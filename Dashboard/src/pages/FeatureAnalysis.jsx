import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
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

function useFeatureData(topN = 20) {
  const { data, loading } = useCSV('/feature_importance.csv')

  const top = useMemo(() => {
    if (!data.length) return []
    return [...data]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, topN)
      .map(r => ({
        feature: r.feature,
        lgbm: parseFloat(r.lgbm_gain) || 0,
        et: parseFloat(r.et_impurity) || 0,
        enet: parseFloat(r.enet_abs_coef) || 0,
        lgbm_rank: parseFloat(r.lgbm_rank) || 999,
        et_rank: parseFloat(r.et_rank) || 999,
        enet_rank: parseFloat(r.enet_rank) || 999,
        lgbm_weak: r.lgbm_weak === 'True' || r.lgbm_weak === true,
        et_weak: r.et_weak === 'True' || r.et_weak === true,
        enet_zero: r.enet_zero === 'True' || r.enet_zero === true,
      }))
  }, [data, topN])

  return { top, loading }
}

/* ── Feature Importance ── */
export function ImportancePage() {
  const { top, loading } = useFeatureData(15)
  const { data: distData } = useCSV('/feature_dist.csv')
  const { data: unitData } = useCSV('/dashboard_units.csv')
  const [selectedFeat, setSelectedFeat] = useState(null)

  const topNames = useMemo(() => top.map(d => d.feature), [top])
  const lgbmVals = useMemo(() => top.map(d => d.lgbm), [top])

  // ufs_serial → risk 매핑 (예측값 기준 HIGH/MED/LOW)
  const riskMap = useMemo(() => {
    if (!unitData.length) return {}
    return Object.fromEntries(unitData.map(r => [r.ufs_serial, r.risk]))
  }, [unitData])

  // 박스플롯 통계 계산 (min, Q1, median, Q3, max)
  function boxStats(arr) {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    const n = s.length
    const q = p => {
      const idx = p * (n - 1)
      const lo = Math.floor(idx), hi = Math.ceil(idx)
      return s[lo] + (s[hi] - s[lo]) * (idx - lo)
    }
    return [s[0], q(0.25), q(0.5), q(0.75), s[n - 1]]
  }

  // 박스플롯 옵션
  const boxOpt = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(riskMap).length) return null
    const high  = distData.filter(r => riskMap[r.ufs_serial] === 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => riskMap[r.ufs_serial] !== 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const bHigh  = boxStats(high)
    const bOther = boxStats(other)
    if (!bHigh || !bOther) return null

    return {
      tooltip: {
        trigger: 'item',
        formatter: p => {
          const [mn, q1, med, q3, mx] = p.data
          return `${p.seriesName}<br/>최솟값: ${mn.toFixed(4)}<br/>Q1: ${q1.toFixed(4)}<br/>중앙값: ${med.toFixed(4)}<br/>Q3: ${q3.toFixed(4)}<br/>최댓값: ${mx.toFixed(4)}`
        }
      },
      grid: { top: 16, left: 70, right: 16, bottom: 24 },
      xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      yAxis: { type: 'category', data: ['저위험', '고위험'], axisLabel: { fontSize: 11, color: '#475569' } },
      series: [
        {
          name: '저위험(MED/LOW)', type: 'boxplot',
          data: [bOther],
          itemStyle: { color: 'rgba(59,130,246,.2)', borderColor: 'rgba(59,130,246,.9)', borderWidth: 2 },
        },
        {
          name: '고위험(HIGH)', type: 'boxplot',
          data: [bHigh],
          itemStyle: { color: 'rgba(239,68,68,.2)', borderColor: 'rgba(239,68,68,.9)', borderWidth: 2 },
        },
      ],
    }
  }, [distData, riskMap, selectedFeat])

  // 선택된 피처의 고위험/저위험 분포 (예측값 기준)
  const distOpt = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(riskMap).length) return null
    const high = distData.filter(r => riskMap[r.ufs_serial] === 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => riskMap[r.ufs_serial] !== 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    if (!high.length || !other.length) return null

    // 히스토그램 bin 생성
    const allVals = [...high, ...other]
    const mn = Math.min(...allVals), mx = Math.max(...allVals)
    const BINS = 30
    const step = (mx - mn) / BINS || 1
    const bins = Array.from({ length: BINS }, (_, i) => mn + i * step)

    function toBins(arr) {
      const counts = new Array(BINS).fill(0)
      arr.forEach(v => {
        const idx = Math.min(Math.floor((v - mn) / step), BINS - 1)
        counts[idx]++
      })
      return counts.map(c => +(c / arr.length * 100).toFixed(2))
    }

    return {
      tooltip: { trigger:'axis', formatter: p => `${selectedFeat} = ${p[0].name}<br/>고위험(HIGH): ${p[0].value}%<br/>저위험(MED/LOW): ${p[1]?.value ?? 0}%` },
      legend: { data:['고위험(HIGH)','저위험(MED/LOW)'], bottom:0, textStyle:{ fontSize:10 } },
      grid: { top:10, left:44, right:16, bottom:36 },
      xAxis: { type:'category', data: bins.map(b => b.toFixed(1)), axisLabel:{ fontSize:8, color:'#94A3B8', rotate:30 }, boundaryGap: false },
      yAxis: { type:'value', name:'비율(%)', nameTextStyle:{ fontSize:9, color:'#94A3B8' }, axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
      series: [
        {
          name:'고위험(HIGH)', type:'line', data: toBins(high),
          smooth: true, symbol:'none',
          lineStyle:{ color:'rgba(239,68,68,.9)', width:2 },
          areaStyle:{ color:'rgba(239,68,68,.15)' },
        },
        {
          name:'저위험(MED/LOW)', type:'line', data: toBins(other),
          smooth: true, symbol:'none',
          lineStyle:{ color:'rgba(59,130,246,.9)', width:2 },
          areaStyle:{ color:'rgba(59,130,246,.15)' },
        },
      ],
    }
  }, [distData, unitData, riskMap, selectedFeat])

  const reversedTopNames = useMemo(() => [...topNames].reverse(), [topNames])
  const reversedLgbmVals = useMemo(() => [...lgbmVals].reverse(), [lgbmVals])

  const BAR_COLORS = ['#3B82F6','#3B82F6','#3B82F6','#60A5FA','#60A5FA','#93C5FD','#93C5FD','#BFDBFE','#BFDBFE','#BFDBFE','#DBEAFE','#DBEAFE','#EFF6FF','#EFF6FF','#EFF6FF']

  const hbarOpt = useMemo(() => ({
    tooltip: { trigger:'item', formatter: p => `${p.name}<br/>LGBM Gain: ${Number(p.value).toExponential(3)}<br/>클릭하면 분포 확인` },
    grid: { top:10, left:66, right:60, bottom:10 },
    xAxis: { type:'value', axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    yAxis: { type:'category', data: reversedTopNames, axisLabel:{ fontSize:10, color:'#475569', fontFamily:'DM Mono,monospace' } },
    series: [{
      type:'bar',
      data: reversedLgbmVals.map((v, i) => {
        const feat = reversedTopNames[i]
        const isSelected = feat === selectedFeat
        return {
          value: v,
          itemStyle: {
            color: isSelected ? '#2563EB' : (BAR_COLORS[i] || '#DBEAFE'),
            borderColor: isSelected ? '#1E293B' : 'transparent',
            borderWidth: isSelected ? 2 : 0,
            borderRadius: [0,4,4,0],
          }
        }
      }),
      barMaxWidth:16,
      label:{ show:true, position:'right', fontSize:9, formatter: p => Number(p.value).toExponential(2), color:'#475569' },
    }],
  }), [reversedTopNames, reversedLgbmVals, selectedFeat])


  if (loading || !top.length) {
    return (
      <div className="feat-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>
        데이터 로딩 중…
      </div>
    )
  }

  const BOX_H = 140
  const HIST_H = 300

  return (
    <div className="feat-page">
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'stretch' }}>

        {/* 왼쪽: 막대차트 — 오른쪽 높이에 맞춰 늘어남 */}
        <div className="chart-card feat-left-card">
          <div className="cc-header">
            <div className="cc-title">🏆 LGBM Gain Top-15<span className="cc-tag">피처 클릭 → 분포 확인</span></div>
          </div>
          <div className="cc-body" style={{ display:'flex', flexDirection:'column', flex:1 }}>
            <div style={{ fontSize:11, color:'#64748B', marginBottom:6 }}>
              막대를 클릭하면 해당 피처의 <b>고위험/저위험 그룹 분포</b>를 오른쪽에서 확인할 수 있습니다.
            </div>
            <div style={{ flex:1, minHeight: HIST_H }}>
              <ReactECharts
                option={hbarOpt}
                style={{ height: '100%', minHeight: HIST_H }}
                onEvents={{
                  click: p => {
                    const feat = reversedTopNames[p.dataIndex]
                    if (feat) setSelectedFeat(feat)
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* 오른쪽: 히스토그램 + 박스플롯 */}
        {selectedFeat && distOpt ? (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <ChartCard title={`📉 ${selectedFeat} — 고위험 vs 저위험 분포`} tag="히스토그램">
              <div style={{ fontSize:11, color:'#64748B', marginBottom:6 }}>
                <span style={{ color:'#EF4444', fontWeight:600 }}>빨강</span> = 고위험(예측 HIGH) &nbsp;
                <span style={{ color:'#3B82F6', fontWeight:600 }}>파랑</span> = 저위험(예측 MED/LOW) &nbsp;
                — 두 분포가 벌어질수록 이 피처값이 위험도를 가르는 핵심 인자입니다.
              </div>
              <ReactECharts option={distOpt} style={{ height: HIST_H }} />
            </ChartCard>

            {boxOpt && (
              <ChartCard title="📦 박스플롯 비교" tag="중앙값·IQR">
                <ReactECharts option={boxOpt} style={{ height: BOX_H }} />
              </ChartCard>
            )}
          </div>
        ) : (
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            borderRadius:10, border:'2px dashed #E2E8F0',
            flexDirection:'column', gap:8, color:'#94A3B8', fontSize:12,
            minHeight: HIST_H,
          }}>
            <div style={{ fontSize:24 }}>👆</div>
            왼쪽 막대를 클릭하면<br/>분포가 여기에 표시됩니다
          </div>
        )}
      </div>
    </div>
  )
}

