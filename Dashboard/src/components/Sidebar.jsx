import { useState } from 'react'
import './Sidebar.css'

const MENU = [
  { id: 'overview', icon: '📊', label: '상세' },
  { id: 'data-table', icon: '🗃', label: '데이터 테이블' },
  {
    id: 'date', icon: '📅', label: '날짜',
    children: [
      { id: 'date-daily',   label: '일별' },
      { id: 'date-monthly', label: '월별' },
      { id: 'date-yearly',  label: 'Split 비교' },
    ]
  },
  {
    id: 'location', icon: '📍', label: '위치',
    children: [
      { id: 'loc-position', label: 'Position별' },
      { id: 'loc-unit', label: 'Unit별' },
      { id: 'loc-zone', label: 'Zone별' },
    ]
  },
  {
    id: 'feature', icon: '🔬', label: '피처 분석',
    children: [
      { id: 'feat-shap', label: 'SHAP 분석' },
      { id: 'feat-importance', label: '임포턴스' },
    ]
  },
  { id: 'model', icon: '⚙️', label: '모델 성능' },
]

export default function Sidebar({ activePage, setActivePage }) {
  const [openTree, setOpenTree] = useState(null)

  function handleNav(id) {
    setActivePage(id)
  }

  function toggleTree(id) {
    setOpenTree(prev => prev === id ? null : id)
  }

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
            {item.children && (
              <span className="nav-arrow">▶</span>
            )}
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
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className="sidebar-divider" />
      <div className="sidebar-label">설정</div>

      <div
        className={`nav-item ${activePage === 'model' ? 'active' : ''}`}
        onClick={() => handleNav('model')}
      >
        <span className="nav-icon">⚙️</span>
        <span className="nav-label">모델 성능</span>
      </div>
    </nav>
  )
}
