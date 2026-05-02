import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './DateAnalysis.css'

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

function StatCard({ label, value, color, sub }) {
  return (
    <div className="stat-card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="stat-val" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function useDateData() {
  const { data, loading } = useCSV('/dashboard_dates.csv')

  const parsed = useMemo(() => {
    if (!data.length) return null

    const bySplit = { train: [], val: [], test: [] }
    for (const r of data) {
      const sp = r.split
      if (bySplit[sp]) bySplit[sp].push({
        date: r.date,
        total: parseInt(r.total) || 0,
        defect: parseInt(r.defect) || 0,
        defect_rate: parseFloat(r.defect_rate) || 0,
        health_mean: parseFloat(r.health_mean) || 0,
        proba_mean: parseFloat(r.proba_mean) || 0,
      })
    }
    for (const sp of Object.keys(bySplit)) {
      bySplit[sp].sort((a, b) => a.date.localeCompare(b.date))
    }

    // 월별 집계 (train)
    const monthAgg = {}
    for (const r of bySplit.train) {
      const m = r.date.slice(0, 7)
      if (!monthAgg[m]) monthAgg[m] = { month: m, total: 0, defect: 0, proba_sum: 0, cnt: 0 }
      monthAgg[m].total    += r.total
      monthAgg[m].defect   += r.defect
      monthAgg[m].proba_sum += r.proba_mean
      monthAgg[m].cnt      += 1
    }
    const monthList = Object.values(monthAgg)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({
        ...m,
        defect_rate: m.total ? parseFloat((m.defect / m.total * 100).toFixed(2)) : 0,
        proba_mean:  m.cnt   ? parseFloat((m.proba_sum / m.cnt).toFixed(4)) : 0,
      }))

    return { bySplit, monthList }
  }, [data])

  return { parsed, loading }
}

