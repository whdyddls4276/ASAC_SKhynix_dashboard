import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import ReportModal from './ReportModal'
import './ChatBot.css'

const API_URL = ''  // Vite 프록시 경유 (/chat, /report → localhost:8000 / /chat/assistant → localhost:8002)

const INIT_AGENT = {
  role: 'bot',
  text: '안녕하세요! SK Hynix 품질 분석 AI Agent입니다.\n"이번 주 보고서 만들어줘" 처럼 요청해보세요.',
}
const INIT_ASSISTANT = {
  role: 'bot',
  text: '안녕하세요! SK Hynix Wafer Test 도메인 전문 어시스턴트입니다.\n반도체, DRAM, 공정, 모델링 관련 질문을 해주세요.',
}

export default function ChatBot({ open, onClose }) {
  const [mode, setMode] = useState('agent')  // 'agent' | 'assistant'

  // ── 에이전트 상태 ─────────────────────────────────────────────
  const [agentMsgs, setAgentMsgs]   = useState([INIT_AGENT])
  const [buttons, setButtons]        = useState([])
  const [reportMd, setReportMd]      = useState(null)
  const [reportData, setReportData]  = useState(null)
  const [modalOpen, setModalOpen]    = useState(false)
  const agentHistoryRef = useRef([])
  const toolCacheRef    = useRef({})

  // ── 어시스턴트 상태 ───────────────────────────────────────────
  const [assistMsgs, setAssistMsgs]  = useState([INIT_ASSISTANT])
  const assistHistoryRef = useRef([])

  const [input, setInput]     = useState('')
  const [loading, setLoading]  = useState(false)
  const bottomRef = useRef(null)

  const messages = mode === 'agent' ? agentMsgs : assistMsgs

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [agentMsgs, assistMsgs, buttons])

  // ── DEV: 보고서 즉시 미리보기 ────────────────────────────────
  async function handleDevPreview() {
    try {
      const res  = await fetch(`${API_URL}/report/preview`)
      const json = await res.json()
      setReportMd(json.html)
      setReportData(json.report_data || null)
      setModalOpen(true)
    } catch {
      alert('서버 연결 실패. FastAPI 서버가 실행 중인지 확인하세요.')
    }
  }

  // ── 에이전트 전송 (SSE 스트리밍) ─────────────────────────────
  async function sendAgent(msg) {
    setAgentMsgs(prev => [...prev, { role: 'user', text: msg }])
    agentHistoryRef.current.push({ role: 'user', content: msg })
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: agentHistoryRef.current.slice(0, -1),
          tool_cache: toolCacheRef.current,
        }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let botText = ''
      let buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue

          let event
          try { event = JSON.parse(raw) } catch { continue }

          if (event.type === 'text') {
            botText += event.content
            setAgentMsgs(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'bot' && last?.streaming) {
                next[next.length - 1] = { ...last, text: botText }
              } else {
                next.push({ role: 'bot', text: botText, streaming: true })
              }
              return next
            })
          }

          if (event.type === 'tool_start') {
            const labels = {
              scan_data:        '🔍 데이터 스캔 중...',
              analyze_features: '📊 feature 분포 비교 중...',
              get_importance:   '📋 feature importance 조회 중...',
            }
            setAgentMsgs(prev => [...prev, {
              role: 'bot',
              text: labels[event.tool] || `⚙️ ${event.tool} 실행 중...`,
              status: true,
            }])
          }

          if (event.type === 'tool_result') {
            toolCacheRef.current = { ...toolCacheRef.current, [event.tool]: event.result }
          }

          if (event.type === 'confirm') {
            setButtons(event.buttons)
          }

          if (event.type === 'report_ready') {
            setReportMd(event.html)
            setReportData(event.report_data || null)
            setModalOpen(true)
          }

          if (event.type === 'error') {
            setAgentMsgs(prev => [...prev, { role: 'bot', text: `⚠️ ${event.message}` }])
            setLoading(false)
          }

          if (event.type === 'done') {
            setLoading(false)
          }
        }
      }

      setAgentMsgs(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m))
      if (botText) agentHistoryRef.current.push({ role: 'assistant', content: botText })
    } catch {
      setAgentMsgs(prev => [...prev, {
        role: 'bot',
        text: '⚠️ 서버 연결에 실패했습니다. FastAPI 서버(8000)가 실행 중인지 확인해주세요.',
      }])
      setLoading(false)
    }
  }

  // ── 어시스턴트 전송 (RAG, JSON 응답) ─────────────────────────
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
        text: `⚠️ ${e.message || '서버 연결에 실패했습니다. RAG 서버(8002)가 실행 중인지 확인해주세요.'}`,
        error: true,
      }])
    } finally {
      setLoading(false)
    }
  }

  // ── 통합 전송 ─────────────────────────────────────────────────
  async function send(text) {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    setButtons([])

    if (msg === '기간 변경') toolCacheRef.current = {}

    if (mode === 'agent') {
      await sendAgent(msg)
    } else {
      await sendAssistant(msg)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function handleReset() {
    if (mode === 'agent') {
      setAgentMsgs([INIT_AGENT])
      setButtons([])
      setReportMd(null)
      setReportData(null)
      setModalOpen(false)
      agentHistoryRef.current = []
      toolCacheRef.current    = {}
    } else {
      setAssistMsgs([INIT_ASSISTANT])
      assistHistoryRef.current = []
    }
    setInput('')
  }

  function handleTabChange(newMode) {
    setMode(newMode)
    setInput('')
    setLoading(false)
  }

  const placeholder = mode === 'agent'
    ? '보고서 생성, 원인 분석을 요청하세요...'
    : '반도체, 공정, 모델링 관련 질문을 해주세요...'

  return (
    <>
      <div className={`chatbot-panel ${open ? 'open' : ''}`}>
        <div className="cb-header">
          <div className="cb-title">🤖 AI 어시스턴트</div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {mode === 'agent' && (
              <button
                className="cb-close"
                onClick={handleDevPreview}
                title="DEV: 보고서 즉시 미리보기"
                style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px',
                         width: 'auto', color: '#D97706', borderColor: '#D97706' }}
              >
                DEV
              </button>
            )}
            <button className="cb-close" onClick={handleReset} title="대화 초기화">🔄</button>
            <button className="cb-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* 탭 */}
        <div className="cb-tabs">
          <button
            className={`cb-tab ${mode === 'agent' ? 'active' : ''}`}
            onClick={() => handleTabChange('agent')}
          >
            🔧 에이전트
          </button>
          <button
            className={`cb-tab ${mode === 'assistant' ? 'active' : ''}`}
            onClick={() => handleTabChange('assistant')}
          >
            💬 어시스턴트
          </button>
        </div>

        <div className="cb-messages">
          {messages.map((m, i) => (
            <div key={i} className={`cb-msg ${m.role}`}>
              {m.role === 'bot' && <div className="cb-avatar">AI</div>}
              <div className={`cb-bubble ${m.status ? 'status' : ''} ${m.streaming ? 'streaming' : ''} ${m.error ? 'error' : ''}`}>
                {m.role === 'bot' && !m.status ? (
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                ) : (
                  <span>{m.text}</span>
                )}
              </div>
            </div>
          ))}

          {mode === 'agent' && buttons.length > 0 && !loading && (
            <div className="cb-buttons">
              {buttons.map(btn => (
                <button key={btn} className="cb-btn" onClick={() => send(btn)}>
                  {btn}
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

        <div className="cb-input-row">
          <textarea
            className="cb-input"
            placeholder={placeholder}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={2}
            disabled={loading}
          />
          <button className="cb-send" onClick={() => send()} disabled={loading}>
            전송
          </button>
        </div>
      </div>

      {modalOpen && (
        <ReportModal
          markdown={reportMd}
          reportData={reportData}
          toolCache={toolCacheRef.current}
          onClose={() => setModalOpen(false)}
          onEdit={() => { setModalOpen(false); setInput('') }}
          apiUrl={API_URL}
        />
      )}
    </>
  )
}
