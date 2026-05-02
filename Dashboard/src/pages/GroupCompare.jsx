import './GroupCompare.css'

export default function GroupCompare() {
  const dummyRows = [
    { feature: 'X739',  defect: 2.34, normal: 1.01, ratio: 2.32, diff: 1.33 },
    { feature: 'X1083', defect: 1.89, normal: 0.87, ratio: 2.17, diff: 1.02 },
    { feature: 'X507',  defect: 1.55, normal: 0.72, ratio: 2.15, diff: 0.83 },
    { feature: 'X012',  defect: 3.12, normal: 1.58, ratio: 1.97, diff: 1.54 },
    { feature: 'X348',  defect: 0.94, normal: 0.51, ratio: 1.84, diff: 0.43 },
  ]

  return (
    <div className="gc-page">
      <div className="gc-header">
        <div className="gc-title">📈 그룹 비교</div>
        <div className="gc-desc">불량/정상 그룹 간 feature 평균값 차이를 비교합니다.</div>
      </div>

      <div className="gc-dummy-note">
        ⚠ 현재 더미 데이터입니다. shap_summary.csv 연결 후 실제 값으로 교체됩니다.
      </div>

      <div className="gc-card">
        <div className="gc-card-title">🔴 vs 🟢 그룹 평균값 비교 (상위 N feature)</div>
        <div className="gc-bar-list">
          {dummyRows.map((r, i) => (
            <div key={i} className="gc-bar-row">
              <div className="gc-bar-label">{r.feature}</div>
              <div className="gc-bars">
                <div className="gc-bar-wrap">
                  <div className="gc-bar defect" style={{ width: `${Math.min(r.defect / 4 * 100, 100)}%` }} />
                  <span className="gc-bar-val defect">{r.defect.toFixed(2)}</span>
                </div>
                <div className="gc-bar-wrap">
                  <div className="gc-bar normal" style={{ width: `${Math.min(r.normal / 4 * 100, 100)}%` }} />
                  <span className="gc-bar-val normal">{r.normal.toFixed(2)}</span>
                </div>
              </div>
              <div className="gc-ratio">{r.ratio.toFixed(1)}×</div>
            </div>
          ))}
        </div>
        <div className="gc-legend">
          <span className="gc-leg defect">■ 불량 그룹 평균</span>
          <span className="gc-leg normal">■ 정상 그룹 평균</span>
          <span className="gc-leg ratio">× 배율</span>
        </div>
      </div>

      <div className="gc-card">
        <div className="gc-card-title">📋 상세 수치 테이블</div>
        <table className="gc-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>불량 평균</th>
              <th>정상 평균</th>
              <th>차이</th>
              <th>배율</th>
            </tr>
          </thead>
          <tbody>
            {dummyRows.map((r, i) => (
              <tr key={i}>
                <td className="mono">{r.feature}</td>
                <td className="mono bad">{r.defect.toFixed(2)}</td>
                <td className="mono good">{r.normal.toFixed(2)}</td>
                <td className="mono">{r.diff.toFixed(2)}</td>
                <td className="mono bold">{r.ratio.toFixed(1)}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
