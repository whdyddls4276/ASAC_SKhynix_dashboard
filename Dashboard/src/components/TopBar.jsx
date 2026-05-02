import { useState, useEffect } from 'react'
import './TopBar.css'

export default function TopBar({ notifOpen, setNotifOpen }) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const dateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .replace(/\. /g, '-').replace('.', '')
  const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="logo">QMS</div>
        <div className="topbar-div" />
        <div className="topbar-title">불량 현황 · 예측 모니터링</div>
      </div>

      <div className="topbar-right">
        <div className="date-pill">{dateStr} · {timeStr}</div>

        <button
          className="icon-btn"
          onClick={() => setNotifOpen(v => !v)}
          title="알림"
        >
          🔔
          <span className="notif-dot" />
        </button>

        <div className="profile-wrap">
          <button
            className="profile-btn"
            onClick={() => setProfileOpen(v => !v)}
          >
            <div className="avatar">PI</div>
            <span className="profile-name">이정훈</span>
            <span className="profile-arrow">{profileOpen ? '▲' : '▼'}</span>
          </button>
          {profileOpen && (
            <div className="profile-dropdown">
              <div className="pd-item">내 프로필</div>
              <div className="pd-item">설정</div>
              <div className="pd-divider" />
              <div className="pd-item pd-logout">로그아웃</div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
