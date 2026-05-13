import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import ReportModal from './ReportModal'
import './ChatBot.css'

const API_URL = 'http://localhost:8000'

export default function ChatBot({ open, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      text: '안녕하세요! SK Hynix 품질 분석 AI Agent입니다.\n"이번 주 보고서 만들어줘" 처럼 요청해보세요.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [buttons, setButtons] = useState([])       // PI 확인 버튼 목록
  const [reportMd, setReportMd] = useState(null)
  const [reportData, setReportData] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const historyRef  = useRef([])                    // Claude API용 대화 이력
  const toolCacheRef = useRef({})                   // 실행 완료된 tool 결과 (재실행 방지)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, buttons])

  function addBotMsg(text, opts = {}) {
    setMessages(prev => [...prev, { role: 'bot', text, ...opts }])
  }

  async function send(text) {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    setButtons([])

    setMessages(prev => [...prev, { role: 'user', text: msg }])
    historyRef.current.push({ role: 'user', content: msg })
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: historyRef.current.slice(0, -1),
          tool_cache: toolCacheRef.current,        // 이미 실행된 tool 결과 전달
        }),
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let botText = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // 마지막 불완전한 줄은 버퍼에 남김

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue

          let event
          try {
            event = JSON.parse(raw)
          } catch { continue }

          if (event.type === 'text') {
            botText += event.content
            setMessages(prev => {
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
              infer_period: '📅 기간 추론 중...',
              scan_data: '🔍 데이터 스캔 중...',
              analyze_features: '📊 feature 분포 비교 중...',
              get_importance: '📋 feature importance 조회 중...',
            }
            addBotMsg(labels[event.tool] || `⚙️ ${event.tool} 실행 중...`, { status: true })
          }

          if (event.type === 'tool_result') {
            // 실행 완료된 tool 결과 누적 저장 → 다음 요청 시 재실행 방지
            toolCacheRef.current = {
              ...toolCacheRef.current,
              [event.tool]: event.result,
            }
          }

          if (event.type === 'confirm') {
            setButtons(event.buttons)
          }

          if (event.type === 'report_ready') {
            setReportMd(event.html)
            setReportData(event.report_data || null)
            addBotMsg('보고서 초안이 완성됐습니다. 확인해주세요.', { reportReady: true })
          }

          if (event.type === 'error') {
            addBotMsg(`⚠️ ${event.message}`)
            setLoading(false)
          }

          if (event.type === 'done') {
            setLoading(false)
          }
        }
      }
      // 버퍼에 남은 데이터 처리
      if (buffer.startsWith('data: ')) {
        const raw = buffer.slice(6).trim()
        if (raw && raw !== '[DONE]') {
          try { JSON.parse(raw) } catch { /* 불완전한 데이터 무시 */ }
        }
      }

      // streaming 플래그 제거
      setMessages(prev =>
        prev.map(m => m.streaming ? { ...m, streaming: false } : m)
      )
      if (botText) {
        historyRef.current.push({ role: 'assistant', content: botText })
      }
    } catch (err) {
      addBotMsg('⚠️ 서버 연결에 실패했습니다. FastAPI 서버가 실행 중인지 확인해주세요.')
      setLoading(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function handleButton(btn) {
    send(btn)
  }

  function handleReset() {
    setMessages([{
      role: 'bot',
      text: '안녕하세요! SK Hynix 품질 분석 AI Agent입니다.\n"이번 주 보고서 만들어줘" 처럼 요청해보세요.',
    }])
    setInput('')
    setButtons([])
    setReportMd(null)
    setReportData(null)
    setModalOpen(false)
    historyRef.current = []
    toolCacheRef.current = {}
  }

  async function handleDevPreview() {
    try {
      const res = await fetch(`${API_URL}/report/preview`)
      const html = await res.text()
      setReportMd(html)
      setReportData(null)
      setModalOpen(true)
    } catch {
      alert('서버 연결 실패. FastAPI 서버가 실행 중인지 확인하세요.')
    }
  }

  return (
    <>
      <div className={`chatbot-panel ${open ? 'open' : ''}`}>
        <div className="cb-header">
          <div className="cb-title">🤖 AI Agent</div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className="cb-close"
              onClick={handleDevPreview}
              title="[DEV] API 없이 바로 미리보기"
              style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', width: 'auto', color: '#F59E0B', borderColor: '#F59E0B' }}
            >
              DEV
            </button>
            <button
              className="cb-close"
              onClick={handleReset}
              title="대화 초기화"
            >
              🔄
            </button>
            <button className="cb-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="cb-messages">
          {messages.map((m, i) => (
            <div key={i} className={`cb-msg ${m.role}`}>
              {m.role === 'bot' && (
                <div className="cb-avatar">AI</div>
              )}
              <div className={`cb-bubble ${m.status ? 'status' : ''} ${m.streaming ? 'streaming' : ''}`}>
                {m.role === 'bot' && !m.status ? (
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                ) : (
                  <span>{m.text}</span>
                )}
                {m.reportReady && (
                  <button className="cb-preview-btn" onClick={() => setModalOpen(true)}>
                    미리보기 열기
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* PI 확인 버튼 */}
          {buttons.length > 0 && !loading && (
            <div className="cb-buttons">
              {buttons.map(btn => (
                <button key={btn} className="cb-btn" onClick={() => handleButton(btn)}>
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
            placeholder="보고서 생성, 원인 분석을 요청하세요..."
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
