import './Sidebar.css'
import skLogo from '../assets/sk_logo_nobg.png'

const MENU = [
  { id: 'overview',        label: '불량 현황',      icon: '◈' },
  { id: 'drilldown',       label: '불량 상세 분석',  icon: '◉' },
  { id: 'feat-importance', label: 'ML 모델 분석',   icon: '◇' },
]

function ButterflyLogo() {
  return <img src={skLogo} alt="SK hynix" width="42" height="42" style={{ objectFit: 'contain' }} />
}

export default function Sidebar({ activePage, setActivePage, open, setOpen }) {
  return (
    <>
      {/* 열렸을 때 바깥 클릭하면 닫힘 */}
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}

      <nav className={`sidebar ${open ? 'open' : ''}`}>
        {/* 로고 버튼 — 항상 표시 */}
        <button className="sidebar-logo-btn" onClick={() => setOpen(o => !o)} title="메뉴">
          <ButterflyLogo />
          {open && <span className="sidebar-logo-text">SK hynix</span>}
        </button>

        <div className="sidebar-divider" />

        {/* 메뉴 아이템 */}
        {MENU.map(item => (
          <div
            key={item.id}
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
            onClick={() => { setActivePage(item.id); setOpen(false) }}
            title={!open ? item.label : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            {open && <span className="nav-label">{item.label}</span>}
          </div>
        ))}
      </nav>
    </>
  )
}
