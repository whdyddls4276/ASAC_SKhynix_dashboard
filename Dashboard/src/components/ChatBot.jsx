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
  const [buttons, setButtons] = useState([])
  const [reportMd, setReportMd] = useState(null)
  const [reportData, setReportData] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const historyRef   = useRef([])
  const toolCacheRef = useRef({})
  const bottomRef    = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, buttons])

  function addBotMsg(text, opts = {}) {
    setMessages(prev => [...prev, { role: 'bot', text, ...opts }])
  }

  // ── DEV: 바로 미리보기 ──────────────────────────────────────
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

  // ── PROD: 에이전트 대화 ─────────────────────────────────────
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
              scan_data:        '🔍 데이터 스캔 중...',
              analyze_features: '📊 feature 분포 비교 중...',
              get_importance:   '📋 feature importance 조회 중...',
            }
            addBotMsg(labels[event.tool] || `⚙️ ${event.tool} 실행 중...`, { status: true })
          }

          if (event.type === 'tool_result') {
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
            // 보고서 완성 → 자동으로 미리보기 오픈
            setModalOpen(true)
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

      if (buffer.startsWith('data: ')) {
        const raw = buffer.slice(6).trim()
        if (raw && raw !== '[DONE]') {
          try { JSON.parse(raw) } catch { /* 불완전한 데이터 무시 */ }
        }
      }

      setMessages(prev =>
        prev.map(m => m.streaming ? { ...m, streaming: false } : m)
      )
      if (botText) {
        historyRef.current.push({ role: 'assistant', content: botText })
      }
    } catch {
      addBotMsg('⚠️ 서버 연결에 실패했습니다. FastAPI 서버가 실행 중인지 확인해주세요.')
      setLoading(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
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
    historyRef.current   = []
    toolCacheRef.current = {}
  }

  return (
    <>
      <div className={`chatbot-panel ${open ? 'open' : ''}`}>
        <div className="cb-header">
          <div className="cb-title">🤖 AI Agent</div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {/* DEV 버튼: 보고서 즉시 미리보기 */}
            <button
              className="cb-close"
              onClick={handleDevPreview}
              title="DEV: 보고서 즉시 미리보기"
              style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px',
                       width: 'auto', color: '#D97706', borderColor: '#D97706' }}
            >
              DEV
            </button>
            <button className="cb-close" onClick={handleReset} title="대화 초기화">🔄</button>
            <button className="cb-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="cb-messages">
          {messages.map((m, i) => (
            <div key={i} className={`cb-msg ${m.role}`}>
              {m.role === 'bot' && <div className="cb-avatar">AI</div>}
              <div className={`cb-bubble ${m.status ? 'status' : ''} ${m.streaming ? 'streaming' : ''}`}>
                {m.role === 'bot' && !m.status ? (
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                ) : (
                  <span>{m.text}</span>
                )}
              </div>
            </div>
          ))}

          {buttons.length > 0 && !loading && (
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
