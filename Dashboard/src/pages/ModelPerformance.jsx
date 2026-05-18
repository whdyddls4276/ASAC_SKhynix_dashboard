import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './ModelPerformance.css'

const BASELINE_RMSE = 0.0150
const FIXED_DATE    = '2026-06-11'

function ChartCard({ title, tag, children }) {
  return (
    <div className="mp-chart-card">
      <div className="mp-cc-header">
        <span className="mp-cc-title">{title}</span>
        {tag && <span className="mp-cc-tag">{tag}</span>}
      </div>
      <div className="mp-cc-body">{children}</div>
    </div>
  )
}

function KpiBox({ label, value, sub, color, accent }) {
  return (
    <div className="mp-kpi" style={{ '--kc': color, '--ka': accent ?? color + '18' }}>
      <div className="mp-kpi-val" style={{ color }}>{value}</div>
      <div className="mp-kpi-label">{label}</div>
      {sub && <div className="mp-kpi-sub">{sub}</div>}
    </div>
  )
}

export default function ModelPerformance() {
  const { data: metricsRaw }  = useCSV('/metrics.csv')
  const { data: fiRaw }       = useCSV('/feature_importance.csv')
  const { data: shapBarRaw }  = useCSV('/shap_bar.csv')
  const { data: unitsRaw }    = useCSV('/dashboard_units.csv')
  const { data: featDistRaw } = useCSV('/feature_dist.csv')

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
      lgbm_val:     get('reg', 'lgbm',     'val'),
      et_val:       get('reg', 'et',        'val'),
      enet_val:     get('reg', 'enet',      'val'),
      lgbm_test:    get('reg', 'lgbm',      'test'),
      et_test:      get('reg', 'et',        'test'),
      enet_test:    get('reg', 'enet',      'test'),
    }
  }, [metricsRaw])

  // ── 피처 임포턴스 상위 5개 KPI ──
  const topFi = useMemo(() => {
    if (!fiRaw.length) return []
    return [...fiRaw]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 5)
  }, [fiRaw])

  // ── 피처 임포턴스 차트 (좌상단) ──
  const fiOption = useMemo(() => {
    if (!fiRaw.length) return null
    const top = [...fiRaw]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 20)
      .reverse()
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: p => `<b>${p[0].name}</b><br/>중요도 점수: ${parseFloat(p[0].value).toFixed(1)}` },
      grid: { top: 8, bottom: 8, left: 80, right: 60, containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' },
        splitLine: { lineStyle: { color: '#F1F5F9' } } },
      yAxis: { type: 'category', data: top.map(d => d.feature),
        axisLabel: { fontSize: 10, color: '#374151', fontFamily: 'monospace' } },
      series: [{
        type: 'bar',
        data: top.map((d, i) => ({
          value: parseFloat(d.lgbm_gain),
          itemStyle: { color: i >= 15 ? '#EF4444' : i >= 10 ? '#F97316' : '#3B82F6', borderRadius: [0, 3, 3, 0] },
        })),
        barMaxWidth: 14,
        label: { show: true, position: 'right', fontSize: 9, color: '#64748B',
          formatter: p => p.value.toFixed(1) },
      }],
    }
  }, [fiRaw])

  // ── SHAP Top-10 (우상단) ──
  const shapOption = useMemo(() => {
    if (!shapBarRaw.length) return null
    const top10 = [...shapBarRaw]
      .sort((a, b) => parseFloat(b.mean_abs_shap) - parseFloat(a.mean_abs_shap))
      .slice(0, 10)
      .reverse()
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: p => {
          const d = top10[top10.length - 1 - p[0].dataIndex] || top10[p[0].dataIndex]
          const mean = parseFloat(shapBarRaw.find(r => r.feature === p[0].name)?.mean_shap ?? 0)
          return `<b>${p[0].name}</b><br/>|SHAP|: ${parseFloat(p[0].value).toFixed(5)}<br/>방향: ${mean >= 0 ? '▲ 불량 증가' : '▼ 불량 감소'}`
        },
      },
      grid: { top: 8, bottom: 8, left: 80, right: 70, containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8', formatter: v => v.toFixed(3) },
        splitLine: { lineStyle: { color: '#F1F5F9' } } },
      yAxis: { type: 'category', data: top10.map(d => d.feature),
        axisLabel: { fontSize: 10, color: '#374151', fontFamily: 'monospace' } },
      series: [{
        type: 'bar',
        data: top10.map(d => {
          const meanShap = parseFloat(d.mean_shap)
          return {
            value: parseFloat(d.mean_abs_shap),
            itemStyle: { color: meanShap >= 0 ? '#EF4444' : '#3B82F6', borderRadius: [0, 3, 3, 0] },
          }
        }),
        barMaxWidth: 14,
        label: { show: true, position: 'right', fontSize: 9,
          formatter: p => parseFloat(p.value).toFixed(4),
          color: '#64748B' },
      }],
    }
  }, [shapBarRaw])

  // ── 고위험 vs 저위험 reg_pred 분포 비교 (좌하단) ──
  const riskDistOption = useMemo(() => {
    if (!unitsRaw.length) return null

    // threshold: train p70.8
    const trainPreds = unitsRaw.filter(u => u.split === 'train')
      .map(u => parseFloat(u.reg_pred)).filter(isFinite).sort((a, b) => a - b)
    const thresh = trainPreds[Math.floor(trainPreds.length * 0.708)] ?? 0

    const highPreds = unitsRaw.filter(u => parseFloat(u.reg_pred) >= thresh).map(u => parseFloat(u.reg_pred))
    const lowPreds  = unitsRaw.filter(u => parseFloat(u.reg_pred) <  thresh).map(u => parseFloat(u.reg_pred))

    const allPreds  = unitsRaw.map(u => parseFloat(u.reg_pred)).filter(isFinite)
    const maxP = Math.max(...allPreds)
    const BIN  = 30
    const binSz = maxP / BIN
    const bins  = Array.from({ length: BIN }, (_, i) => i * binSz)

    const mkHist = (vals) => bins.map((b, i) => {
      const next = i === BIN - 1 ? Infinity : bins[i + 1]
      return vals.filter(v => v >= b && v < next).length
    })

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['고위험(≥τ)', '저위험(<τ)'], top: 0, textStyle: { fontSize: 10 } },
      grid: { top: 28, bottom: 36, left: 48, right: 16 },
      xAxis: { type: 'category', data: bins.map(b => (b * 1e6).toFixed(0)),
        axisLabel: { fontSize: 8, color: '#94A3B8', interval: 5 },
        name: 'reg_pred (ppm)', nameTextStyle: { fontSize: 9, color: '#94A3B8' } },
      yAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' },
        splitLine: { lineStyle: { color: '#F1F5F9' } } },
      series: [
        { name: '고위험(≥τ)', type: 'bar', stack: 'dist', data: mkHist(highPreds),
          itemStyle: { color: 'rgba(239,68,68,0.7)', borderRadius: [2, 2, 0, 0] } },
        { name: '저위험(<τ)', type: 'bar', stack: 'dist', data: mkHist(lowPreds),
          itemStyle: { color: 'rgba(59,130,246,0.45)', borderRadius: [2, 2, 0, 0] } },
      ],
    }
  }, [unitsRaw])

  // ── 피처 분포 스캐터: 일주일치 X값 (우하단) ──
  // feature_dist.csv 컬럼: ufs_serial, X1064, X592, ... health, is_defect
  // 최근 val 데이터 기반 — 각 top-5 피처의 분포를 점으로
  const [selFeat, setSelFeat] = useState(null)

  const featScatterOption = useMemo(() => {
    if (!featDistRaw.length || !fiRaw.length) return null

    const top5 = [...fiRaw]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 5)
      .map(d => d.feature)

    const feat = selFeat ?? top5[0]
    if (!feat || !(feat in featDistRaw[0])) return null

    // x: 피처값, y: health (reg_pred 없으면 health)
    const COLORS = {
      0: 'rgba(59,130,246,0.4)',   // 정상
      1: 'rgba(239,68,68,0.65)',   // 불량
    }
    const data0 = []
    const data1 = []
    for (const r of featDistRaw) {
      const x = parseFloat(r[feat])
      const y = parseFloat(r.health)
      if (!isFinite(x) || !isFinite(y)) continue
      if (parseInt(r.is_defect) === 1) data1.push([x, y])
      else data0.push([x, y])
    }
    // 샘플링
    const sample = (arr, n) => arr.length <= n ? arr
      : arr.filter((_, i) => i % Math.ceil(arr.length / n) === 0).slice(0, n)

    return {
      tooltip: { formatter: p =>
        `${feat}: ${p.data[0].toFixed(4)}<br/>health: ${p.data[1].toFixed(6)}` },
      legend: { data: ['정상(Y=0)', '불량(Y>0)'], top: 0, textStyle: { fontSize: 10 } },
      grid: { top: 28, bottom: 36, left: 52, right: 16 },
      xAxis: { type: 'value', name: feat, nameTextStyle: { fontSize: 10, color: '#94A3B8' },
        axisLabel: { fontSize: 9, color: '#94A3B8' },
        splitLine: { lineStyle: { color: '#F1F5F9' } } },
      yAxis: { type: 'value', name: 'health', nameTextStyle: { fontSize: 9, color: '#94A3B8' },
        axisLabel: { fontSize: 9, color: '#94A3B8' },
        splitLine: { lineStyle: { color: '#F1F5F9' } } },
      series: [
        { name: '정상(Y=0)', type: 'scatter', data: sample(data0, 400), symbolSize: 4,
          itemStyle: { color: 'rgba(59,130,246,0.4)' } },
        { name: '불량(Y>0)', type: 'scatter', data: sample(data1, 300), symbolSize: 5,
          itemStyle: { color: 'rgba(239,68,68,0.7)' } },
      ],
    }
  }, [featDistRaw, fiRaw, selFeat])

  const top5FeatNames = useMemo(() =>
    [...fiRaw].sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 5).map(d => d.feature),
    [fiRaw])

  if (!metrics) {
    return <div className="mp-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>데이터 로딩 중…</div>
  }

  const bestVal    = metrics.ensemble_val ?? metrics.lgbm_val ?? 0
  const beatBase   = bestVal < BASELINE_RMSE
  const improvement = (((BASELINE_RMSE - bestVal) / BASELINE_RMSE) * 100).toFixed(1)

  return (
    <div className="mp-page">

      {/* ── Row 1: RMSE KPI ── */}
      <div className="mp-kpi-row">
        <KpiBox
          label="Ensemble Val RMSE"
          value={bestVal.toFixed(6)}
          sub={`예측 시점 · ${FIXED_DATE}`}
          color="#3B82F6"
          accent="#EFF6FF"
        />
        <KpiBox
          label="LGBM Val RMSE"
          value={metrics.lgbm_val?.toFixed(6) ?? '—'}
          sub="LightGBM 단독"
          color="#8B5CF6"
        />
        <KpiBox
          label="ET Val RMSE"
          value={metrics.et_val?.toFixed(6) ?? '—'}
          sub="ExtraTrees 단독"
          color="#06B6D4"
        />
        <KpiBox
          label={beatBase ? '기준 대비 개선' : '기준 미달'}
          value={beatBase ? `-${improvement}%` : `+${Math.abs(parseFloat(improvement))}%`}
          sub={`기준 ${BASELINE_RMSE} · ${beatBase ? '달성 ✓' : '미달성'}`}
          color={beatBase ? '#22C55E' : '#EF4444'}
        />
      </div>

      {/* ── Row 2: 피처 임포턴스 상위 5개 KPI ── */}
      {topFi.length > 0 && (
        <div className="mp-fi-kpi-row">
          {topFi.map((f, i) => (
            <KpiBox
              key={f.feature}
              label={`#${i + 1} ${f.feature}`}
              value={parseFloat(f.lgbm_gain).toFixed(1)}
              sub={`ET: ${parseFloat(f.et_impurity).toFixed(5)}`}
              color={['#EF4444','#F97316','#EAB308','#3B82F6','#8B5CF6'][i]}
            />
          ))}
        </div>
      )}

      {/* ── Row 3+4: 2×2 차트 그리드 ── */}
      <div className="mp-grid-2x2">
        {/* 좌상: 피처 임포턴스 */}
        <ChartCard title="피처 임포턴스" tag="LGBM Gain Top 20">
          {fiOption
            ? <ReactECharts option={fiOption} style={{ height: 320 }} />
            : <div className="mp-empty">feature_importance.csv 없음</div>}
        </ChartCard>

        {/* 우상: SHAP Top-10 */}
        <ChartCard title="SHAP 분석" tag="Top 10 · 빨강=증가 파랑=감소">
          {shapOption
            ? <ReactECharts option={shapOption} style={{ height: 320 }} />
            : <div className="mp-empty">shap_bar.csv 없음</div>}
        </ChartCard>

        {/* 좌하: 고위험 vs 저위험 분포 */}
        <ChartCard title="고위험 vs 저위험 분포" tag="reg_pred 히스토그램 · 임계=p70.8">
          {riskDistOption
            ? <ReactECharts option={riskDistOption} style={{ height: 280 }} />
            : <div className="mp-empty">dashboard_units.csv 없음</div>}
        </ChartCard>

        {/* 우하: 피처 분포 스캐터 */}
        <ChartCard title="피처 분포 스캐터" tag="X값 vs health · 일주일치">
          <div className="mp-feat-tabs">
            {top5FeatNames.map(f => (
              <button
                key={f}
                className={`mp-feat-tab ${(selFeat ?? top5FeatNames[0]) === f ? 'active' : ''}`}
                onClick={() => setSelFeat(f)}
              >{f}</button>
            ))}
          </div>
          {featScatterOption
            ? <ReactECharts option={featScatterOption} style={{ height: 250 }} />
            : <div className="mp-empty">feature_dist.csv 없음</div>}
        </ChartCard>
      </div>

    </div>
  )
}
