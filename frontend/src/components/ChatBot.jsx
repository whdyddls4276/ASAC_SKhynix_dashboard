import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import './ChatBot.css'

const API_URL = ''

const INIT_AGENT = {
  role: 'bot',
  text: '안녕하세요! 불량 예측 분석 어시스턴트입니다.\n\n유닛·LOT·피처에 대해 물어보세요.\n예) "S22474는 왜 위험해?", "제일 위험한 LOT 어디야?", "X592 분포 보여줘"',
}

// RAG 탭: 벡터 DB(사내 교육자료·용어집·논문) 기반 도메인 지식 Q&A
const INIT_ASSISTANT = {
  role: 'bot',
  text: '안녕하세요! SK Hynix Wafer Test 도메인 전문 어시스턴트입니다.\n\n반도체·DRAM 공정, 모델링 개념, 용어를 물어보세요.\n예) "PTE가 뭐야?", "Zero-inflated 모델이 뭐야?", "HBM이랑 DDR 차이는?"',
}

// tool 진행 표시 라벨
const TOOL_LABELS = {
  get_top_unit_data:            '🔍 유닛 정보 조회 중...',
  get_unit_shap_bar:            '🧬 원인 피처(SHAP) 분석 중...',
  get_top_risk_units:           '⚠️ 위험 유닛 조회 중...',
  get_candidate_units:          '📋 대표 유닛 조회 중...',
  get_feature_dist_compare:     '📊 피처 분포 비교 중...',
  get_lot_mean_ppm_top:         '🏭 LOT 위험도 조회 중...',
  get_wafer_risk_die_ratio_top: '🔲 웨이퍼 위험도 조회 중...',
  get_lot_grade_stack:          '🏭 LOT 위험 분포 분석 중...',
  get_importance:               '📈 피처 중요도 조회 중...',
}

// 추천 질문. short=버튼 라벨, label=전송/말풍선 질문. needsUnit=유닛 선택 선행 필요(후보 버튼 흐름)
const RECOMMENDED_QUESTIONS = [
  { id: 'lot_concentration', short: 'LOT 집중·분산 확인',  label: '이번 위험은 특정 LOT에 집중됐나요, 여러 LOT에 분산됐나요?' },
  { id: 'unit_reason',       short: '고위험 UNIT 원인 보기', label: null, needsUnit: true },
  // ③ 라벨/문구는 selectedUnit 유무에 따라 handleRecommended에서 동적 결정
  { id: 'other_risk_units',  short: '고위험 UNIT 더 보기',  label: '추가로 확인할 고위험 UNIT이 있나요?', dynamic: true },
]

