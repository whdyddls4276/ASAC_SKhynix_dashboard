import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import { GRADE_COLORS, getGrade } from './Overview'
import './WeeklyProd.css'

// lot 번호 → 날짜 변환 (Overview와 동일)
function lotToDate(lot) {
  const n = Math.round(parseFloat(lot))
  let base, offset
  if (n >= 201) {
    base = new Date('2026-05-28')
    offset = Math.floor((n - 201) / 9)
  } else if (n >= 101) {
    base = new Date('2026-04-11')
    offset = n - 101
  } else if (n <= 28) {
    base = new Date('2026-03-27')
    offset = Math.round((n - 1) * (45 / 27))
  } else if (n <= 56) {
    base = new Date('2026-05-12')
    offset = n - 29
  } else {
    base = new Date('2026-06-11')
    offset = n - 57
  }
  const d = new Date(base)
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

// 날짜 → 주 시작일(월요일)
function getWeekStart(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  return monday.toISOString().slice(0, 10)
}

function weekLabel(startStr) {
  const s = new Date(startStr)
  const e = new Date(s)
  e.setDate(s.getDate() + 6)
  const fmt = (dt) => `${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getDate().toString().padStart(2,'0')}`
  return `${fmt(s)}~${fmt(e)}`
}

function SummaryCard({ label, value, sub, color }) {
  return (
    <div className="wp-card" style={{ '--wp-color': color }}>
      <div className="wp-card-val" style={{ color }}>{value}</div>
      <div className="wp-card-label">{label}</div>
      {sub && <div className="wp-card-sub">{sub}</div>}
    </div>
  )
}

export default function WeeklyProd() {
  const { data: units, loading } = useCSV('/dashboard_units.csv')

  // unit별 날짜 매핑 & 주차별 집계
  const { weeklyData, summary } = useMemo(() => {
    if (!units.length) return { weeklyData: [], summary: null }

    // train + val + test 전체 사용
    const filtered = units

    // unit별 날짜 붙이기
    const withDate = filtered.map(u => ({
      ...u,
      date: lotToDate(u.run_id),
      pred: parseFloat(u.reg_pred),
    }))

    // grade threshold: train 기준
    const trainPreds = withDate.filter(u => u.split === 'train').map(u => u.pred).sort((a, b) => a - b)
    const n = trainPreds.length
    const thresholds = {
      g1: trainPreds[Math.floor(n * 0.90)] ?? 0,
      g2: trainPreds[Math.floor(n * 0.708)] ?? 0,
      g3: trainPreds[Math.floor(n * 0.50)] ?? 0,
    }

    // defect threshold (g2 기준 = 상위 29.2%)
    const defectThresh = thresholds.g2

    // 주차별 집계
    const weekMap = {}
    withDate.forEach(u => {
      const ws = getWeekStart(u.date)
      if (!weekMap[ws]) weekMap[ws] = { total: 0, grade1: 0, grade2: 0, grade3: 0, grade4: 0 }
      weekMap[ws].total++
      const grade = getGrade(u.pred, thresholds)
      weekMap[ws][grade]++
    })

    const sorted = Object.entries(weekMap).sort(([a], [b]) => a.localeCompare(b))
    const weeklyData = sorted.map(([ws, d]) => ({
      week: ws,
      label: weekLabel(ws),
      total: d.total,
      grade1: d.grade1,
      grade2: d.grade2,
      grade3: d.grade3,
      grade4: d.grade4,
      defect: d.grade1 + d.grade2 + d.grade3,
      defectRate: d.total ? +(((d.grade1 + d.grade2 + d.grade3) / d.total) * 100).toFixed(1) : 0,
    }))

    const totalUnits = filtered.length
    const totalDefect = filtered.filter(u => parseFloat(u.reg_pred) >= defectThresh).length
    const avgWeekly = weeklyData.length ? Math.round(weeklyData.reduce((s, w) => s + w.total, 0) / weeklyData.length) : 0
    const maxWeek = weeklyData.reduce((a, b) => b.total > a.total ? b : a, weeklyData[0] ?? {})

    return {
      weeklyData,
      summary: { totalUnits, totalDefect, avgWeekly, maxWeek },
    }
  }, [units])

  // 주차별 생산량 (누적 스택 바: grade4 → grade1 순)
  const prodBarOption = useMemo(() => {
    if (!weeklyData.length) return null
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const w = weeklyData[params[0].dataIndex]
          return `<b>${w.label}</b><br/>
            총 생산: ${w.total.toLocaleString()}개<br/>
            🔴 Grade 1: ${w.grade1}개<br/>
            🟠 Grade 2: ${w.grade2}개<br/>
            🟡 Grade 3: ${w.grade3}개<br/>
            🟢 Grade 4: ${w.grade4}개<br/>
            위험 비율: ${w.defectRate}%`
        },
      },
      legend: { data: ['Grade 4', 'Grade 3', 'Grade 2', 'Grade 1'], top: 4, textStyle: { fontSize: 11 } },
      grid: { top: 40, bottom: 70, left: 56, right: 20 },
      xAxis: {
        type: 'category',
        data: weeklyData.map(w => w.label),
        axisLabel: { fontSize: 9, rotate: 30, interval: 0 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: {
        type: 'value',
        name: '유닛 수',
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        { name: 'Grade 4', type: 'bar', stack: 'total', data: weeklyData.map(w => w.grade4), itemStyle: { color: GRADE_COLORS.grade4.bar }, barMaxWidth: 36 },
        { name: 'Grade 3', type: 'bar', stack: 'total', data: weeklyData.map(w => w.grade3), itemStyle: { color: GRADE_COLORS.grade3.bar } },
        { name: 'Grade 2', type: 'bar', stack: 'total', data: weeklyData.map(w => w.grade2), itemStyle: { color: GRADE_COLORS.grade2.bar } },
        { name: 'Grade 1', type: 'bar', stack: 'total', data: weeklyData.map(w => w.grade1), itemStyle: { color: GRADE_COLORS.grade1.bar, borderRadius: [3, 3, 0, 0] } },
      ],
    }
  }, [weeklyData])

  // 주차별 불량률 꺾은선
  const defectRateOption = useMemo(() => {
    if (!weeklyData.length) return null
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => `<b>${params[0].axisValue}</b><br/>${params[0].marker} 불량률: ${params[0].value}%`,
      },
      grid: { top: 20, bottom: 70, left: 56, right: 20 },
      xAxis: {
        type: 'category',
        data: weeklyData.map(w => w.label),
        axisLabel: { fontSize: 9, rotate: 30, interval: 0 },
      },
      yAxis: {
        type: 'value',
        name: '불량률(%)',
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [{
        type: 'line',
        data: weeklyData.map(w => w.defectRate),
        smooth: true,
        lineStyle: { color: '#EF4444', width: 2 },
        itemStyle: { color: '#EF4444' },
        areaStyle: { color: 'rgba(239,68,68,0.08)' },
        symbolSize: 5,
      }],
    }
  }, [weeklyData])

  if (loading || !summary) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 14 }}>데이터 로딩 중…</div>
  }

  return (
    <div className="wp-page">
      <div className="wp-header">
        <h2 className="wp-title">📅 주별 생산량</h2>
        <p className="wp-subtitle">Train + Validation 구간 기준 / Lot별 날짜 매핑</p>
      </div>

      {/* 요약 카드 */}
      <div className="wp-summary-row">
        <SummaryCard label="총 생산 유닛" value={summary.totalUnits.toLocaleString()} sub="train + val 전체" color="#6366F1" />
        <SummaryCard label="총 불량 위험" value={summary.totalDefect.toLocaleString()} sub={`전체의 ${((summary.totalDefect/summary.totalUnits)*100).toFixed(1)}%`} color="#EF4444" />
        <SummaryCard label="주평균 생산량" value={summary.avgWeekly.toLocaleString()} sub="유닛/주" color="#0EA5E9" />
        <SummaryCard label="최다 생산 주차" value={summary.maxWeek?.label ?? '-'} sub={`${summary.maxWeek?.total?.toLocaleString() ?? 0}개`} color="#22C55E" />
      </div>

      {/* 주차별 생산량 스택 바 */}
      <div className="wp-chart-card">
        <div className="wp-chart-title">📊 주차별 생산량 — 위험 등급별 누적 (Grade 1~4)</div>
        <ReactECharts option={prodBarOption} style={{ height: 320 }} />
      </div>

      {/* 주차별 불량률 */}
      <div className="wp-chart-card">
        <div className="wp-chart-title">📉 주차별 불량 위험률 추이</div>
        <ReactECharts option={defectRateOption} style={{ height: 240 }} />
      </div>

      {/* 주차별 상세 테이블 */}
      <div className="wp-chart-card">
        <div className="wp-chart-title">📋 주차별 생산 상세</div>
        <div className="wp-table-wrap">
          <table className="wp-table">
            <thead>
              <tr>
                <th>주차</th>
                <th>총 유닛</th>
                <th>Grade 1</th>
                <th>Grade 2</th>
                <th>Grade 3</th>
                <th>Grade 4</th>
                <th>불량 위험률</th>
              </tr>
            </thead>
            <tbody>
              {weeklyData.map(w => (
                <tr key={w.week}>
                  <td className="wp-td-week">{w.label}</td>
                  <td>{w.total.toLocaleString()}</td>
                  <td><span className="wp-badge wp-badge-g1">{w.grade1}</span></td>
                  <td><span className="wp-badge wp-badge-g2">{w.grade2}</span></td>
                  <td><span className="wp-badge wp-badge-g3">{w.grade3}</span></td>
                  <td><span className="wp-badge wp-badge-g4">{w.grade4}</span></td>
                  <td>
                    <div className="wp-rate-wrap">
                      <div className="wp-rate-bar" style={{ width: `${Math.min(w.defectRate * 2, 100)}%` }} />
                      <span className="wp-rate-val">{w.defectRate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
