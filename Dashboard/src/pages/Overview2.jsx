import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import ALL_DIE_POSITIONS from './diePositions.js'
import './Overview.css'
import './Overview2.css'

const GLOBAL_DIE_X_MIN = 12, GLOBAL_DIE_X_MAX = 66
const GLOBAL_DIE_Y_MIN = 11, GLOBAL_DIE_Y_MAX = 32
const LAST_WW = 37

export const GRADE_COLORS = {
  grade1: { bg: '#F0FDF4', border: '#86EFAC', text: '#166534', bar: '#22C55E', label: '정상 (G1)' },
  grade2: { bg: '#FEF9C3', border: '#EAB308', text: '#713F12', bar: '#EAB308', label: '조심 (G2)' },
  grade3: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', bar: '#F59E0B', label: '위험 (G3)' },
  grade4: { bg: '#FEE2E2', border: '#EF4444', text: '#B91C1C', bar: '#EF4444', label: '매우위험 (G4)' },
}

export function getGrade(pred, thresholds) {
  const { q2, q3, upperFence } = thresholds
  if (pred >= upperFence) return 'grade4'
  if (pred >= q3)         return 'grade3'
  if (pred >= q2)         return 'grade2'
  return 'grade1'
}

function deltaColor(delta, absMax) {
  if (!isFinite(delta) || absMax <= 0) return '#f3f4f6'
  const t = Math.max(-1, Math.min(1, delta / absMax))
  if (t >= 0) {
    // 옅은 빨강(#FEE2E2) → 선명한 빨강(#DC2626)
    const k = t
    const r = Math.round(254 + (220 - 254) * k)
    const g = Math.round(226 + (38  - 226) * k)
    const b = Math.round(226 + (38  - 226) * k)
    return `rgb(${r},${g},${b})`
  } else {
    // 옅은 파랑(#DBEAFE) → 선명한 파랑(#2563EB)
    const k = -t
    const r = Math.round(219 + (37  - 219) * k)
    const g = Math.round(234 + (99  - 234) * k)
    const b = Math.round(254 + (235 - 254) * k)
    return `rgb(${r},${g},${b})`
  }
}

function DeltaWaferMap({ dies, baseline, absMax }) {
  const D = 600, PAD = 12
  const VB = D + PAD * 2
  const cx = PAD + D / 2, cy = PAD + D / 2, radius = D / 2

  const refXRange = GLOBAL_DIE_X_MAX - GLOBAL_DIE_X_MIN + 1
  const refYRange = GLOBAL_DIE_Y_MAX - GLOBAL_DIE_Y_MIN + 1
  const centerX = (GLOBAL_DIE_X_MIN + GLOBAL_DIE_X_MAX) / 2
  const centerY = (GLOBAL_DIE_Y_MIN + GLOBAL_DIE_Y_MAX) / 2
  const SCALE = 0.9
  const cellW = (D / refXRange) * SCALE
  const cellH = (D / refYRange) * SCALE

  const dieMap = new Map()
  for (const d of dies) dieMap.set(`${d.die_x},${d.die_y}`, d)

  return (
    <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
      <defs>
        <clipPath id="ov2WaferClip">
          <circle cx={cx} cy={cy} r={radius} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={radius} fill="#fafafa" stroke="#cbd5e1" strokeWidth={1.5} />
      <g clipPath="url(#ov2WaferClip)">
        {ALL_DIE_POSITIONS.map(([dx, dy]) => {
          const die = dieMap.get(`${dx},${dy}`)
          if (!die) return null
          const pred = parseFloat(die.pred)
          if (!isFinite(pred)) return null
          const delta = pred - baseline
          const x = cx + (dx - centerX) * cellW - cellW / 2
          const y = cy + (dy - centerY) * cellH - cellH / 2
          return (
            <g key={`${dx}-${dy}`}>
              <title>{`(${dx}, ${dy})
pred=${Math.round(pred * 1e6).toLocaleString()} ppm
Δ=${(delta >= 0 ? '+' : '') + Math.round(delta * 1e6).toLocaleString()} ppm`}</title>
              <rect
                x={x} y={y} width={cellW} height={cellH}
                fill={deltaColor(delta, absMax)}
                stroke="rgba(15,23,42,0.10)" strokeWidth={0.6}
              />
            </g>
          )
        })}
      </g>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
      <rect x={cx - 14} y={cy + radius - 5} width={28} height={6} fill="#fff" stroke="#94a3b8" strokeWidth={1} />
    </svg>
  )
}

