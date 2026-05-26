import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import { getGrade } from './Overview'
import './FeatureAnalysis.css'

function ChartCard({ title, sub, children }) {
  return (
    <div className="chart-card">
      <div className="cc-header">
        <div className="cc-title">
          {title}
          {sub && <span className="cc-sub">{sub}</span>}
        </div>
      </div>
      <div className="cc-body">{children}</div>
    </div>
  )
}

export function ImportancePage() {
  const { data: impRaw, loading } = useCSV('/feature_importance.csv')
  const { data: distData }        = useCSV('/feature_dist.csv')
  const { data: unitData }        = useCSV('/dashboard_units.csv')
  const { data: shapRaw }         = useCSV('/shap_data.csv')
  const { data: metricsRaw }      = useCSV('/metrics.csv')

  const [selectedFeat, setSelectedFeat] = useState(null)

  // ── 모델 RMSE (ensemble val 기준)
  const ensembleRmse = useMemo(() => {
    if (!metricsRaw.length) return null
    const row = metricsRaw.find(r => r.stage === 'reg' && r.model === 'ensemble' && r.split === 'val' && r.metric === 'rmse')
    return row ? parseFloat(row.value) : null
  }, [metricsRaw])

  // ── LGBM Top-10
  const lgbmTop = useMemo(() => {
    if (!impRaw.length) return []
    return [...impRaw]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 10)
      .map(r => ({ feature: r.feature, value: parseFloat(r.lgbm_gain) || 0 }))
  }, [impRaw])

  // ── KPI: Top-3 피처
  const top3Features = useMemo(() => {
    if (!lgbmTop.length) return []
    const total = lgbmTop.reduce((s, d) => s + d.value, 0) || 1
    return lgbmTop.slice(0, 3).map(d => ({
      feature: d.feature,
      value: d.value,
      ratio: d.value / total,
    }))
  }, [lgbmTop])

  // ── SHAP Top-10
  const shapTop = useMemo(() => {
    if (!shapRaw.length) return []
    return [...shapRaw]
      .sort((a, b) => parseFloat(a.lgbm_rank) - parseFloat(b.lgbm_rank))
      .slice(0, 10)
      .map(r => ({ feature: r.feature, value: parseFloat(r.effect_norm) || 0 }))
  }, [shapRaw])

  // ── grade 매핑
  const gradeMap = useMemo(() => {
    if (!unitData.length) return {}
    const trainPreds = unitData
      .filter(r => r.split === 'train')
      .map(r => parseFloat(r.reg_pred))
      .filter(v => !isNaN(v))
      .sort((a, b) => a - b)
    const n = trainPreds.length
    const thresholds = {
      g1: trainPreds[Math.floor(n * 0.90)] ?? 0,
      g2: trainPreds[Math.floor(n * 0.708)] ?? 0,
      g3: trainPreds[Math.floor(n * 0.50)] ?? 0,
    }
    return Object.fromEntries(unitData.map(r => [r.ufs_serial, getGrade(parseFloat(r.reg_pred) || 0, thresholds)]))
  }, [unitData])

  // ── 히스토그램
  const distOpt = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(gradeMap).length) return null
    const high  = distData.filter(r => gradeMap[r.ufs_serial] === 'grade1').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => gradeMap[r.ufs_serial] !== 'grade1').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    if (!high.length || !other.length) return null

    const median = arr => { const s = [...arr].sort((a,b)=>a-b); const m = Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2 }
    const medHigh  = median(high)
    const medOther = median(other)

    const allVals = [...high, ...other]
    const mn = Math.min(...allVals), mx = Math.max(...allVals)
    const BINS = 30, step = (mx - mn) / BINS || 1
    const bins = Array.from({ length: BINS }, (_, i) => mn + i * step)
    function toBins(arr) {
      const counts = new Array(BINS).fill(0)
      arr.forEach(v => { const idx = Math.min(Math.floor((v - mn) / step), BINS - 1); counts[idx]++ })
      return counts.map(c => +(c / arr.length * 100).toFixed(2))
    }

    const medHighIdx  = Math.min(Math.floor((medHigh  - mn) / step), BINS - 1)
    const medOtherIdx = Math.min(Math.floor((medOther - mn) / step), BINS - 1)

    return {
      tooltip: { trigger: 'axis', formatter: p => `${p[0].name}<br/>Grade1: ${p[0].value}%<br/>나머지: ${p[1]?.value ?? 0}%` },
      legend: { data: ['Grade 1(최고위험)', '나머지(Grade 2~4)'], top: 0, right: 0, textStyle: { fontSize: 12 }, itemHeight: 8 },
      grid: { top: 24, left: 44, right: 16, bottom: 24 },
      xAxis: { type: 'category', data: bins.map(b => b.toFixed(1)), axisLabel: { fontSize: 8, color: '#94A3B8', rotate: 30 }, boundaryGap: false },
      yAxis: { type: 'value', name: '비율(%)', nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      series: [
        {
          name: 'Grade 1(최고위험)',
          type: 'line', data: toBins(high), smooth: true, symbol: 'none',
          lineStyle: { color: 'rgba(239,68,68,.9)', width: 2 },
          areaStyle: { color: 'rgba(239,68,68,.15)' },
          markLine: {
            silent: true, symbol: 'none',
            data: [{ xAxis: medHighIdx, lineStyle: { color: 'rgba(180,50,50,0.6)', type: 'dashed', width: 1.5 }, label: { show: false } }],
          },
        },
        {
          name: '나머지(Grade 2~4)',
          type: 'line', data: toBins(other), smooth: true, symbol: 'none',
          lineStyle: { color: 'rgba(59,130,246,.9)', width: 2 },
          areaStyle: { color: 'rgba(59,130,246,.15)' },
          markLine: {
            silent: true, symbol: 'none',
            data: [{ xAxis: medOtherIdx, lineStyle: { color: 'rgba(50,90,180,0.6)', type: 'dashed', width: 1.5 }, label: { show: false } }],
          },
        },
      ],
    }
  }, [distData, gradeMap, selectedFeat])

  // ── LGBM 바차트 옵션
  const lgbmNames = useMemo(() => [...lgbmTop.map(d => d.feature)].reverse(), [lgbmTop])
  const lgbmOpt = useMemo(() => ({
    tooltip: { show: false },
    grid: { top: 10, left: 66, right: 80, bottom: 10 },
    xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8', formatter: v => v.toFixed(0) }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
    yAxis: { type: 'category', data: lgbmNames, axisLabel: { fontSize: 10, color: '#475569', fontFamily: 'DM Mono,monospace' } },
    series: [{
      type: 'bar', barMaxWidth: 14,
      data: [...lgbmTop].reverse().map(d => {
        const isSel = d.feature === selectedFeat
        return {
          value: d.value,
          itemStyle: {
            color: isSel ? '#2563EB' : 'rgba(59,130,246,0.55)',
            borderColor: isSel ? '#1E293B' : 'transparent',
            borderWidth: isSel ? 3 : 0,
            borderRadius: [0, 4, 4, 0],
          }
        }
      }),
      label: { show: true, position: 'right', fontSize: 11, formatter: p => Number(p.value).toFixed(2), color: '#475569' },
    }],
  }), [lgbmTop, lgbmNames, selectedFeat])

  // ── SHAP 바차트 옵션
  const shapNames = useMemo(() => [...shapTop.map(d => d.feature)].reverse(), [shapTop])
  const shapOpt = useMemo(() => {
    if (!shapTop.length) return null
    const maxAbs = Math.max(...shapTop.map(d => Math.abs(d.value)))
    return {
      tooltip: { show: false },
      grid: { top: 10, left: 66, right: 24, bottom: 10 },
      xAxis: {
        type: 'value', min: -maxAbs * 1.2, max: maxAbs * 1.2,
        axisLabel: { fontSize: 9, color: '#94A3B8', formatter: v => v.toFixed(4) },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
      },
      yAxis: { type: 'category', data: shapNames, axisLabel: { fontSize: 10, color: '#475569', fontFamily: 'DM Mono,monospace' } },
      series: [{
        type: 'bar', barMaxWidth: 14,
        data: [...shapTop].reverse().map(d => {
          const isSel = d.feature === selectedFeat
          return {
            value: d.value,
            itemStyle: {
              color: isSel ? '#7C3AED' : (d.value >= 0 ? 'rgba(239,68,68,0.55)' : 'rgba(59,130,246,0.55)'),
              borderColor: isSel ? '#5B21B6' : 'transparent',
              borderWidth: isSel ? 3 : 0,
              borderRadius: d.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          }
        }),
        markLine: { silent: true, data: [{ xAxis: 0, lineStyle: { color: '#94A3B8', type: 'solid', width: 1 } }] },
      }],
    }
  }, [shapTop, shapNames, selectedFeat])

  if (loading) return (
    <div className="feat-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 11 }}>
      데이터 로딩 중…
    </div>
  )

  return (
    <div className="feat-page" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* KPI 박스 행 */}
      <div className="fa-kpi-row">
        {/* RMSE */}
        <div className="fa-kpi-card fa-kpi-rmse">
          <div className="fa-kpi-label">RMSE</div>
          <div className="fa-kpi-value">
            {ensembleRmse !== null
              ? ensembleRmse.toFixed(6)
              : <span className="fa-kpi-tbd">—</span>}
          </div>
          <div className="fa-kpi-hint">val set · reg ensemble</div>
        </div>

        {/* Top-3 Feature Importance */}
        {top3Features.length > 0
          ? top3Features.map((d, i) => (
            <div key={d.feature} className="fa-kpi-card fa-kpi-feat">
              <div className="fa-kpi-rank">#{i + 1} Feature</div>
              <div className="fa-kpi-feat-main">
                <span className="fa-kpi-feat-name">{d.feature}</span>
                <span className="fa-kpi-feat-ratio">{(d.ratio * 100).toFixed(1)}%</span>
              </div>
              <div className="fa-kpi-hint">Top-10 gain 기준</div>
            </div>
          ))
          : [1,2,3].map(i => (
            <div key={i} className="fa-kpi-card fa-kpi-feat fa-kpi-loading">
              <div className="fa-kpi-rank">#{i} Feature</div>
              <div className="fa-kpi-tbd">로딩 중…</div>
            </div>
          ))
        }
      </div>

      {/* 상단: LGBM + SHAP 나란히 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ChartCard title="Feature Importance — Top-10">
          <ReactECharts
            option={lgbmOpt}
            style={{ height: 320 }}
            onEvents={{ click: p => { const f = lgbmNames[p.dataIndex]; if (f) setSelectedFeat(f) } }}
          />
        </ChartCard>

        <ChartCard title="불량 기여 방향 — SHAP effect Top-10">
          {shapOpt
            ? <ReactECharts
                option={shapOpt}
                style={{ height: 320 }}
                onEvents={{ click: p => { const f = shapNames[p.dataIndex]; if (f) setSelectedFeat(f) } }}
              />
            : <div style={{ color: '#94A3B8', textAlign: 'center', paddingTop: 40 }}>SHAP 데이터 없음</div>
          }
        </ChartCard>
      </div>

      {/* 하단: 히스토그램 */}
      <ChartCard
        title={`고위험 vs 저위험 분포${selectedFeat ? ` — ${selectedFeat}` : ''}`}
      >
        {distOpt
          ? <ReactECharts option={distOpt} style={{ height: 220 }} />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220, color: '#94A3B8', fontSize: 11 }}>
              위 막대를 클릭하면 분포가 표시됩니다
            </div>
        }
      </ChartCard>
    </div>
  )
}
