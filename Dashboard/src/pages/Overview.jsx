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

// grade 기준 (train 전체 reg_pred 분위수 기반, 고정)
// grade1: 상위 10%  (p90 이상)
// grade2: 상위 10~29.2% (p70.8 ~ p90)
// grade3: 상위 29.2~50% (p50 ~ p70.8)
// grade4: 하위 50% (p50 미만)
export const GRADE_COLORS = {
  grade1: { bg: '#FEE2E2', border: '#EF4444', text: '#B91C1C', bar: '#EF4444', label: 'Grade 1' },
  grade2: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', bar: '#F59E0B', label: 'Grade 2' },
  grade3: { bg: '#FEF9C3', border: '#EAB308', text: '#713F12', bar: '#EAB308', label: 'Grade 3' },
  grade4: { bg: '#F0FDF4', border: '#86EFAC', text: '#166534', bar: '#22C55E', label: 'Grade 4' },
}

export function getGrade(pred, thresholds) {
  const { g1, g2, g3 } = thresholds
  if (pred >= g1) return 'grade1'
  if (pred >= g2) return 'grade2'
  if (pred >= g3) return 'grade3'
  return 'grade4'
}

// 1팀 방식 threshold 계산 (KPI용 defectThresh/highThresh + grade용 g1/g2/g3)
function computeThresholds(units) {
  const trainUnits = units.filter(u => u.split === 'train')
  const trainPreds = trainUnits.map(u => parseFloat(u.reg_pred)).sort((a, b) => a - b)
  const n = trainPreds.length
  const defectThresh = trainPreds[Math.floor(n * 0.708)] ?? 0
  const g1 = trainPreds[Math.floor(n * 0.90)]  ?? 0
  const g2 = defectThresh
  const g3 = trainPreds[Math.floor(n * 0.50)]  ?? 0

  const valUnits = units.filter(u => u.split === 'val')
  const latestLot = valUnits.length ? Math.max(...valUnits.map(u => parseFloat(u.run_id))) : null
  const latestUnits = valUnits.filter(u => parseFloat(u.run_id) === latestLot)
  const dangerPreds = latestUnits.map(u => parseFloat(u.reg_pred)).filter(p => p >= defectThresh).sort((a, b) => a - b)
  const highThresh = dangerPreds.length ? dangerPreds[Math.floor(dangerPreds.length * 0.9)] : defectThresh

  return { defectThresh, highThresh, g1, g2, g3, latestLot }
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
  const { data: gradeTrendRaw } = useCSV('/grade_trend.csv')

  const { defectThresh, highThresh, g1, g2, g3, latestLot } = useMemo(() => {
    if (!units.length) return { defectThresh: 0, highThresh: 0, g1: 0, g2: 0, g3: 0, latestLot: null }
    return computeThresholds(units)
  }, [units])

  const thresholds = useMemo(() => ({ g1, g2, g3 }), [g1, g2, g3])

  // KPI (1팀 방식: ppm 기준)
  const kpi = useMemo(() => {
    if (!units.length || latestLot === null) return null

    const latestUnits = units.filter(u => u.split === 'val' && parseFloat(u.run_id) === latestLot)
    const total = latestUnits.length
    if (total === 0) return null

    const ppmValues = latestUnits.map(u => parseFloat(u.reg_pred) * 1_000_000)
    const meanPpm = ppmValues.reduce((s, v) => s + v, 0) / ppmValues.length

    const sorted = [...ppmValues].sort((a, b) => a - b)
    const p95Idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)
    const p95Ppm = sorted[p95Idx] ?? 0

    const nRisk = ppmValues.filter(v => v > p95Ppm).length
    const latestDate = lotToDate(latestLot)
    const fmtPpm = (v) => `${Math.round(v).toLocaleString()} ppm`

    return { total, meanPpm, p95Ppm, nRisk, latestDate, fmtPpm }
  }, [units, latestLot])

  // 트렌드: 주차별 집계 — 막대=생산량, 꺾은선=수율(예측/실제)
  const trendOption = useMemo(() => {
    if (!trendRaw.length) return null

    const weekMap = {}
    trendRaw.forEach(r => {
      const d = new Date(r.date)
      const day = d.getDay()
      const diff = day === 0 ? -6 : 1 - day
      const monday = new Date(d)
      monday.setDate(d.getDate() + diff)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const fmt = (dt) => `${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getDate().toString().padStart(2,'0')}`
      const weekKey = `${fmt(monday)}~${fmt(sunday)}`
      const weekStart = monday.toISOString().slice(0, 10)

      if (!weekMap[weekStart]) weekMap[weekStart] = { label: weekKey, preds: [], trues: [], prod: 0 }
      const yp = r.y_pred !== '' && r.y_pred != null ? parseFloat(r.y_pred) : null
      const yt = r.y_true !== '' && r.y_true != null ? parseFloat(r.y_true) : null
      const prod = r.production !== '' && r.production != null ? parseInt(r.production) : 0
      if (yp != null) weekMap[weekStart].preds.push(yp)
      if (yt != null) weekMap[weekStart].trues.push(yt)
      weekMap[weekStart].prod += prod
    })

    const weeks = Object.entries(weekMap).sort(([a], [b]) => a.localeCompare(b))
    const xLabels  = weeks.map(([, w]) => w.label)
    const prodSum  = weeks.map(([, w]) => w.prod)
    const predAvg  = weeks.map(([, w]) => w.preds.length ? +(w.preds.reduce((s,v)=>s+v,0)/w.preds.length).toFixed(2) : null)
    const trueAvg  = weeks.map(([, w]) => w.trues.length ? +(w.trues.reduce((s,v)=>s+v,0)/w.trues.length).toFixed(2) : null)

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          let html = `<b>${params[0].axisValue}</b><br/>`
          params.forEach(item => {
            if (item.value == null) return
            if (item.seriesName === '생산량') html += `${item.marker} 생산량: ${item.value.toLocaleString()}개<br/>`
            else html += `${item.marker} ${item.seriesName}: ${item.value.toFixed(1)}%<br/>`
          })
          return html
        },
      },
      legend: { data: ['생산량', '예측 수율', '실제 수율'], top: 4, textStyle: { fontSize: 11 } },
      grid: { top: 40, bottom: 60, left: 56, right: 56 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { fontSize: 9, rotate: 30, interval: 0, margin: 8 },
        axisTick: { alignWithLabel: true },
      },
      yAxis: [
        {
          type: 'value',
          name: '생산량(개)',
          nameTextStyle: { fontSize: 10 },
          axisLabel: { fontSize: 10 },
          splitLine: { lineStyle: { color: '#F1F5F9' } },
        },
        {
          type: 'value',
          name: '수율(%)',
          nameTextStyle: { fontSize: 10 },
          axisLabel: { fontSize: 10, formatter: '{value}%' },
          splitLine: { show: false },
          scale: true,
        },
      ],
      series: [
        {
          name: '생산량',
          type: 'bar',
          yAxisIndex: 0,
          data: prodSum,
          itemStyle: { color: 'rgba(99,102,241,0.45)', borderRadius: [3,3,0,0] },
          barMaxWidth: 32,
        },
        {
          name: '예측 수율',
          type: 'line',
          yAxisIndex: 1,
          data: predAvg,
          smooth: true,
          connectNulls: true,
          lineStyle: { color: '#3B82F6', width: 2 },
          itemStyle: { color: '#3B82F6' },
          symbolSize: 5,
        },
        {
          name: '실제 수율',
          type: 'line',
          yAxisIndex: 1,
          data: trueAvg,
          smooth: true,
          connectNulls: false,
          lineStyle: { color: '#EF4444', width: 2 },
          itemStyle: { color: '#EF4444' },
          symbolSize: 6,
        },
      ],
    }
  }, [trendRaw])

  // 포지션별 불량 위험 유닛 비율 (val 전체, run_id 내 ufs_serial 정렬로 pos 1~4 부여)
  const positionRiskData = useMemo(() => {
    if (!units.length) return []
    const valUnits = units.filter(u => u.split === 'val')
    if (!valUnits.length) return []
    const runMap = {}
    valUnits.forEach(u => {
      if (!runMap[u.run_id]) runMap[u.run_id] = []
      runMap[u.run_id].push(u)
    })
    const posStat = { 1: { total: 0, danger: 0 }, 2: { total: 0, danger: 0 }, 3: { total: 0, danger: 0 }, 4: { total: 0, danger: 0 } }
    Object.values(runMap).forEach(group => {
      const sorted = [...group].sort((a, b) => a.ufs_serial.localeCompare(b.ufs_serial))
      sorted.forEach((u, i) => {
        const pos = (i % 4) + 1
        posStat[pos].total++
        if (parseFloat(u.reg_pred) >= defectThresh) posStat[pos].danger++
      })
    })
    return [1, 2, 3, 4].map(pos => ({
      pos,
      total: posStat[pos].total,
      danger: posStat[pos].danger,
      rate: posStat[pos].total ? +((posStat[pos].danger / posStat[pos].total) * 100).toFixed(1) : 0,
    }))
  }, [units, defectThresh])

  // Grade별 주차별 비율 라인 차트 (grade_trend.csv 기반)
  const gradeTrendOption = useMemo(() => {
    if (!gradeTrendRaw.length) return null
    const xLabels = gradeTrendRaw.map(r => r.week)
    const mk = (key) => gradeTrendRaw.map(r => parseFloat(r[key]) || 0)
    // 마지막 4주(실제 val 데이터) 강조용 구분선 인덱스
    const realStartIdx = gradeTrendRaw.length - 4
    return {
      tooltip: {
        trigger: 'axis',
        formatter: params => {
          const idx = params[0].dataIndex
          const isReal = idx >= realStartIdx
          return `<b>${params[0].axisValue}</b>${isReal ? ' ✅ 실제' : ' (추정)'}<br/>` +
            params.map(p => `${p.marker} ${p.seriesName}: ${p.value}%`).join('<br/>')
        },
      },
      legend: { data: ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'], top: 4, textStyle: { fontSize: 11 } },
      grid: { top: 36, bottom: 50, left: 50, right: 16 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { fontSize: 9, rotate: 30, interval: 0 },
        axisTick: { alignWithLabel: true },
        markLine: {
          data: [{ xAxis: realStartIdx - 0.5, lineStyle: { color: '#94A3B8', type: 'dashed' } }],
        },
      },
      yAxis: {
        type: 'value',
        name: '비율(%)',
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        { name: 'Grade 1', type: 'line', data: mk('grade1'), smooth: true, symbolSize: 5, lineStyle: { color: GRADE_COLORS.grade1.bar, width: 2.5 }, itemStyle: { color: GRADE_COLORS.grade1.bar } },
        { name: 'Grade 2', type: 'line', data: mk('grade2'), smooth: true, symbolSize: 5, lineStyle: { color: GRADE_COLORS.grade2.bar, width: 2.5 }, itemStyle: { color: GRADE_COLORS.grade2.bar } },
        { name: 'Grade 3', type: 'line', data: mk('grade3'), smooth: true, symbolSize: 5, lineStyle: { color: GRADE_COLORS.grade3.bar, width: 2 }, itemStyle: { color: GRADE_COLORS.grade3.bar } },
        { name: 'Grade 4', type: 'line', data: mk('grade4'), smooth: true, symbolSize: 5, lineStyle: { color: GRADE_COLORS.grade4.bar, width: 2 }, itemStyle: { color: GRADE_COLORS.grade4.bar } },
      ],
    }
  }, [gradeTrendRaw])

  if (loadingUnits || !kpi) {
    return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>데이터 로딩 중…</div>
  }

  return (
    <div className="overview">
      {/* KPI — 1팀 원본 */}
      <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6 }}>
        📅 기준일: {kpi.latestDate} — 최근 WT 완료분 기준
      </div>
      <div className="kpi-row">
        <KpiCard
          label="오늘 검사 unit"
          value={kpi.total.toLocaleString()}
          sub="최신 Lot 실시간 진단 대상"
          color="#F59E0B" icon="🔬"
        />
        <KpiCard
          label="평균 예측 ppm"
          value={kpi.fmtPpm(kpi.meanPpm)}
          sub={`fleet 평균 — Lot ${latestLot}`}
          color="#3B82F6" icon="📊"
        />
        <KpiCard
          label="p95 ppm"
          value={kpi.fmtPpm(kpi.p95Ppm)}
          sub="상위 5% 꼬리 위험 수준"
          color="#F97316" icon="⚠️"
        />
        <KpiCard
          label="임계 초과 unit"
          value={kpi.nRisk.toLocaleString()}
          sub={`pred > p95 (전체 ${kpi.total.toLocaleString()} 중)`}
          color="#EF4444" icon="🚨"
        />
      </div>

      {/* 트렌드 차트 */}
      <ChartCard title="📈 주차별 수율 트렌드 — 막대(예측 주평균) + 꺾은선(예측/실제)">
        {loadingTrend
          ? <div className="dummy-desc">트렌드 데이터 로딩 중…</div>
          : trendOption
            ? <ReactECharts option={trendOption} style={{ height: 300 }} />
            : <div className="dummy-desc">trend_data.csv 데이터 없음</div>
        }
      </ChartCard>

      {/* 하단 2열: Grade별 라인차트 + 포지션별 불량 위험 비율 */}
      <div className="two-col">
        {/* 왼쪽: Lot별 Grade 비율 라인 차트 */}
        <ChartCard title="📉 Lot별 Grade 비율 추이 (Val 전체)">
          {gradeTrendOption
            ? <ReactECharts option={gradeTrendOption} style={{ height: 260 }} />
            : <div className="dummy-desc">데이터 로딩 중…</div>
          }
        </ChartCard>

        {/* 오른쪽: 포지션별 불량 위험 비율 가로 막대 */}
        <ChartCard title="📊 포지션별 불량 위험 유닛 비율 (Val 전체 기준)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '20px 8px' }}>
            {positionRiskData.map(({ pos, rate, danger, total }) => {
              const color = pos === 1 ? '#EF4444' : pos === 2 ? '#F97316' : pos === 3 ? '#EAB308' : '#22C55E'
              return (
                <div key={pos} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#475569', fontFamily: 'DM Mono,monospace' }}>
                    POS {pos}
                  </div>
                  <div style={{ flex: 1, background: '#F1F5F9', borderRadius: 6, height: 22, overflow: 'hidden' }}>
                    <div style={{ width: `${rate}%`, height: '100%', background: color, borderRadius: 6, opacity: 0.85, transition: 'width 0.5s ease' }} />
                  </div>
                  <div style={{ width: 52, flexShrink: 0, textAlign: 'right', fontSize: 15, fontWeight: 700, fontFamily: 'DM Mono,monospace', color }}>
                    {rate}%
                  </div>
                  <div style={{ width: 64, flexShrink: 0, fontSize: 10, color: '#94A3B8' }}>
                    {danger}/{total}
                  </div>
                </div>
              )
            })}
            <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>
              * 상위 29.2% 이상(grade1+2+3 제외) 기준 위험으로 집계
            </div>
          </div>
        </ChartCard>
      </div>

    </div>
  )
}