export default function ChatBot({ open, onClose, onReportGenerated, onOpenReport }) {
  const [mode, setMode] = useState('agent')   // 'agent'(데이터 분석) | 'assistant'(도메인 RAG)

  // ── 에이전트 탭 상태 ──────────────────────────────────────────
  const [agentMsgs, setAgentMsgs] = useState([INIT_AGENT])

  // ── 도메인 Q&A(RAG) 탭 상태 ───────────────────────────────────
  // 에이전트와 달리 history를 서버로 넘긴다 (후속질문 맥락 유지)
  const [assistMsgs, setAssistMsgs] = useState([INIT_ASSISTANT])
  const assistHistoryRef = useRef([])

  const [input, setInput]    = useState('')
  const [loading, setLoading] = useState(false)
  const [recoOpen, setRecoOpen] = useState(true)   // 추천 질문 패널 펼침 여부
  const [unitCandidates, setUnitCandidates] = useState([])   // 유닛 선택 대기 시 후보 버튼
  // 후속질문 맥락: 직전까지 다룬 대상 (대화 history 대신 이것만 백엔드로 전달)
  const entityRef = useRef({ selected_unit: null, selected_feature: null, selected_lot: null, selected_wafer: null })
  const bottomRef = useRef(null)

  // 현재 탭의 메시지 목록 (렌더용)
  const messages = mode === 'agent' ? agentMsgs : assistMsgs

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [agentMsgs, assistMsgs])

  // 스트리밍 중인 bot 메시지를 갱신. 직전이 스트리밍/상태 말풍선이면 그것을 텍스트로 교체
  // (→ "분석 중..." 상태 말풍선이 최종 답변으로 바뀌고, 완료 후 잔재가 안 남음)
  function updateStreamMsg(text, final) {
    setAgentMsgs(prev => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last?.role === 'bot' && (last?.streaming || last?.status))
        return next.map((m, i) => i === next.length - 1
          ? { role: 'bot', text, streaming: !final } : m)
      return [...next, { role: 'bot', text, streaming: !final }]
    })
  }

  // tool 진행 상태 표시 — 상태 말풍선 1개만 유지. 직전이 상태 OR 스트리밍중(서두 멘트)이면
  // 그것을 상태로 덮어씀 → LLM이 tool 호출 전 붙인 "조회하겠습니다" 서두 멘트가 화면에 안 남음.
  function addStatus(tool) {
    const label = TOOL_LABELS[tool] || `⚙️ ${tool}...`
    setAgentMsgs(prev => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (last?.role === 'bot' && (last?.status || last?.streaming))
        return next.map((m, i) => i === next.length - 1 ? { role: 'bot', text: label, status: true } : m)
      return [...next, { role: 'bot', text: label, status: true }]
    })
  }

  // 현재 질문에서 엔티티 추출 → entityRef 갱신 (현재 질문 명시값 우선, 새 UNIT이면 하위 대상 초기화)
  function updateEntityFromQuestion(msg) {
    const unit = (msg.match(/\bS\d{4,}\b/i) || [])[0]?.toUpperCase() || null
    const feature = (msg.match(/\bX\d+\b/i) || [])[0]?.toUpperCase() || null
    const lot = (msg.match(/(?:LOT|로트)\s*_?\s*(\d+)/i) || [])[1] || null
    const cur = entityRef.current
    let next = { ...cur }
    if (unit && unit !== cur.selected_unit) {
      // 새 UNIT → 이전 유닛의 피처/LOT/웨이퍼가 잘못 붙지 않도록 초기화 후 새 UNIT만
      next = { selected_unit: unit, selected_feature: null, selected_lot: null, selected_wafer: null }
    }
    if (feature) next.selected_feature = feature   // 현재 질문의 피처 우선
    if (lot) next.selected_lot = lot
    entityRef.current = next
  }

  // tool 결과에서 엔티티 보정 (질문에 없던 대상을 결과로 보완)
  function updateEntityFromResult(tool, result) {
    if (!result || typeof result !== 'object') return
    const c = entityRef.current
    if (result.serial && !c.selected_unit) c.selected_unit = String(result.serial)
    if (result.run_id != null && !c.selected_lot) c.selected_lot = String(result.run_id)
    if (result.wafer_no != null && !c.selected_wafer) c.selected_wafer = String(result.wafer_no)
    // 유닛 SHAP 결과(list)의 1위 양수 피처를 선택 피처로 보완
    if (Array.isArray(result) && !c.selected_feature) {
      const pos = result.find(it => (it?.signed ?? 0) > 0 && /^X\d+$/.test(it?.feature || ''))
      if (pos) c.selected_feature = pos.feature
    }
    if (result.feature && !c.selected_feature) c.selected_feature = String(result.feature)
  }

  function resetEntity() {
    entityRef.current = { selected_unit: null, selected_feature: null, selected_lot: null, selected_wafer: null }
  }

  // 마지막 봇 메시지에 [보고서 반영] 버튼 마커를 붙임 (유닛 SHAP 답변에만)
  function markLastBotForApply(serial) {
    setAgentMsgs(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'bot' && !next[i].status && !next[i].error) {
          next[i] = { ...next[i], applyUnit: serial }
          break
        }
      }
      return next
    })
  }

  // ── 자유 질의 전송 (SSE 스트리밍) ─────────────────────────
  // mode="chat": 자유 입력(entity_context로 후속질문 맥락) / "recommended": 추천 질문(독립)
  // applyUnitSerial: 값이 있으면 이 답변(유닛 SHAP)에 [보고서 반영] 버튼 마커를 붙임
  async function sendFreeQuery(msg, mode = 'chat', applyUnitSerial = null) {
    setAgentMsgs(prev => [...prev, { role: 'user', text: msg }])
    setLoading(true)

    // 추천 질문은 독립 시나리오 → 맥락 없음. 자유 입력만 엔티티 추출/전달
    if (mode === 'recommended') resetEntity()
    else updateEntityFromQuestion(msg)

    let botText = ''
    let buffer = ''
    let sawTool = false
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: [],   // 대화 history는 넘기지 않음 (재실행·묶음답변 차단)
          context: 'free_query',
          mode,
          entity_context: mode === 'recommended' ? {} : entityRef.current,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          let ev; try { ev = JSON.parse(raw) } catch { continue }
          if (ev.type === 'text') { botText += ev.content; updateStreamMsg(botText, false) }
          if (ev.type === 'tool_start') { botText = ''; sawTool = true; addStatus(ev.tool) }
          if (ev.type === 'tool_result' && mode !== 'recommended') { updateEntityFromResult(ev.tool, ev.result) }
          if (ev.type === 'done') {
            if (botText) {
              updateStreamMsg(botText, true)
              // 유닛 SHAP 답변이 성공했을 때만 반영 버튼 마커 (단순 후보목록엔 안 붙음)
              if (applyUnitSerial) markLastBotForApply(applyUnitSerial)
            } else if (sawTool) {
              // 빈 응답 방어: tool은 돌았는데 텍스트가 없음 (임의 문장 조립 안 함)
              updateStreamMsg('분석 결과를 생성하지 못했습니다. 다시 시도해주세요.', true)
            }
          }
          if (ev.type === 'error') {
            setAgentMsgs(prev => [...prev, { role: 'bot', text: `⚠️ ${ev.message}`, error: true }])
          }
        }
      }
    } catch {
      setAgentMsgs(prev => [...prev, {
        role: 'bot',
        text: '⚠️ 분석 서버에 연결하지 못했습니다. 서버 실행 상태를 확인해주세요.',
        error: true,
      }])
    } finally {
      setLoading(false)
    }
  }

  // ── 도메인 Q&A 전송 (RAG, 단순 JSON 응답 — SSE 아님) ──────────
  async function sendAssistant(msg) {
    setAssistMsgs(prev => [...prev, { role: 'user', text: msg }])
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/chat/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: assistHistoryRef.current }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || res.statusText)
      }
      const data = await res.json()
      assistHistoryRef.current = data.history || []
      setAssistMsgs(prev => [...prev, { role: 'bot', text: data.response }])
    } catch (e) {
      setAssistMsgs(prev => [...prev, {
        role: 'bot',
        text: `⚠️ ${e.message || '서버 연결에 실패했습니다. 분석 서버(8000) 실행 상태를 확인해주세요.'}`,
        error: true,
      }])
    } finally {
      setLoading(false)
    }
  }

  async function send() {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    if (mode === 'assistant') await sendAssistant(msg)
    else await sendFreeQuery(msg)
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function handleTabChange(newMode) {
    if (loading) return       // 응답 대기 중 탭 전환 시 결과가 엉뚱한 탭에 꽂히는 것 방지
    setMode(newMode)
    setInput('')
  }

  function handleReset() {
    if (mode === 'assistant') {
      setAssistMsgs([INIT_ASSISTANT])
      assistHistoryRef.current = []
    } else {
      setAgentMsgs([INIT_AGENT])
      resetEntity()        // 대화 초기화 시 엔티티 맥락도 비움 (다음 분석 오염 방지)
      setUnitCandidates([])
    }
    setInput('')
  }

  // 추천 질문 클릭
  async function handleRecommended(q) {
    if (loading) return
    console.info('recommended_question_clicked', { intentId: q.id })

    // 유닛 선택이 선행돼야 하는 질문(② UNIT 원인) → 후보 버튼을 먼저 제시
    if (q.needsUnit) {
      try {
        const res = await fetch(`${API_URL}/candidate-units?n=5`)
        const data = await res.json()
        const units = data.units || []
        if (units.length) {
          setUnitCandidates(units)
          setAgentMsgs(prev => [...prev, { role: 'bot', text: '어느 UNIT의 위험 원인을 볼까요? (예측 ppm 높은 순)' }])
        } else {
          setAgentMsgs(prev => [...prev, { role: 'bot', text: '후보 UNIT을 불러오지 못했습니다.', error: true }])
        }
      } catch {
        setAgentMsgs(prev => [...prev, { role: 'bot', text: '⚠️ 후보 조회 실패. 서버(8000)를 확인해주세요.', error: true }])
      }
      return
    }

    // ③ 고위험 UNIT 더 보기: 현재 다루던 유닛이 있으면 그 유닛을 제외하도록 문구를 동적 생성
    if (q.dynamic && q.id === 'other_risk_units') {
      const cur = entityRef.current.selected_unit
      const label = cur
        ? `${cur} 외에 추가로 확인할 고위험 UNIT이 있나요?`
        : q.label
      sendFreeQuery(label, 'recommended')
      return
    }

    sendFreeQuery(q.label, 'recommended')
  }

  // 후보 UNIT 버튼 클릭 → 그 유닛으로 SHAP 원인 분석. 이 답변엔 [보고서 생성] 버튼 마커를 붙임
  function handleUnitPick(u) {
    if (loading) return
    setUnitCandidates([])
    sendFreeQuery(`${u.serial}는 왜 위험하게 예측됐나요?`, 'chat', u.serial)
  }

  // [이 유닛으로 보고서 생성] 클릭 → 챗봇 안에서 그 유닛 대표 보고서를 생성(run_agent, SSE로 진행표시).
  // 완료되면 App에 보고서를 넘기고 "생성 완료 [보고서 열기]"를 띄움 (방식2: 생성→열기).
  async function handleGenerateReport(serial) {
    if (loading) return
    setLoading(true)
    setAgentMsgs(prev => [...prev, { role: 'user', text: `${serial} 유닛으로 보고서를 생성해줘` }])

    let buffer = ''
    let done = false
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // context 없음 = run_agent(보고서 생성). serial만 보내면 그 유닛 대표로 생성(백엔드에서 스캔 자동)
        body: JSON.stringify({ message: serial, history: [], tool_cache: {} }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done: rdDone, value } = await reader.read()
        if (rdDone) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          let ev; try { ev = JSON.parse(raw) } catch { continue }
          if (ev.type === 'tool_start') addStatus(ev.tool)               // 🔍 스캔 중 등
          if (ev.type === 'text' && ev.content?.trim())
            setAgentMsgs(prev => [...prev, { role: 'bot', text: ev.content }])   // 스캔결과·피처 요약
          if (ev.type === 'report_ready' && ev.html) {
            done = true
            onReportGenerated?.({ html: ev.html, report_data: ev.report_data, serial })
            setAgentMsgs(prev => [...prev, { role: 'bot', text: `✅ ${serial} 유닛을 대표로 보고서를 생성했습니다.`, openReport: true }])
          }
        }
      }
      if (!done) setAgentMsgs(prev => [...prev, { role: 'bot', text: '⚠️ 보고서 생성에 실패했습니다. 다시 시도해주세요.', error: true }])
    } catch {
      setAgentMsgs(prev => [...prev, { role: 'bot', text: '⚠️ 분석 서버에 연결하지 못했습니다. 서버 실행 상태를 확인해주세요.', error: true }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`chatbot-panel ${open ? 'open' : ''}`}>
      <div className="cb-header">
        <div className="cb-title">💬 분석 어시스턴트</div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button className="cb-close" onClick={handleReset} title="대화 초기화">🔄</button>
          <button className="cb-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="cb-tabs">
        <button
          className={`cb-tab ${mode === 'agent' ? 'active' : ''}`}
          onClick={() => handleTabChange('agent')}
        >
          🔧 분석
        </button>
        <button
          className={`cb-tab ${mode === 'assistant' ? 'active' : ''}`}
          onClick={() => handleTabChange('assistant')}
        >
          📚 도메인 Q&A
        </button>
      </div>

      <div className="cb-messages">
        {messages.map((m, i) => (
          <div key={i} className={`cb-msg ${m.role}`}>
            {m.role === 'bot' && <div className="cb-avatar">AI</div>}
            <div className="cb-bubble-wrap">
              <div className={`cb-bubble ${m.error ? 'error' : ''} ${m.status ? 'status' : ''}`}>
                {m.role === 'bot'
                  ? <ReactMarkdown>{m.text}</ReactMarkdown>
                  : <span>{m.text}</span>
                }
              </div>
              {/* 유닛 SHAP 답변 아래: [이 유닛으로 보고서 생성] (방식2 — 챗봇 안에서 생성) */}
              {m.applyUnit && (
                <button className="cb-apply-btn" disabled={loading}
                  onClick={() => handleGenerateReport(m.applyUnit)}>
                  📄 이 유닛으로 보고서 생성
                </button>
              )}
              {/* 생성 완료 답변 아래: [보고서 열기] → 보고서 화면으로 전환 */}
              {m.openReport && (
                <button className="cb-open-btn" onClick={() => onOpenReport?.()}>
                  📑 보고서 열기
                </button>
              )}
            </div>
          </div>
        ))}

        {/* 유닛 선택 대기: 후보 버튼 (serial + 예측 ppm) — 분석 탭 전용 */}
        {mode === 'agent' && unitCandidates.length > 0 && !loading && (
          <div className="cb-unit-picker">
            {unitCandidates.map(u => (
              <button key={u.serial} className="cb-unit-btn" onClick={() => handleUnitPick(u)}>
                <span className="cb-unit-serial">{u.serial}</span>
                <span className="cb-unit-ppm">{Math.round(u.ppm).toLocaleString()} ppm</span>
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="cb-msg bot">
            <div className="cb-avatar">AI</div>
            <div className="cb-bubble status">
              <span className="cb-typing"><span /><span /><span /></span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 추천 질문: 입력창 바로 위 고정 영역 (스크롤에 안 밀림) — 분석 탭 전용 */}
      {mode === 'agent' && (
      <div className="cb-reco">
        <button
          className="cb-reco-toggle"
          onClick={() => setRecoOpen(v => !v)}
        >
          💡 다음으로 확인할 분석 {recoOpen ? '▾' : '▸'}
        </button>
        {recoOpen && (
          <div className="cb-reco-list">
            {RECOMMENDED_QUESTIONS.map(q => {
              // ③은 현재 다루던 유닛이 있으면 라벨을 '다른 고위험 UNIT 보기'로
              const short = (q.id === 'other_risk_units' && entityRef.current.selected_unit)
                ? '다른 고위험 UNIT 보기' : q.short
              return (
                <button
                  key={q.id}
                  className="cb-reco-btn"
                  onClick={() => handleRecommended(q)}
                  disabled={loading}
                >
                  {short} <span className="cb-reco-arrow">→</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      )}

      <div className="cb-input-row">
        <textarea
          className="cb-input"
          placeholder={mode === 'agent'
            ? '유닛·LOT·피처를 물어보세요 (예: S22474 왜 위험해?)'
            : '반도체·공정·모델링 용어를 물어보세요 (예: PTE가 뭐야?)'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          disabled={loading}
        />
        <button className="cb-send" onClick={send} disabled={loading}>전송</button>
      </div>
    </div>
  )
}
