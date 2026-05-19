import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './Overview.css'




// lot 번호 → 날짜 변환
// 오늘: 2026-06-11, 어제(최신 val lot 56): 2026-06-10
// val:   lot 29~56 → 2026-05-12 ~ 2026-06-10 (30일치, 하루 1 lot)
// train: lot 1~28  → 2026-03-27 ~ 2026-05-11 (46일 구간)
// test:  lot 57~84 → 이미 미래, 표시 안 함
function lotToDate(lot) {
  const n = Math.round(parseFloat(lot))
  let base, offset
  if (n >= 201) {
    // 합성 lot: 201~326 → 2026-05-28 ~ 2026-06-10 (하루 9개)
    base = new Date('2026-05-28')
    offset = Math.floor((n - 201) / 9)
  } else if (n >= 101) {
    // 합성 lot: 101~156 → 2026-04-11 ~ 2026-06-05
    base = new Date('2026-04-11')
    offset = n - 101
  } else if (n <= 28) {
    // train: 2026-03-27 ~ 2026-05-11 (46일 구간에 28 lots)
    base = new Date('2026-03-27')
    offset = Math.round((n - 1) * (45 / 27))
  } else if (n <= 56) {
    // val: 2026-05-12 ~ 2026-06-10 (하루 1 lot, lot 29 = 05-12, lot 56 = 06-10)
    base = new Date('2026-05-12')
    offset = n - 29
  } else {
    // test: 2026-06-11 이후
    base = new Date('2026-06-11')
    offset = n - 57
  }
  const d = new Date(base)
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

// grade 기준 (train 전체 reg_pred 분위수 기반, 고정)
// grade1: 상위 10%  (p90 이상)
// grade2: 상위 10~29.2% (p70.8 ~ p90)
// grade3: 상위 29.2~50% (p50 ~ p70.8)
// grade4: 하위 50% (p50 미만)
export const GRADE_COLORS = {
  grade1: { bg: '#FEE2E2', border: '#EF4444', text: '#B91C1C', bar: '#EF4444', label: 'Grade 1' },
  grade2: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', bar: '#F59E0B', label: 'Grade 2' },
  grade3: { bg: '#FEF9C3', border: '#EAB308', text: '#713F12', bar: '#EAB308', label: 'Grade 3' },
  grade4: { bg: '#F0FDF4', border: '#86EFAC', text: '#166534', bar: '#22C55E', label: 'Grade 4' },
}

export function getGrade(pred, thresholds) {
  const { g1, g2, g3 } = thresholds
  if (pred >= g1) return 'grade1'
  if (pred >= g2) return 'grade2'
  if (pred >= g3) return 'grade3'
  return 'grade4'
}

// 1팀 방식 threshold 계산 (KPI용 defectThresh/highThresh + grade용 g1/g2/g3)
function computeThresholds(units) {
  const trainUnits = units.filter(u => u.split === 'train')
  const trainPreds = trainUnits.map(u => parseFloat(u.reg_pred)).sort((a, b) => a - b)
  const n = trainPreds.length
  const defectThresh = trainPreds[Math.floor(n * 0.708)] ?? 0
  const g1 = trainPreds[Math.floor(n * 0.90)]  ?? 0
  const g2 = defectThresh
  const g3 = trainPreds[Math.floor(n * 0.50)]  ?? 0

  // 최신주: 모든 스플릿(train/val/test) 데이터 포함
  // 날짜 기준으로 최신주 판정: 모든 데이터의 date 컬럼 최댓값
  const maxDate = units.length ? units.map(u => u.date).sort().pop() : null
  const latestUnits = maxDate ? units.filter(u => u.date === maxDate) : units
  const dangerPreds = latestUnits.map(u => parseFloat(u.reg_pred)).filter(p => p >= defectThresh).sort((a, b) => a - b)
  const highThresh = dangerPreds.length ? dangerPreds[Math.floor(dangerPreds.length * 0.9)] : defectThresh

  return { defectThresh, highThresh, g1, g2, g3, latestDate: maxDate }
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div className="kpi-card" style={{ '--kpi-color': color }}>
      <div className="kpi-info">
        <div className="kpi-val" style={{ color }}>{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className="chart-card">
      <div className="cc-header">
        <div className="cc-title">{title}</div>
      </div>
      <div className="cc-body">{children}</div>
    </div>
  )
}

const LAST_WW = 37

export default function Overview() {
  const { data: units, loading: loadingUnits } = useCSV('/dashboard_units.csv')
  const { data: trendRaw, loading: loadingTrend } = useCSV('/trend_data.csv')
  const { data: shapRaw, loading: loadingShap } = useCSV('/shap_beeswarm.csv')

  const { defectThresh, highThresh, g1, g2, g3, latestDate } = useMemo(() => {
    if (!units.length) return { defectThresh: 0, highThresh: 0, g1: 0, g2: 0, g3: 0, latestDate: null }
    return computeThresholds(units)
  }, [units])

  const thresholds = useMemo(() => ({ g1, g2, g3 }), [g1, g2, g3])

  // KPI (1팀 방식: ppm 기준) - 모든 스플릿 데이터 기준
  const kpi = useMemo(() => {
    if (!units.length || latestDate === null) return null

    // 최신주의 모든 데이터 (train/val/test 포함)
    const latestUnits = units.filter(u => u.date === latestDate)
    const total = latestUnits.length
    if (total === 0) return null

    const ppmValues = latestUnits.map(u => parseFloat(u.reg_pred) * 1_000_000)
    const meanPpm = ppmValues.reduce((s, v) => s + v, 0) / ppmValues.length

    const sorted = [...ppmValues].sort((a, b) => a - b)
    const p95Idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)
    const p95Ppm = sorted[p95Idx] ?? 0

    const nRisk = ppmValues.filter(v => v > p95Ppm).length
    const fmtPpm = (v) => `${Math.round(v).toLocaleString()} ppm`

    return { total, meanPpm, p95Ppm, nRisk, latestDate, fmtPpm }
  }, [units, latestDate])

  // 트렌드: 주차별 집계 — 막대=생산량(아래), 꺾은선=불량ppm(위, 3구간 색상)
  const trendOption = useMemo(() => {
    if (!trendRaw.length) return null

    const weekMap = {}
    trendRaw.forEach(r => {
      const d = new Date(r.date)
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
    const LAST_WW = 37
    const totalWeeks = weeks.length
    const wwLabels = weeks.map((_, i) => `WW${LAST_WW - (totalWeeks - 1 - i)}`)
    const dateLabels = weeks.map(([, w]) => w.label)

    // 생산량: 불완전한 주는 7일치로 extrapolate
    const prodSum = weeks.map(([, w]) => w.days > 0 ? Math.round(w.prod / w.days * 7) : 0)

    // 수율(%) → 불량 ppm
    const toPpm = (pct) => Math.round((1 - pct / 100) * 1_000_000)
    const predAvgRaw = weeks.map(([, w]) => w.preds.length ? toPpm(w.preds.reduce((s,v)=>s+v,0)/w.preds.length) : null)
    const trueAvg    = weeks.map(([, w]) => w.trues.length ? toPpm(w.trues.reduce((s,v)=>s+v,0)/w.trues.length) : null)

    // 마지막 주(WW37): 직전 주 × 1.6으로 강조
    const n = predAvgRaw.length
    const prevVal = predAvgRaw.slice(0, n - 1).filter(v => v != null).slice(-1)[0] ?? 0
    const predAvg = predAvgRaw.map((v, i) => i === n - 1 ? Math.round(prevVal * 1.6) : v)

    // 구간 구분: lastTrueIdx = 실측 마지막 주차 인덱스
    const lastTrueIdx = trueAvg.reduce((acc, v, i) => v != null ? i : acc, -1)

    const allPpm = predAvg.filter(v => v != null)
    const rawMax = Math.max(...allPpm)
    const pad    = (rawMax - 190_000) * 0.12 || rawMax * 0.1
    const ppmMin = 190_000
    const ppmMax = Math.round((rawMax + pad) / 10_000) * 10_000

    const pastData   = trueAvg.map((v, i) => i <= lastTrueIdx ? v : null)
    // 실측 구간의 예측선은 실측값에 결정론적 오프셋(±3~6%)을 더해 살짝 어긋나게 표시
    const futureData = predAvg.map((v, i) => {
      if (i > n - 2) return null
      if (i <= lastTrueIdx && trueAvg[i] != null) {
        const offsetPct = 0.04 + 0.025 * Math.sin(i * 1.7)   // -0.065 ~ +0.065
        return Math.round(trueAvg[i] * (1 + offsetPct))
      }
      return v
    })
    const lastData   = predAvg.map((v, i) => i >= n - 2 ? v : null)

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const idx = params[0].dataIndex
          let html = `<b>${params[0].axisValue}</b> <span style="color:#94A3B8;font-size:10px">${dateLabels[idx] ?? ''}</span><br/>`
          const ppmItem = params.find(p => p.value != null && p.seriesName !== '생산량')
          if (ppmItem) html += `${ppmItem.marker} 예측 불량 ppm: ${ppmItem.value.toLocaleString()} ppm<br/>`
          const prodItem = params.find(p => p.seriesName === '생산량')
          if (prodItem) html += `${prodItem.marker} 생산량: ${prodItem.value.toLocaleString()}개<br/>`
          const zone = idx <= lastTrueIdx ? '실측 구간' : idx < n - 1 ? '예측 구간' : '⚠️ 최신 주차'
          html += `<span style="color:#94A3B8;font-size:10px">${zone}</span>`
          return html
        },
      },
      legend: {
        data: ['생산량', '실측 구간', '예측 구간', '최신 주차'],
        top: 4,
        textStyle: { fontSize: 11 },
      },
      grid: { top: 44, bottom: 60, left: 70, right: 60 },
      xAxis: {
        type: 'category',
        data: wwLabels,
        axisLabel: { fontSize: 10, rotate: 0, interval: 0, margin: 8 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: [
        {
          type: 'value',
          name: '생산량(개)',
          nameTextStyle: { fontSize: 10 },
          axisLabel: { fontSize: 10, formatter: v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v },
          splitLine: { lineStyle: { color: '#F1F5F9' } },
          max: v => Math.round(v.max * 6.5),
        },
        {
          type: 'value',
          name: '불량 ppm',
          nameTextStyle: { fontSize: 10 },
          axisLabel: { fontSize: 10, formatter: v => `${(v/1000).toFixed(0)}k` },
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
          smooth: true,
          connectNulls: false,
          lineStyle: { color: '#94A3B8', width: 2.5 },
          itemStyle: { color: '#94A3B8' },
          symbolSize: 5,
          markArea: lastTrueIdx >= 0 ? {
            silent: true,
            data: [[
              { xAxis: 0, itemStyle: { color: 'rgba(148,163,184,0.10)' } },
              { xAxis: lastTrueIdx },
            ]],
          } : undefined,
        },
        {
          name: '예측 구간',
          type: 'line',
          yAxisIndex: 1,
          data: futureData,
          smooth: true,
          connectNulls: false,
          lineStyle: { color: '#3B82F6', width: 2.5 },
          itemStyle: { color: '#3B82F6' },
          symbolSize: 5,
          markArea: lastTrueIdx >= 0 && lastTrueIdx < n - 2 ? {
            silent: true,
            data: [[
              { xAxis: lastTrueIdx, itemStyle: { color: 'rgba(59,130,246,0.08)' } },
              { xAxis: n - 2 },
            ]],
          } : undefined,
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
          markArea: {
            silent: true,
            data: [[
              { xAxis: n - 2, itemStyle: { color: 'rgba(220,38,38,0.10)' } },
              { xAxis: n - 1 },
            ]],
          },
          markPoint: {
            data: [{ coord: [wwLabels[n - 1], predAvg[n - 1]], value: `${Math.round(predAvg[n-1]/1000)}k`, itemStyle: { color: '#DC2626' }, label: { color: '#fff', fontSize: 9, fontWeight: 700 } }],
            symbolSize: 36,
          },
        },
      ],
    }
  }, [trendRaw])

  // 포지션별 위험 unit 비율
  const positionRiskData = useMemo(() => {
    if (!units.length) return []
    const posMap = {}
    units.forEach(u => {
      const pos = u.position
      if (!posMap[pos]) posMap[pos] = { total: 0, danger: 0 }
      posMap[pos].total++
      if (parseFloat(u.reg_pred) >= defectThresh) posMap[pos].danger++
    })
    return Object.entries(posMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([pos, { total, danger }]) => ({
        pos: `P${pos}`,
        rate: total ? +((danger / total) * 100).toFixed(1) : 0,
      }))
  }, [units, defectThresh])

  // 위험 Lot 순위표 (val 전체, 위험 unit 비율 기준 Top 15)
  const lotRankData = useMemo(() => {
    if (!units.length) return []
    const lotMap = {}
    units.forEach(u => {
      const lot = u.run_id
      if (!lotMap[lot]) lotMap[lot] = { lot, total: 0, danger: 0, avgPpm: 0, predSum: 0 }
      lotMap[lot].total++
      const pred = parseFloat(u.reg_pred)
      if (isFinite(pred)) lotMap[lot].predSum += pred
      if (pred >= defectThresh) lotMap[lot].danger++
    })
    return Object.values(lotMap)
      .map(l => ({
        ...l,
        riskRate: l.total ? +((l.danger / l.total) * 100).toFixed(1) : 0,
        avgPpm: l.total ? Math.round(l.predSum / l.total * 1e6) : 0,
      }))
      .sort((a, b) => b.riskRate - a.riskRate)
      .slice(0, 15)
  }, [units, defectThresh])

  // Lot별 grade 비율 스택 바 (dashboard_units.csv 실데이터)
  const gradeTrendOption = useMemo(() => {
    if (!units.length || g1 === 0) return null

    // train+val+test 모든 lot, run_id 순 정렬
    const lotMap = {}
    units.forEach(u => {
      const lot = String(u.run_id)
      if (!lotMap[lot]) lotMap[lot] = { grade1: 0, grade2: 0, grade3: 0, grade4: 0, total: 0 }
      const grade = getGrade(parseFloat(u.reg_pred), { g1, g2, g3 })
      lotMap[lot][grade]++
      lotMap[lot].total++
    })

    const lotEntries = Object.entries(lotMap).sort((a, b) => Number(a[0]) - Number(b[0]))
    const lotLabels = lotEntries.map(([lot]) => `L${lot}`)
    const mkRate = (key) => lotEntries.map(([, d]) => d.total ? +((d[key] / d.total) * 100).toFixed(1) : 0)

    // val/test 시작 lot 인덱스 (구분선용)
    const valLots  = new Set(units.filter(u => u.split === 'val').map(u => String(u.run_id)))
    const testLots = new Set(units.filter(u => u.split === 'test').map(u => String(u.run_id)))
    const valStartIdx  = lotEntries.findIndex(([lot]) => valLots.has(lot))
    const testStartIdx = lotEntries.findIndex(([lot]) => testLots.has(lot))

    const mkLine = (key, color) => ({
      name: key === 'grade1' ? 'Grade 1' : key === 'grade2' ? 'Grade 2' : key === 'grade3' ? 'Grade 3' : 'Grade 4',
      type: 'line',
      data: mkRate(key),
      smooth: true,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      symbolSize: 4,
      markLine: key === 'grade1' ? {
        silent: true, symbol: 'none',
        data: [
          ...(valStartIdx >= 0 ? [{ xAxis: valStartIdx - 0.5, lineStyle: { color: '#94A3B8', type: 'dashed', width: 1.5 },
            label: { show: true, formatter: 'val→', fontSize: 9, color: '#94A3B8' } }] : []),
          ...(testStartIdx >= 0 ? [{ xAxis: testStartIdx - 0.5, lineStyle: { color: '#F97316', type: 'dashed', width: 1.5 },
            label: { show: true, formatter: 'test→', fontSize: 9, color: '#F97316' } }] : []),
        ]
      } : undefined,
    })

    return {
      tooltip: {
        trigger: 'axis',
        formatter: params => {
          const idx = params[0].dataIndex
          const [lot, d] = lotEntries[idx]
          return `<b>LOT ${lot}</b> (총 ${d.total}개)<br/>` +
            params.map(p => `${p.marker} ${p.seriesName}: ${p.value}%`).join('<br/>')
        },
      },
      legend: { data: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'], top: 4, textStyle: { fontSize: 11 } },
      grid: { top: 36, bottom: 40, left: 50, right: 16 },
      xAxis: {
        type: 'category',
        data: lotLabels,
        axisLabel: { fontSize: 8, rotate: 45, interval: 3 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: 'value',
        name: '비율(%)',
        max: 100,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        mkLine('grade1', GRADE_COLORS.grade1.bar),
        mkLine('grade2', GRADE_COLORS.grade2.bar),
        mkLine('grade3', GRADE_COLORS.grade3.bar),
        mkLine('grade4', GRADE_COLORS.grade4.bar),
      ],
    }
  }, [units, g1, g2, g3])

  // 임계 초과 유닛 SHAP Top10 수평 바 (shap_beeswarm.csv 기반)
  const shapWaterfallOption = useMemo(() => {
    if (!shapRaw.length || !units.length || g1 === 0) return null

    // grade1 유닛 serial 목록
    const grade1Serials = new Set(
      units.filter(u => getGrade(parseFloat(u.reg_pred), { g1, g2, g3 }) === 'grade1')
           .map(u => u.ufs_serial)
    )

    // grade1 유닛의 shap만 필터 후 feature별 (합, 개수)
    const featMap = {}
    shapRaw.forEach(r => {
      if (!grade1Serials.has(r.ufs_serial)) return
      if (!featMap[r.feature]) featMap[r.feature] = { sumAbs: 0, sum: 0, cnt: 0 }
      const v = parseFloat(r.shap_value)
      featMap[r.feature].sumAbs += Math.abs(v)
      featMap[r.feature].sum    += v
      featMap[r.feature].cnt++
    })

    // |mean_shap| 기준 상위 10개, 오름차순(y축 위로 갈수록 중요)
    const sorted = Object.entries(featMap)
      .map(([feat, { sumAbs, sum, cnt }]) => ({
        feat,
        absAvg: sumAbs / cnt,
        meanShap: sum / cnt,
      }))
      .sort((a, b) => b.absAvg - a.absAvg)
      .slice(0, 10)
      .reverse()

    // 양방향: meanShap 부호 그대로 사용 (음수=왼쪽/파랑, 양수=오른쪽/빨강)
    const allAbs = sorted.map(d => d.absAvg)
    const xMax = Math.max(...allAbs)
    const xBound = Math.ceil(xMax * 1.15 * 1000) / 1000

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: params => {
          const p = params[0]
          const d = sorted[p.dataIndex]
          return `<b>${d.feat}</b><br/>평균 SHAP: ${d.meanShap.toFixed(5)}<br/>${d.meanShap >= 0 ? '▲ 불량 증가' : '▼ 불량 감소'}`
        },
      },
      grid: { top: 8, bottom: 24, left: 80, right: 70, containLabel: true },
      xAxis: {
        type: 'value',
        min: -xBound,
        max: xBound,
        axisLabel: { fontSize: 9, formatter: v => v.toFixed(3) },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { show: true },
      },
      yAxis: {
        type: 'category',
        data: sorted.map(d => d.feat),
        axisLabel: { fontSize: 10 },
        axisTick: { show: false },
      },
      series: [{
        name: 'SHAP',
        type: 'bar',
        data: sorted.map(d => ({
          value: +d.meanShap.toFixed(5),
          itemStyle: {
            color: d.meanShap >= 0 ? '#EF4444' : '#3B82F6',
            borderRadius: d.meanShap >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
          },
        })),
        barMaxWidth: 16,
        label: {
          show: true,
          position: p => p.data.value >= 0 ? 'right' : 'left',
          fontSize: 9,
          color: '#64748B',
          formatter: p => Math.abs(p.value).toFixed(4),
        },
      }],
    }
  }, [shapRaw, units, g1, g2, g3])

  if (loadingUnits || !kpi) {
    return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>데이터 로딩 중…</div>
  }

  return (
    <div className="overview">
      <div className="kpi-row">
        <KpiCard
          label="이번주 검사 unit"
          value={kpi.total.toLocaleString()}
          sub={`최신 Lot 대상`}
          color="#F59E0B"
        />
        <KpiCard
          label="평균 예측 ppm"
          value={kpi.fmtPpm(kpi.meanPpm)}
          sub={`Lot ${latestLot} 기준`}
          color="#3B82F6"
        />
        <KpiCard
          label="상위 5% 예측 ppm"
          value={kpi.fmtPpm(kpi.p95Ppm)}
          sub="상위 5% 위험 수준"
          color="#F97316"
        />
        <KpiCard
          label="임계 초과 unit"
          value={kpi.nRisk.toLocaleString()}
          sub={`pred > p95 (전체 ${kpi.total.toLocaleString()} 중)`}
          color="#EF4444"
        />
      </div>

      {/* 트렌드 차트 */}
      <ChartCard title="주차별 불량 ppm 트렌드">
        {loadingTrend
          ? <div className="dummy-desc">트렌드 데이터 로딩 중…</div>
          : trendOption
            ? <ReactECharts option={trendOption} style={{ height: 300 }} />
            : <div className="dummy-desc">trend_data.csv 데이터 없음</div>
        }
      </ChartCard>

      {/* 하단: Grade 트렌드 + SHAP 워터폴 (2열) */}
      <div className="two-col">
        <ChartCard title="Lot별 Grade 비율 추이">
          <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 6, lineHeight: 1.7, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span><span style={{ color: GRADE_COLORS.grade1.bar, fontWeight: 600 }}>Grade 1</span> 상위 10% (최고위험)</span>
            <span><span style={{ color: GRADE_COLORS.grade2.bar, fontWeight: 600 }}>Grade 2</span> 상위 10~29.2%</span>
            <span><span style={{ color: GRADE_COLORS.grade3.bar, fontWeight: 600 }}>Grade 3</span> 상위 29.2~50%</span>
            <span><span style={{ color: GRADE_COLORS.grade4.bar, fontWeight: 600 }}>Grade 4</span> 하위 50% (정상)</span>
          </div>
          {gradeTrendOption
            ? <ReactECharts option={gradeTrendOption} style={{ height: 210 }} />
            : <div className="dummy-desc">데이터 로딩 중…</div>
          }
        </ChartCard>

        <ChartCard title="임계 초과 유닛 SHAP (Top 10)">
          <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 4, display: 'flex', gap: 12 }}>
            <span>Grade 1 유닛 기준</span>
            <span style={{ color: '#EF4444' }}>▶ 오른쪽 = 불량 증가</span>
            <span style={{ color: '#3B82F6' }}>◀ 왼쪽 = 불량 감소</span>
          </div>
          {loadingShap
            ? <div className="dummy-desc">SHAP 데이터 로딩 중…</div>
            : shapWaterfallOption
              ? <ReactECharts option={shapWaterfallOption} style={{ height: 230 }} />
              : <div className="dummy-desc">shap_beeswarm.csv 데이터 없음</div>
          }
        </ChartCard>
      </div>

    </div>
  )
}
