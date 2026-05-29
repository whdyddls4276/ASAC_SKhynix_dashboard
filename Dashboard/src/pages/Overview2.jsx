import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import { GRADE_COLORS, getGrade } from './Overview'
import ALL_DIE_POSITIONS from './diePositions.js'
import './Overview.css'
import './Overview2.css'

const GLOBAL_DIE_X_MIN = 12, GLOBAL_DIE_X_MAX = 66
const GLOBAL_DIE_Y_MIN = 11, GLOBAL_DIE_Y_MAX = 32

function deltaColor(delta, absMax) {
  if (!isFinite(delta) || absMax <= 0) return '#f3f4f6'
  const t = Math.max(-1, Math.min(1, delta / absMax))
  if (t >= 0) {
    const k = t
    const r = Math.round(243 + (220 - 243) * k)
    const g = Math.round(244 + (38  - 244) * k)
    const b = Math.round(246 + (38  - 246) * k)
    return `rgb(${r},${g},${b})`
  } else {
    const k = -t
    const r = Math.round(243 + (37  - 243) * k)
    const g = Math.round(244 + (99  - 244) * k)
    const b = Math.round(246 + (235 - 246) * k)
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

function ShapTopBars({ shapData }) {
  const bars = useMemo(() => {
    if (!shapData?.length) return []
    return shapData
      .filter(r => /^X\d+$/.test(r.feature))
      .map(r => ({
        feature: r.feature,
        mag: parseFloat(r.mean_abs_shap) || 0,
        signed: parseFloat(r.mean_shap) || 0,
      }))
      .sort((a, b) => b.mag - a.mag)
      .slice(0, 10)
  }, [shapData])

  if (!bars.length) return <div className="dummy-desc">SHAP 데이터 없음</div>
  const maxMag = Math.max(...bars.map(b => b.mag), 1e-12)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 4px' }}>
      {bars.map((b, i) => {
        const w = Math.round(b.mag / maxMag * 100)
        const clr = b.signed >= 0 ? '#ef4444' : '#3b82f6'
        return (
          <div key={b.feature} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 18, textAlign: 'right', color: '#94a3b8', fontWeight: 600 }}>{i + 1}</span>
            <span style={{ width: 56, fontFamily: 'monospace', color: '#1e293b', fontWeight: 600 }}>{b.feature}</span>
            <div style={{ flex: 1, background: '#f1f5f9', height: 12, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${w}%`, height: '100%', background: clr, borderRadius: 3 }} />
            </div>
            <span style={{ width: 70, textAlign: 'right', color: clr, fontWeight: 700, fontFamily: 'monospace' }}>
              {(b.signed >= 0 ? '+' : '') + Math.round(b.signed * 1e6).toLocaleString()}
            </span>
          </div>
        )
      })}
    </div>
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

function makePieOption(data) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const normalItem = data.find(d => d.name && d.name.includes('정상'))
  const normalPct = total && normalItem ? (normalItem.value / total * 100).toFixed(1) : '0'

  return {
    tooltip: {
      trigger: 'item',
      formatter: p => `<b>${p.name}</b><br/>${p.value.toLocaleString()}개 (${p.percent}%)`,
      backgroundColor: 'rgba(15, 23, 42, 0.92)',
      borderColor: 'transparent',
      textStyle: { color: '#fff', fontSize: 12 },
    },
    legend: {
      show: true,
      orient: 'vertical',
      right: 12,
      top: 'middle',
      itemWidth: 12,
      itemHeight: 12,
      itemGap: 12,
      icon: 'roundRect',
      textStyle: { fontSize: 13, color: '#475569', fontWeight: 500 },
      formatter: name => {
        const item = data.find(d => d.name === name)
        if (!item) return name
        const raw = total ? item.value / total * 100 : 0
        const pct = item.value > 0 && raw < 0.1 ? '<0.1' : raw.toFixed(1)
        return `{name|${name}}  {pct|${pct}%}  {cnt|${item.value.toLocaleString()}개}`
      },
      textStyle: {
        fontSize: 13,
        color: '#475569',
        rich: {
          name: { fontWeight: 600, color: '#1E293B' },
          pct:  { fontWeight: 700, color: '#1E3A5F', padding: [0, 6, 0, 4] },
          cnt:  { color: '#94A3B8', fontSize: 12 },
        },
      },
    },
    graphic: [
      {
        type: 'text',
        left: '35%', top: '44%',
        style: {
          text: `${normalPct}%`,
          fill: '#1E3A5F',
          fontSize: 26,
          fontWeight: 800,
          textAlign: 'center',
        },
      },
      {
        type: 'text',
        left: '35%', top: '60%',
        style: {
          text: '정상 (G1)',
          fill: '#94A3B8',
          fontSize: 11,
          fontWeight: 500,
          textAlign: 'center',
        },
      },
    ],
    series: [{
      type: 'pie',
      radius: ['52%', '74%'],
      center: ['38%', '52%'],
      data: data.map(d => ({
        ...d,
        itemStyle: {
          ...(d.itemStyle || {}),
          borderColor: '#fff',
          borderWidth: 3,
          borderRadius: 4,
        },
      })),
      label: { show: false },
      labelLine: { show: false },
      emphasis: {
        scale: true,
        scaleSize: 6,
        itemStyle: { shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.18)' },
      },
    }],
  }
}

export default function Overview2({ onNavigateDrilldown, onNavigateProcessFactor }) {
  const { data: units, loading: loadingUnits } = useCSV('/dashboard_units.csv')
  const { data: shapData } = useCSV('/shap_bar.csv')

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
    const normalRate = (gradeCount.grade1 / total * 100).toFixed(1)

    // 파이 데이터: 전체 Grade 분포
    const pieData = Object.entries(gradeCount).map(([g, v]) => ({
      name: GRADE_COLORS[g].label,
      value: v,
      itemStyle: { color: GRADE_COLORS[g].bar },
    }))

    return { total, gradeCount, avgPpm, normalRate, pieData }
  }, [units, q2, q3, upperFence])

  const lotRankData = useMemo(() => {
    if (!units.length || q3 === 0) return []
    const thresholds = { q2, q3, upperFence }
    const lotMap = {}
    units.forEach(u => {
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

  // 위험 1위 Lot/Wafer 선정 — 하단 Δ Q-map용
  const topRisk = useMemo(() => {
    if (!lotRankData.length) return null
    return lotRankData[0]   // 이미 riskRate 내림차순 정렬됨
  }, [lotRankData])

  // 해당 Lot의 die 데이터 동적 로드
  const { data: lotDies, loading: loadingDies } = useCSV(
    topRisk ? `/wafer_map_lots/lot_${topRisk.lot}.csv` : null
  )

  // 해당 Lot 내 위험률 1위 Wafer 선정 + Δ 기준선(같은 Lot 내 G1 die 평균 pred) 계산
  const deltaWafer = useMemo(() => {
    if (!lotDies.length || q3 === 0) return null
    const thresholds = { q2, q3, upperFence }

    // 1) Wafer별 위험률(G3+G4 die 비율) 산출
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

    // 2) 같은 Lot 내 G1 die들의 평균 pred = 기준선
    let baseSum = 0, baseN = 0
    lotDies.forEach(d => {
      const pred = parseFloat(d.pred)
      if (!isFinite(pred)) return
      if (getGrade(pred, thresholds) === 'grade1') { baseSum += pred; baseN++ }
    })
    const baseline = baseN > 0
      ? baseSum / baseN
      : lotDies.reduce((s, d) => s + (parseFloat(d.pred) || 0), 0) / lotDies.length

    // 3) 위험 1위 Wafer의 die들 + Δ 절대 최대치
    const wDies = lotDies.filter(d => d.wafer_no == topWafer.wafer)
    let absMax = 0
    wDies.forEach(d => {
      const p = parseFloat(d.pred)
      if (isFinite(p)) absMax = Math.max(absMax, Math.abs(p - baseline))
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

  const { total, gradeCount, avgPpm, normalRate, pieData } = kpi
  const maxPpm = lotRankData.length ? Math.max(...lotRankData.map(r => r.avgPpm), 1) : 1

  return (
    <div className="overview">

      {/* KPI 4개 가로 한 줄 */}
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
          sub="ppm"
          color="#1E3A5F"
        />
        <KpiCard
          label="정상 유닛 비율 (G1)"
          value={`${normalRate}%`}
          color={parseFloat(normalRate) >= 70 ? '#16A34A' : '#F59E0B'}
        />
      </div>

      {/* 위험 Lot 순위표(좌) + Grade 도넛(우) */}
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

        {/* Grade 도넛 차트 */}
        <div className="pie-card">
          <div className="pie-card-title">Grade 분포</div>
          <ReactECharts option={makePieOption(pieData)} style={{ height: 340 }} opts={{ renderer: 'svg' }} />
        </div>
      </div>

      {/* ── 하단: Δ Q-map + SHAP Top10 ── */}
      <div className="ov2-spc-row">
        <ChartCard
          title={
            topRisk && deltaWafer
              ? `Δ Q-map · Lot ${topRisk.lot} / Wafer ${deltaWafer.wafer} (위험률 1위)`
              : '최악 Wafer Δ Q-map'
          }
          sub={
            deltaWafer
              ? `같은 Lot 정상(G1) die 평균(${Math.round(deltaWafer.baseline * 1e6).toLocaleString()} ppm) 대비 편차 · 빨강=초과 · 파랑=이하 · 클릭 시 상세 이동`
              : '같은 Lot 내 정상 die 평균 대비 편차를 색상으로 표시'
          }
        >
          {loadingDies
            ? <div className="dummy-desc">웨이퍼 데이터 로딩 중…</div>
            : deltaWafer
              ? (
                <div
                  style={{ width: '100%', height: 380, cursor: topRisk ? 'pointer' : 'default' }}
                  onClick={() => topRisk && onNavigateDrilldown?.({ lot: topRisk.lot, wafer: deltaWafer.wafer })}
                  title={topRisk ? `Lot ${topRisk.lot} / Wafer ${deltaWafer.wafer} 상세 분석으로 이동` : ''}
                >
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

        <ChartCard
          title="모델 SHAP 기여도 Top 10"
          sub="이번 주 예측을 견인한 주요 인자 — 빨강=불량 위험 ↑, 파랑=정상 방향 / 클릭 시 공정 인자 진단으로 이동"
        >
          <div
            style={{ cursor: onNavigateProcessFactor ? 'pointer' : 'default' }}
            onClick={() => onNavigateProcessFactor?.()}
          >
            <ShapTopBars shapData={shapData} />
          </div>
        </ChartCard>
      </div>

    </div>
  )
}







