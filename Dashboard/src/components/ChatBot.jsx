import { useState, useRef, useEffect } from 'react'
import './ChatBot.css'

const DUMMY_ASSISTANT = [
  '불량률(Defect Rate)은 전체 unit 중 예측 health 값이 임계값(0.015)을 초과하는 unit의 비율입니다.',
  'SHAP(SHapley Additive exPlanations)은 각 feature가 모델 예측에 얼마나 기여했는지를 나타내는 지표입니다.',
  'Position은 unit 내 die의 위치(1~4)를 의미합니다. 동일 unit의 4개 die가 각각 다른 위치에 배치됩니다.',
  'WT(Wafer Test)는 패키징 전 웨이퍼 상태에서 수행되는 전기적 테스트입니다.',
  'y_pred는 모델이 예측한 health 값으로, 값이 클수록 Field 불량 가능성이 높습니다.',
]

const DUMMY_AGENT = [
  '(더미) 이번 LOT-2024A 분석 결과: Position 3 집중, X739 feature 이상 수치 감지. 공정 조건 점검을 권장합니다.',
  '(더미) 유사 패턴 이력 조회 중… 2023년 11월 LOT-2023F와 유사한 패턴입니다. 당시 조치: 장비 캘리브레이션.',
  '(더미) 개선조치 보고서를 생성합니다. 주요 불량 인자: X739, X1083. 권장 조치: 해당 공정 파라미터 모니터링 강화.',
  '(더미) 방어선 제안: X739 > 임계값 시 자동 알림 설정, Position 3 불량률 > 5% 시 즉시 검토 프로세스 도입.',
  '(더미) 분석 중입니다. 데이터 기반 원인 파악 후 조치 방안을 도출합니다.',
]

export default function ChatBot({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('assistant')
  const [assistantMsgs, setAssistantMsgs] = useState([
    { role: 'bot', text: '안녕하세요! 불량 예측 AI 어시스턴트입니다. 용어나 지표에 대해 궁금한 점을 물어보세요.' }
  ])
  const [agentMsgs, setAgentMsgs] = useState([
    { role: 'bot', text: '안녕하세요! AI Agent입니다. 원인 분석, 패턴 비교, 보고서 생성 등을 요청해보세요.' }
  ])
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  const messages = activeTab === 'assistant' ? assistantMsgs : agentMsgs
  const setMessages = activeTab === 'assistant' ? setAssistantMsgs : setAgentMsgs
  const dummyAnswers = activeTab === 'assistant' ? DUMMY_ASSISTANT : DUMMY_AGENT

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function send() {
    if (!input.trim()) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])

    setTimeout(() => {
      const answer = dummyAnswers[Math.floor(Math.random() * dummyAnswers.length)]
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

      <div className="cb-tabs">
        <button
          className={`cb-tab ${activeTab === 'assistant' ? 'active' : ''}`}
          onClick={() => setActiveTab('assistant')}
        >
          Assistant
        </button>
        <button
          className={`cb-tab ${activeTab === 'agent' ? 'active' : ''}`}
          onClick={() => setActiveTab('agent')}
        >
          Agent
        </button>
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
          placeholder={activeTab === 'assistant' ? '용어나 지표에 대해 질문하세요...' : '원인 분석, 보고서 생성을 요청하세요...'}
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
