import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './ProcessFactor.css'

const TOP_N = 5

function quantile(sorted, q) {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1] ?? sorted[base]
  return sorted[base] + rest * (next - sorted[base])
}

function fmt(v) {
  if (v == null || !isFinite(v)) return '-'
  if (Math.abs(v) >= 1000) return v.toFixed(0)
  if (Math.abs(v) >= 10) return v.toFixed(2)
  return v.toFixed(4)
}

export default function ProcessFactor() {
  const { data: shapBarRaw }      = useCSV('/shap_bar.csv')
  const { data: shapBeeswarmRaw } = useCSV('/shap_beeswarm.csv')
  const { data: unitsRaw }        = useCSV('/dashboard_units.csv')
  const { data: featDistRaw }     = useCSV('/feature_dist.csv')

  const [selFeat, setSelFeat] = useState(null)

  const gradeMap = useMemo(() => {
    const m = {}
    unitsRaw.forEach(u => { m[u.ufs_serial] = u.grade })
    return m
  }, [unitsRaw])

  // SHAP top 피처 정렬
  const shapSorted = useMemo(() => {
    if (!shapBarRaw.length) return []
    return [...shapBarRaw].sort((a, b) =>
      parseFloat(b.mean_abs_shap) - parseFloat(a.mean_abs_shap))
  }, [shapBarRaw])

  // Feature Pareto (SHAP 기준 누적 기여도)
  const paretoData = useMemo(() => {
    if (!shapSorted.length) return null
    const TOP = 20
    const items = shapSorted.slice(0, TOP).map(r => ({
      feature: r.feature,
      shap: parseFloat(r.mean_abs_shap),
    }))
    const totalAll = shapSorted.reduce((s, r) => s + parseFloat(r.mean_abs_shap), 0)
    const rows = items.map((it, i) => {
      const cum = items.slice(0, i + 1).reduce((s, r) => s + r.shap, 0)
      return { ...it, cumPct: totalAll ? +(cum / totalAll * 100).toFixed(1) : 0 }
    })
    const top80Idx = rows.findIndex(r => r.cumPct >= 80)
    const top80Count = top80Idx >= 0 ? top80Idx + 1 : rows.length
    return { rows, totalAll, top80Count, top80Pct: rows[top80Count - 1]?.cumPct ?? 0 }
  }, [shapSorted])

  const paretoOption = useMemo(() => {
    if (!paretoData) return null
    const { rows } = paretoData
    const maxShap = Math.max(...rows.map(r => r.shap))
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: p => {
          const bar = p.find(s => s.seriesName === '개별 영향도')
          const line = p.find(s => s.seriesName === '누적 %')
          return `<b>${p[0].axisValue}</b><br/>` +
            (bar ? `${bar.marker}SHAP: ${parseFloat(bar.value).toFixed(6)}<br/>` : '') +
            (line ? `${line.marker}누적 기여도: ${line.value}%` : '')
        },
      },
      legend: {
        show: true, top: 4, right: 8,
        data: ['개별 영향도', '누적 %'],
        textStyle: { fontSize: 12, color: '#475569' },
      },
      grid: { top: 48, bottom: 60, left: 50, right: 60, containLabel: true },
      xAxis: {
        type: 'category',
        data: rows.map(r => r.feature),
        axisLabel: { fontSize: 10, color: '#475569', rotate: 35, fontFamily: 'monospace' },
        axisTick: { alignWithLabel: true },
      },
      yAxis: [
        {
          type: 'value',
          name: 'SHAP', nameTextStyle: { fontSize: 11, color: '#94A3B8' },
          axisLabel: { fontSize: 10, color: '#94A3B8', formatter: v => v.toFixed(4) },
          splitLine: { lineStyle: { color: '#F1F5F9' } },
          max: maxShap * 1.1,
        },
        {
          type: 'value',
          axisLabel: { fontSize: 10, color: '#94A3B8', formatter: v => v + '%' },
          splitLine: { show: false },
          min: 0, max: 100,
        },
      ],
      series: [
        {
          name: '개별 영향도',
          type: 'bar',
          yAxisIndex: 0,
          data: rows.map(r => r.shap),
          itemStyle: { color: '#3B82F6', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 28,
        },
        {
          name: '누적 %',
          type: 'line',
          yAxisIndex: 1,
          data: rows.map(r => r.cumPct),
          smooth: false,
          symbol: 'circle', symbolSize: 7,
          lineStyle: { color: '#EF4444', width: 2.5 },
          itemStyle: { color: '#EF4444' },
          markLine: {
            silent: true, symbol: 'none',
            data: [{ yAxis: 80, name: '80% 기준선' }],
            lineStyle: { color: '#94A3B8', type: 'dashed', width: 1.5 },
            label: {
              show: true, position: 'end',
              formatter: '80%',
              fontSize: 10, color: '#94A3B8',
            },
          },
        },
      ],
    }
  }, [paretoData])

  // 피처별 위험 임계값 카드 데이터 (Top N)
  const thresholdCards = useMemo(() => {
    if (!shapSorted.length || !featDistRaw.length) return []
    const cols = Object.keys(featDistRaw[0] || {})
      .filter(k => !['ufs_serial', 'health', 'is_defect'].includes(k))

    const cards = []
    for (const s of shapSorted) {
      if (cards.length >= TOP_N) break
      const feat = s.feature
      if (!cols.includes(feat)) continue

      const lowVals = []
      const highVals = []
      for (const r of featDistRaw) {
        const x = parseFloat(r[feat])
        if (!isFinite(x)) continue
        const g = gradeMap[r.ufs_serial]
        if (g === 'grade3' || g === 'grade4') highVals.push(x)
        else if (g === 'grade1' || g === 'grade2') lowVals.push(x)
      }
      if (lowVals.length < 10 || highVals.length < 10) continue

      const lowSorted = [...lowVals].sort((a, b) => a - b)
      const highSorted = [...highVals].sort((a, b) => a - b)

      const lowQ1 = quantile(lowSorted, 0.25)
      const lowQ3 = quantile(lowSorted, 0.75)
      const highMed = quantile(highSorted, 0.5)

      // 위험 그룹의 중앙값 방향 결정
      const direction = highMed > quantile(lowSorted, 0.5) ? 'up' : 'down'

      // 임계값: 위험 그룹의 P25 (방향이 up일 때) 또는 P75 (down일 때)
      const threshold = direction === 'up'
        ? quantile(highSorted, 0.25)
        : quantile(highSorted, 0.75)

      // 위험률 계산: threshold 넘는 unit 중 G3·4 비율 vs 전체 G3·4 비율
      let overThreshold = 0
      let overAndHigh = 0
      let total = 0
      let totalHigh = 0
      for (const r of featDistRaw) {
        const x = parseFloat(r[feat])
        if (!isFinite(x)) continue
        const g = gradeMap[r.ufs_serial]
        if (!g) continue
        total++
        const isHigh = (g === 'grade3' || g === 'grade4')
        if (isHigh) totalHigh++
        const cond = direction === 'up' ? x >= threshold : x <= threshold
        if (cond) {
          overThreshold++
          if (isHigh) overAndHigh++
        }
      }
      const baseRate = total ? totalHigh / total : 0
      const condRate = overThreshold ? overAndHigh / overThreshold : 0
      const liftRatio = baseRate ? condRate / baseRate : 0

      cards.push({
        feature: feat,
        shap: parseFloat(s.mean_abs_shap),
        direction,
        normalLow: lowQ1,
        normalHigh: lowQ3,
        threshold,
        condRate,
        baseRate,
        liftRatio,
        nOver: overThreshold,
        nTotal: total,
      })
    }
    return cards
  }, [shapSorted, featDistRaw, gradeMap])

  // 피처 분포 비교 차트 (선택 피처)
  const activeFeat = useMemo(() => {
    if (!selFeat) return thresholdCards[0]?.feature ?? null
    return selFeat
  }, [selFeat, thresholdCards])

  const distOption = useMemo(() => {
    if (!featDistRaw.length || !activeFeat) return null
    const highVals = [], lowVals = []
    for (const r of featDistRaw) {
      const x = parseFloat(r[activeFeat])
      if (!isFinite(x)) continue
      const g = gradeMap[r.ufs_serial]
      if (g === 'grade3' || g === 'grade4') highVals.push(x)
      else if (g === 'grade1' || g === 'grade2') lowVals.push(x)
    }
    if (!highVals.length && !lowVals.length) return null

    const allVals = [...highVals, ...lowVals]
    const minV = Math.min(...allVals)
    const maxV = Math.max(...allVals)
    const BIN = 40
    const binSz = (maxV - minV) / BIN || 1
    const bins = Array.from({ length: BIN }, (_, i) => minV + i * binSz)

    const mkDensity = vals => bins.map((b, i) => {
      const next = i === BIN - 1 ? Infinity : bins[i + 1]
      const cnt = vals.filter(v => v >= b && v < next).length
      return vals.length ? +(cnt / vals.length * 100).toFixed(2) : 0
    })

    const xLabels = bins.map(b => fmt(b))

    const card = thresholdCards.find(c => c.feature === activeFeat)
    const thrIdx = card ? bins.findIndex((b, i) => card.threshold < (i === BIN - 1 ? Infinity : bins[i + 1])) : -1

    return {
      tooltip: {
        trigger: 'axis',
        formatter: p => {
          const lines = p
            .filter(s => s.seriesType !== 'effectScatter')
            .map(s => `${s.marker}${s.seriesName}: ${s.value}%`)
          return lines.join('<br/>') + `<br/><span style="color:#94A3B8;font-size:11px">${activeFeat} ≈ ${p[0]?.axisValue ?? ''}</span>`
        },
      },
      legend: {
        show: true, top: 4, right: 8,
        data: [
          { name: '정상 (G1·2)', icon: 'rect', itemStyle: { color: '#3B82F6' } },
          { name: '위험 (G3·4)', icon: 'rect', itemStyle: { color: '#EF4444' } },
        ],
        textStyle: { fontSize: 12, color: '#475569' },
      },
      grid: { top: 36, bottom: 40, left: 52, right: 20 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { fontSize: 10, color: '#94A3B8', interval: 7, rotate: 30 },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#94A3B8', formatter: v => v + '%' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        {
          name: '정상 (G1·2)', type: 'line', data: mkDensity(lowVals),
          smooth: true, symbol: 'none',
          lineStyle: { color: '#3B82F6', width: 2 },
          areaStyle: { color: 'rgba(59,130,246,0.12)' },
        },
        {
          name: '위험 (G3·4)', type: 'line', data: mkDensity(highVals),
          smooth: true, symbol: 'none',
          lineStyle: { color: '#EF4444', width: 2 },
          areaStyle: { color: 'rgba(239,68,68,0.12)' },
          markLine: thrIdx >= 0 ? {
            silent: true, symbol: 'none',
            data: [{ xAxis: thrIdx, name: '임계값' }],
            lineStyle: { color: '#DC2626', type: 'solid', width: 2 },
            label: {
              show: true, position: 'end',
              formatter: `임계값 ${fmt(card.threshold)}`,
              fontSize: 11, color: '#DC2626', fontWeight: 600,
            },
          } : undefined,
        },
      ],
    }
  }, [featDistRaw, activeFeat, gradeMap, thresholdCards])

  // SHAP Beeswarm (참고용 작게)
  const beeswarmFeats = useMemo(() => shapSorted.slice(0, 15).map(d => d.feature), [shapSorted])

  const normToColor = norm => {
    const t = Math.max(0, Math.min(1, norm))
    const r = Math.round(59 + (239 - 59) * t)
    const g = Math.round(130 + (68 - 130) * t)
    const b = Math.round(246 + (68 - 246) * t)
    return `rgb(${r},${g},${b})`
  }

  const beeswarmOption = useMemo(() => {
    if (!shapBeeswarmRaw.length || !beeswarmFeats.length) return null
    const featOrder = [...beeswarmFeats].reverse()
    const featIdx = Object.fromEntries(featOrder.map((f, i) => [f, i]))
    const SAMPLE = 6000
    const rows = shapBeeswarmRaw.filter(r => beeswarmFeats.includes(r.feature))
    const step = rows.length > SAMPLE ? Math.ceil(rows.length / SAMPLE) : 1
    const points = rows.filter((_, i) => i % step === 0).map(r => ({
      feature: r.feature,
      sv: parseFloat(r.shap_value),
      yi: featIdx[r.feature] + (Math.random() - 0.5) * 0.7,
      norm: parseFloat(r.feat_norm),
    }))

    const scatterData = points.map(d => ({
      value: [d.sv, d.yi],
      itemStyle: {
        color: (selFeat && d.feature !== selFeat) ? '#CBD5E1' : normToColor(isFinite(d.norm) ? d.norm : 0.5),
        opacity: (selFeat && d.feature !== selFeat) ? 0.2 : 0.7,
      },
    }))

    const xVals = points.map(d => d.sv)
    const xBound = Math.max(Math.abs(Math.min(...xVals)), Math.abs(Math.max(...xVals))) * 1.1 || 0.001

    return {
      tooltip: {
        trigger: 'item',
        formatter: p => {
          const sv = p.data.value[0]
          const feat = featOrder[Math.round(p.data.value[1])] ?? ''
          return `<b>${feat}</b><br/>SHAP: ${sv >= 0 ? '+' : ''}${sv.toFixed(6)}<br/>${sv >= 0 ? '▲ 불량 증가 방향' : '▼ 불량 감소 방향'}`
        },
      },
      grid: { top: 8, bottom: 32, left: 8, right: 80, containLabel: true },
      xAxis: {
        type: 'value', min: -xBound, max: xBound,
        axisLabel: { fontSize: 10, color: '#94A3B8', formatter: v => v.toFixed(4) },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
        name: 'SHAP value (불량 기여도)',
        nameLocation: 'center', nameGap: 24,
        nameTextStyle: { fontSize: 11, color: '#94A3B8' },
      },
      yAxis: {
        type: 'value',
        min: -0.5, max: featOrder.length - 0.5,
        interval: 1,
        axisLabel: {
          fontSize: 11, fontFamily: 'monospace',
          formatter: v => featOrder[Math.round(v)] ?? '',
          color: '#374151',
        },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: '#F8FAFC', type: 'dashed' } },
      },
      series: [{
        type: 'scatter',
        data: scatterData,
        symbolSize: 5,
        markLine: {
          silent: true, symbol: 'none',
          data: [{ xAxis: 0 }],
          lineStyle: { color: '#64748B', width: 2 },
          label: { show: false },
        },
      }],
      graphic: [{
        type: 'group', right: 8, top: '15%',
        children: [
          { type: 'text', style: { text: 'High', fontSize: 10, fill: '#EF4444', fontWeight: 700 }, left: 2, top: 0 },
          {
            type: 'rect', left: 0, top: 16,
            shape: { width: 12, height: 110 },
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
          { type: 'text', style: { text: 'Low', fontSize: 10, fill: '#3B82F6', fontWeight: 700 }, left: 2, top: 130 },
          { type: 'text', style: { text: 'Feat\nvalue', fontSize: 9, fill: '#94A3B8' }, left: -2, top: 150 },
        ],
      }],
    }
  }, [shapBeeswarmRaw, beeswarmFeats, selFeat])

  if (!unitsRaw.length || !featDistRaw.length) {
    return (
      <div className="pf-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>
        데이터 로딩 중…
      </div>
    )
  }

  return (
    <div className="pf-page">

      {/* ── 안내 배너 ── */}
      <div className="pf-banner">
        <div className="pf-banner-title">공정 인자 진단</div>
      </div>

      {/* ── Row 0: Feature Pareto (영향력 누적 기여도) ── */}
      <div className="pf-section-title">
        <span>공정 인자 영향도 — Pareto</span>
        <span className="pf-section-sub">
          {paretoData
            ? `상위 ${paretoData.top80Count}개 인자가 전체 영향력의 ${paretoData.top80Pct}%를 설명합니다.`
            : 'SHAP 데이터 기준 상위 20개 인자의 개별 영향도(막대)와 누적 기여도(선)'}
        </span>
      </div>
      <div className="pf-chart-card">
        <div className="pf-cc-body">
          {paretoOption
            ? <ReactECharts option={paretoOption} style={{ height: 320 }} />
            : <div className="pf-empty">SHAP 데이터 없음</div>}
        </div>
      </div>

      {/* ── Row 1: 위험 임계값 카드 Top 5 ── */}
      <div className="pf-section-title">
        <span>관리 대상 공정 인자 Top {TOP_N}</span>
        <span className="pf-section-sub">SHAP 기준 영향력 순. 카드 클릭 시 아래 분포가 갱신됩니다.</span>
      </div>

      <div className="pf-card-row">
        {thresholdCards.length === 0
          ? <div className="pf-empty">임계값 계산 가능한 피처가 없습니다.</div>
          : thresholdCards.map((c) => (
            <div
              key={c.feature}
              className={`pf-thr-card ${activeFeat === c.feature ? 'active' : ''}`}
              onClick={() => setSelFeat(c.feature)}
            >
              <div className="pf-thr-head">
                <span className="pf-thr-feat">{c.feature}</span>
                <span className={`pf-thr-arrow ${c.direction}`}>
                  {c.direction === 'up' ? '↑ 높을수록 위험' : '↓ 낮을수록 위험'}
                </span>
              </div>
              <div className="pf-thr-range">
                <div className="pf-thr-line">
                  <span className="pf-thr-label">정상 범위</span>
                  <span className="pf-thr-val">{fmt(c.normalLow)} ~ {fmt(c.normalHigh)}</span>
                </div>
                <div className="pf-thr-line emphasis">
                  <span className="pf-thr-label">위험 임계값</span>
                  <span className="pf-thr-val danger">
                    {c.direction === 'up' ? '≥ ' : '≤ '}{fmt(c.threshold)}
                  </span>
                </div>
              </div>
              <div className="pf-thr-foot">
                <div className="pf-thr-stat">
                  <div className="pf-thr-stat-val">{(c.condRate * 100).toFixed(1)}%</div>
                  <div className="pf-thr-stat-lbl">임계값 초과 위험률</div>
                </div>
                <div className="pf-thr-stat">
                  <div className="pf-thr-stat-val lift">×{c.liftRatio.toFixed(2)}</div>
                  <div className="pf-thr-stat-lbl">평균 대비 배수</div>
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* ── Row 2: 선택 피처 분포 비교 ── */}
      <div className="pf-grid-2">
        <div className="pf-chart-card">
          <div className="pf-cc-header">
            <span className="pf-cc-title">정상 vs 위험 분포 — {activeFeat ?? '-'}</span>
            <span className="pf-cc-sub">임계값(빨간 실선) 이상에서 위험군 비중이 급증합니다.</span>
          </div>
          <div className="pf-cc-body">
            {distOption
              ? <ReactECharts option={distOption} style={{ height: 340 }} />
              : <div className="pf-empty">분포 데이터 없음</div>}
          </div>
        </div>

        <div className="pf-chart-card">
          <div className="pf-cc-header">
            <span className="pf-cc-title">SHAP 영향도 (전역)</span>
            <span className="pf-cc-sub">색상 = 피처 값 (빨강↑ / 파랑↓), 가로 위치 = 불량 기여 방향</span>
          </div>
          <div className="pf-cc-body">
            {beeswarmOption
              ? <ReactECharts
                  option={beeswarmOption}
                  style={{ height: Math.max(340, beeswarmFeats.length * 24) }}
                  onEvents={{
                    click: p => {
                      if (p.componentType === 'series') {
                        const feat = [...beeswarmFeats].reverse()[Math.round(p.data.value[1])]
                        if (feat) setSelFeat(feat)
                      }
                    },
                  }}
                />
              : <div className="pf-empty">SHAP 데이터 없음</div>}
          </div>
        </div>
      </div>

    </div>
  )
}
