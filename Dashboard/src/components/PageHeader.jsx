import './PageHeader.css'

const STATUS_OPTIONS = [
  { value: 'today',     label: '오늘' },
  { value: 'pending',   label: '대기' },
  { value: 'completed', label: '완료' },
  { value: 'all',       label: '전체' },
]

export default function PageHeader({ title, subtitle, status, onStatusChange, right }) {
  return (
    <div className="page-header">
      <div className="ph-left">
        <h1 className="ph-title">{title}</h1>
        {subtitle && <p className="ph-subtitle">{subtitle}</p>}
      </div>
      <div className="ph-right">
        {right}
        {status && onStatusChange && (
          <div className="ph-status-toggle">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`ph-status-btn ${status === opt.value ? 'active' : ''}`}
                onClick={() => onStatusChange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