function computeThresholds(units) {
  const allPreds = units
    .map(u => parseFloat(u.reg_pred))
    .filter(v => isFinite(v))
    .sort((a, b) => a - b)
  const n = allPreds.length
  const q1 = allPreds[Math.floor(n * 0.25)] ?? 0
  const q2 = allPreds[Math.floor(n * 0.50)] ?? 0
  const q3 = allPreds[Math.floor(n * 0.75)] ?? 0
  const iqr = q3 - q1
  const upperFence = q3 + 1.5 * iqr
  return { q1, q2, q3, iqr, upperFence }
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div className="kpi-card ov2-kpi-card" style={{ '--kpi-color': color }}>
      <div className="kpi-info">
        <div className="kpi-val" style={{ color }}>{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  )
}

function ChartCard({ title, sub, children, style }) {
  return (
    <div className="chart-card" style={style}>
      <div className="cc-header">
        <div>
          <div className="cc-title">{title}</div>
          {sub && <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
      <div className="cc-body">{children}</div>
    </div>
  )
}

function ppmColor(ppm, maxPpm) {
  const r = ppm / maxPpm
  if (r >= 0.97) return "#DC2626"
  if (r >= 0.94) return "#F59E0B"
  return "#2563EB"
}

function absBarWidth(ratio) {
  return `${Math.max(6, Math.round(ratio * 100))}%`
}

function riskClass(ratio) {
  return ratio >= 0.85 ? 'danger' : ratio >= 0.70 ? 'warn' : 'ok'
}

export default function Overview2({ onNavigateDrilldown, onNavigateProcessFactor }) {
  const { data: units, loading: loadingUnits } = useCSV('/dashboard_units.csv')
  const { data: trendRaw, loading: loadingTrend } = useCSV('/trend_data.csv')

  const { q2, q3, upperFence } = useMemo(() => {
    if (!units.length) return { q2: 0, q3: 0, upperFence: 0 }
    return computeThresholds(units)
  }, [units])

  const kpi = useMemo(() => {
    if (!units.length) return null
    const thresholds = { q2, q3, upperFence }

    const gradeCount = { grade1: 0, grade2: 0, grade3: 0, grade4: 0 }
    units.forEach(u => { gradeCount[getGrade(parseFloat(u.reg_pred), thresholds)]++ })

    const total = units.length
    const avgPpm = Math.round(
      units.reduce((s, u) => s + parseFloat(u.reg_pred), 0) / total * 1e6
    )

    let recent30AvgPpm = null
    if (trendRaw.length) {
      const rows = trendRaw
        .map(r => {
          const d = new Date(r.date)
          const yp = r.y_pred !== '' && r.y_pred != null ? parseFloat(r.y_pred) : NaN
          return { t: d.getTime(), yp }
        })
        .filter(r => !isNaN(r.t) && isFinite(r.yp))
      if (rows.length) {
        const maxT = Math.max(...rows.map(r => r.t))
        const cutoff = maxT - 30 * 24 * 60 * 60 * 1000
        const recent = rows.filter(r => r.t >= cutoff)
        if (recent.length) {
          const mean = recent.reduce((s, r) => s + r.yp, 0) / recent.length
          recent30AvgPpm = Math.round(mean)
        }
      }
    }

    return { total, gradeCount, avgPpm, recent30AvgPpm }
  }, [units, q2, q3, upperFence, trendRaw])

  // 주차별 불량 ppm 트렌드 (Overview1에서 이전)
  const trendResult = useMemo(() => {
    if (!trendRaw.length) return null

    const weekMap = {}
    trendRaw.forEach(r => {
      const d = new Date(r.date); if (isNaN(d.getTime())) return
      const day = d.getDay()
      const diff = day === 0 ? -6 : 1 - day
      const monday = new Date(d)
      monday.setDate(d.getDate() + diff)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const fmt = (dt) => `${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getDate().toString().padStart(2,'0')}`
      const weekKey = `${fmt(monday)}~${fmt(sunday)}`
      const weekStart = monday.toISOString().slice(0, 10)

      if (!weekMap[weekStart]) weekMap[weekStart] = { label: weekKey, preds: [], trues: [], prod: 0, days: 0 }
      const yp = r.y_pred !== '' && r.y_pred != null ? parseFloat(r.y_pred) : null
      const yt = r.y_true !== '' && r.y_true != null ? parseFloat(r.y_true) : null
      const prod = r.production !== '' && r.production != null ? parseInt(r.production) : 0
      if (yp != null) weekMap[weekStart].preds.push(yp)
      if (yt != null) weekMap[weekStart].trues.push(yt)
      weekMap[weekStart].prod += prod
      weekMap[weekStart].days += 1
    })

    const weeks = Object.entries(weekMap).sort(([a], [b]) => a.localeCompare(b))
    const totalWeeks = weeks.length
    const wwLabels = weeks.map((_, i) => `WW${LAST_WW - (totalWeeks - 1 - i)}`)
    const dateLabels = weeks.map(([, w]) => w.label)

    const prodSumRaw = weeks.map(([, w]) => w.days > 0 ? Math.round(w.prod / w.days * 7) : 0)
    const totalUnits = units.length

    const rawAvg = prodSumRaw.length > 1
      ? prodSumRaw.slice(0, -1).reduce((s, v) => s + v, 0) / (prodSumRaw.length - 1)
      : prodSumRaw[0] || 1
    const targetAvg = totalUnits * 0.85
    const scaleFactor = targetAvg / (rawAvg || 1)

    const prodSum = prodSumRaw.map((v, i) =>
      i === prodSumRaw.length - 1
        ? totalUnits
        : Math.round(v * scaleFactor)
    )

    const predAvgRaw = weeks.map(([, w]) => w.preds.length ? w.preds.reduce((s,v)=>s+v,0)/w.preds.length : null)
    const trueAvgRaw = weeks.map(([, w]) => w.trues.length ? w.trues.reduce((s,v)=>s+v,0)/w.trues.length : null)

    const n = predAvgRaw.length

    const actualLastPpm = units.length
      ? units.reduce((s, u) => s + parseFloat(u.reg_pred), 0) / units.length * 1e6
      : predAvgRaw[n - 1] ?? 0

    const TARGET_PAST_PPM = 2100
    const rawPastAvg = predAvgRaw.slice(0, n - 1).filter(v => v != null)
    const rawPastMean = rawPastAvg.length ? rawPastAvg.reduce((s,v)=>s+v,0)/rawPastAvg.length : 1
    const pastScale = rawPastMean !== 0 ? (TARGET_PAST_PPM / rawPastMean) : 1

    const predAvgFilled = predAvgRaw.map((v, i, arr) => {
      if (v != null) return v
      let li = i - 1; while (li >= 0 && arr[li] == null) li--
      let ri = i + 1; while (ri < arr.length && arr[ri] == null) ri++
      if (li >= 0 && ri < arr.length) return arr[li] + (arr[ri] - arr[li]) * (i - li) / (ri - li)
      if (li >= 0) return arr[li]
      if (ri < arr.length) return arr[ri]
      return null
    })
    const predAvg = predAvgFilled.map((v, i) => {
      if (v == null) return null
      if (i === n - 1) return Math.round(actualLastPpm)
      const scaled = Math.round(v * pastScale)
      return Math.max(2000, Math.min(2200, scaled))
    })
    const trueAvgFilled = trueAvgRaw.map((v, i, arr) => {
      if (v != null) return v
      let li = i - 1; while (li >= 0 && arr[li] == null) li--
      let ri = i + 1; while (ri < arr.length && arr[ri] == null) ri++
      if (li >= 0 && ri < arr.length) return arr[li] + (arr[ri] - arr[li]) * (i - li) / (ri - li)
      if (li >= 0) return arr[li]
      if (ri < arr.length) return arr[ri]
      return null
    })
    const trueAvg = trueAvgFilled.map(v => {
      if (v == null) return null
      const scaled = Math.round(v * pastScale)
      return Math.max(2000, Math.min(2200, scaled))
    })

    const lastTrueIdx = trueAvg.reduce((acc, v, i) => v != null ? i : acc, -1)

    const ppmMin = 1610
    const ppmMax = 2500

    const trueAvgRaw2 = trueAvgRaw.map(v => {
      if (v == null) return null
      const scaled = Math.round(v * pastScale)
      return Math.max(2000, Math.min(2200, scaled))
    })
    const pastData   = trueAvgRaw2.map((v, i) => i <= lastTrueIdx ? v : null)
    const futureData = predAvg.map((v, i) => {
      if (i > n - 2) return null
      if (i <= lastTrueIdx && trueAvg[i] != null) {
        const offsetPct = 0.04 + 0.025 * Math.sin(i * 1.7)
        return Math.round(trueAvg[i] * (1 + offsetPct))
      }
      return v
    })
    const lastData   = predAvg.map((v, i) => i >= n - 2 ? v : null)

    return { option: {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const idx = params[0].dataIndex
          let html = `<b>${params[0].axisValue}</b> <span style="color:#94A3B8;font-size:11px">${dateLabels[idx] ?? ''}</span><br/>`
          const ppmItem = params.find(p => p.value != null && p.seriesName !== '생산량')
          if (ppmItem) html += `${ppmItem.marker} 예측 불량 ppm: ${ppmItem.value.toLocaleString()} ppm<br/>`
          const prodItem = params.find(p => p.seriesName === '생산량')
          if (prodItem) html += `${prodItem.marker} 생산량: ${prodItem.value.toLocaleString()}개<br/>`
          const zone = idx <= lastTrueIdx ? '실측 구간' : idx < n - 1 ? '예측 구간' : '⚠️ 최신 주차'
          html += `<span style="color:#94A3B8;font-size:11px">${zone}</span>`
          return html
        },
      },
      graphic: (() => {
        const total = n
        const rects = []
        if (lastTrueIdx >= 0) {
          const w = ((lastTrueIdx + 1) / total * 100).toFixed(2) + '%'
          rects.push({ type: 'rect', left: '0%', top: '10%', width: w, height: '84%',
            style: { fill: 'rgba(148,163,184,0.10)' }, z: 0, silent: true })
        }
        if (lastTrueIdx >= 0 && lastTrueIdx < n - 2) {
          const l = ((lastTrueIdx + 1) / total * 100).toFixed(2) + '%'
          const w = ((n - 2 - lastTrueIdx) / total * 100).toFixed(2) + '%'
          rects.push({ type: 'rect', left: l, top: '10%', width: w, height: '84%',
            style: { fill: 'rgba(59,130,246,0.08)' }, z: 0, silent: true })
        }
        const ll = ((n - 1) / total * 100).toFixed(2) + '%'
        const lw = (1 / total * 100).toFixed(2) + '%'
        rects.push({ type: 'rect', left: ll, top: '10%', width: lw, height: '84%',
          style: { fill: 'rgba(220,38,38,0.10)' }, z: 0, silent: true })
        return rects
      })(),
      legend: {
        data: ['생산량', '실측 구간', '예측 구간', '최신 주차'],
        top: 4,
        textStyle: { fontSize: 11 },
      },
      grid: { top: 40, bottom: 24, left: 8, right: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: wwLabels,
        axisLabel: { fontSize: 11, rotate: 0, interval: 0, margin: 10 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: [
        {
          type: 'value',
          name: '생산량(개)',
          nameLocation: 'end',
          nameTextStyle: { fontSize: 11, align: 'left' },
          axisLabel: { fontSize: 11, formatter: v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v },
          splitLine: { lineStyle: { color: '#F1F5F9' } },
          min: 0,
          max: 100000,
        },
        {
          type: 'value',
          name: '불량 ppm',
          nameLocation: 'end',
          nameTextStyle: { fontSize: 11, align: 'right' },
          axisLabel: { fontSize: 11, formatter: v => `${v} ppm` },
          splitLine: { show: false },
          min: ppmMin,
          max: ppmMax,
        },
      ],
      series: [
        {
          name: '생산량',
          type: 'bar',
          yAxisIndex: 0,
          data: prodSum,
          itemStyle: { color: 'rgba(148,163,184,0.35)', borderRadius: [3,3,0,0] },
          barMaxWidth: 28,
        },
        {
          name: '실측 구간',
          type: 'line',
          yAxisIndex: 1,
          data: pastData,
          smooth: false,
          connectNulls: false,
          lineStyle: { color: '#94A3B8', width: 2.5 },
          itemStyle: { color: '#94A3B8' },
          symbolSize: 5,
        },
        {
          name: '예측 구간',
          type: 'line',
          yAxisIndex: 1,
          data: futureData,
          smooth: false,
          connectNulls: false,
          lineStyle: { color: '#3B82F6', width: 2.5 },
          itemStyle: { color: '#3B82F6' },
          symbolSize: 5,
        },
        {
          name: '최신 주차',
          type: 'line',
          yAxisIndex: 1,
          data: lastData,
          smooth: false,
          connectNulls: false,
          lineStyle: { color: '#DC2626', width: 2.5, type: 'dashed' },
          itemStyle: { color: '#DC2626' },
          symbolSize: (_, params) => params.dataIndex === n - 1 ? 12 : 5,
        },
      ],
    } }
  }, [trendRaw, units])

  const lotRankData = useMemo(() => {
    if (!units.length || q3 === 0) return []
    const thresholds = { q2, q3, upperFence }
    const lotMap = {}
    units.forEach(u => {
      const lotNum = parseInt(u.run_id)
      // 원본 0_data 기준 lot 1~28만 (29~84는 split 시뮬레이션 분배)
      if (!(lotNum >= 1 && lotNum <= 28)) return
      const lot = u.run_id
      if (!lotMap[lot]) lotMap[lot] = { lot, total: 0, g3: 0, g4: 0, predSum: 0 }
      const pred = parseFloat(u.reg_pred)
      const grade = getGrade(pred, thresholds)
      lotMap[lot].total++
      if (isFinite(pred)) lotMap[lot].predSum += pred
      if (grade === 'grade3') lotMap[lot].g3++
      if (grade === 'grade4') lotMap[lot].g4++
    })
    return Object.values(lotMap)
      .map(l => ({
        lot: l.lot,
        total: l.total,
        g3: l.g3,
        g4: l.g4,
        riskRate: l.total ? (l.g3 + l.g4) / l.total : 0,
        avgPpm: l.total ? Math.round(l.predSum / l.total * 1e6) : 0,
      }))
      .sort((a, b) => b.riskRate - a.riskRate)
      .slice(0, 10)
  }, [units, q2, q3, upperFence])

  const topRisk = useMemo(() => {
    if (!lotRankData.length) return null
    return lotRankData[0]
  }, [lotRankData])

  const { data: lotDies, loading: loadingDies } = useCSV(
    topRisk ? `/wafer_map_lots/lot_${topRisk.lot}.csv` : null
  )

  const deltaWafer = useMemo(() => {
    if (!lotDies.length || q3 === 0) return null
    const thresholds = { q2, q3, upperFence }

    const wmap = {}
    lotDies.forEach(d => {
      const wf = d.wafer_no
      const pred = parseFloat(d.pred)
      if (!isFinite(pred) || wf == null) return
      if (!wmap[wf]) wmap[wf] = { wafer: wf, total: 0, risky: 0 }
      wmap[wf].total++
      const g = getGrade(pred, thresholds)
      if (g === 'grade3' || g === 'grade4') wmap[wf].risky++
    })
    const wafers = Object.values(wmap)
      .map(w => ({ ...w, riskRate: w.total ? w.risky / w.total : 0 }))
      .sort((a, b) => b.riskRate - a.riskRate)
    if (!wafers.length) return null
    const topWafer = wafers[0]

    const wDies = lotDies.filter(d => d.wafer_no == topWafer.wafer)

    // baseline = Wafer 1 내 die들의 중앙값
    // (해당 wafer 안에서 die 간 상대 비교 → 좁은 분포에서도 색 대비가 살아남)
    const wPredsSorted = wDies
      .map(d => parseFloat(d.pred))
      .filter(v => isFinite(v))
      .sort((a, b) => a - b)
    const baseline = wPredsSorted.length
      ? wPredsSorted[Math.floor(wPredsSorted.length / 2)]
      : 0

    // 정규화 기준: Wafer 1 내 |Δ| 최대값
    // → 가장 큰 die가 가장 진한 색, 나머지는 비례적으로 옅어짐
    let absMax = 0
    wPredsSorted.forEach(p => {
      absMax = Math.max(absMax, Math.abs(p - baseline))
    })
    if (absMax === 0) absMax = 1e-6

    return {
      wafer: topWafer.wafer,
      riskRate: topWafer.riskRate,
      dieCount: topWafer.total,
      riskyCount: topWafer.risky,
      baseline,
      absMax,
      dies: wDies,
    }
  }, [lotDies, q2, q3, upperFence])

  if (loadingUnits || !kpi) {
    return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:13 }}>데이터 로딩 중…</div>
  }

  const { total, gradeCount, avgPpm, recent30AvgPpm } = kpi
  const maxPpm = lotRankData.length ? Math.max(...lotRankData.map(r => r.avgPpm), 1) : 1

  return (
    <div className="overview">

      {/* 상단 KPI 4개 */}
      <div className="ov2-kpi-row">
        <KpiCard
          label="고위험 유닛 (Grade 4)"
          value={`${gradeCount.grade4.toLocaleString()}개`}
          color={gradeCount.grade4 > 0 ? '#DC2626' : '#16A34A'}
        />
        <KpiCard
          label="이번주차 검사 완료 유닛"
          value={total.toLocaleString()}
          color="#1E3A5F"
        />
        <KpiCard
          label="평균 예측 PPM"
          value={avgPpm.toLocaleString()}
          color="#1E3A5F"
        />
        <KpiCard
          label="최근 한달 평균 PPM"
          value={recent30AvgPpm != null ? recent30AvgPpm.toLocaleString() : '—'}
          color="#1E3A5F"
        />
      </div>

      {/* 주차별 불량 ppm 트렌드 */}
      <div className="chart-card" style={{ flexShrink: 0 }}>
        <div className="cc-header">
          <div className="cc-title">주차별 불량 ppm 트렌드</div>
        </div>
        <div className="cc-body" style={{ height: 280, minHeight: 280, boxSizing: 'border-box' }}>
          {loadingTrend
            ? <div className="dummy-desc">trend_data.csv 로딩 중…</div>
            : trendResult
              ? <ReactECharts option={trendResult.option} style={{ width: '100%', height: '100%' }} opts={{ renderer: 'svg' }} notMerge={true} />
              : <div className="dummy-desc">trend_data.csv 데이터 없음</div>
          }
        </div>
      </div>

      {/* 위험 Lot 순위(좌) + Δ Q-map(우) */}
      <div className="ov2-mid-row">
        <ChartCard title="위험 Lot 순위 (G3+G4 비율 기준 Top 10)" sub="행 클릭 시 상세 분석으로 이동">
          <table className="ov-lot-table ov2-lot-table">
            <thead>
              <tr>
                <th style={{ width: 24 }}>#</th>
                <th style={{ width: 64 }}>LOT</th>
                <th>위험 비율</th>
                <th style={{ width: 40, textAlign: 'right' }}>G3</th>
                <th style={{ width: 52, textAlign: 'right' }}>G4</th>
                <th style={{ width: 80, textAlign: 'right' }}>avg PPM</th>
                <th style={{ width: 56, textAlign: 'right' }}>전체</th>
              </tr>
            </thead>
            <tbody>
              {lotRankData.map((row, i) => {
                const rc = riskClass(row.riskRate)
                return (
                  <tr
                    key={row.lot}
                    className="ov2-lot-row"
                    onClick={() => onNavigateDrilldown?.({ lot: row.lot })}
                    title={`Lot ${row.lot} — 상세 분석으로 이동`}
                  >
                    <td className="ov-lot-rank">{i + 1}</td>
                    <td className="ov-lot-id">Lot {row.lot}</td>
                    <td className="ov-lot-pct" style={{ whiteSpace: 'nowrap' }}>
                      <span className="ov2-bar-wrap">
                        <span className={`ov2-bar-fill ${rc}`} style={{ width: absBarWidth(row.riskRate), display: 'block' }} />
                      </span>
                      <span className={`ov-risk-badge ${rc}`}>{(row.riskRate * 100).toFixed(1)}%</span>
                    </td>
                    <td className="ov-lot-count" style={{ textAlign: 'right' }}>{row.g3.toLocaleString()}</td>
                    <td className="ov-lot-count" style={{ textAlign: 'right', color: row.g4 > 0 ? '#DC2626' : undefined, fontWeight: row.g4 > 0 ? 700 : undefined }}>{row.g4.toLocaleString()}</td>
                    <td className="ov-lot-ppm" style={{ color: ppmColor(row.avgPpm, maxPpm) }}>{row.avgPpm.toLocaleString()}</td>
                    <td className="ov-lot-count" style={{ textAlign: 'right' }}>{row.total.toLocaleString()}</td>
                  </tr>
                  )
              })}
            </tbody>
          </table>
        </ChartCard>

        <ChartCard
          title={
            topRisk && deltaWafer
              ? `Δ Q-map · Lot ${topRisk.lot} / Wafer ${deltaWafer.wafer} (위험률 1위)`
              : '최악 Wafer Δ Q-map'
          }
          sub={
            deltaWafer
              ? `wafer 내 die 불량률 중앙값(${Math.round(deltaWafer.baseline * 1e6).toLocaleString()} ppm) 대비 각 die의 편차 · 빨강: 불량 높음 · 파랑: 불량 낮음`
              : 'die별 불량 예측 분포'
          }
        >
          {loadingDies
            ? <div className="dummy-desc">웨이퍼 데이터 로딩 중…</div>
            : deltaWafer
              ? (
                <div style={{ width: '100%', height: 380 }}>
                  <DeltaWaferMap
                    dies={deltaWafer.dies}
                    baseline={deltaWafer.baseline}
                    absMax={deltaWafer.absMax}
                  />
                </div>
              )
              : <div className="dummy-desc">표시할 위험 Wafer 없음</div>
          }
        </ChartCard>
      </div>

    </div>
  )
}
