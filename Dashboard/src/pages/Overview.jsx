import { useState, useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './Overview.css'

const THRESH = 0.5

function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div className="kpi-card">
      <div className="kpi-icon" style={{ background: color + '18' }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div className="kpi-info">
        <div className="kpi-val" style={{ color }}>{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  )
}

function ChartCard({ title, tag, children }) {
  return (
    <div className="chart-card">
      <div className="cc-header">
        <div className="cc-title">
          {title}
          {tag && <span className="cc-tag">{tag}</span>}
        </div>
      </div>
      <div className="cc-body">{children}</div>
    </div>
  )
}

function RiskBadge({ level }) {
  const map = {
    HIGH: { bg:'#FEF2F2', color:'#EF4444' },
    MED:  { bg:'#FFF7ED', color:'#F97316' },
    LOW:  { bg:'#F0FDF4', color:'#22C55E' },
  }
  const s = map[level] || map.LOW
  return (
    <span style={{
      fontSize:9, padding:'2px 7px', borderRadius:3,
      fontWeight:600, fontFamily:'DM Mono,monospace',
      background: s.bg, color: s.color,
    }}>{level}</span>
  )
}

function useOofData() {
  const { data, loading } = useCSV('/oof_meta.csv')

  const derived = useMemo(() => {
    if (!data.length) return null

    // unit-level: max clf_proba per unit
    const unitMap = {}
    for (const r of data) {
      const uid = r.ufs_serial
      const p = parseFloat(r.clf_proba_mean) || 0
      const sp = r.split
      if (!unitMap[uid]) {
        unitMap[uid] = { id: uid, maxP: p, meanP: p, cnt: 1, split: sp, health: parseFloat(r.health) || 0 }
      } else {
        unitMap[uid].maxP = Math.max(unitMap[uid].maxP, p)
        unitMap[uid].meanP += p
        unitMap[uid].cnt += 1
      }
    }
    const units = Object.values(unitMap).map(u => ({ ...u, meanP: u.meanP / u.cnt }))

    // KPI per split
    const kpi = {}
    for (const sp of ['train', 'val', 'test']) {
      const sp_units = units.filter(u => u.split === sp)
      const defect = sp_units.filter(u => u.maxP >= THRESH).length
      const total = sp_units.length
      kpi[sp] = { defect, total, normal: total - defect }
    }

    // top units per split (top 10 by maxP)
    const topUnits = {}
    for (const sp of ['train', 'val', 'test']) {
      topUnits[sp] = units
        .filter(u => u.split === sp)
        .sort((a, b) => b.maxP - a.maxP)
        .slice(0, 10)
        .map((u, i) => {
          const num = parseInt(u.id.replace(/\D/g, ''), 10)
          const lot = `L${String((Math.floor(num / 1000) % 99) + 1).padStart(2, '0')}`
          const wafer = `W${String((Math.floor(num / 100) % 25) + 1).padStart(2, '0')}`
          const risk = u.maxP >= 0.65 ? 'HIGH' : u.maxP >= 0.55 ? 'MED' : 'LOW'
          return { rank: i + 1, id: u.id, pred: u.maxP, lot, wafer, risk }
        })
    }

    return { kpi, topUnits }
  }, [data])

  return { derived, loading }
}

export default function Overview() {
  const [mode, setMode] = useState('Train')
  const [selectedUnit, setSelectedUnit] = useState(null)
  const { derived, loading } = useOofData()

  const sp = mode.toLowerCase()

  if (loading || !derived) {
    return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>데이터 로딩 중…</div>
  }

  const d = derived.kpi[sp] || { defect: 0, total: 0, normal: 0 }
  const defectRate = d.total ? ((d.defect / d.total) * 100).toFixed(1) : '0.0'
  const topUnits = derived.topUnits[sp] || []

  return (
    <div className="overview">
      {/* Split 탭 */}
      <div className="split-tabs">
        {['Train', 'Val', 'Test'].map(m => (
          <button
            key={m}
            className={`split-tab ${mode === m ? 'active' : ''}`}
            onClick={() => { setMode(m); setSelectedUnit(null) }}
          >
            <span className="split-tab-label">{m}</span>
            {derived && (
              <span className="split-tab-count">
                {derived.kpi[m.toLowerCase()]?.total.toLocaleString()} units
              </span>
            )}
          </button>
        ))}
      </div>

      {/* KPI */}
      <div className="kpi-row">
        <KpiCard label="불량 의심 Unit"  value={d.defect.toLocaleString()}                        sub={`전체 ${d.total.toLocaleString()}개 unit`}        color="#EF4444" icon="⚠️" />
        <KpiCard label="불량 발생률"     value={`${defectRate}%`}                                 sub="clf_proba ≥ 0.5 기준"                              color="#F97316" icon="📉" />
        <KpiCard label="정상 Unit"       value={d.normal.toLocaleString()}                        sub={`정상률 ${(100-parseFloat(defectRate)).toFixed(1)}%`} color="#22C55E" icon="✅" />
      </div>

      {/* 트렌드 + 미니 웨이퍼맵 */}
      <div className="two-col">
        <ChartCard title="📈 불량률 트렌드" tag={mode}>
          <div className="mini-trend-dummy">
            <div className="mtd-label">트렌드 차트 (구현 예정)</div>
            <div className="mtd-sub">Lot별 불량률 추이</div>
          </div>
        </ChartCard>
        <ChartCard title="🗺 웨이퍼맵 미리보기" tag="클릭 시 상세 이동">
          <div className="mini-wafer-dummy">
            <div className="mwd-circle">
              <div className="mwd-label">웨이퍼맵</div>
              <div className="mwd-sub">구현 예정</div>
            </div>
          </div>
        </ChartCard>
      </div>

      {/* 불량 Unit Top-N 테이블 */}
      <ChartCard title="🚨 불량 위험 Unit Top-10" tag={mode}>
        <table className="unit-table">
          <thead>
            <tr>
              <th>순위</th><th>Unit ID</th><th>예측 확률</th>
              <th>Lot(추정)</th><th>Wafer(추정)</th><th>위험</th>
            </tr>
          </thead>
          <tbody>
            {topUnits.map(u => (
              <tr
                key={u.id}
                className={selectedUnit === u.id ? 'selected' : ''}
                onClick={() => setSelectedUnit(u.id === selectedUnit ? null : u.id)}
              >
                <td className="rank">#{u.rank}</td>
                <td className="unit-id">{u.id}</td>
                <td className="pred-val">{u.pred.toFixed(4)}</td>
                <td>{u.lot}</td>
                <td>{u.wafer}</td>
                <td><RiskBadge level={u.risk} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {selectedUnit && (
          <div className="unit-detail">
            <span>📌 선택된 Unit: <b>{selectedUnit}</b> — 상세 분석은 피처 분석 탭에서 확인하세요.</span>
          </div>
        )}
      </ChartCard>
    </div>
  )
}