/* ── 일별: train 138일 가로 스크롤 + val/test 일별 ── */
export function DailyPage() {
  const { parsed, loading } = useDateData()

  if (loading || !parsed) {
    return <div className="date-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8' }}>데이터 로딩 중…</div>
  }

  const { bySplit } = parsed
  const trainDates  = bySplit.train.map(r => r.date)
  const trainRates  = bySplit.train.map(r => r.defect_rate)
  const trainCounts = bySplit.train.map(r => r.defect)

  const valTest  = [...bySplit.val, ...bySplit.test].sort((a, b) => a.date.localeCompare(b.date))
  const vtDates  = valTest.map(r => r.date)

  const totalTrainDefect = bySplit.train.reduce((s, r) => s + r.defect, 0)
  const avgRate = bySplit.train.length
    ? (bySplit.train.reduce((s, r) => s + r.defect_rate, 0) / bySplit.train.length).toFixed(1)
    : '0'
  const maxRow = bySplit.train.reduce((a, b) => a.defect_rate > b.defect_rate ? a : b, bySplit.train[0] || {})
  const recentRate = bySplit.test.length
    ? (bySplit.test.reduce((s, r) => s + r.defect_rate, 0) / bySplit.test.length).toFixed(1)
    : '0'

  // Train 138일 — dataZoom 스크롤
  const trainScrollOpt = {
    tooltip: { trigger:'axis', formatter: params =>
      `<b>${params[0]?.axisValue}</b><br/>` +
      params.map(p => `${p.seriesName}: ${p.value}${p.seriesName.includes('불량률') ? '%' : '건'}`).join('<br/>')
    },
    legend: { data:['불량 unit','불량률(%)'], bottom:36, textStyle:{ fontSize:11, color:'#475569' } },
    dataZoom: [
      { type:'slider', bottom:8, height:18, start:0, end:30,
        textStyle:{ fontSize:9, color:'#94A3B8' }, borderColor:'#E2E8F0', fillerColor:'rgba(59,130,246,.1)' },
      { type:'inside', start:0, end:30 },
    ],
    grid: { top:16, left:52, right:52, bottom:80 },
    xAxis: { type:'category', data:trainDates,
      axisLabel:{ fontSize:9, color:'#94A3B8', rotate:30 },
      axisLine:{ lineStyle:{ color:'#E2E8F0' } } },
    yAxis: [
      { type:'value', name:'불량 unit', nameTextStyle:{ fontSize:10, color:'#3B82F6' },
        axisLabel:{ fontSize:10, color:'#3B82F6' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
      { type:'value', name:'불량률(%)', nameTextStyle:{ fontSize:10, color:'#EF4444' },
        axisLabel:{ fontSize:10, color:'#EF4444', formatter:'{value}%' }, position:'right' },
    ],
    series: [
      { name:'불량 unit', type:'bar', data:trainCounts, barMaxWidth:12,
        itemStyle:{ color:'rgba(59,130,246,.65)', borderRadius:[2,2,0,0] } },
      { name:'불량률(%)', type:'line', yAxisIndex:1, data:trainRates,
        smooth:true, symbol:'none',
        lineStyle:{ color:'#EF4444', width:2 },
        areaStyle:{ color:'rgba(239,68,68,.06)' } },
    ],
  }

  // Val + Test 일별
  const vtOpt = {
    tooltip: { trigger:'axis', formatter: params =>
      `<b>${params[0]?.axisValue}</b><br/>` +
      params.filter(p => p.value != null).map(p => `${p.seriesName}: ${p.value}`).join('<br/>')
    },
    legend: { data:['불량률(%)','clf_proba'], bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    grid: { top:16, left:52, right:52, bottom:44 },
    xAxis: { type:'category', data:vtDates, axisLabel:{ fontSize:11, color:'#475569' } },
    yAxis: [
      { type:'value', name:'불량률(%)', axisLabel:{ fontSize:10, color:'#8B5CF6', formatter:'{value}%' },
        splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
      { type:'value', name:'clf_proba', axisLabel:{ fontSize:10, color:'#F97316' }, position:'right' },
    ],
    series: [
      { name:'불량률(%)', type:'bar', data:valTest.map(r => r.defect_rate), barMaxWidth:40,
        itemStyle:{ color: p => p.dataIndex < bySplit.val.length ? 'rgba(139,92,246,.8)' : 'rgba(6,182,212,.8)',
          borderRadius:[3,3,0,0] },
        label:{ show:true, position:'top', fontSize:11, formatter:'{c}%', color:'#475569' } },
      { name:'clf_proba', type:'line', yAxisIndex:1, data:valTest.map(r => r.proba_mean.toFixed(4)),
        smooth:true, symbol:'circle', symbolSize:8,
        lineStyle:{ color:'#F97316', width:2 }, itemStyle:{ color:'#F97316' } },
    ],
  }

  return (
    <div className="date-page">
      <div className="stat-row">
        <StatCard label="Train 총 불량 unit" value={totalTrainDefect.toLocaleString()} color="#3B82F6" sub="2025-10 ~ 2026-04-10" />
        <StatCard label="일평균 불량률"      value={`${avgRate}%`}                     color="#8B5CF6" sub="Train 138일 평균" />
        <StatCard label="최고 불량일"        value={maxRow?.date?.slice(5) || '-'}      color="#EF4444" sub={`${maxRow?.defect_rate ?? 0}%`} />
        <StatCard label="최근 Test 불량률"   value={`${recentRate}%`}                  color="#06B6D4" sub="04/21~04/24 평균" />
      </div>

      <ChartCard title="📅 Train 일별 불량 추이" tag="2025-10 ~ 2026-04-10 · 드래그로 범위 조절">
        <div style={{ fontSize:11, color:'#94A3B8', marginBottom:6 }}>
          막대 = 불량 unit 수 &nbsp;·&nbsp; 빨간선 = 불량률(%) &nbsp;·&nbsp;
          <span style={{ color:'#3B82F6', fontWeight:600 }}>하단 슬라이더로 기간 조절</span>
        </div>
        <ReactECharts option={trainScrollOpt} style={{ height:280 }} />
      </ChartCard>

      <ChartCard title="🔍 Val · Test 일별 불량률" tag="결과 미확정 · 최근 2주">
        <div style={{ fontSize:11, color:'#94A3B8', marginBottom:6 }}>
          <span style={{ color:'#8B5CF6' }}>■</span> Val (04/14~04/17) &nbsp;
          <span style={{ color:'#06B6D4' }}>■</span> Test (04/21~04/24) &nbsp;·&nbsp;
          주황선 = 평균 clf_proba
        </div>
        <ReactECharts option={vtOpt} style={{ height:220 }} />
      </ChartCard>
    </div>
  )
}

/* ── 월별 ── */
export function MonthlyPage() {
  const { parsed, loading } = useDateData()

  if (loading || !parsed) {
    return <div className="date-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8' }}>데이터 로딩 중…</div>
  }

  const { monthList } = parsed
  const months      = monthList.map(m => m.month)
  const monthRates  = monthList.map(m => m.defect_rate)
  const monthCounts = monthList.map(m => m.defect)

  const peakMonth   = monthList.reduce((a, b) => a.defect_rate > b.defect_rate ? a : b, monthList[0] || {})
  const lowestMonth = monthList.reduce((a, b) => a.defect_rate < b.defect_rate ? a : b, monthList[0] || {})
  const totalDefect = monthList.reduce((s, m) => s + m.defect, 0)
  const avgRate     = monthList.length
    ? (monthList.reduce((s, m) => s + m.defect_rate, 0) / monthList.length).toFixed(1)
    : '0'

  const barOpt = {
    tooltip: { trigger:'axis', formatter: params =>
      `<b>${params[0].axisValue}</b><br/>` +
      params.map(p => `${p.seriesName}: ${p.value}${p.seriesName.includes('불량률') ? '%' : '건'}`).join('<br/>')
    },
    legend: { data:['불량 unit','불량률(%)'], bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    grid: { top:16, left:52, right:52, bottom:44 },
    xAxis: { type:'category', data:months, axisLabel:{ fontSize:11, color:'#475569' } },
    yAxis: [
      { type:'value', name:'불량 unit', nameTextStyle:{ fontSize:10, color:'#3B82F6' },
        axisLabel:{ fontSize:10, color:'#3B82F6' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
      { type:'value', name:'불량률(%)', nameTextStyle:{ fontSize:10, color:'#EF4444' },
        axisLabel:{ fontSize:10, color:'#EF4444', formatter:'{value}%' }, position:'right' },
    ],
    series: [
      { name:'불량 unit', type:'bar', data:monthCounts, barMaxWidth:44,
        itemStyle:{ color: p => {
          const colors = ['#93C5FD','#60A5FA','#3B82F6','#2563EB','#1D4ED8','#1E40AF','#172554']
          return colors[p.dataIndex % colors.length]
        }, borderRadius:[4,4,0,0] },
        label:{ show:true, position:'top', fontSize:10, formatter:'{c}건', color:'#475569' } },
      { name:'불량률(%)', type:'line', yAxisIndex:1, data:monthRates,
        smooth:true, symbol:'circle', symbolSize:8,
        lineStyle:{ color:'#EF4444', width:2.5 }, itemStyle:{ color:'#EF4444' },
        label:{ show:true, position:'top', fontSize:10, formatter:'{c}%', color:'#EF4444' } },
    ],
  }

  const probaOpt = {
    tooltip: { trigger:'axis', formatter: params =>
      `<b>${params[0].axisValue}</b><br/>평균 clf_proba: ${params[0].value}`
    },
    grid: { top:16, left:52, right:20, bottom:36 },
    xAxis: { type:'category', data:months, axisLabel:{ fontSize:11, color:'#475569' } },
    yAxis: { type:'value', name:'평균 clf_proba', nameTextStyle:{ fontSize:10, color:'#94A3B8' },
      axisLabel:{ fontSize:10, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    series: [{
      type:'line', data:monthList.map(m => m.proba_mean), smooth:true,
      symbol:'circle', symbolSize:8,
      lineStyle:{ color:'#F97316', width:2.5 }, itemStyle:{ color:'#F97316' },
      areaStyle:{ color:'rgba(249,115,22,.08)' },
      label:{ show:true, position:'top', fontSize:9, formatter:'{c}', color:'#F97316' },
    }],
  }

  return (
    <div className="date-page">
      <div className="stat-row">
        <StatCard label="총 불량 unit (Train)" value={totalDefect.toLocaleString()} color="#3B82F6" sub="2025-10 ~ 2026-04" />
        <StatCard label="월평균 불량률"         value={`${avgRate}%`}               color="#8B5CF6" sub="Train 기준" />
        <StatCard label="불량 최고 월"          value={peakMonth?.month || '-'}      color="#EF4444" sub={`${peakMonth?.defect_rate ?? 0}%`} />
        <StatCard label="불량 최저 월"          value={lowestMonth?.month || '-'}    color="#22C55E" sub={`${lowestMonth?.defect_rate ?? 0}%`} />
      </div>

      <ChartCard title="📅 월별 불량 unit 수 + 불량률" tag="Train · 2025-10 ~ 2026-04">
        <ReactECharts option={barOpt} style={{ height:260 }} />
      </ChartCard>

      <ChartCard title="📈 월별 평균 clf_proba 추이" tag="모델 예측 확률">
        <div style={{ fontSize:11, color:'#94A3B8', marginBottom:6 }}>
          불량률이 높은 달에 clf_proba도 높으면 모델 예측이 실제 패턴을 잘 반영하는 것
        </div>
        <ReactECharts option={probaOpt} style={{ height:200 }} />
      </ChartCard>

      <ChartCard title="📋 월별 상세 집계" tag="Train">
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr>
              {['월','총 unit','불량 unit','불량률','평균 clf_proba'].map(h => (
                <th key={h} style={{ padding:'7px 12px', textAlign:'left', fontSize:10, fontWeight:600,
                  color:'#94A3B8', borderBottom:'1.5px solid #E2E8F0', background:'#F8FAFC', textTransform:'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthList.map((m, i) => (
              <tr key={m.month} style={{ background: i % 2 === 0 ? undefined : '#FAFAFA' }}>
                <td style={{ padding:'8px 12px', fontFamily:'DM Mono,monospace', fontWeight:600, color:'#1E3A5F' }}>{m.month}</td>
                <td style={{ padding:'8px 12px', fontFamily:'DM Mono,monospace', color:'#475569' }}>{m.total.toLocaleString()}</td>
                <td style={{ padding:'8px 12px', fontFamily:'DM Mono,monospace', color:'#EF4444', fontWeight:600 }}>{m.defect.toLocaleString()}</td>
                <td style={{ padding:'8px 12px', fontFamily:'DM Mono,monospace', fontWeight:700,
                  color: m.defect_rate >= 30 ? '#EF4444' : m.defect_rate >= 20 ? '#F97316' : '#22C55E' }}>
                  {m.defect_rate}%
                </td>
                <td style={{ padding:'8px 12px', fontFamily:'DM Mono,monospace', color:'#64748B' }}>{m.proba_mean}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  )
}

/* ── Split 비교 ── */
export function YearlyPage() {
  const { parsed, loading } = useDateData()

  if (loading || !parsed) {
    return <div className="date-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8' }}>데이터 로딩 중…</div>
  }

  const { bySplit, monthList } = parsed

  const agg = {}
  for (const [sp, rows] of Object.entries(bySplit)) {
    const total  = rows.reduce((s, r) => s + r.total, 0)
    const defect = rows.reduce((s, r) => s + r.defect, 0)
    agg[sp] = {
      total, defect,
      rate:      total ? parseFloat((defect / total * 100).toFixed(2)) : 0,
      proba_avg: rows.length ? parseFloat((rows.reduce((s, r) => s + r.proba_mean, 0) / rows.length).toFixed(4)) : 0,
    }
  }

  const splits = ['train', 'val', 'test']
  const labels = ['Train', 'Val', 'Test']
  const colors = ['#3B82F6', '#8B5CF6', '#06B6D4']

  const barOpt = {
    tooltip: { trigger:'axis', formatter: p => `${p[0].name}: ${p[0].value}%` },
    grid: { top:10, left:52, right:30, bottom:30 },
    xAxis: { type:'category', data:labels, axisLabel:{ fontSize:13, color:'#475569', fontWeight:600 } },
    yAxis: { type:'value', axisLabel:{ fontSize:10, color:'#94A3B8', formatter:'{value}%' },
      splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    series: [{
      type:'bar', data: splits.map(sp => agg[sp].rate), barMaxWidth:56,
      itemStyle: { color: p => colors[p.dataIndex], borderRadius:[5,5,0,0] },
      label: { show:true, position:'top', fontSize:13, formatter:'{c}%', color:'#475569', fontWeight:700 },
    }],
  }

  const pieOpt = {
    tooltip: { trigger:'item', formatter: '{b}: {c}건 ({d}%)' },
    legend: { bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    series: [{
      type:'pie', radius:['40%','68%'], center:['50%','44%'],
      data: splits.map((sp, i) => ({
        value: agg[sp].defect, name: labels[i],
        itemStyle: { color: colors[i] },
      })),
      label: { show:false },
      emphasis: { label: { show:true, fontSize:13, fontWeight:'bold' } },
    }],
  }

  // 월별×Split 히트맵 (train 실제값, val/test 전체 평균)
  const months = monthList.map(m => m.month)
  const hmData = []
  months.forEach((m, mi) => {
    splits.forEach((sp, si) => {
      let rate = 0
      if (sp === 'train') {
        const mo = monthList.find(x => x.month === m)
        rate = mo ? mo.defect_rate : 0
      } else {
        const rows = bySplit[sp]
        rate = rows.length
          ? parseFloat((rows.reduce((s, r) => s + r.defect_rate, 0) / rows.length).toFixed(2))
          : 0
      }
      hmData.push([mi, si, rate])
    })
  })

  const maxRate = Math.max(...hmData.map(d => d[2]))

  const heatOpt = {
    tooltip: { formatter: p => `${months[p.data[0]]} · ${labels[p.data[1]]}<br/>불량률: ${p.data[2]}%` },
    visualMap: { min:0, max:Math.ceil(maxRate), orient:'horizontal', bottom:0, left:'center',
      inRange:{ color:['#EFF6FF','#BFDBFE','#60A5FA','#F97316','#EF4444'] },
      textStyle:{ fontSize:10, color:'#94A3B8' }, text:['높음','낮음'] },
    grid: { top:16, left:70, right:20, bottom:60 },
    xAxis: { type:'category', data:months, axisLabel:{ fontSize:11, color:'#475569' } },
    yAxis: { type:'category', data:labels, axisLabel:{ fontSize:12, color:'#475569', fontWeight:600 } },
    series: [{ type:'heatmap', data:hmData,
      label: { show:true, fontSize:11, fontWeight:600, formatter: p => p.data[2] > 0 ? p.data[2] + '%' : '' },
      emphasis:{ itemStyle:{ shadowBlur:8 } } }],
  }

  return (
    <div className="date-page">
      <div className="stat-row">
        <StatCard label="Train 불량률" value={`${agg.train.rate}%`} color="#3B82F6"
          sub={`${agg.train.defect.toLocaleString()}건 / ${agg.train.total.toLocaleString()}unit`} />
        <StatCard label="Val 불량률"   value={`${agg.val.rate}%`}   color="#8B5CF6"
          sub={`${agg.val.defect.toLocaleString()}건 / ${agg.val.total.toLocaleString()}unit`} />
        <StatCard label="Test 불량률"  value={`${agg.test.rate}%`}  color="#06B6D4"
          sub={`${agg.test.defect.toLocaleString()}건 / ${agg.test.total.toLocaleString()}unit`} />
        <StatCard label="Val+Test / Train" color="#EF4444"
          value={`×${((agg.val.rate + agg.test.rate) / 2 / (agg.train.rate || 1)).toFixed(1)}`}
          sub="불량률 배율" />
      </div>

      <div className="two-col">
        <ChartCard title="📊 Split별 불량률 비교" tag="전체 기간">
          <ReactECharts option={barOpt} style={{ height:240 }} />
        </ChartCard>
        <ChartCard title="🎯 Split별 불량 unit 분포" tag="총 건수">
          <ReactECharts option={pieOpt} style={{ height:240 }} />
        </ChartCard>
      </div>

      <ChartCard title="🗓 월별 × Split 불량률 히트맵" tag="Train 실제값 · Val/Test 전체 평균">
        <ReactECharts option={heatOpt} style={{ height:220 }} />
      </ChartCard>

      <ChartCard title="📋 Split별 상세" tag="실데이터">
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead>
            <tr>
              {['Split','총 unit','불량 unit','불량률','평균 clf_proba','기간'].map(h => (
                <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:10, fontWeight:600,
                  color:'#94A3B8', borderBottom:'1.5px solid #E2E8F0', background:'#F8FAFC', textTransform:'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { sp:'train', label:'Train', color:'#3B82F6', period:'2025-10-01 ~ 2026-04-10' },
              { sp:'val',   label:'Val',   color:'#8B5CF6', period:'2026-04-14 ~ 2026-04-17' },
              { sp:'test',  label:'Test',  color:'#06B6D4', period:'2026-04-21 ~ 2026-04-24' },
            ].map(({ sp, label, color, period }) => (
              <tr key={sp}>
                <td style={{ padding:'10px 12px', fontWeight:700, color }}>{label}</td>
                <td style={{ padding:'10px 12px', fontFamily:'DM Mono,monospace' }}>{agg[sp].total.toLocaleString()}</td>
                <td style={{ padding:'10px 12px', fontFamily:'DM Mono,monospace', color:'#EF4444' }}>{agg[sp].defect.toLocaleString()}</td>
                <td style={{ padding:'10px 12px', fontFamily:'DM Mono,monospace', fontWeight:700, color }}>{agg[sp].rate}%</td>
                <td style={{ padding:'10px 12px', fontFamily:'DM Mono,monospace' }}>{agg[sp].proba_avg}</td>
                <td style={{ padding:'10px 12px', color:'#94A3B8', fontSize:11 }}>{period}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  )
}
