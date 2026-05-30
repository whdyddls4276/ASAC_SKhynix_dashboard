import { useState, useMemo } from 'react'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import ChatBot from './components/ChatBot'
import Overview2 from './pages/Overview2'
import WaferMap from './pages/WaferMap'
import ModelPerformanceV2 from './pages/ModelPerformanceV2'
import ProcessFactor from './pages/ProcessFactor'
import DrilldownV2 from './pages/DrilldownV2'
import { useCSV } from './hooks/useCSV'
import './App.css'

export default function App() {
  const [activePage, setActivePage] = useState('overview2')
  const [notifOpen, setNotifOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // 페이지 간 selection 전달용 (Overview에서 클릭한 unit → DrilldownV2로 전달)
  const [pendingSelection, setPendingSelection] = useState(null)  // { lot, wafer, unit }
  const { data: units } = useCSV('/dashboard_units.csv')

  // Overview에서 호출: DrilldownV2로 이동하면서 unit 선택
  const navigateToDrilldown = (selection) => {
    setPendingSelection(selection)
    setActivePage('drilldown-v2')
  }

  // grade별 unit 목록
  const notifByGrade = useMemo(() => {
    if (!units.length) return { grade1: [], grade2: [], grade3: [], grade4: [] }
    const result = { grade1: [], grade2: [], grade3: [], grade4: [] }
    units.forEach(u => {
      const g = u.grade
      if (result[g]) result[g].push(u.ufs_serial)
    })
    return result
  }, [units])
  function renderPageWithProps(page) {
    switch (page) {
      case 'overview':
        return <Overview onNavigateDrilldown={navigateToDrilldown} />
      case 'overview2':
        return <Overview2
          onNavigateDrilldown={(sel) => { setPendingSelection(sel); setActivePage('drilldown-v2') }}
          onNavigateProcessFactor={() => setActivePage('process-factor')}
        />
      case 'wafer-map':
        return <WaferMap />
      case 'feat-importance-v2':
        return <ModelPerformanceV2 />
      case 'process-factor':
        return <ProcessFactor />
      case 'drilldown-v2':
        return <DrilldownV2 initialSelection={pendingSelection} />
      default:
        return <Overview onNavigateDrilldown={navigateToDrilldown} />
    }
  }

  return (
    <div className="app">
      <TopBar notifOpen={notifOpen} setNotifOpen={setNotifOpen} />

      <div className="app-body">
        <Sidebar activePage={activePage} setActivePage={setActivePage} open={sidebarOpen} setOpen={setSidebarOpen} />

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
        <div className="np-list">
          {[
            { key: 'grade4', label: '매우위험 (G4)', color: '#EF4444', bg: '#FEE2E2' },
            { key: 'grade3', label: '위험 (G3)',     color: '#F59E0B', bg: '#FEF3C7' },
            { key: 'grade2', label: '조심 (G2)',     color: '#EAB308', bg: '#FEF9C3' },
            { key: 'grade1', label: '정상 (G1)',     color: '#22C55E', bg: '#F0FDF4' },
          ].map(({ key, label, color, bg }) => {
            const list = notifByGrade[key] ?? []
            if (!list.length) return null
            return (
              <div key={key} className="np-grade-section">
                <div className="np-grade-header" style={{ background: bg, borderColor: color }}>
                  <span className="np-grade-label" style={{ color }}>{label}</span>
                  <span className="np-grade-count" style={{ color }}>{list.length.toLocaleString()}개</span>
                </div>
                <div className="np-unit-list">
                  {list.slice(0, 30).map(serial => (
                    <div key={serial} className="np-unit-item">{serial}</div>
                  ))}
                  {list.length > 30 && (
                    <div className="np-unit-more">+{(list.length - 30).toLocaleString()}개 더</div>
                  )}
                </div>
              </div>
            )
          })}
          {!units.length && (
            <div style={{ padding: 16, color: '#94A3B8', fontSize: 11 }}>데이터 로딩 중…</div>
          )}
        </div>
      </div>
    </div>
  )
}
