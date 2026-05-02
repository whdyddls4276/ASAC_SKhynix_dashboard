import './WaferMap.css'

export default function WaferMap() {
  return (
    <div className="wafermap-page">
      <div className="wm-header">
        <div className="wm-title">🗺 웨이퍼맵</div>
        <div className="wm-desc">Lot / Wafer를 선택하면 die_x · die_y 기반 히트맵이 표시됩니다.</div>
      </div>

      <div className="wm-filters">
        <div className="wm-filter-item">
          <label>Lot</label>
          <select disabled>
            <option>LOT-2024A</option>
          </select>
        </div>
        <div className="wm-filter-item">
          <label>Wafer</label>
          <select disabled>
            <option>W01</option>
          </select>
        </div>
      </div>

      <div className="wm-dummy">
        <div className="wm-dummy-circle">
          <div className="wm-dummy-label">웨이퍼맵 (구현 예정)</div>
          <div className="wm-dummy-sub">die_x / die_y 기반 히트맵<br/>y_pred 값으로 색상 표현<br/>위험도 높은 die 강조</div>
        </div>
      </div>
    </div>
  )
}
