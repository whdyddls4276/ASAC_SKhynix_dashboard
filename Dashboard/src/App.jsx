import { useState } from 'react'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import ChatBot from './components/ChatBot'
import Overview from './pages/Overview'
import { PositionPage, UnitMapPage, WaferZonePage } from './pages/LocationAnalysis'
import { ShapPage, ImportancePage } from './pages/FeatureAnalysis'
import ModelPerformance from './pages/ModelPerformance'
import { DailyPage, MonthlyPage, YearlyPage } from './pages/DateAnalysis'
import DataTablePage from './pages/DataTable'
import './App.css'

function renderPage(page) {
  switch (page) {
    case 'overview':        return <Overview />
    case 'date-daily':      return <DailyPage />
    case 'date-monthly':    return <MonthlyPage />
    case 'date-yearly':     return <YearlyPage />
    case 'loc-position':    return <PositionPage />
    case 'loc-unit':        return <UnitMapPage />
    case 'loc-zone':        return <WaferZonePage />
    case 'feat-shap':       return <ShapPage />
    case 'feat-importance': return <ImportancePage />
    case 'model':           return <ModelPerformance />
    case 'data-table':      return <DataTablePage />
    default:                return <Overview />
  }
}

export default function App() {
  const [activePage, setActivePage] = useState('overview')
  const [notifOpen, setNotifOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <div className="app">
      <TopBar notifOpen={notifOpen} setNotifOpen={setNotifOpen} />

      <div className="app-body">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />

        <main className="main-content">
          {renderPage(activePage)}
        </main>

        <ChatBot open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>

      {!chatOpen && (
        <button className="chatbot-fab" onClick={() => setChatOpen(true)} title="AI 어시스턴트">
          🤖
        </button>
      )}

      {notifOpen && <div className="overlay" onClick={() => setNotifOpen(false)} />}
      <div className={`notif-panel ${notifOpen ? 'open' : ''}`}>
        <div className="np-header">
          <div className="np-title">🔔 위험 감지 알림</div>
          <button className="np-close" onClick={() => setNotifOpen(false)}>✕</button>
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
