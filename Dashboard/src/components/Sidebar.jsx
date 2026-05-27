import './Sidebar.css'

const MENU = [
  { id: 'overview',        label: '불량 현황' },
  { id: 'drilldown',       label: '불량 상세 분석' },
  { id: 'feat-importance', label: 'ML 모델 분석' },
]

export default function Sidebar({ activePage, setActivePage }) {
  return (
    <nav className="sidebar">
      {MENU.map(item => (
        <div
          key={item.id}
          className={`nav-item ${activePage === item.id ? 'active' : ''}`}
          onClick={() => setActivePage(item.id)}
        >
          <span className="nav-label">{item.label}</span>
        </div>
      ))}
    </nav>
  )
}
