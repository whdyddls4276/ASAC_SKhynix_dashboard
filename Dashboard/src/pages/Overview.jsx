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
  if (n <= 28) {
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

    // 위험 집중 Wafer: 최신 lot 안에서 위험 unit이 가장 많은 wafer_no
    const waferCount = {}
    latestUnits.filter(u => parseFloat(u.reg_pred) >= defectThresh).forEach(u => {
      const w = u.wafer_no
      waferCount[w] = (waferCount[w] || 0) + 1
    })
    const topWafer = Object.entries(waferCount).sort((a, b) => b[1] - a[1])[0]
    const topWaferLabel = topWafer ? `Wafer ${Math.round(topWafer[0])}` : '-'
    const latestDate = lotToDate(latestLot)

    return { total, danger, rate, topWaferLabel, highAvg, latestDate }
  }, [units, defectThresh, highThresh, latestLot])

  // 트렌드: lot별 수율 비교
  // train → health > 0 기준 불량률, val → reg_pred >= defectThresh 기준 불량률
  const trendOption = useMemo(() => {
    if (!units.length || defectThresh === 0) return null

    // lot별 집계 (train + val만, test 제외)
    const lotMap = {}
    units.filter(u => u.split !== 'test').forEach(u => {
      const lot = Math.round(parseFloat(u.run_id))
      if (!lotMap[lot]) lotMap[lot] = { split: u.split, total: 0, trainDefect: 0, predDefect: 0 }
      lotMap[lot].total++
      if (u.split === 'train' && parseFloat(u.health) > 0) lotMap[lot].trainDefect++
      if (parseFloat(u.reg_pred) >= defectThresh) lotMap[lot].predDefect++
    })

    const sorted = Object.entries(lotMap).sort((a, b) => a[0] - b[0])
    const xData = sorted.map(([lot]) => lotToDate(lot))

    // 수율 = (1 - 불량률) × 100
    const trueYield = sorted.map(([, d]) =>
      d.split === 'train' ? (100 - (d.trainDefect / d.total * 100)).toFixed(1) : null
    )
    const predYield = sorted.map(([, d]) =>
      (100 - (d.predDefect / d.total * 100)).toFixed(1)
    )

    const firstValIdx = sorted.findIndex(([, d]) => d.split === 'val')
    const boundaryDate = firstValIdx > 0 ? xData[firstValIdx] : null

    return {
      tooltip: { trigger: 'axis', formatter: (p) => {
        let html = `<b>${p[0].axisValue}</b><br/>`
        p.forEach(item => {
          if (item.value != null)
            html += `${item.marker} ${item.seriesName}: ${item.value}%<br/>`
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
        axisLabel: { fontSize: 9, rotate: 35, interval: 2, margin: 8 },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
      },
      yAxis: {
        type: 'value',
        name: '수율(%)',
        min: 0, max: 100,
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
          lineStyle: { color: '#3B82F6', width: 2 },
          itemStyle: { color: '#3B82F6' },
          symbol: 'none',
          markLine: boundaryDate ? {
            silent: true,
            data: [{ xAxis: boundaryDate, lineStyle: { color: '#94A3B8', type: 'dashed', width: 1.5 }, label: { formatter: '예측 시작', fontSize: 10, color: '#64748B' } }]
          } : undefined,
        },
        {
          name: '실제 수율',
          type: 'line',
          data: trueYield,
          smooth: true,
          areaStyle: { color: 'rgba(239,68,68,0.10)' },
          lineStyle: { color: '#EF4444', width: 1.5 },
          itemStyle: { color: '#EF4444' },
          symbol: 'none',
        },
      ],
    }
  }, [units, defectThresh])

  // 최신 lot 하루치 Wafer별 위험 unit 수
  const waferBarOption = useMemo(() => {
    if (!units.length || latestLot === null) return null
    const latestUnits = units.filter(u => u.split === 'val' && parseFloat(u.run_id) === latestLot)
    const waferMap = {}
    latestUnits.forEach(u => {
      const w = Math.round(parseFloat(u.wafer_no))
      if (!waferMap[w]) waferMap[w] = { danger: 0, total: 0 }
      waferMap[w].total++
      if (parseFloat(u.reg_pred) >= defectThresh) waferMap[w].danger++
    })
    // 값 있는 것만, 내림차순
    const sorted = Object.entries(waferMap)
      .filter(([, d]) => d.danger > 0)
      .sort((a, b) => b[1].danger - a[1].danger)
    if (!sorted.length) return null
    return {
      tooltip: { trigger: 'axis', formatter: p => `Wafer ${p[0].axisValue}<br/>위험 unit: ${p[0].value}개` },
      grid: { top: 10, bottom: 40, left: 50, right: 10 },
      xAxis: { type: 'category', data: sorted.map(([w]) => `W${w}`), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: [{
        type: 'bar',
        data: sorted.map(([w, d]) => ({
          value: d.danger,
          itemStyle: { color: '#F97316', borderRadius: [3, 3, 0, 0] },
          wafer: parseFloat(w),
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

  if (loadingUnits || !kpi) {
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
          label="위험 집중 Wafer"
          value={kpi.topWaferLabel}
          sub={`Lot ${latestLot} 내 위험 unit 최다 Wafer`}
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
        <ChartCard title={`🏭 Wafer별 위험 unit 수 (${kpi.latestDate} 하루치)`}>
          {waferBarOption
            ? <ReactECharts option={waferBarOption} style={{ height: 220 }} />
            : <div className="dummy-desc">데이터 로딩 중…</div>
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
