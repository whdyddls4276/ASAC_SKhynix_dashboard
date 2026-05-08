import { useState } from 'react'
import './Sidebar.css'

const MENU = [
  { id: 'overview',       icon: '📊', label: 'Overview' },
  { id: 'wafer-map',      icon: '🗺', label: '웨이퍼맵' },
  {
    id: 'feature', icon: '🔬', label: '변수 분석',
    children: [
      { id: 'feat-importance', label: 'Feature Importance' },
      { id: 'feat-shap',       label: 'SHAP 분석' },
    ]
  },
{ id: 'data-table',     icon: '📋', label: '데이터 테이블' },
]

export default function Sidebar({ activePage, setActivePage }) {
  const [openTree, setOpenTree] = useState(null)

  function handleNav(id) { setActivePage(id) }
  function toggleTree(id) { setOpenTree(prev => prev === id ? null : id) }

  return (
    <nav className="sidebar">
      <div className="sidebar-label">분석 메뉴</div>

      {MENU.map(item => (
        <div key={item.id}>
          <div
            className={`nav-item ${activePage === item.id ? 'active' : ''} ${openTree === item.id ? 'open' : ''}`}
            onClick={() => item.children ? toggleTree(item.id) : handleNav(item.id)}
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
