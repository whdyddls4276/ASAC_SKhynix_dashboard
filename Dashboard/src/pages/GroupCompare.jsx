import { useMemo } from 'react'
import { useCSV } from '../hooks/useCSV'
import './GroupCompare.css'

export default function GroupCompare() {
  const { data: shapData, loading } = useCSV('/shap_data.csv')

  const rows = useMemo(() => {
    if (!shapData.length) return []
    return shapData
      .map(f => ({
        feature:  f.feature,
        defect:   parseFloat(f.high_median) || 0,
        normal:   parseFloat(f.med_median)  || 0,
        gain:     parseFloat(f.lgbm_gain)   || 0,
      }))
      .filter(f => isFinite(f.defect) && isFinite(f.normal))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 10)
      .map(f => ({
        ...f,
        diff:  f.defect - f.normal,
        ratio: f.normal !== 0 ? f.defect / f.normal : null,
      }))
  }, [shapData])

  if (loading) {
    return <div style={{ padding: 40, color: '#94A3B8' }}>데이터 로딩 중…</div>
  }

  if (!rows.length) {
    return <div style={{ padding: 40, color: '#94A3B8' }}>shap_data.csv 데이터 없음</div>
  }

  const maxVal = Math.max(...rows.flatMap(r => [r.defect, r.normal]))

  return (
    <div className="gc-page">
      <div className="gc-header">
        <div className="gc-title">📈 그룹 비교</div>
        <div className="gc-desc">
          불량(HIGH 리스크) / 정상(MED 리스크) 그룹 간 피처 중앙값 차이 —
          <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>lgbm_gain 상위 10개 · shap_data.csv 기반</span>
        </div>
      </div>

      <div className="gc-card">
        <div className="gc-card-title">🔴 vs 🟢 그룹 피처 중앙값 비교 (lgbm_gain 상위 10)</div>
        <div className="gc-bar-list">
          {rows.map((r, i) => (
            <div key={i} className="gc-bar-row">
              <div className="gc-bar-label">{r.feature}</div>
              <div className="gc-bars">
                <div className="gc-bar-wrap">
                  <div className="gc-bar defect" style={{ width: `${Math.min(r.defect / maxVal * 100, 100)}%` }} />
                  <span className="gc-bar-val defect">{r.defect.toFixed(3)}</span>
                </div>
                <div className="gc-bar-wrap">
                  <div className="gc-bar normal" style={{ width: `${Math.min(r.normal / maxVal * 100, 100)}%` }} />
                  <span className="gc-bar-val normal">{r.normal.toFixed(3)}</span>
                </div>
              </div>
              <div className="gc-ratio">
                {r.ratio !== null ? `${r.ratio.toFixed(1)}×` : '—'}
              </div>
            </div>
          ))}
        </div>
        <div className="gc-legend">
          <span className="gc-leg defect">■ 불량 그룹 중앙값 (HIGH risk)</span>
          <span className="gc-leg normal">■ 정상 그룹 중앙값 (MED risk)</span>
          <span className="gc-leg ratio">× 배율</span>
        </div>
      </div>

      <div className="gc-card">
        <div className="gc-card-title">📋 상세 수치 테이블</div>
        <table className="gc-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>lgbm_gain 순위</th>
              <th>불량 중앙값</th>
              <th>정상 중앙값</th>
              <th>차이</th>
              <th>배율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="mono">{r.feature}</td>
                <td className="mono" style={{ color: '#64748b' }}>{i + 1}위</td>
                <td className="mono bad">{r.defect.toFixed(3)}</td>
                <td className="mono good">{r.normal.toFixed(3)}</td>
                <td className={`mono ${r.diff > 0 ? 'bad' : 'good'}`}>{r.diff > 0 ? '+' : ''}{r.diff.toFixed(3)}</td>
                <td className="mono bold">{r.ratio !== null ? `${r.ratio.toFixed(1)}×` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
