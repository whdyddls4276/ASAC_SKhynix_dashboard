import { useState, useMemo } from 'react'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import ChatBot from './components/ChatBot'
import Overview from './pages/Overview'
import WaferMap from './pages/WaferMap'
import ModelPerformance from './pages/ModelPerformance'
import Drilldown from './pages/Drilldown'
import { useCSV } from './hooks/useCSV'
import './App.css'

export default function App() {
  const [activePage, setActivePage] = useState('overview')
  const [notifOpen, setNotifOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // 페이지 간 selection 전달용 (Overview에서 클릭한 unit → Drilldown으로 전달)
  const [pendingSelection, setPendingSelection] = useState(null)  // { lot, wafer, unit }
  const { data: units } = useCSV('/dashboard_units.csv')

  // Overview에서 호출: drilldown으로 이동하면서 unit 선택
  const navigateToDrilldown = (selection) => {
    setPendingSelection(selection)
    setActivePage('drilldown')
  }

  // 실제 위험 Lot 알림: lot별 평균 reg_pred 상위 4개
  const notifItems = useMemo(() => {
    if (!units.length) return []
    const lotMap = {}
    units.forEach(u => {
      const lot = String(u.run_id)
      if (!lotMap[lot]) lotMap[lot] = { lot, predSum: 0, count: 0, riskCount: 0 }
      const pred = parseFloat(u.reg_pred)
      if (isFinite(pred)) { lotMap[lot].predSum += pred; lotMap[lot].count++ }
      if (u.risk === 'HIGH') lotMap[lot].riskCount++
    })
    return Object.values(lotMap)
      .map(l => ({
        lot:      `LOT-${l.lot}`,
        avgPpm:   l.count ? Math.round(l.predSum / l.count * 1e6) : 0,
        riskCount: l.riskCount,
        level:    l.riskCount > 50 ? 'HIGH' : l.riskCount > 20 ? 'MED' : 'LOW',
      }))
      .sort((a, b) => b.avgPpm - a.avgPpm)
      .slice(0, 4)
  }, [units])
  function renderPageWithProps(page) {
    switch (page) {
      case 'overview':
        return <Overview onNavigateDrilldown={navigateToDrilldown} />
      case 'wafer-map':
        return <WaferMap />
      case 'feat-importance':
        return <ModelPerformance />
      case 'drilldown':
      case 'lot-level':
      case 'wafer-level':
      case 'unit-level':
      case 'die-level':
        return <Drilldown initialTab={
          page === 'wafer-level' ? 'wafer' :
          page === 'unit-level'  ? 'unit'  :
          page === 'die-level'   ? 'die'   : 'lot'
        } initialSelection={pendingSelection} />
      default:
        return <Overview onNavigateDrilldown={navigateToDrilldown} />
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
        <button className="chatbot-fab" onClick={() => setChatOpen(true)} title="AI Agent (localhost:8000)">
          💬
        </button>
      )}

      {notifOpen && <div className="overlay" onClick={() => setNotifOpen(false)} />}
      <div className={`notif-panel ${notifOpen ? 'open' : ''}`}>
        <div className="np-header">
          <div className="np-title">🔔 위험 감지 알림</div>
          <button className="np-close" onClick={() => setNotifOpen(false)}>✕</button>
        </div>
        <div style={{ margin: '6px 12px 0', fontSize: 12, color: '#94A3B8' }}>
          예측 ppm 기준 위험 Lot 상위 4개 · dashboard_units.csv
        </div>
        <div className="np-list">
          {notifItems.map((n, i) => (
            <div key={i} className="np-item">
              <div className="np-top">
                <span className={`np-lot level-${n.level.toLowerCase()}`}>{n.lot}</span>
                <span className="np-time">
                  <span className={`badge badge-${n.level.toLowerCase()}`}>{n.level}</span>
                </span>
              </div>
              <div className="np-msg">
                평균 {n.avgPpm.toLocaleString()} ppm
                {n.riskCount > 0 && ` · HIGH risk unit ${n.riskCount}개`}
              </div>
            </div>
          ))}
          {notifItems.length === 0 && (
            <div style={{ padding: 16, color: '#94A3B8', fontSize: 11 }}>데이터 로딩 중…</div>
          )}
        </div>
      </div>
    </div>
  )
}
