import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './Overview.css'



// lot 번호 → 날짜 변환
// 오늘: 2026-06-11, 어제(최신 val lot 56): 2026-06-10
// val:   lot 29~56 → 2026-05-12 ~ 2026-06-10 (30일치, 하루 1 lot)
// train: lot 1~28  → 2026-03-27 ~ 2026-05-11 (46일 구간)
// test:  lot 57~84 → 이미 미래, 표시 안 함
function lotToDate(lot) {
  const n = Math.round(parseFloat(lot))
  let base, offset
  if (n >= 201) {
    // 합성 lot: 201~326 → 2026-05-28 ~ 2026-06-10 (하루 9개)
    base = new Date('2026-05-28')
    offset = Math.floor((n - 201) / 9)
  } else if (n >= 101) {
    // 합성 lot: 101~156 → 2026-04-11 ~ 2026-06-05
    base = new Date('2026-04-11')
    offset = n - 101
  } else if (n <= 28) {
    // train: 2026-03-27 ~ 2026-05-11 (46일 구간에 28 lots)
    base = new Date('2026-03-27')
    offset = Math.round((n - 1) * (45 / 27))
  } else if (n <= 56) {
    // val: 2026-05-12 ~ 2026-06-10 (하루 1 lot, lot 29 = 05-12, lot 56 = 06-10)
    base = new Date('2026-05-12')
    offset = n - 29
  } else {
    // test: 2026-06-11 이후
    base = new Date('2026-06-11')
    offset = n - 57
  }
  const d = new Date(base)
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

// defectThresh: train reg_pred 상위 29.2% 경계값 (전체 고정 기준)
// highThresh: 최신 lot(어제 하루치) 안에서 reg_pred 상위 10% (KPI 전용)
function computeThresholds(units) {
  const trainUnits = units.filter(u => u.split === 'train')
  const trainPreds = trainUnits.map(u => parseFloat(u.reg_pred)).sort((a, b) => a - b)
  const defectThresh = trainPreds[Math.floor(trainPreds.length * 0.708)] ?? 0

  // 최신 lot = val에서 run_id가 가장 큰 lot
  const valUnits = units.filter(u => u.split === 'val')
  const latestLot = Math.max(...valUnits.map(u => parseFloat(u.run_id)))
  const latestUnits = valUnits.filter(u => parseFloat(u.run_id) === latestLot)
  const latestPreds = latestUnits.map(u => parseFloat(u.reg_pred)).sort((a, b) => a - b)
  // highThresh: 최신 lot의 위험 unit(>=defectThresh) 중 상위 10% 경계
  const dangerPreds = latestPreds.filter(p => p >= defectThresh)
  const highThresh = dangerPreds.length
    ? dangerPreds[Math.floor(dangerPreds.length * 0.9)]
    : defectThresh

  return { defectThresh, highThresh, latestLot }
}

function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div className="kpi-card" style={{ '--kpi-color': color }}>
      <div className="kpi-icon" style={{ background: color + '18' }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div className="kpi-info">
        <div className="kpi-val" style={{ color }}>{value}</div>
        <div className="kpi-label">{label}</div>
        {sub && <div className="kpi-sub">{sub}</div>}
      </div>
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className="chart-card">
      <div className="cc-header">
        <div className="cc-title">{title}</div>
      </div>
      <div className="cc-body">{children}</div>
    </div>
  )
}

