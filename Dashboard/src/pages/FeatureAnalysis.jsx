import { useMemo } from 'react'
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

/* ── SHAP / Importance 분석 ── */
export function ShapPage() {
  const { top, loading } = useFeatureData(15)

  if (loading || !top.length) {
    return (
      <div className="feat-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>
        데이터 로딩 중…
      </div>
    )
  }

  // LGBM Gain 기준 Top-15
  const topNames = top.map(d => d.feature)
  const lgbmVals = top.map(d => d.lgbm)
  const etVals   = top.map(d => d.et)
  const enetVals = top.map(d => d.enet)

  // normalize for display (max=1 scale per model)
  const maxLgbm = Math.max(...lgbmVals) || 1
  const maxEt   = Math.max(...etVals) || 1
  const maxEnet = Math.max(...enetVals) || 1

  const importanceOpt = {
    tooltip: {
      trigger: 'axis',
      formatter: params => {
        const idx = params[0].dataIndex
        const d = top[idx]
        return `<b>${d.feature}</b><br/>LGBM Gain: ${d.lgbm.toFixed(5)}<br/>ET Impurity: ${d.et.toFixed(5)}<br/>ElasticNet Coef: ${d.enet.toFixed(5)}`
      }
    },
    legend: { data:['LGBM Gain','ET Impurity','ElasticNet'], bottom:0, textStyle:{ fontSize:10, color:'#475569' } },
    grid: { top:10, left:66, right:20, bottom:44 },
    xAxis: { type:'category', data:topNames, axisLabel:{ fontSize:9, color:'#475569', fontFamily:'DM Mono,monospace', rotate:30 } },
    yAxis: { type:'value', name:'정규화 중요도', nameTextStyle:{ fontSize:9, color:'#94A3B8' }, axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    series: [
      { name:'LGBM Gain',   type:'bar', data:lgbmVals.map(v=>+(v/maxLgbm).toFixed(4)), barGap:'5%', barMaxWidth:14, itemStyle:{ color:'rgba(59,130,246,.85)', borderRadius:[3,3,0,0] } },
      { name:'ET Impurity', type:'bar', data:etVals.map(v=>+(v/maxEt).toFixed(4)),      barMaxWidth:14, itemStyle:{ color:'rgba(34,197,94,.75)', borderRadius:[3,3,0,0] } },
      { name:'ElasticNet',  type:'bar', data:enetVals.map(v=>+(v/maxEnet).toFixed(4)),  barMaxWidth:14, itemStyle:{ color:'rgba(249,115,22,.75)', borderRadius:[3,3,0,0] } },
    ],
  }

  // 순위 비교 (radar) — top 7
  const top7 = top.slice(0, 7)
  const radarIndicator = top7.map(d => ({ name: d.feature, max: Math.max(d.lgbm_rank, d.et_rank, d.enet_rank, 10) + 5 }))
  const radarOpt = {
    tooltip: {},
    legend: { data:['LGBM 순위','ET 순위','ElasticNet 순위'], bottom:0, textStyle:{ fontSize:10, color:'#475569' } },
    radar: { indicator: radarIndicator, radius:'58%' },
    series: [{
      type:'radar',
      data: [
        { value: top7.map(d => d.lgbm_rank),  name:'LGBM 순위',      areaStyle:{ color:'rgba(59,130,246,.1)' },  lineStyle:{ color:'#3B82F6' }, itemStyle:{ color:'#3B82F6' } },
        { value: top7.map(d => d.et_rank),    name:'ET 순위',         areaStyle:{ color:'rgba(34,197,94,.1)' },   lineStyle:{ color:'#22C55E' }, itemStyle:{ color:'#22C55E' } },
        { value: top7.map(d => d.enet_rank),  name:'ElasticNet 순위', areaStyle:{ color:'rgba(249,115,22,.1)' },  lineStyle:{ color:'#F97316' }, itemStyle:{ color:'#F97316' } },
      ],
    }],
  }

  // 수평 바 — LGBM Gain Top 15 (상세 순위)
  const hbarOpt = {
    tooltip: { trigger:'axis', formatter: p => `${p[0].name}<br/>LGBM Gain: ${top[top.length-1-p[0].dataIndex].lgbm.toExponential(3)}` },
    grid: { top:10, left:66, right:60, bottom:10 },
    xAxis: { type:'value', axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    yAxis: { type:'category', data:[...topNames].reverse(), axisLabel:{ fontSize:10, color:'#475569', fontFamily:'DM Mono,monospace' } },
    series: [{
      type:'bar', data:[...lgbmVals].reverse(), barMaxWidth:16,
      itemStyle: {
        color: p => {
          const colors = ['#3B82F6','#3B82F6','#3B82F6','#60A5FA','#60A5FA','#93C5FD','#93C5FD','#BFDBFE','#BFDBFE','#BFDBFE','#DBEAFE','#DBEAFE','#EFF6FF','#EFF6FF','#EFF6FF']
          return colors[p.dataIndex] || '#DBEAFE'
        },
        borderRadius:[0,4,4,0],
      },
      label:{ show:true, position:'right', fontSize:9, formatter: p => p.value.toExponential(2), color:'#475569' },
    }],
  }

  return (
    <div className="feat-page">
      <div className="two-col">
        <ChartCard title="📊 Feature Importance — 3종 모델 비교" tag="정규화 기준">
          <ReactECharts option={importanceOpt} style={{ height:260 }} />
        </ChartCard>
        <ChartCard title="📡 Top-7 순위 레이더" tag="모델별 rank">
          <ReactECharts option={radarOpt} style={{ height:260 }} />
        </ChartCard>
      </div>
      <ChartCard title="🏆 LGBM Gain Top-15 (상세)" tag="내림차순">
        <ReactECharts option={hbarOpt} style={{ height:320 }} />
      </ChartCard>
      <ChartCard title="📋 Feature 상세 테이블" tag="Top-15">
        <table className="feat-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>LGBM Gain</th><th>LGBM Rank</th>
              <th>ET Impurity</th><th>ET Rank</th>
              <th>ElasticNet</th><th>Enet Rank</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {top.slice(0, 15).map((d, i) => {
              const good = !d.lgbm_weak && !d.et_weak && !d.enet_zero
              return (
                <tr key={i}>
                  <td style={{ fontFamily:'DM Mono,monospace', fontWeight:600 }}>{d.feature}</td>
                  <td style={{ fontFamily:'DM Mono,monospace', color:'#3B82F6' }}>{d.lgbm.toExponential(3)}</td>
                  <td style={{ fontFamily:'DM Mono,monospace' }}>#{Math.round(d.lgbm_rank)}</td>
                  <td style={{ fontFamily:'DM Mono,monospace', color:'#22C55E' }}>{d.et.toExponential(3)}</td>
                  <td style={{ fontFamily:'DM Mono,monospace' }}>#{Math.round(d.et_rank)}</td>
                  <td style={{ fontFamily:'DM Mono,monospace', color:'#F97316' }}>{d.enet.toExponential(3)}</td>
                  <td style={{ fontFamily:'DM Mono,monospace' }}>#{Math.round(d.enet_rank)}</td>
                  <td>
                    <span style={{ fontSize:9, padding:'2px 6px', borderRadius:3, fontWeight:600,
                      background: good ? '#F0FDF4' : '#FEF2F2',
                      color: good ? '#22C55E' : '#EF4444' }}>
                      {good ? 'STRONG' : 'WEAK'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ChartCard>
    </div>
  )
}

/* ── Feature 개별 분포 ── */
export function ImportancePage() {
  const { top, loading } = useFeatureData(30)

  if (loading || !top.length) {
    return (
      <div className="feat-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>
        데이터 로딩 중…
      </div>
    )
  }

  // 모델 간 순위 일치도 scatter (lgbm_rank vs et_rank)
  const rankScatterOpt = {
    tooltip: { formatter: p => `${p.data[2]}<br/>LGBM rank: #${Math.round(p.data[0])}<br/>ET rank: #${Math.round(p.data[1])}` },
    grid: { top:20, left:52, right:20, bottom:40 },
    xAxis: { type:'value', name:'LGBM Rank', nameTextStyle:{ fontSize:10, color:'#94A3B8' }, axisLabel:{ fontSize:10, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    yAxis: { type:'value', name:'ET Rank', nameTextStyle:{ fontSize:10, color:'#94A3B8' }, axisLabel:{ fontSize:10, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    series: [{
      type:'scatter', symbolSize:6,
      data: top.map(d => [d.lgbm_rank, d.et_rank, d.feature]),
      itemStyle:{ color: p => {
        const diff = Math.abs(p.data[0] - p.data[1])
        if (diff < 20) return '#22C55E'
        if (diff < 60) return '#3B82F6'
        return '#EF4444'
      }, opacity:0.75 },
    }],
  }

  // LGBM Gain vs ET Impurity scatter
  const gainImpScatterOpt = {
    tooltip: { formatter: p => `${p.data[2]}<br/>LGBM Gain: ${p.data[0].toExponential(3)}<br/>ET Impurity: ${p.data[1].toExponential(3)}` },
    grid: { top:20, left:60, right:20, bottom:40 },
    xAxis: { type:'value', name:'LGBM Gain', nameTextStyle:{ fontSize:10, color:'#94A3B8' }, axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    yAxis: { type:'value', name:'ET Impurity', nameTextStyle:{ fontSize:10, color:'#94A3B8' }, axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    series: [{
      type:'scatter', symbolSize:5,
      data: top.map(d => [d.lgbm, d.et, d.feature]),
      itemStyle:{ color:'rgba(59,130,246,.6)' },
    }],
  }

  // 3모델 모두 강한 피처 카운트
  const allStrong = top.filter(d => !d.lgbm_weak && !d.et_weak && !d.enet_zero).length
  const twoStrong = top.filter(d => {
    const weak = [d.lgbm_weak, d.et_weak, d.enet_zero].filter(Boolean).length
    return weak === 1
  }).length
  const oneOrLess = top.length - allStrong - twoStrong

  const consensusPie = {
    tooltip: { trigger:'item', formatter:'{b}: {c}개 ({d}%)' },
    legend: { bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    series: [{
      type:'pie', radius:['40%','68%'], center:['50%','45%'],
      data:[
        { value:allStrong, name:'3모델 합의', itemStyle:{ color:'#22C55E' } },
        { value:twoStrong, name:'2모델 합의', itemStyle:{ color:'#F97316' } },
        { value:oneOrLess, name:'1모델 이하', itemStyle:{ color:'#EF4444' } },
      ],
      label:{ show:false },
      emphasis:{ label:{ show:true, fontSize:12, fontWeight:'bold' } },
    }],
  }

  return (
    <div className="feat-page">
      <div className="stat-row-feat">
        {[
          { label:'분석 피처 수', value:top.length, color:'#3B82F6' },
          { label:'3모델 합의 Strong', value:allStrong, color:'#22C55E' },
          { label:'2모델 합의', value:twoStrong, color:'#F97316' },
          { label:'약신호 (1모델↓)', value:oneOrLess, color:'#EF4444' },
        ].map((s, i) => (
          <div key={i} className="stat-card-feat" style={{ borderTop:`3px solid ${s.color}` }}>
            <div style={{ fontSize:22, fontWeight:700, fontFamily:'DM Mono,monospace', color:s.color }}>{s.value}</div>
            <div style={{ fontSize:11, color:'#64748B', marginTop:3 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className="two-col">
        <ChartCard title="🎯 모델 간 순위 일치도" tag="LGBM rank vs ET rank">
          <div style={{ fontSize:11, color:'#94A3B8', marginBottom:6 }}>
            <span style={{ color:'#22C55E' }}>●</span> 순위 차 &lt;20 (일치) &nbsp;
            <span style={{ color:'#3B82F6' }}>●</span> 20-60 &nbsp;
            <span style={{ color:'#EF4444' }}>●</span> 60 이상 (불일치)
          </div>
          <ReactECharts option={rankScatterOpt} style={{ height:240 }} />
        </ChartCard>
        <ChartCard title="📊 3모델 합의 현황" tag={`Top-${top.length} 피처`}>
          <ReactECharts option={consensusPie} style={{ height:240 }} />
        </ChartCard>
      </div>
      <ChartCard title="🔵 LGBM Gain vs ET Impurity 상관" tag="scatter">
        <div style={{ fontSize:11, color:'#94A3B8', marginBottom:6 }}>
          두 모델이 공통으로 높게 평가하는 피처일수록 우상단에 위치 → 더 신뢰할 수 있는 중요 피처
        </div>
        <ReactECharts option={gainImpScatterOpt} style={{ height:240 }} />
      </ChartCard>
    </div>
  )
}
