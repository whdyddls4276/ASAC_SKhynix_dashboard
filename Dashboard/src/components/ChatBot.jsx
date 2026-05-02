import { useState, useRef, useEffect } from 'react'
import './ChatBot.css'

const DUMMY_ANSWERS = [
  '현재 불량률은 29.1%입니다.',
  'SHAP 분석 결과 X739, X1083이 가장 영향력 있는 feature입니다.',
  '불량 unit Top-3은 S00142, S00387, S00521입니다.',
  'Position 3에서 불량 발생률이 가장 높습니다 (4.8%).',
  '현재 데이터를 분석 중입니다. 잠시만 기다려 주세요.',
]

export default function ChatBot({ open, onClose }) {
  const [messages, setMessages] = useState([
    { role: 'bot', text: '안녕하세요! 불량 예측 AI 어시스턴트입니다. 궁금한 점을 물어보세요.' }
  ])
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function send() {
    if (!input.trim()) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])

    setTimeout(() => {
      const answer = DUMMY_ANSWERS[Math.floor(Math.random() * DUMMY_ANSWERS.length)]
      setMessages(prev => [...prev, { role: 'bot', text: answer }])
    }, 600)
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className={`chatbot-panel ${open ? 'open' : ''}`}>
      <div className="cb-header">
        <div className="cb-title">🤖 AI 어시스턴트</div>
        <button className="cb-close" onClick={onClose}>✕</button>
      </div>

      <div className="cb-messages">
        {messages.map((m, i) => (
          <div key={i} className={`cb-msg ${m.role}`}>
            {m.role === 'bot' && <div className="cb-avatar">AI</div>}
            <div className="cb-bubble">{m.text}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="cb-input-row">
        <textarea
          className="cb-input"
          placeholder="질문을 입력하세요..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
        />
        <button className="cb-send" onClick={send}>전송</button>
      </div>
    </div>
  )
}
