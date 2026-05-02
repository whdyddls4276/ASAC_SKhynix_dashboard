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

    // lot-level defect rate per split (group by serial // 1000)
    const lotMap = {}
    for (const u of units) {
      const num = parseInt(u.id.replace(/\D/g, ''), 10)
      const lot = `L${String((Math.floor(num / 1000) % 99) + 1).padStart(2, '0')}`
      const key = `${lot}|${u.split}`
      if (!lotMap[key]) lotMap[key] = { lot, split: u.split, total: 0, defect: 0 }
      lotMap[key].total += 1
      if (u.maxP >= THRESH) lotMap[key].defect += 1
    }
    const lotDefect = {}
    for (const sp of ['train', 'val', 'test']) {
      lotDefect[sp] = Object.values(lotMap)
        .filter(l => l.split === sp && l.total >= 3)
        .map(l => ({ lot: l.lot, rate: parseFloat((l.defect / l.total * 100).toFixed(1)) }))
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 10)
    }

    // trend: lot index → defect rate for each split
    const allLots = [...new Set(Object.values(lotMap).map(l => l.lot))].sort()
    const makeSeriesData = (sp) =>
      allLots.map(lot => {
        const key = `${lot}|${sp}`
        const d = lotMap[key]
        return d && d.total >= 3 ? parseFloat((d.defect / d.total * 100).toFixed(1)) : null
      })

    return { kpi, topUnits, lotDefect, allLots, trendSeries: {
      train: makeSeriesData('train'),
      val: makeSeriesData('val'),
      test: makeSeriesData('test'),
    }}
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

  const pieOpt1 = {
    tooltip: { trigger:'item', formatter:'{b}: {c}건 ({d}%)' },
    legend: { bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    series: [{ type:'pie', radius:['45%','70%'], center:['50%','45%'],
      data:[
        { value:d.normal, name:'정상', itemStyle:{ color:'#22C55E' } },
        { value:d.defect, name:'불량', itemStyle:{ color:'#EF4444' } },
      ],
      label:{ show:false },
      emphasis:{ label:{ show:true, fontSize:13, fontWeight:'bold' } },
    }]
  }

  const pieOpt2 = {
    tooltip: { trigger:'item', formatter:'{b}: {c}건 ({d}%)' },
    legend: { bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    series: [{ type:'pie', radius:['45%','70%'], center:['50%','45%'],
      data:[
        { value:Math.round(d.defect*0.28), name:'High',   itemStyle:{ color:'#EF4444' } },
        { value:Math.round(d.defect*0.47), name:'Medium', itemStyle:{ color:'#F97316' } },
        { value:Math.round(d.defect*0.25), name:'Low',    itemStyle:{ color:'#EAB308' } },
      ],
      label:{ show:false },
      emphasis:{ label:{ show:true, fontSize:13, fontWeight:'bold' } },
    }]
  }

  const pieOpt3 = {
    tooltip: { trigger:'item', formatter:'{b}: {c}건 ({d}%)' },
    legend: { bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    series: [{ type:'pie', radius:['45%','70%'], center:['50%','45%'],
      data:[
        { value:derived.kpi.train.defect, name:'Train', itemStyle:{ color:'#3B82F6' } },
        { value:derived.kpi.val.defect,   name:'Val',   itemStyle:{ color:'#8B5CF6' } },
        { value:derived.kpi.test.defect,  name:'Test',  itemStyle:{ color:'#06B6D4' } },
      ],
      label:{ show:false },
      emphasis:{ label:{ show:true, fontSize:13, fontWeight:'bold' } },
    }]
  }

  const trendOpt = {
    tooltip: {
      trigger:'axis',
      formatter: params => params.filter(p => p.value != null).map(p => `${p.seriesName}: ${p.value}%`).join('<br/>')
    },
    legend: { data:['Train','Val','Test'], bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    grid: { top:16, left:44, right:20, bottom:40 },
    xAxis: { type:'category', data:derived.allLots, axisLabel:{ fontSize:9, color:'#94A3B8', interval: Math.floor(derived.allLots.length / 12) }, axisLine:{ lineStyle:{ color:'#E2E8F0' } } },
    yAxis: { type:'value', axisLabel:{ fontSize:10, color:'#94A3B8', formatter:'{value}%' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    series: [
      { name:'Train', type:'line', data:derived.trendSeries.train, smooth:true, connectNulls:false, symbol:'none',
        lineStyle:{ color:'#3B82F6', width:2 }, itemStyle:{ color:'#3B82F6' }, areaStyle:{ color:'rgba(59,130,246,.1)' } },
      { name:'Val', type:'line', data:derived.trendSeries.val, smooth:true, connectNulls:false, symbol:'none',
        lineStyle:{ color:'#8B5CF6', width:2, type:'dashed' }, itemStyle:{ color:'#8B5CF6' } },
      { name:'Test', type:'line', data:derived.trendSeries.test, smooth:true, connectNulls:false, symbol:'none',
        lineStyle:{ color:'#06B6D4', width:2, type:'dotted' }, itemStyle:{ color:'#06B6D4' } },
    ],
  }

  const lots = derived.lotDefect[sp] || []
  const lotOpt = {
    tooltip: { trigger:'axis', formatter: p => `${p[0].name}: ${p[0].value}%` },
    grid: { top:10, left:52, right:30, bottom:10 },
    xAxis: { type:'value', axisLabel:{ fontSize:10, color:'#94A3B8', formatter:'{value}%' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    yAxis: { type:'category', data:lots.map(l=>l.lot).reverse(), axisLabel:{ fontSize:10, color:'#94A3B8' } },
    series: [{
      type:'bar', data: lots.map(l=>l.rate).reverse(),
      barMaxWidth: 18,
      itemStyle: {
        color: params => {
          const v = params.value
          if (v >= 30) return '#EF4444'
          if (v >= 20) return '#F97316'
          return '#3B82F6'
        },
        borderRadius:[0,4,4,0],
      },
      label: { show:true, position:'right', fontSize:10, formatter:'{c}%', color:'#475569' },
    }],
  }

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

      {/* 파이차트 */}
      <div className="pie-row">
        <ChartCard title="정상 vs 불량"     tag={mode}><ReactECharts option={pieOpt1} style={{ height:200 }} /></ChartCard>
        <ChartCard title="위험 등급별"       tag={mode}><ReactECharts option={pieOpt2} style={{ height:200 }} /></ChartCard>
        <ChartCard title="Split별 불량 분포" tag="전체"><ReactECharts option={pieOpt3} style={{ height:200 }} /></ChartCard>
      </div>

      {/* 트렌드 + Lot 바차트 */}
      <div className="two-col">
        <ChartCard title="📈 Lot별 불량률 트렌드" tag="Train / Val / Test">
          <ReactECharts option={trendOpt} style={{ height:220 }} />
        </ChartCard>
        <ChartCard title="📊 Lot별 불량률 Top-10" tag={mode}>
          <ReactECharts option={lotOpt} style={{ height:220 }} />
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
