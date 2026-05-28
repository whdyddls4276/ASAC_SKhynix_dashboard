import { useMemo, useState, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './ModelPerformance.css'

const BASELINE_RMSE = 0.005845
const FIXED_DATE    = '2026-06-11'

function ChartCard({ title, tag, controls, children, scrollable }) {
  return (
    <div className="mp-chart-card">
      <div className="mp-cc-header">
        <span className="mp-cc-title">{title}</span>
        {tag && <span className="mp-cc-tag">{tag}</span>}
        {controls && <div className="mp-cc-controls">{controls}</div>}
      </div>
      <div className={scrollable ? 'mp-cc-scroll' : 'mp-cc-body'}>
        {children}
      </div>
    </div>
  )
}

const chartH = (count) => Math.max(100, count * 28)

function KpiBox({ label, value, sub }) {
  return (
    <div className="mp-kpi">
      <div className="mp-kpi-val">{value}</div>
      <div className="mp-kpi-label">{label}</div>
      {sub && <div className="mp-kpi-sub">{sub}</div>}
    </div>
  )
}

function SortBtn({ options, value, onChange }) {
  return (
    <div className="mp-sort-btngroup">
      {options.map(opt => (
        <button
          key={opt.value}
          className={`mp-sort-btn${value === opt.value ? ' active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function ModelPerformance() {
  const { data: metricsRaw }     = useCSV('/metrics.csv')
  const { data: fiRaw }          = useCSV('/feature_importance.csv')
  const { data: shapBarRaw }     = useCSV('/shap_bar.csv')
  const { data: shapBeeswarmRaw }= useCSV('/shap_beeswarm.csv')
  const { data: unitsRaw }       = useCSV('/dashboard_units.csv')
  const { data: featDistRaw }    = useCSV('/feature_dist.csv')

  // ── 선택 피처 ──
  const [selFeat, setSelFeat] = useState(null)

  // ── FI 차트 정렬: 기준(fi | shap) + 방향(desc | asc) ──
  const [fiSortBy,  setFiSortBy]  = useState('fi')    // 'fi' | 'shap'
  const [fiSortDir, setFiSortDir] = useState('desc')  // 'desc' | 'asc'

  // ── SHAP 차트 정렬: 기준(shap | fi) + 방향(desc | asc) ──
  const [shapSortBy,  setShapSortBy]  = useState('shap') // 'shap' | 'fi'
  const [shapSortDir, setShapSortDir] = useState('desc') // 'desc' | 'asc'

  const [violinRaw, setViolinRaw] = useState([])
  useEffect(() => {
    fetch('/feature_violin.json').then(r => r.json()).then(setViolinRaw).catch(() => {})
  }, [])

  const violinFeats = useMemo(() => [...new Set(violinRaw.map(r => r.feature))], [violinRaw])
  const violinFeat  = useMemo(() => {
    if (!selFeat) return null
    if (violinFeats.includes(selFeat)) return selFeat
    return null
  }, [selFeat, violinFeats])

  // ── metrics ──
  const metrics = useMemo(() => {
    if (!metricsRaw.length) return null
    const get = (stage, model, split, metric = 'rmse') => {
      const row = metricsRaw.find(r =>
        r.stage === stage && r.model === model && r.split === split && r.metric === metric)
      return row ? parseFloat(row.value) : null
    }
    return {
      ensemble_val: get('reg', 'ensemble', 'val'),
      stacking_val: get('reg', 'stacking', 'val'),
      lgbm_val:     get('reg', 'lgbm',     'val'),
    }
  }, [metricsRaw])

  // ── FI 전체 정렬된 배열 (gain_pct 포함) ──
  const allFiSorted = useMemo(() => {
    if (!fiRaw.length) return []
    const totalGain = fiRaw.reduce((s, r) => s + parseFloat(r.lgbm_gain || 0), 0) || 1
    return [...fiRaw]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .map(r => ({
        ...r,
        gain_pct: parseFloat(r.lgbm_gain || 0) / totalGain * 100,
      }))
  }, [fiRaw])

  // ── SHAP bar 전체 정렬된 배열 ──
  const allShapSorted = useMemo(() => {
    if (!shapBarRaw.length) return []
    return [...shapBarRaw].sort((a, b) => parseFloat(b.mean_abs_shap) - parseFloat(a.mean_abs_shap))
  }, [shapBarRaw])

  // ── FI 차트에 표시할 피처 목록 ──
  // desc=상위20, asc=하위20 (항상 20개만)
  const fiDisplayItems = useMemo(() => {
    if (!allFiSorted.length) return []
    if (fiSortBy === 'fi') {
      const items = fiSortDir === 'desc' ? allFiSorted.slice(0, 20) : allFiSorted.slice(-20)
      return fiSortDir === 'asc' ? [...items].reverse() : items
    } else {
      const shapSlice = fiSortDir === 'desc' ? allShapSorted.slice(0, 20) : allShapSorted.slice(-20)
      return shapSlice
        .map(d => allFiSorted.find(f => f.feature === d.feature))
        .filter(Boolean)
        .sort((a, b) => fiSortDir === 'desc'
          ? parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain)
          : parseFloat(a.lgbm_gain) - parseFloat(b.lgbm_gain))
    }
  }, [allFiSorted, allShapSorted, fiSortBy, fiSortDir])

  const shapDisplayItems = useMemo(() => {
    if (!allShapSorted.length) return []
    if (shapSortBy === 'shap') {
      const items = shapSortDir === 'desc' ? allShapSorted.slice(0, 20) : allShapSorted.slice(-20)
      return shapSortDir === 'asc' ? [...items].reverse() : items
    } else {
      const fiSlice = shapSortDir === 'desc' ? allFiSorted.slice(0, 20) : allFiSorted.slice(-20)
      return fiSlice
        .map(d => allShapSorted.find(s => s.feature === d.feature))
        .filter(Boolean)
        .sort((a, b) => shapSortDir === 'desc'
          ? parseFloat(b.mean_abs_shap) - parseFloat(a.mean_abs_shap)
          : parseFloat(a.mean_abs_shap) - parseFloat(b.mean_abs_shap))
    }
  }, [allShapSorted, allFiSorted, shapSortBy, shapSortDir])

  // ── FI 차트 옵션 ──
  const fiOption = useMemo(() => {
    if (!fiDisplayItems.length) return null
    // 차트는 아래→위가 1위이므로 reverse
    const items = [...fiDisplayItems].reverse()
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: p => `<b>${p[0].name}</b><br/>중요도: ${parseFloat(p[0].value).toFixed(2)}%`,
      },
      grid: { top: 8, bottom: 8, left: 8, right: 70, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#94A3B8', formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      yAxis: {
        type: 'category',
        data: items.map(d => d.feature),
        axisLabel: { fontSize: 10, color: '#374151', fontFamily: 'monospace' },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: items.map(d => ({
          value: +d.gain_pct.toFixed(2),
          itemStyle: {
            color: d.feature === selFeat ? '#7C3AED' : '#3B82F6',
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barMaxWidth: 14,
        label: {
          show: true, position: 'right', fontSize: 11, color: '#64748B',
          formatter: p => `${parseFloat(p.value).toFixed(2)}%`,
        },
      }],
    }
  }, [fiDisplayItems, selFeat])

  // ── 클릭 핸들러 (피처 선택 전용) ──
  const onFiClick = (p) => { if (p.name && p.name !== '─────────') setSelFeat(f => f === p.name ? null : p.name) }

  // ── FI 차트 높이 계산 ──
  const fiChartHeight = useMemo(() => chartH(fiDisplayItems.length), [fiDisplayItems])

  // ── SHAP Beeswarm: shapDisplayItems 피처 기준 ──
  const beeswarmFeats = useMemo(() => shapDisplayItems.map(d => d.feature), [shapDisplayItems])

  const shapBeeswarmOption = useMemo(() => {
    if (!shapBeeswarmRaw.length || !beeswarmFeats.length) return null

    const featOrder = [...beeswarmFeats].reverse()
    const featIdx   = Object.fromEntries(featOrder.map((f, i) => [f, i]))

    const SAMPLE  = 8000
    const rows    = shapBeeswarmRaw.filter(r => beeswarmFeats.includes(r.feature))
    const step    = rows.length > SAMPLE ? Math.ceil(rows.length / SAMPLE) : 1
    const sampled = rows.filter((_, i) => i % step === 0)

    const normToColor = norm => {
      const t = Math.max(0, Math.min(1, norm))
      const r = Math.round(59  + (239 - 59)  * t)
      const g = Math.round(130 + (68  - 130) * t)
      const b = Math.round(246 + (68  - 246) * t)
      return `rgb(${r},${g},${b})`
    }

    const scatterData = sampled.map(r => {
      const yi    = featIdx[r.feature]
      const sv    = parseFloat(r.shap_value)
      const norm  = parseFloat(r.feat_norm)
      const jitter = (Math.random() - 0.5) * 0.7
      return {
        value: [sv, yi + jitter],
        itemStyle: { color: normToColor(isFinite(norm) ? norm : 0.5), opacity: 0.7 },
      }
    })

    const xVals  = scatterData.map(d => d.value[0])
    const xBound = Math.max(Math.abs(Math.min(...xVals)), Math.abs(Math.max(...xVals))) * 1.1 || 0.001

    return {
      tooltip: {
        trigger: 'item',
        formatter: p => {
          const sv   = p.data.value[0]
          const feat = featOrder[Math.round(p.data.value[1])] ?? ''
          return `<b>${feat}</b><br/>SHAP: ${sv >= 0 ? '+' : ''}${sv.toFixed(6)}<br/>${sv >= 0 ? '▲ 불량 증가 방향' : '▼ 불량 감소 방향'}`
        },
      },
      grid: { top: 8, bottom: 28, left: 8, right: 80, containLabel: true },
      xAxis: {
        type: 'value', min: -xBound, max: xBound,
        axisLabel: { fontSize: 10, color: '#94A3B8', formatter: v => v.toFixed(4) },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
        name: 'SHAP value (impact on model output)',
        nameLocation: 'center', nameGap: 22,
        nameTextStyle: { fontSize: 10, color: '#94A3B8' },
      },
      yAxis: {
        type: 'value',
        min: -0.5, max: featOrder.length - 0.5,
        interval: 1,
        axisLabel: {
          fontSize: 10, color: '#374151', fontFamily: 'monospace',
          formatter: v => featOrder[Math.round(v)] ?? '',
        },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#F8FAFC', type: 'dashed' } },
      },
      series: [{
        type: 'scatter',
        data: scatterData,
        symbolSize: 5,
        large: true,
        largeThreshold: 2000,
        markLine: {
          silent: true, symbol: 'none',
          data: [{ xAxis: 0 }],
          lineStyle: { color: '#CBD5E1', width: 1 },
          label: { show: false },
        },
      }],
      graphic: [{
        type: 'group', right: 8, top: '15%',
        children: [
          { type: 'text', style: { text: 'High', fontSize: 10, fill: '#EF4444', fontWeight: 700 }, left: 2, top: 0 },
          {
            type: 'rect', left: 0, top: 16,
            shape: { width: 12, height: 120 },
            style: {
              fill: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgb(239,68,68)' },
                  { offset: 1, color: 'rgb(59,130,246)' },
                ],
              },
            },
          },
          { type: 'text', style: { text: 'Low', fontSize: 10, fill: '#3B82F6', fontWeight: 700 }, left: 2, top: 140 },
          { type: 'text', style: { text: 'Feature\nvalue', fontSize: 9, fill: '#94A3B8' }, left: -2, top: 158 },
        ],
      }],
    }
  }, [shapBeeswarmRaw, beeswarmFeats])

  // ── 피처 분포 / 바이올린 ──
  const featDistCols = useMemo(() => {
    if (!featDistRaw.length) return []
    return Object.keys(featDistRaw[0]).filter(k => !['ufs_serial','health','is_defect'].includes(k))
  }, [featDistRaw])

  const activeFeat = useMemo(() => {
    if (!selFeat || !featDistCols.length) return null
    if (featDistCols.includes(selFeat)) return selFeat
    return null
  }, [selFeat, featDistCols])

  const gradeMap = useMemo(() => {
    const m = {}
    unitsRaw.forEach(u => { m[u.ufs_serial] = u.grade })
    return m
  }, [unitsRaw])

  const riskDistOption = useMemo(() => {
    if (!featDistRaw.length || !activeFeat) return null

    const highVals = [], lowVals = []
    for (const r of featDistRaw) {
      const x = parseFloat(r[activeFeat])
      if (!isFinite(x)) continue
      const grade = gradeMap[r.ufs_serial]
      if (grade === 'grade4') highVals.push(x)
      else if (grade === 'grade1') lowVals.push(x)
    }
    if (!highVals.length && !lowVals.length) {
      for (const r of featDistRaw) {
        const x = parseFloat(r[activeFeat])
        if (!isFinite(x)) continue
        if (parseInt(r.is_defect) === 1) highVals.push(x)
        else lowVals.push(x)
      }
    }
    if (!highVals.length && !lowVals.length) return null

    const allVals = [...highVals, ...lowVals]
    const minV = Math.min(...allVals)
    const maxV = Math.max(...allVals)
    const BIN  = 40
    const binSz = (maxV - minV) / BIN || 1
    const bins  = Array.from({ length: BIN }, (_, i) => minV + i * binSz)

    const median = arr => {
      const s = [...arr].sort((a, b) => a - b)
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    const toBinIdx = v => {
      const idx = bins.findIndex((b, i) => v < (i === BIN - 1 ? Infinity : bins[i + 1]))
      return idx < 0 ? BIN - 1 : idx
    }
    const medHighIdx = toBinIdx(median(highVals))
    const medLowIdx  = toBinIdx(median(lowVals))

    const mkDensity = vals => bins.map((b, i) => {
      const next = i === BIN - 1 ? Infinity : bins[i + 1]
      const cnt = vals.filter(v => v >= b && v < next).length
      return vals.length ? +(cnt / vals.length * 100).toFixed(2) : 0
    })

    const fmtX = v => {
      if (Math.abs(v) >= 1000) return v.toFixed(0)
      if (Math.abs(v) >= 10)   return v.toFixed(1)
      return v.toFixed(3)
    }

    const xLabels = bins.map(b => fmtX(b))

    return {
      tooltip: {
        trigger: 'axis',
        formatter: p => {
          const lines = p
            .filter(s => s.seriesType !== 'effectScatter')
            .map(s => `${s.marker}${s.seriesName}: ${s.value}%`)
          return lines.join('<br/>') + `<br/><span style="color:#94A3B8;font-size:11px">${activeFeat} = ${p[0]?.axisValue ?? ''}</span>`
        },
      },
      legend: {
        show: true, top: 4, right: 8,
        data: [
          { name: '저위험 (Grade 4)', icon: 'rect', itemStyle: { color: '#3B82F6' } },
          { name: '고위험 (Grade 1)', icon: 'rect', itemStyle: { color: '#EF4444' } },
        ],
        textStyle: { fontSize: 12, color: '#475569' },
      },
      grid: { top: 32, bottom: 36, left: 48, right: 16 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { fontSize: 9, color: '#94A3B8', interval: 7, rotate: 30 },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#94A3B8', formatter: v => v + '%' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        {
          name: '저위험 (Grade 4)',
          type: 'line',
          data: mkDensity(lowVals),
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#3B82F6', width: 2 },
          areaStyle: { color: 'rgba(59,130,246,0.12)' },
          markLine: {
            silent: false, symbol: 'none',
            data: [{ xAxis: medLowIdx, name: `Grade4 중앙값: ${fmtX(median(lowVals))}` }],
            lineStyle: { color: '#3B82F6', type: 'dashed', width: 1.5 },
            label: { show: false },
            tooltip: { show: true, formatter: () => `<b style="color:#3B82F6">Grade4 중앙값</b><br/>${fmtX(median(lowVals))}` },
          },
        },
        {
          name: '고위험 (Grade 1)',
          type: 'line',
          data: mkDensity(highVals),
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#EF4444', width: 2 },
          areaStyle: { color: 'rgba(239,68,68,0.12)' },
          markLine: {
            silent: false, symbol: 'none',
            data: [{ xAxis: medHighIdx, name: `Grade1 중앙값: ${fmtX(median(highVals))}` }],
            lineStyle: { color: '#EF4444', type: 'dashed', width: 1.5 },
            label: { show: false },
            tooltip: { show: true, formatter: () => `<b style="color:#EF4444">Grade1 중앙값</b><br/>${fmtX(median(highVals))}` },
          },
        },
      ],
    }
  }, [featDistRaw, activeFeat, gradeMap])

  const featScatterOption = useMemo(() => {
    if (!featDistRaw.length || !activeFeat) return null
    const dataLow = [], dataHigh = []
    for (const r of featDistRaw) {
      const x = parseFloat(r[activeFeat])
      const y = parseFloat(r.health)
      if (!isFinite(x) || !isFinite(y)) continue
      const grade = gradeMap[r.ufs_serial]
      if (grade === 'grade4') dataHigh.push([x, y])
      else if (grade === 'grade1') dataLow.push([x, y])
    }
    if (!dataLow.length && !dataHigh.length) {
      for (const r of featDistRaw) {
        const x = parseFloat(r[activeFeat])
        const y = parseFloat(r.health)
        if (!isFinite(x) || !isFinite(y)) continue
        if (parseInt(r.is_defect) === 1) dataHigh.push([x, y])
        else dataLow.push([x, y])
      }
    }
    const sample = (arr, n) => arr.length <= n ? arr
      : arr.filter((_, i) => i % Math.ceil(arr.length / n) === 0).slice(0, n)
    return {
      tooltip: { formatter: p => `${activeFeat}: ${p.data[0].toFixed(4)}<br/>health: ${p.data[1].toFixed(6)}` },
      legend: {
        data: ['저위험 (Grade 4)', '고위험 (Grade 1)'],
        top: 0, textStyle: { fontSize: 12 },
      },
      grid: { top: 28, bottom: 36, left: 52, right: 16 },
      xAxis: {
        type: 'value', name: activeFeat, nameTextStyle: { fontSize: 10, color: '#94A3B8' },
        axisLabel: { fontSize: 10, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      yAxis: {
        type: 'value', name: 'health', nameTextStyle: { fontSize: 10, color: '#94A3B8' },
        axisLabel: { fontSize: 10, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        { name: '저위험 (Grade 4)', type: 'scatter', data: sample(dataLow, 400), symbolSize: 4, itemStyle: { color: 'rgba(59,130,246,0.4)' } },
        { name: '고위험 (Grade 1)', type: 'scatter', data: sample(dataHigh, 300), symbolSize: 5, itemStyle: { color: 'rgba(239,68,68,0.7)' } },
      ],
    }
  }, [featDistRaw, activeFeat, gradeMap])

  const violinOption = useMemo(() => {
    if (!violinRaw.length || !violinFeat) return null
    const rows = violinRaw.filter(r => r.feature === violinFeat)
    if (!rows.length) return null

    const dates = [...new Set(rows.map(r => String(r.date)))].sort()
    const W = 0.38

    const allY = rows.flatMap(r => r.kde.map(([y]) => y))
    const globalMin = Math.min(...allY)
    const globalMax = Math.max(...allY)
    const span = globalMax - globalMin || 1

    const series = dates.flatMap((date, xi) => {
      const d = rows.find(r => String(r.date) === date)
      if (!d || !d.kde.length) return []

      const maxDens = Math.max(...d.kde.map(([, dens]) => dens)) || 1
      const rightPts = d.kde.map(([y, dens]) => [xi + (dens / maxDens) * W, y])
      const leftPts  = [...d.kde].reverse().map(([y, dens]) => [xi - (dens / maxDens) * W, y])
      const polygon  = [...rightPts, ...leftPts]

      const { q1, median: med, q3, mean } = d

      return [
        {
          type: 'custom', name: date,
          renderItem(params, api) {
            const pts = polygon.map(([px, py]) => api.coord([px, py]))
            return { type: 'polygon', shape: { points: pts },
              style: { fill: 'rgba(59,130,246,0.18)', stroke: '#3B82F6', lineWidth: 1.5 } }
          },
          data: [0], z: 2,
        },
        {
          type: 'scatter', name: '_median',
          data: [[xi, med]], symbolSize: 8,
          itemStyle: { color: '#EF4444' }, z: 4,
        },
      ]
    })

    return {
      tooltip: {
        trigger: 'item',
        formatter: p => {
          if (!p.seriesName || p.seriesName.startsWith('_')) return ''
          const d = rows.find(r => String(r.date) === p.seriesName)
          if (!d) return ''
          const fmt = v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 })
          return `<b>${p.seriesName}</b><br/>
            Q3: ${fmt(d.q3)}<br/>Median: <b>${fmt(d.median)}</b><br/>
            Q1: ${fmt(d.q1)}<br/>Mean: <span style="color:#EF4444">${fmt(d.mean)}</span>`
        },
      },
      grid: { top: 16, bottom: 40, left: 60, right: 16 },
      xAxis: {
        type: 'value', min: -0.6, max: dates.length - 0.4,
        axisLabel: { fontSize: 10, color: '#374151', formatter: v => dates[Math.round(v)] ?? '', interval: 0 },
        splitLine: { show: false }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', name: violinFeat,
        nameTextStyle: { fontSize: 10, color: '#94A3B8' },
        axisLabel: { fontSize: 10, color: '#94A3B8' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        min: globalMin - span * 0.05,
        max: globalMax + span * 0.05,
      },
      series,
    }
  }, [violinRaw, violinFeat])


  if (!metrics) {
    return (
      <div className="mp-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>
        데이터 로딩 중…
      </div>
    )
  }

  const bestVal     = metrics.stacking_val ?? metrics.ensemble_val ?? metrics.lgbm_val ?? 0
  const beatBase    = bestVal < BASELINE_RMSE
  const improvement = (((BASELINE_RMSE - bestVal) / BASELINE_RMSE) * 100).toFixed(1)

  return (
    <div className="mp-page">

      {/* ── Row 1: RMSE KPI 2개 ── */}
      <div className="mp-kpi-row mp-kpi-row--2">
        <KpiBox
          label="앙상블 모델 검증 오차(RMSE)"
          value={bestVal.toFixed(6)}
          sub={`예측 시점 · ${FIXED_DATE}`}
        />
        <KpiBox
          label={beatBase ? '사내경진대회 대비 개선' : '사내경진대회 대비 미달'}
          value={beatBase ? `-${improvement}%` : `+${Math.abs(parseFloat(improvement))}%`}
          sub={`경진대회 기준 ${BASELINE_RMSE} · ${beatBase ? '목표 달성 ✓' : '미달성'}`}
        />
      </div>

      {/* ── 2×2 고정 그리드 ── */}
      <div className="mp-grid-2x2">

        {/* 좌상단: 피처 임포턴스 */}
        <ChartCard
          title="피처 중요도 순위"
          controls={
            <>
              <SortBtn
                options={[{ value: 'desc', label: '↓ 내림차순' }, { value: 'asc', label: '↑ 오름차순' }]}
                value={fiSortDir}
                onChange={setFiSortDir}
              />
              <SortBtn
                options={[{ value: 'fi', label: 'FI 기준' }, { value: 'shap', label: 'SHAP 기준' }]}
                value={fiSortBy}
                onChange={setFiSortBy}
              />
            </>
          }
          scrollable
        >
          {fiOption
            ? <ReactECharts
                option={fiOption}
                style={{ height: fiChartHeight }}
                onEvents={{ click: onFiClick }}
              />
            : <div className="mp-empty">feature_importance.csv 없음</div>}
        </ChartCard>

        {/* 우상단: SHAP Beeswarm */}
        <ChartCard
          title="SHAP 분석 (Beeswarm)"
          controls={
            <>
              <SortBtn
                options={[{ value: 'desc', label: '↓ 내림차순' }, { value: 'asc', label: '↑ 오름차순' }]}
                value={shapSortDir}
                onChange={setShapSortDir}
              />
              <SortBtn
                options={[{ value: 'shap', label: 'SHAP 기준' }, { value: 'fi', label: 'FI 기준' }]}
                value={shapSortBy}
                onChange={setShapSortBy}
              />
            </>
          }
          scrollable
        >
          {shapBeeswarmOption
            ? <ReactECharts
                option={shapBeeswarmOption}
                style={{ height: Math.max(300, beeswarmFeats.length * 18) }}
              />
            : <div className="mp-empty">shap_beeswarm.csv 없음</div>}
        </ChartCard>

        {/* 좌하단: 히스토그램 (피처 분포) */}
        <ChartCard title={activeFeat ? `피처 분포 · ${activeFeat}` : '피처 분포'}>
          {activeFeat && riskDistOption
            ? <ReactECharts option={riskDistOption} style={{ height: 360 }} />
            : <div className="mp-empty">{activeFeat ? 'dashboard_units.csv 없음' : '위 차트에서 피처를 클릭하세요'}</div>}
        </ChartCard>

        {/* 우하단: 피처 일별 분포 (바이올린) */}
        <ChartCard
          title="피처 일별 분포"
          tag={activeFeat
            ? <select
                value={violinFeat ?? ''}
                onChange={e => setSelFeat(e.target.value)}
                style={{ fontSize: 13, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4, padding: '1px 4px', cursor: 'pointer' }}
              >
                {violinFeats.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            : null}
        >
          {activeFeat && violinOption
            ? <ReactECharts option={violinOption} style={{ height: 360 }} />
            : <div className="mp-empty">{activeFeat ? 'feature_violin.json 없음' : '위 차트에서 피처를 클릭하세요'}</div>}
        </ChartCard>

      </div>

    </div>
  )
}
