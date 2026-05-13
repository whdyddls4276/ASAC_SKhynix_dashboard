import { useState } from 'react'
import './Sidebar.css'

const MENU = [
  { id: 'overview',        icon: '📊', label: 'Overview' },
  { id: 'drilldown',       icon: '🔍', label: '계층별 정밀 분석' },
  { id: 'wafer-map',       icon: '🗺', label: '웨이퍼맵' },
  { id: 'weekly-prod',     icon: '📅', label: '주별 생산량' },
  { id: 'feat-importance', icon: '🔬', label: '모델 분석' },
  { id: 'data-table',      icon: '📋', label: '데이터 테이블' },
]

export default function Sidebar({ activePage, setActivePage }) {
  const [openTree, setOpenTree] = useState(null)

  function handleNav(id) { setActivePage(id) }
  function toggleTree(id, defaultChild) {
    setOpenTree(prev => prev === id ? null : id)
    if (defaultChild) setActivePage(defaultChild)
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-label">분석 메뉴</div>

      {MENU.map(item => (
        <div key={item.id}>
          <div
            className={`nav-item ${activePage === item.id ? 'active' : ''} ${openTree === item.id ? 'open' : ''}`}
            onClick={() => item.children ? toggleTree(item.id, item.children[0]?.id) : handleNav(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {item.dummy && <span className="dummy-badge">🚧</span>}
            {item.children && <span className="nav-arrow">▶</span>}
          </div>

          {item.children && (
            <div className={`submenu ${openTree === item.id ? 'open' : ''}`}>
              {item.children.map(child => (
                <div
                  key={child.id}
                  className={`sub-item ${activePage === child.id ? 'active' : ''}`}
                  onClick={() => handleNav(child.id)}
                >
                  {child.label}
                  {child.dummy && <span className="dummy-badge">🚧</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  )
}
