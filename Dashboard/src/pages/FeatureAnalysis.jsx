import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import { getGrade } from './Overview'
import './FeatureAnalysis.css'

function ChartCard({ title, tag, children }) {
  return (
    <div className="chart-card">
      <div className="cc-header">
        <div className="cc-title">{title}{tag && <span className="cc-tag">{tag}</span>}</div>
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

  // ── KPI: Top-3 피처 (비율 포함)
  const top3Features = useMemo(() => {
    if (!lgbmTop.length) return []
    const total = lgbmTop.reduce((s, d) => s + d.value, 0) || 1
    return lgbmTop.slice(0, 3).map(d => ({
      feature: d.feature,
      value: d.value,
      ratio: d.value / total,
    }))
  }, [lgbmTop])

  // ── SHAP Top-10 (shap_data.csv 기준, lgbm_rank 순)
  const shapTop = useMemo(() => {
    if (!shapRaw.length) return []
    return [...shapRaw]
      .sort((a, b) => parseFloat(a.lgbm_rank) - parseFloat(b.lgbm_rank))
      .slice(0, 10)
      .map(r => ({ feature: r.feature, value: parseFloat(r.effect_norm) || 0 }))
  }, [shapRaw])

  // ── SHAP Top-1 피처
  const shapTop1 = useMemo(() => shapTop.length ? shapTop[0].feature : null, [shapTop])

  // ── grade 매핑 (train 기준 threshold)
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

  // ── 히스토그램 (중앙값 수직선 포함)
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

    // 중앙값을 bins 인덱스로 변환
    const medHighIdx  = Math.min(Math.floor((medHigh  - mn) / step), BINS - 1)
    const medOtherIdx = Math.min(Math.floor((medOther - mn) / step), BINS - 1)

    return {
      tooltip: { trigger: 'axis', formatter: p => `${p[0].name}<br/>Grade1: ${p[0].value}%<br/>나머지: ${p[1]?.value ?? 0}%` },
      legend: { data: ['Grade 1(최고위험)', '나머지(Grade 2~4)'], bottom: 0, textStyle: { fontSize: 10 } },
      grid: { top: 10, left: 44, right: 16, bottom: 36 },
      xAxis: { type: 'category', data: bins.map(b => b.toFixed(1)), axisLabel: { fontSize: 8, color: '#94A3B8', rotate: 30 }, boundaryGap: false },
      yAxis: { type: 'value', name: '비율(%)', nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      series: [
        {
          name: 'Grade 1(최고위험)',
          type: 'line', data: toBins(high), smooth: true, symbol: 'none',
          lineStyle: { color: 'rgba(239,68,68,.9)', width: 2 },
          areaStyle: { color: 'rgba(239,68,68,.15)' },
          markLine: {
            silent: true,
            data: [{ xAxis: medHighIdx, lineStyle: { color: 'rgba(150,150,150,0.55)', type: 'dashed', width: 1.5 }, label: { formatter: `중앙값\n${medHigh.toFixed(2)}`, fontSize: 8, color: '#9CA3AF', position: 'insideStartTop' } }],
          },
        },
        {
          name: '나머지(Grade 2~4)',
          type: 'line', data: toBins(other), smooth: true, symbol: 'none',
          lineStyle: { color: 'rgba(59,130,246,.9)', width: 2 },
          areaStyle: { color: 'rgba(59,130,246,.15)' },
          markLine: {
            silent: true,
            data: [{ xAxis: medOtherIdx, lineStyle: { color: 'rgba(150,150,150,0.55)', type: 'dashed', width: 1.5 }, label: { formatter: `중앙값\n${medOther.toFixed(2)}`, fontSize: 8, color: '#9CA3AF', position: 'insideEndTop' } }],
          },
        },
      ],
    }
  }, [distData, gradeMap, selectedFeat])

  // ── SHAP trend: Top-1 피처의 이번 주차 일별 평균 (val 최신 7일)
  const shapTrendOpt = useMemo(() => {
    if (!distData.length || !unitData.length || !shapTop1) return null

    // unit → lot날짜 매핑
    const lotToDateLocal = (lot) => {
      const n = Math.round(parseFloat(lot))
      let base, offset
      if (n >= 201) { base = new Date('2026-05-28'); offset = Math.floor((n - 201) / 9) }
      else if (n >= 101) { base = new Date('2026-04-11'); offset = n - 101 }
      else if (n <= 28) { base = new Date('2026-03-27'); offset = Math.round((n - 1) * (45 / 27)) }
      else if (n <= 56) { base = new Date('2026-05-12'); offset = n - 29 }
      else { base = new Date('2026-06-11'); offset = n - 57 }
      const d = new Date(base); d.setDate(d.getDate() + offset)
      return d.toISOString().slice(0, 10)
    }

    // val 유닛만, 날짜 붙이기
    const valUnits = unitData.filter(u => u.split === 'val')
    const dateMap = Object.fromEntries(valUnits.map(u => [u.ufs_serial, lotToDateLocal(u.run_id)]))

    // 최신 날짜 기준 최근 7일
    const allDates = [...new Set(Object.values(dateMap))].sort()
    const recentDates = allDates.slice(-7)

    // feature_dist에서 해당 unit의 Top-1 피처 값 → 일별 평균
    const dayMap = {}
    recentDates.forEach(d => { dayMap[d] = [] })
    distData.forEach(r => {
      const d = dateMap[r.ufs_serial]
      if (d && dayMap[d] !== undefined) {
        const v = parseFloat(r[shapTop1])
        if (!isNaN(v)) dayMap[d].push(v)
      }
    })

    const labels = recentDates.map(d => d.slice(5)) // MM-DD
    const values = recentDates.map(d => {
      const arr = dayMap[d]
      return arr.length ? +(arr.reduce((s,v)=>s+v,0)/arr.length).toFixed(4) : null
    })

    if (values.every(v => v === null)) return null

    return {
      tooltip: {
        trigger: 'axis',
        formatter: p => `<b>${p[0].axisValue}</b><br/>${p[0].marker} ${shapTop1} 평균: ${p[0].value?.toFixed(4) ?? '-'}`,
      },
      grid: { top: 16, bottom: 30, left: 60, right: 20 },
      xAxis: {
        type: 'category', data: labels,
        axisLabel: { fontSize: 10 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: 'value',
        name: '평균값',
        nameTextStyle: { fontSize: 9 },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [{
        type: 'line',
        data: values,
        smooth: true,
        connectNulls: true,
        lineStyle: { color: '#8B5CF6', width: 2 },
        itemStyle: { color: '#8B5CF6' },
        areaStyle: { color: 'rgba(139,92,246,0.1)' },
        symbolSize: 6,
      }],
    }
  }, [distData, unitData, shapTop1])

  // ── LGBM 바차트 옵션
  const lgbmNames = useMemo(() => [...lgbmTop.map(d => d.feature)].reverse(), [lgbmTop])
  const lgbmOpt = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br/>LGBM Gain: ${Number(p.value).toExponential(3)}` },
    grid: { top: 10, left: 66, right: 56, bottom: 10 },
    xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
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
      label: { show: true, position: 'right', fontSize: 9, formatter: p => Number(p.value).toExponential(2), color: '#475569' },
    }],
  }), [lgbmTop, lgbmNames, selectedFeat])

  // ── SHAP 바차트 옵션
  const shapNames = useMemo(() => [...shapTop.map(d => d.feature)].reverse(), [shapTop])
  const shapOpt = useMemo(() => {
    if (!shapTop.length) return null
    const maxAbs = Math.max(...shapTop.map(d => Math.abs(d.value)))
    return {
      tooltip: { trigger: 'item', formatter: p => {
        const v = parseFloat(p.value)
        return `${p.name}<br/>mean SHAP: ${v.toFixed(6)}<br/>${v >= 0 ? '위험 기여 ↑' : '위험 억제 ↓'}`
      }},
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
    <div className="feat-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 14 }}>
      데이터 로딩 중…
    </div>
  )

  return (
    <div className="feat-page" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* KPI 박스 행 */}
      <div className="fa-kpi-row">
        {/* Ensemble RMSE */}
        <div className="fa-kpi-card fa-kpi-rmse">
          <div className="fa-kpi-label">Ensemble RMSE</div>
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

      {/* 선택된 피처 표시 */}
      <div style={{ padding: '7px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12, color: '#64748B' }}>
        {selectedFeat
          ? <><span style={{ fontWeight: 700, color: '#1E293B', fontFamily: 'DM Mono,monospace' }}>{selectedFeat}</span> 선택됨 — 아래 히스토그램·박스플롯 업데이트</>
          : '막대를 클릭하면 히스토그램과 박스플롯이 표시됩니다'}
      </div>

      {/* 상단: LGBM + SHAP 나란히 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ChartCard title="🏆 Feature Importance — LGBM Gain Top-10" tag="클릭 → 분포 확인">
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.6 }}>
            모델이 예측할 때 <b>각 피처를 얼마나 많이 활용했는지</b>를 나타냅니다.
            값이 클수록 해당 피처가 불량 예측에 중요하게 사용된 것입니다.
          </div>
          <ReactECharts
            option={lgbmOpt}
            style={{ height: 320 }}
            onEvents={{ click: p => { const f = lgbmNames[p.dataIndex]; if (f) setSelectedFeat(f) } }}
          />
        </ChartCard>

        <ChartCard title="🧬 불량 기여 방향 — SHAP effect Top-10" tag="클릭 → 분포 확인">
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.6 }}>
            <span style={{ color: '#EF4444', fontWeight: 600 }}>빨강(+)</span> = 불량 위험을 높이는 피처 &nbsp;
            <span style={{ color: '#3B82F6', fontWeight: 600 }}>파랑(-)</span> = 불량 위험을 낮추는 피처.
            절대값이 클수록 예측 결과에 더 큰 영향을 줍니다.
          </div>
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

      {/* 하단: 히스토그램 + SHAP trend 나란히 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ChartCard title="📉 고위험 vs 저위험 분포" tag={selectedFeat ?? '피처를 선택하세요'}>
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.6 }}>
            선택한 피처의 값 분포를 <b>Grade 1(최고위험)</b> vs 나머지 그룹으로 비교합니다.
            두 선이 <b>많이 겹칠수록</b> 구분력이 낮고, <b>떨어져 있을수록</b> 불량 예측에 효과적인 피처입니다.
            회색 점선은 각 그룹의 <b>중앙값</b>입니다.
          </div>
          {distOpt
            ? <ReactECharts option={distOpt} style={{ height: 220 }} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220, color: '#94A3B8', fontSize: 12, flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 20 }}>👆</span>위 막대를 클릭하세요
              </div>
          }
        </ChartCard>

        <ChartCard title={`📈 SHAP Top-1 일별 트렌드${shapTop1 ? ` — ${shapTop1}` : ''}`} tag="이번 주차 최근 7일">
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.6 }}>
            SHAP 중요도 <b>1위 피처</b>의 이번 주차 일별 평균값 추이입니다.
            값의 변화가 클수록 해당 피처가 최근 공정에서 <b>불안정</b>함을 의미할 수 있습니다.
          </div>
          {shapTrendOpt
            ? <ReactECharts option={shapTrendOpt} style={{ height: 220 }} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 220, color: '#94A3B8', fontSize: 12, flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 20 }}>📊</span>SHAP 데이터 로딩 중…
              </div>
          }
        </ChartCard>
      </div>
    </div>
  )
}
