import { useState } from 'react'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import ChatBot from './components/ChatBot'
import Overview from './pages/Overview'
import WaferMap from './pages/WaferMap'
import { ShapPage, ImportancePage } from './pages/FeatureAnalysis'
import DataTablePage from './pages/DataTable'
import './App.css'


export default function App() {
  const [activePage, setActivePage] = useState('overview')
  const [notifOpen, setNotifOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  function renderPageWithProps(page) {
    switch (page) {
      case 'overview':        return <Overview />
      case 'wafer-map':       return <WaferMap />
      case 'feat-importance': return <ImportancePage />
      case 'feat-shap':       return <ShapPage />
      case 'data-table':      return <DataTablePage />
      default:                return <Overview />
    }
  }

  return (
    <div className="app">
      <TopBar notifOpen={notifOpen} setNotifOpen={setNotifOpen} />

      <div className="app-body">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />

        <main className="main-content">
          {renderPageWithProps(activePage)}
        </main>

        <ChatBot open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>

      {!chatOpen && (
        <button className="chatbot-fab" onClick={() => setChatOpen(true)} title="AI 어시스턴트 (더미)">
          🤖<span className="fab-dummy-badge">🚧</span>
        </button>
      )}

      {notifOpen && <div className="overlay" onClick={() => setNotifOpen(false)} />}
      <div className={`notif-panel ${notifOpen ? 'open' : ''}`}>
        <div className="np-header">
          <div className="np-title">🔔 위험 감지 알림</div>
          <button className="np-close" onClick={() => setNotifOpen(false)}>✕</button>
        </div>
        <div style={{
          margin: '8px 12px',
          padding: '7px 12px',
          background: '#FEF2F2',
          border: '1.5px solid #EF4444',
          borderRadius: 6,
          fontSize: 11,
          color: '#B91C1C',
          fontWeight: 600,
        }}>
          🔴 더미 알림 — 실제 예측 결과 기반 알림 로직 미구현
        </div>
        <div className="np-list">
          {[
            { lot:'LOT-2024A', time:'14:32', level:'HIGH', msg:'불량 확률 78% — 즉시 확인 필요' },
            { lot:'LOT-2024B', time:'13:58', level:'MED',  msg:'불량 확률 52%' },
            { lot:'WFR-044',   time:'13:21', level:'MED',  msg:'Position 3 이상 감지' },
            { lot:'LOT-2023F', time:'12:44', level:'LOW',  msg:'주의 수준 — 모니터링 중' },
          ].map((n,i) => (
            <div key={i} className="np-item">
              <div className="np-top">
                <span className={`np-lot level-${n.level.toLowerCase()}`}>{n.lot}</span>
                <span className="np-time">{n.time} <span className={`badge badge-${n.level.toLowerCase()}`}>{n.level}</span></span>
              </div>
              <div className="np-msg">{n.msg}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
