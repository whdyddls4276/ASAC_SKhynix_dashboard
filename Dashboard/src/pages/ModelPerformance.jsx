import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './ModelPerformance.css'

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

function MetricCard({ label, value, color, sub, highlight }) {
  return (
    <div className="metric-card" style={{ borderColor: color + '44', background: highlight ? color + '08' : undefined }}>
      <div className="metric-val" style={{ color }}>{value}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  )
}

const BASELINE_RMSE = 0.0150  // 사내 최우수 기준

export default function ModelPerformance() {
  const { data: metricsRaw, loading: mLoading } = useCSV('/metrics.csv')
  const { data: scatterRaw, loading: sLoading }  = useCSV('/model_scatter.csv')

  // metrics 파싱
  const metrics = useMemo(() => {
    if (!metricsRaw.length) return null
    const get = (model, split) => {
      const row = metricsRaw.find(r => r.model === model && r.split === split)
      return row ? parseFloat(row.value) : null
    }
    return {
      lgbm_val:     get('lgbm', 'val'),
      lgbm_test:    get('lgbm', 'test'),
      et_val:       get('et', 'val'),
      et_test:      get('et', 'test'),
      enet_val:     get('enet', 'val'),
      enet_test:    get('enet', 'test'),
      ensemble_oof: get('ensemble', 'oof'),
      ensemble_val: get('ensemble', 'val'),
    }
  }, [metricsRaw])

  // scatter 데이터
  const scatterData = useMemo(() => {
    if (!scatterRaw.length) return []
    return scatterRaw.map(r => [
      parseFloat(r.health) || 0,
      parseFloat(r.reg_pred) || 0,
    ])
  }, [scatterRaw])

  if (mLoading || sLoading || !metrics) {
    return <div className="model-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8' }}>데이터 로딩 중…</div>
  }

  const bestVal  = metrics.ensemble_val
  const beatBase = bestVal < BASELINE_RMSE
  const improvement = (((BASELINE_RMSE - bestVal) / BASELINE_RMSE) * 100).toFixed(1)

  // 모델별 비교 바차트
  const models = ['LGBM', 'ET', 'ElasticNet', 'Ensemble']
  const valRmse  = [metrics.lgbm_val, metrics.et_val, metrics.enet_val, metrics.ensemble_val]
  const testRmse = [metrics.lgbm_test, metrics.et_test, metrics.enet_test, null]

  const barOpt = {
    tooltip: { trigger: 'axis', formatter: p =>
      `<b>${p[0].axisValue}</b><br/>` +
      p.filter(s => s.value != null).map(s => `${s.seriesName}: ${s.value?.toFixed(6)}`).join('<br/>')
    },
    legend: { data:['Val RMSE','Test RMSE'], bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    grid: { top:16, left:54, right:20, bottom:44 },
    xAxis: { type:'category', data:models, axisLabel:{ fontSize:12, color:'#475569', fontWeight:600 } },
    yAxis: {
      type:'value', name:'RMSE', nameTextStyle:{ fontSize:10, color:'#94A3B8' },
      axisLabel:{ fontSize:9, color:'#94A3B8' },
      splitLine:{ lineStyle:{ color:'#F1F5F9' } },
      min: v => parseFloat((v.min * 0.97).toFixed(6)),
    },
    series: [
      { name:'Val RMSE', type:'bar', data:valRmse, barMaxWidth:36,
        itemStyle:{ color: p => p.dataIndex === 3 ? '#3B82F6' : 'rgba(59,130,246,.45)', borderRadius:[4,4,0,0] },
        label:{ show:true, position:'top', fontSize:9, formatter: p => p.value?.toFixed(5), color:'#475569' } },
      { name:'Test RMSE', type:'bar', data:testRmse, barMaxWidth:36,
        itemStyle:{ color:'rgba(249,115,22,.6)', borderRadius:[4,4,0,0] },
        label:{ show:true, position:'top', fontSize:9, formatter: p => p.value != null ? p.value.toFixed(5) : '', color:'#475569' } },
    ],
    markLine: {
      silent: true,
      data:[{ yAxis: BASELINE_RMSE, lineStyle:{ color:'#EF4444', type:'dashed', width:2 },
        label:{ formatter:`기준 ${BASELINE_RMSE}`, color:'#EF4444', fontSize:10, position:'end' } }]
    }
  }

  // 실제 vs 예측 scatter
  const maxVal = Math.max(...scatterData.map(d => Math.max(d[0], d[1])), 0.01)
  const scatterOpt = {
    tooltip: { formatter: p => `실제: ${p.data[0].toFixed(6)}<br/>예측: ${p.data[1].toFixed(6)}` },
    grid: { top:20, left:60, right:20, bottom:44 },
    xAxis: { type:'value', name:'실제값 (health)', nameTextStyle:{ fontSize:10, color:'#94A3B8' },
      axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } }, max: maxVal },
    yAxis: { type:'value', name:'예측값 (reg_pred)', nameTextStyle:{ fontSize:10, color:'#94A3B8' },
      axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } }, max: maxVal },
    series: [
      { type:'line', data:[[0,0],[maxVal,maxVal]],
        lineStyle:{ color:'#94A3B8', type:'dashed', width:1 }, symbol:'none', silent:true },
      { name:'예측', type:'scatter', data:scatterData, symbolSize:5,
        itemStyle:{ color: p => p.data[0] > 0 ? 'rgba(239,68,68,.6)' : 'rgba(59,130,246,.3)' } },
    ],
  }

  // 예측값 분포 히스토그램
  const predVals = scatterData.map(d => d[1])
  const maxPred  = Math.max(...predVals)
  const BIN_N    = 24
  const binSize  = maxPred / BIN_N
  const bins     = Array.from({ length: BIN_N }, (_, i) => i * binSize)
  const histCounts = bins.map((b, i) => {
    const next = i === BIN_N - 1 ? Infinity : bins[i+1]
    return predVals.filter(v => v >= b && v < next).length
  })

  const histOpt = {
    tooltip: { trigger:'axis', formatter: p => `구간 ${parseFloat(p[0].name).toFixed(5)}<br/>건수: ${p[0].value}` },
    grid: { top:10, left:50, right:20, bottom:40 },
    xAxis: { type:'category', data:bins.map(b=>b.toFixed(4)),
      axisLabel:{ fontSize:8, color:'#94A3B8', interval:5 } },
    yAxis: { type:'value', axisLabel:{ fontSize:10, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    series: [{
      type:'bar', data:histCounts, barGap:'-100%',
      itemStyle:{ color: p => p.dataIndex === 0 ? 'rgba(34,197,94,.75)' : 'rgba(59,130,246,.65)', borderRadius:[3,3,0,0] },
    }],
  }

  return (
    <div className="model-page">
      {/* RMSE 카드 */}
      <div className="metric-row">
        <MetricCard label="Ensemble Val RMSE" value={bestVal.toFixed(6)}   color="#3B82F6" sub="최종 앙상블 모델" highlight />
        <MetricCard label="LGBM Val RMSE"      value={metrics.lgbm_val.toFixed(6)}  color="#8B5CF6" sub="LightGBM 단독" />
        <MetricCard label="ET Val RMSE"        value={metrics.et_val.toFixed(6)}    color="#06B6D4" sub="ExtraTrees 단독" />
        <MetricCard
          label={beatBase ? '기준 대비 개선' : '기준 RMSE'}
          value={beatBase ? `-${improvement}%` : BASELINE_RMSE.toFixed(4)}
          color={beatBase ? '#22C55E' : '#EF4444'}
          sub={beatBase ? `기준 ${BASELINE_RMSE} 달성 ✓` : '사내 최우수 기준'}
        />
      </div>

      {/* 모델 비교 바 + scatter */}
      <div className="two-col">
        <ChartCard title="📊 모델별 RMSE 비교" tag="Val / Test · 빨간선=기준">
          <ReactECharts option={barOpt} style={{ height:240 }} />
        </ChartCard>
        <ChartCard title="🎯 실제 vs 예측값 산점도" tag="train OOF 500개 샘플">
          <div style={{ fontSize:11, color:'#94A3B8', marginBottom:6 }}>
            <span style={{ color:'#EF4444' }}>●</span> 불량(health&gt;0) &nbsp;
            <span style={{ color:'#3B82F6' }}>●</span> 정상(health=0) &nbsp;·&nbsp; 점선 = 완벽 예측
          </div>
          <ReactECharts option={scatterOpt} style={{ height:210 }} />
        </ChartCard>
      </div>

      {/* 히스토그램 */}
      <ChartCard title="📉 예측값 분포" tag="reg_pred · Zero-inflated 확인">
        <div style={{ fontSize:11, color:'#94A3B8', marginBottom:6 }}>
          <span style={{ color:'#22C55E', fontWeight:600 }}>초록</span> = 정상(y≈0) 구간 &nbsp;·&nbsp;
          <span style={{ color:'#3B82F6', fontWeight:600 }}>파랑</span> = 양수 예측 구간 &nbsp;·&nbsp;
          Zero-inflated 분포 반영 확인
        </div>
        <ReactECharts option={histOpt} style={{ height:200 }} />
      </ChartCard>

      {/* 상세 테이블 */}
      <ChartCard title="📋 모델별 RMSE 상세" tag="실데이터">
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr>
              {['모델','Val RMSE','Test RMSE','기준 대비'].map(h => (
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:10, fontWeight:600,
                  color:'#94A3B8', borderBottom:'1.5px solid #E2E8F0', background:'#F8FAFC',
                  textTransform:'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { name:'LGBM',      val: metrics.lgbm_val,     test: metrics.lgbm_test,  color:'#8B5CF6' },
              { name:'ExtraTrees',val: metrics.et_val,       test: metrics.et_test,    color:'#06B6D4' },
              { name:'ElasticNet',val: metrics.enet_val,     test: metrics.enet_test,  color:'#F97316' },
              { name:'Ensemble ⭐',val: metrics.ensemble_val, test: null,               color:'#3B82F6' },
            ].map((m, i) => {
              const beat = m.val < BASELINE_RMSE
              const diff = (((BASELINE_RMSE - m.val) / BASELINE_RMSE) * 100).toFixed(1)
              return (
                <tr key={i} style={{ background: i===3 ? 'rgba(59,130,246,.04)' : undefined }}>
                  <td style={{ padding:'10px 12px', fontWeight:700, color:m.color }}>{m.name}</td>
                  <td style={{ padding:'10px 12px', fontFamily:'DM Mono,monospace',
                    color: m.val < BASELINE_RMSE ? '#22C55E' : '#EF4444', fontWeight:600 }}>
                    {m.val.toFixed(6)}
                  </td>
                  <td style={{ padding:'10px 12px', fontFamily:'DM Mono,monospace', color:'#64748B' }}>
                    {m.test != null ? m.test.toFixed(6) : '—'}
                  </td>
                  <td style={{ padding:'10px 12px', fontFamily:'DM Mono,monospace',
                    fontWeight:700, color: beat ? '#22C55E' : '#EF4444' }}>
                    {beat ? `-${diff}%` : `+${Math.abs(parseFloat(diff))}%`}
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
