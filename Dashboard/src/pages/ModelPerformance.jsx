import { useMemo, useState, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './ModelPerformance.css'

const BASELINE_RMSE = 0.005845
const FIXED_DATE    = '2026-06-11'

function ChartCard({ title, tag, children, scrollable }) {
  return (
    <div className="mp-chart-card">
      <div className="mp-cc-header">
        <span className="mp-cc-title">{title}</span>
        {tag && <span className="mp-cc-tag">{tag}</span>}
      </div>
      <div className={scrollable ? 'mp-cc-scroll' : 'mp-cc-body'}>
        {children}
      </div>
    </div>
  )
}

// 항목 수에 따라 ECharts 높이 동적 계산 (항목 1개 = 28px, 최소 100px)
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

export default function ModelPerformance() {
  const { data: metricsRaw }   = useCSV('/metrics.csv')
  const { data: fiRaw }        = useCSV('/feature_importance.csv')
  const { data: shapBarRaw }   = useCSV('/shap_bar.csv')
  const { data: unitsRaw }     = useCSV('/dashboard_units.csv')
  const { data: featDistRaw }  = useCSV('/feature_dist.csv')
  // 클릭으로 선택된 피처 → 우하단 바이올린 연동
  const [selFeat, setSelFeat] = useState(null)
  const [violinRaw, setViolinRaw] = useState([])
  useEffect(() => {
    fetch('/feature_violin.json').then(r => r.json()).then(setViolinRaw).catch(() => {})
  }, [])

  // lot scatter: 피처 선택 시 lazy load (피처별 파일)
  const [lotMeta, setLotMeta]         = useState(null)
  const [lotScatterPts, setLotScatterPts] = useState(null)
  const [lotScatterFeat, setLotScatterFeat] = useState(null)
  const [lotScatterLoading, setLotScatterLoading] = useState(false)
  useEffect(() => {
    fetch('/lot_scatter/meta.json').then(r => r.json()).then(setLotMeta).catch(() => {})
  }, [])
  const activeLotFeat = selFeat ?? null
  useEffect(() => {
    if (!activeLotFeat) return
    if (activeLotFeat === lotScatterFeat) return
    setLotScatterLoading(true)
    setLotScatterPts(null)
    fetch(`/lot_scatter/${activeLotFeat}.json`).then(r => r.json()).then(pts => {
      setLotScatterPts(pts)
      setLotScatterFeat(activeLotFeat)
      setLotScatterLoading(false)
    }).catch(() => setLotScatterLoading(false))
  }, [activeLotFeat])

  // 바이올린용 드롭다운 피처 선택 (selFeat 없으면 첫 번째 피처)
  const violinFeats = useMemo(() => [...new Set(violinRaw.map(r => r.feature))], [violinRaw])
  const violinFeat  = useMemo(() => {
    if (selFeat && violinFeats.includes(selFeat)) return selFeat
    return violinFeats[0] ?? null
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

  // ── 피처 임포턴스 Top-20 (퍼센트 변환: 전체 합 대비 비율) ──
  const top20Fi = useMemo(() => {
    if (!fiRaw.length) return []
    const totalGain = fiRaw.reduce((s, r) => s + parseFloat(r.lgbm_gain || 0), 0) || 1
    return [...fiRaw]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 20)
      .map(r => ({
        ...r,
        gain_pct: parseFloat(r.lgbm_gain || 0) / totalGain * 100,
      }))
  }, [fiRaw])

  const fiOption = useMemo(() => {
    if (!top20Fi.length) return null
    const reversed = [...top20Fi].reverse() // 아래에서 위로 = 1위가 맨 위
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
        data: reversed.map(d => d.feature),
        axisLabel: { fontSize: 10, color: '#374151', fontFamily: 'monospace' },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: reversed.map((d, i) => ({
          value: +d.gain_pct.toFixed(2),
          itemStyle: {
            color: d.feature === selFeat
              ? '#7C3AED'
              : i >= 15 ? '#EF4444' : i >= 10 ? '#F97316' : '#3B82F6',
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
  }, [top20Fi, selFeat])

  // ── SHAP (shap_bar.csv 기준: zit_only 3개 모델의 Ridge 가중합) ──
  const top20Shap = useMemo(() => {
    if (!shapBarRaw.length) return []
    return [...shapBarRaw]
      .sort((a, b) => parseFloat(b.mean_abs_shap) - parseFloat(a.mean_abs_shap))
      .slice(0, 20)
  }, [shapBarRaw])

  const shapOption = useMemo(() => {
    if (!top20Shap.length) return null
    const reversed = [...top20Shap].reverse()
    const xMax = Math.max(...reversed.map(d => Math.abs(parseFloat(d.mean_shap))))
    const xBound = Math.ceil(xMax * 1.2 * 10000) / 10000 || 0.001
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: p => {
          const v = parseFloat(p[0].value)
          return `<b>${p[0].name}</b><br/>SHAP 기여도: ${v.toFixed(5)}<br/>${v >= 0 ? '▲ 불량 증가 방향' : '▼ 불량 감소 방향'}`
        },
      },
      grid: { top: 8, bottom: 20, left: 8, right: 16, containLabel: true },
      xAxis: {
        type: 'value', min: -xBound, max: xBound,
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: reversed.map(d => d.feature),
        axisLabel: { fontSize: 10, color: '#374151', fontFamily: 'monospace' },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: reversed.map(d => {
          const v = parseFloat(d.mean_shap)
          return {
            value: +v.toFixed(5),
            itemStyle: {
              color: d.feature === selFeat
                ? '#7C3AED'
                : v >= 0 ? '#EF4444' : '#3B82F6',
              borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          }
        }),
        barMaxWidth: 14,
        label: { show: false },
      }],
    }
  }, [top20Shap, selFeat])

  // 피처/SHAP 클릭 → selFeat 토글
  const onFiClick   = p => { if (p.name) setSelFeat(f => f === p.name ? null : p.name) }
  const onShapClick = p => { if (p.name) setSelFeat(f => f === p.name ? null : p.name) }

  // ── 피처 분포 스캐터 (피처 클릭 연동) ── 먼저 선언해야 riskDistOption에서 사용 가능
  const top5FeatNames = useMemo(() =>
    [...fiRaw].sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 5).map(d => d.feature),
    [fiRaw])

  // feature_dist.csv 컬럼 목록 (ufs_serial, health, is_defect 제외)
  const featDistCols = useMemo(() => {
    if (!featDistRaw.length) return []
    return Object.keys(featDistRaw[0]).filter(k => !['ufs_serial','health','is_defect'].includes(k))
  }, [featDistRaw])

  const activeFeat = useMemo(() => {
    if (!featDistCols.length) return null
    // 클릭한 피처가 feature_dist 컬럼에 있으면 사용
    if (selFeat && featDistCols.includes(selFeat)) return selFeat
    // 없으면 feature_dist 첫 번째 컬럼
    return featDistCols[0]
  }, [selFeat, featDistCols])

  // grade1/grade4 구분을 위한 ufs_serial → grade 맵
  const gradeMap = useMemo(() => {
    const m = {}
    unitsRaw.forEach(u => { m[u.ufs_serial] = u.grade })
    return m
  }, [unitsRaw])

  // ── 고위험(grade1) vs 저위험(grade4) 피처값 분포 — 밀도 라인 차트 ──
  const riskDistOption = useMemo(() => {
    if (!featDistRaw.length || !activeFeat) return null

    const highVals = [], lowVals = []
    for (const r of featDistRaw) {
      const x = parseFloat(r[activeFeat])
      if (!isFinite(x)) continue
      const grade = gradeMap[r.ufs_serial]
      if (grade === 'grade1') highVals.push(x)
      else if (grade === 'grade4') lowVals.push(x)
    }
    // grade 정보 없으면 is_defect fallback
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

    // 중앙값 → 가장 가까운 bin 인덱스
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
            silent: false,
            symbol: 'none',
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
            silent: false,
            symbol: 'none',
            data: [{ xAxis: medHighIdx, name: `Grade1 중앙값: ${fmtX(median(highVals))}` }],
            lineStyle: { color: '#EF4444', type: 'dashed', width: 1.5 },
            label: { show: false },
            tooltip: { show: true, formatter: () => `<b style="color:#EF4444">Grade1 중앙값</b><br/>${fmtX(median(highVals))}` },
          },
        },
      ],
    }
  }, [featDistRaw, activeFeat])

  const featScatterOption = useMemo(() => {
    if (!featDistRaw.length || !activeFeat) return null
    const dataLow = [], dataHigh = []
    for (const r of featDistRaw) {
      const x = parseFloat(r[activeFeat])
      const y = parseFloat(r.health)
      if (!isFinite(x) || !isFinite(y)) continue
      const grade = gradeMap[r.ufs_serial]
      if (grade === 'grade1') dataHigh.push([x, y])
      else if (grade === 'grade4') dataLow.push([x, y])
    }
    // grade 정보 없으면 is_defect fallback
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

  // ── 바이올린 차트 (KDE 기반 부드러운 폴리곤) ──
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
      // KDE 폴리곤: 오른쪽 → 왼쪽 대칭
      const rightPts = d.kde.map(([y, dens]) => [xi + (dens / maxDens) * W, y])
      const leftPts  = [...d.kde].reverse().map(([y, dens]) => [xi - (dens / maxDens) * W, y])
      const polygon  = [...rightPts, ...leftPts]

      const { q1, median: med, q3, mean } = d

      return [
        // 바이올린 몸체 (부드러운 KDE)
        {
          type: 'custom', name: date,
          renderItem(params, api) {
            const pts = polygon.map(([px, py]) => api.coord([px, py]))
            return { type: 'polygon', shape: { points: pts },
              style: { fill: 'rgba(59,130,246,0.18)', stroke: '#3B82F6', lineWidth: 1.5 } }
          },
          data: [0], z: 2,
        },
        // 중앙값 빨간 점
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

  // ── Lot scatter 옵션 ──
  const lotScatterOption = useMemo(() => {
    if (!lotScatterPts || !lotMeta || !lotScatterFeat) return null
    const lots = lotMeta.lots
    const GRADE_COLOR = { grade1: '#22C55E', grade2: '#EAB308', grade3: '#F97316', grade4: '#EF4444' }

    const byGrade = {}
    for (const [xi, y, grade] of lotScatterPts) {
      if (!byGrade[grade]) byGrade[grade] = []
      byGrade[grade].push([lots[xi], y])
    }

    return {
      tooltip: {
        trigger: 'item',
        formatter: p => {
          if (!p.data || p.data[0] == null) return ''
          return `Lot ${p.data[0]}<br/>${lotScatterFeat}: ${p.data[1]}<br/>Grade: ${p.seriesName}`
        },
      },
      legend: {
        top: 4, right: 8, textStyle: { fontSize: 12 },
        data: Object.keys(byGrade),
      },
      grid: { top: 32, bottom: 60, left: 60, right: 16 },
      xAxis: {
        type: 'category',
        data: lots,
        name: 'Lot', nameTextStyle: { fontSize: 10, color: '#94A3B8' },
        axisLabel: { fontSize: 9, color: '#94A3B8', rotate: 45, interval: Math.floor(lots.length / 20) },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: lotScatterFeat, nameTextStyle: { fontSize: 10, color: '#94A3B8' },
        axisLabel: { fontSize: 10, color: '#94A3B8' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: Object.entries(byGrade).map(([grade, pts]) => ({
        name: grade,
        type: 'scatter',
        data: pts,
        symbolSize: 3,
        large: true,
        largeThreshold: 1000,
        itemStyle: { color: GRADE_COLOR[grade] ?? '#94A3B8', opacity: 0.5 },
      })),
    }
  }, [lotScatterPts, lotMeta, lotScatterFeat])

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

      {/* ── Row 2+3: 2×2 차트 그리드 ── */}
      <div className="mp-grid-2x2">

        {/* 좌상: 피처 중요도 — 박스 안 스크롤 */}
        <ChartCard title="피처 중요도 순위" scrollable>
          {fiOption
            ? <ReactECharts
                option={fiOption}
                style={{ height: chartH(top20Fi.length) }}
                onEvents={{ click: onFiClick }}
              />
            : <div className="mp-empty">feature_importance.csv 없음</div>}
        </ChartCard>

        {/* 우상: SHAP 분석 — 박스 안 스크롤 */}
        <ChartCard title="SHAP 기여도 분석" scrollable>
          {shapOption
            ? <ReactECharts
                option={shapOption}
                style={{ height: chartH(top20Shap.length) }}
                onEvents={{ click: onShapClick }}
              />
            : <div className="mp-empty">shap_bar.csv 없음</div>}
        </ChartCard>

        {/* 좌하: 고위험 vs 저위험 분포 */}
        <ChartCard title={`피처 분포 · ${activeFeat ?? ''}`}>
          {riskDistOption
            ? <ReactECharts option={riskDistOption} style={{ height: 360 }} />
            : <div className="mp-empty">dashboard_units.csv 없음</div>}
        </ChartCard>

        {/* 우하: 피처 월별 분포 바이올린 */}
        <ChartCard title="피처 월별 분포" tag={
          <select
            value={violinFeat ?? ''}
            onChange={e => setSelFeat(e.target.value)}
            style={{ fontSize: 13, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4, padding: '1px 4px', cursor: 'pointer' }}
          >
            {violinFeats.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        }>
          {violinOption
            ? <ReactECharts option={violinOption} style={{ height: 360 }} />
            : <div className="mp-empty">feature_violin.csv 없음</div>}
        </ChartCard>

      </div>

      {/* ── 하단: Lot별 피처 산점도 ── */}
      <ChartCard title={`Lot별 피처 분포 · ${lotScatterFeat ?? '피처를 클릭하세요'}`} tag={lotScatterLoading ? '로딩 중…' : undefined}>
        {lotScatterOption
          ? <ReactECharts option={lotScatterOption} style={{ height: 400 }} />
          : <div className="mp-empty" style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {lotScatterLoading ? '데이터 로딩 중…' : '좌측 피처 중요도 차트에서 피처를 클릭하세요'}
            </div>}
      </ChartCard>

    </div>
  )
}
