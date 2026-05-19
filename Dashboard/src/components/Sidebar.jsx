import { useState } from 'react'
import './Sidebar.css'

const MENU = [
  { id: 'overview',        label: '개요' },
  { id: 'drilldown',       label: '계층별 정밀 분석' },
  { id: 'feat-importance', label: '모델 분석' },
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
      {MENU.map(item => (
        <div key={item.id}>
          <div
            className={`nav-item ${activePage === item.id ? 'active' : ''} ${openTree === item.id ? 'open' : ''}`}
            onClick={() => item.children ? toggleTree(item.id, item.children[0]?.id) : handleNav(item.id)}
          >
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