export default function Overview() {
  const { data: units, loading: loadingUnits } = useCSV('/dashboard_units.csv')
  const { data: trendRaw, loading: loadingTrend } = useCSV('/trend_data.csv')

  const { defectThresh, highThresh, latestLot } = useMemo(() => {
    if (!units.length) return { defectThresh: 0, highThresh: 0, latestLot: null }
    return computeThresholds(units)
  }, [units])

  const kpi = useMemo(() => {
    if (!units.length || latestLot === null) return null

    // KPI는 최신 lot(어제 하루치) 기준
    const latestUnits = units.filter(u => u.split === 'val' && parseFloat(u.run_id) === latestLot)
    const total = latestUnits.length
    const danger = latestUnits.filter(u => parseFloat(u.reg_pred) >= defectThresh).length
    const rate = total ? ((danger / total) * 100).toFixed(1) : '0.0'

    // HIGH: 최신 lot 안에서 상위 10%
    const high = latestUnits.filter(u => parseFloat(u.reg_pred) >= highThresh)
    const highAvg = high.length
      ? (high.reduce((s, u) => s + parseFloat(u.reg_pred), 0) / high.length).toFixed(4)
      : '0.0000'

    // 위험 집중 Lot: 어제(최신 lot) 기준 위험 unit이 가장 많은 wafer
    const latestWaferCount = {}
    latestUnits.filter(u => parseFloat(u.reg_pred) >= defectThresh).forEach(u => {
      const w = Math.round(parseFloat(u.wafer_no))
      latestWaferCount[w] = (latestWaferCount[w] || 0) + 1
    })
    const topWaferEntry = Object.entries(latestWaferCount).sort((a, b) => b[1] - a[1])[0]
    const topLotLabel = `Lot ${latestLot}`
    const topLotRate  = `${rate}%`
    const latestDate = lotToDate(latestLot)

    return { total, danger, rate, topLotLabel, topLotRate, highAvg, latestDate }
  }, [units, defectThresh, highThresh, latestLot])

  // 트렌드: trend_data.csv 기반
  const trendOption = useMemo(() => {
    if (!trendRaw.length) return null

    const xData     = trendRaw.map(r => r.date)
    const predYield = trendRaw.map(r => r.y_pred !== '' ? parseFloat(r.y_pred) : null)
    const trueYield = trendRaw.map(r => r.y_true !== '' ? parseFloat(r.y_true) : null)

    // 실제 수율 시작일 (y_true가 처음 null로 바뀌는 날 = 구간2 시작)
    const predBoundaryIdx = trueYield.findIndex(v => v === null)
    const predBoundaryDate = predBoundaryIdx > 0 ? xData[predBoundaryIdx] : null

    // 실제 데이터 시작일 (y_true가 다시 등장하는 날 = 마지막 5일 시작)
    const realBoundaryIdx = trueYield.findLastIndex(v => v === null) + 1
    const realBoundaryDate = realBoundaryIdx > 0 && realBoundaryIdx < xData.length ? xData[realBoundaryIdx] : null

    return {
      tooltip: { trigger: 'axis', formatter: (p) => {
        let html = `<b>${p[0].axisValue}</b><br/>`
        p.forEach(item => {
          if (item.value != null)
            html += `${item.marker} ${item.seriesName}: ${parseFloat(item.value).toFixed(1)}%<br/>`
        })
        return html
      }},
      legend: { data: ['예측 수율', '실제 수율'], top: 4, textStyle: { fontSize: 11 } },
      dataZoom: [
        { type: 'slider', bottom: 0, height: 20, start: 0, end: 100, fillerColor: 'rgba(59,130,246,0.1)', borderColor: '#E2E8F0' },
        { type: 'inside' },
      ],
      grid: { top: 36, bottom: 110, left: 56, right: 20 },
      xAxis: {
        type: 'category', data: xData,
        axisLabel: { fontSize: 9, rotate: 35, interval: 9, margin: 8 },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
      },
      yAxis: {
        type: 'value',
        name: '수율(%)',
        min: 60, max: 90,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        {
          name: '예측 수율',
          type: 'line',
          data: predYield,
          smooth: true,
          connectNulls: false,
          lineStyle: { color: '#3B82F6', width: 2 },
          itemStyle: { color: '#3B82F6' },
          symbol: 'none',
          markLine: {
            silent: true,
            data: [
              predBoundaryDate && { xAxis: predBoundaryDate, lineStyle: { color: '#94A3B8', type: 'dashed', width: 1.5 }, label: { formatter: '예측 구간 시작', fontSize: 9, color: '#64748B', position: 'insideStartTop' } },
              realBoundaryDate && { xAxis: realBoundaryDate, lineStyle: { color: '#6366F1', type: 'solid', width: 1.5 }, label: { formatter: '실제 데이터', fontSize: 9, color: '#6366F1', position: 'insideStartTop' } },
            ].filter(Boolean),
          },
        },
        {
          name: '실제 수율',
          type: 'line',
          data: trueYield,
          smooth: true,
          connectNulls: false,
          areaStyle: { color: 'rgba(239,68,68,0.10)' },
          lineStyle: { color: '#EF4444', width: 1.5 },
          itemStyle: { color: '#EF4444' },
          symbol: 'none',
        },
      ],
    }
  }, [trendRaw])

  // 최근 2주 Lot별 위험 unit 수
  const lotBarOption = useMemo(() => {
    if (!units.length || latestLot === null) return null
    const twoWeeksAgo = latestLot - 14
    const recentUnits = units.filter(u => u.split === 'val' && parseFloat(u.run_id) > twoWeeksAgo)
    const lotMap = {}
    recentUnits.forEach(u => {
      const lot = Math.round(parseFloat(u.run_id))
      if (!lotMap[lot]) lotMap[lot] = { danger: 0, total: 0 }
      lotMap[lot].total++
      if (parseFloat(u.reg_pred) >= defectThresh) lotMap[lot].danger++
    })
    const sorted = Object.entries(lotMap).sort((a, b) => Number(a[0]) - Number(b[0]))
    if (!sorted.length) return null
    return {
      tooltip: { trigger: 'axis', formatter: p => `Lot ${p[0].axisValue} (${lotToDate(p[0].axisValue)})<br/>위험 unit: ${p[0].value}개` },
      grid: { top: 10, bottom: 50, left: 50, right: 10 },
      xAxis: { type: 'category', data: sorted.map(([lot]) => lot), axisLabel: { fontSize: 10, formatter: v => `L${v}` } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: [{
        type: 'bar',
        data: sorted.map(([lot, d]) => ({
          value: d.danger,
          itemStyle: { color: Number(lot) === latestLot ? '#6366F1' : '#F97316', borderRadius: [3, 3, 0, 0] },
        })),
        barMaxWidth: 28,
      }],
    }
  }, [units, defectThresh, latestLot])

  // 3. 최신 lot 하루치 위험 등급별 unit 수
  const riskBarOption = useMemo(() => {
    if (!units.length || latestLot === null) return null
    const latestUnits = units.filter(u => u.split === 'val' && parseFloat(u.run_id) === latestLot)
    const groups = { HIGH: 0, MED: 0, LOW: 0 }
    latestUnits.forEach(u => {
      const p = parseFloat(u.reg_pred)
      if (p >= highThresh) groups.HIGH++
      else if (p >= defectThresh) groups.MED++
      else groups.LOW++
    })
    return {
      tooltip: { trigger: 'item' },
      grid: { top: 10, bottom: 10, left: 50, right: 10 },
      xAxis: { type: 'category', data: ['🔴 HIGH', '🟡 MED'], axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: [{
        type: 'bar',
        data: [
          { value: groups.HIGH, itemStyle: { color: '#EF4444' } },
          { value: groups.MED,  itemStyle: { color: '#F97316' } },
        ],
        barMaxWidth: 48,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      }],
    }
  }, [units, defectThresh, highThresh, latestLot])

  if (loadingUnits || loadingTrend || !kpi) {
    return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>데이터 로딩 중…</div>
  }

  return (
    <div className="overview">
      {/* KPI — 최신 lot(어제 하루치) 기준 */}
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6 }}>
        📅 기준일: {kpi.latestDate} (Lot {latestLot}) — 어제 WT 완료분
      </div>
      <div className="kpi-row">
        <KpiCard
          label="불량 위험률"
          value={`${kpi.rate}%`}
          sub={`위험 ${kpi.danger.toLocaleString()}개 / 전체 ${kpi.total.toLocaleString()}개`}
          color="#EF4444" icon="📊"
        />
        <KpiCard
          label="어제 위험 Lot"
          value={kpi.topLotLabel}
          sub={`${kpi.latestDate} WT 완료 — 위험 ${kpi.danger}개 / 전체 ${kpi.total}개`}
          color="#F97316" icon="🏭"
        />
        <KpiCard
          label="HIGH 그룹 평균 불량지수"
          value={kpi.highAvg}
          sub="어제 lot 위험 unit 중 상위 10% y_pred 평균"
          color="#6366F1" icon="🔴"
        />
      </div>

      {/* 트렌드 차트 */}
      <ChartCard title="📈 수율 트렌드 — 예측 수율(라인) vs 실제 수율(영역, train만)">
        {trendOption
          ? <ReactECharts option={trendOption} style={{ height: 340 }} />
          : <div className="dummy-desc">데이터 로딩 중…</div>
        }
      </ChartCard>

      {/* 하단 바차트: 어제 하루치 */}
      <div className="two-col">
        <ChartCard title={`🏭 최근 2주 Lot별 위험 unit 수 (기준: ${kpi.latestDate})`}>
          {lotBarOption
            ? <ReactECharts option={lotBarOption} style={{ height: 220 }} />
            : <div className="dummy-desc">위험 unit 없음</div>
          }
        </ChartCard>
        <ChartCard title={`⚠️ 위험 등급별 unit 수 (${kpi.latestDate} 하루치)`}>
          {riskBarOption
            ? <ReactECharts option={riskBarOption} style={{ height: 220 }} />
            : <div className="dummy-desc">데이터 로딩 중…</div>
          }
        </ChartCard>
      </div>

    </div>
  )
}