/* ── SHAP 분석 ── */
export function ShapPage() {
  const { data: barData, loading: barLoading } = useCSV('/shap_bar.csv')
  const { data: beeData, loading: beeLoading } = useCSV('/shap_beeswarm.csv')

  const topBar = useMemo(() => {
    if (!barData.length) return []
    return [...barData]
      .sort((a, b) => parseFloat(b.mean_abs_shap) - parseFloat(a.mean_abs_shap))
      .slice(0, 20)
      .map(r => ({
        feature: r.feature,
        shap: parseFloat(r.mean_abs_shap) || 0,
        rank: parseInt(r.rank) || 0,
      }))
  }, [barData])

  const beeswarmData = useMemo(() => {
    if (!beeData.length || !topBar.length) return []
    const top10Names = new Set(topBar.slice(0, 10).map(d => d.feature))
    return beeData
      .filter(r => top10Names.has(r.feature))
      .map(r => ({
        feature: r.feature,
        shap_value: parseFloat(r.shap_value) || 0,
        feat_norm: parseFloat(r.feat_norm) || 0,
        rank: parseInt(r.rank) || 0,
      }))
  }, [beeData, topBar])

  if (barLoading || beeLoading) {
    return (
      <div className="feat-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>
        데이터 로딩 중…
      </div>
    )
  }

  // SHAP Bar — Top-20 가로 막대
  const barNames = topBar.map(d => d.feature)
  const barVals  = topBar.map(d => d.shap)
  const shapBarOpt = {
    tooltip: { trigger:'axis', formatter: p => `${p[0].name}<br/>mean |SHAP|: ${topBar[topBar.length-1-p[0].dataIndex].shap.toFixed(5)}` },
    grid: { top:10, left:80, right:70, bottom:10 },
    xAxis: { type:'value', axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    yAxis: { type:'category', data:[...barNames].reverse(), axisLabel:{ fontSize:10, color:'#475569', fontFamily:'DM Mono,monospace' } },
    series: [{
      type:'bar', data:[...barVals].reverse(), barMaxWidth:16,
      itemStyle: {
        color: p => {
          const colors = ['#7C3AED','#7C3AED','#8B5CF6','#8B5CF6','#A78BFA','#A78BFA','#C4B5FD','#C4B5FD','#DDD6FE','#DDD6FE',
                          '#EDE9FE','#EDE9FE','#EDE9FE','#EDE9FE','#EDE9FE','#EDE9FE','#EDE9FE','#EDE9FE','#EDE9FE','#EDE9FE']
          return colors[p.dataIndex] || '#EDE9FE'
        },
        borderRadius:[0,4,4,0],
      },
      label:{ show:true, position:'right', fontSize:9, formatter: p => p.value.toExponential(2), color:'#475569' },
    }],
  }

  // Beeswarm 대체 — 피처별 SHAP 분포 scatter
  // x: shap_value, y: feature(rank 기준), color: feat_norm(피처값 크기)
  const top10Names = topBar.slice(0, 10).map(d => d.feature)
  const scatterSeries = top10Names.map((feat, i) => {
    const pts = beeswarmData.filter(d => d.feature === feat)
    return {
      name: feat,
      type: 'scatter',
      symbolSize: 4,
      data: pts.map(d => [d.shap_value, i, d.feat_norm]),
      itemStyle: {
        color: p => {
          const norm = p.data[2]
          if (norm > 0.66) return '#EF4444'
          if (norm > 0.33) return '#F97316'
          return '#3B82F6'
        },
        opacity: 0.6,
      },
    }
  })

  const beeOpt = {
    tooltip: {
      formatter: p => `${top10Names[p.data[1]]}<br/>SHAP: ${p.data[0].toFixed(4)}<br/>피처값(정규화): ${p.data[2].toFixed(2)}`
    },
    legend: { show: false },
    grid: { top:10, left:90, right:30, bottom:30 },
    xAxis: {
      type:'value', name:'SHAP value', nameTextStyle:{ fontSize:10, color:'#94A3B8' },
      axisLabel:{ fontSize:9, color:'#94A3B8' },
      splitLine:{ lineStyle:{ color:'#F1F5F9' } },
      axisLine:{ lineStyle:{ color:'#E2E8F0' } },
    },
    yAxis: {
      type:'value', min:-0.5, max:top10Names.length-0.5,
      axisLabel:{
        fontSize:10, color:'#475569', fontFamily:'DM Mono,monospace',
        formatter: v => top10Names[Math.round(v)] || '',
      },
      splitLine:{ show:false },
      axisTick:{ show:false },
    },
    series: scatterSeries,
  }

  return (
    <div className="feat-page">
      <div className="two-col" style={{ alignItems:'start' }}>
        <ChartCard title="📊 SHAP Bar — Top-20" tag="mean |SHAP| 기준">
          <div style={{ fontSize:11, color:'#64748B', marginBottom:6 }}>
            값이 클수록 health 예측을 크게 움직이는 WT 항목입니다.
          </div>
          <ReactECharts option={shapBarOpt} style={{ height:300 }} />
        </ChartCard>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'flex', gap:10 }}>
            {[
              { label:'분석 피처 수', value: barData.length, color:'#7C3AED' },
              { label:'Top-1 피처', value: topBar[0]?.feature ?? '-', color:'#7C3AED' },
              { label:'mean|SHAP|', value: topBar[0]?.shap.toFixed(4) ?? '-', color:'#7C3AED' },
            ].map((s, i) => (
              <div key={i} className="stat-card-feat" style={{ borderTop:`3px solid ${s.color}`, flex:1 }}>
                <div style={{ fontSize:i===1?12:18, fontWeight:700, fontFamily:'DM Mono,monospace', color:s.color }}>{s.value}</div>
                <div style={{ fontSize:10, color:'#64748B', marginTop:3 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <ChartCard title="🐝 Beeswarm — Top-10 피처별 분포" tag="unit별 기여도">
            <div style={{ fontSize:11, color:'#64748B', marginBottom:4 }}>
              <span style={{ color:'#EF4444' }}>●</span> 피처값 높음 &nbsp;
              <span style={{ color:'#3B82F6' }}>●</span> 낮음 &nbsp;
              오른쪽(+) = health↑, 왼쪽(-) = health↓
            </div>
            <ReactECharts option={beeOpt} style={{ height:240 }} />
          </ChartCard>
        </div>
      </div>
    </div>
  )
}
