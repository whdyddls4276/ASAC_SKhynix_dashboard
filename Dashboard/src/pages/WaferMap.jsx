import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './WaferMap.css'

// 실제 날짜(wafer_map.csv date 컬럼) → 트렌드 기준 표시 날짜 (159일 shift)
// 실제 최신: 2025-11-29 → 표시 오늘: 2026-05-07
const DATE_OFFSET_MS = 159 * 24 * 60 * 60 * 1000
function shiftDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  d.setTime(d.getTime() + DATE_OFFSET_MS)
  return d.toISOString().slice(0, 10)
}

const WAFER_CX = 39, WAFER_CY = 21.5, WAFER_R = 27

export default function WaferMap() {
  const { data: dies, loading } = useCSV('/wafer_map.csv')

  const [selLot, setSelLot] = useState(null)
  const [selWafer, setSelWafer] = useState(null)
  const waferChartRef = useRef(null)

  const drawCircle = useCallback(() => {
    const chart = waferChartRef.current?.getEchartsInstance?.()
    if (!chart) return
    const center = chart.convertToPixel('grid', [WAFER_CX, WAFER_CY])
    const edgeX = chart.convertToPixel('grid', [WAFER_CX + WAFER_R, WAFER_CY])
    const edgeY = chart.convertToPixel('grid', [WAFER_CX, WAFER_CY + WAFER_R])
    const rx = Math.abs(edgeX[0] - center[0])
    const ry = Math.abs(edgeY[1] - center[1])
    if (!rx || isNaN(rx)) return
    chart.setOption({
      graphic: [{
        type: 'ellipse',
        shape: { cx: center[0], cy: center[1], rx, ry },
        style: { fill: 'none', stroke: '#94A3B8', lineWidth: 2 },
        z: 100,
      }]
    })
  }, [])

  useEffect(() => {
    if (!selLot || !selWafer) return
    const t = setTimeout(drawCircle, 80)
    return () => clearTimeout(t)
  }, [selLot, selWafer, drawCircle])

  // lot 목록 + lot별 wafer 목록 + lot별 위험 unit 수
  const { lots, wafersByLot, lotDateMap } = useMemo(() => {
    if (!dies.length) return { lots: [], wafersByLot: {} }
    const wbl = {}
    dies.forEach(d => {
      const lot = Math.round(parseFloat(d.run_id))
      const wafer = Math.round(parseFloat(d.wafer_no))
      if (!wbl[lot]) wbl[lot] = new Set()
      wbl[lot].add(wafer)
    })
    const lots = Object.keys(wbl).map(Number).sort((a, b) => a - b)
    const wafersByLot = {}
    lots.forEach(lot => { wafersByLot[lot] = [...wbl[lot]].sort((a, b) => a - b) })

    // lot → 표시 날짜 매핑 (date 컬럼 max + 159일 shift)
    const lotDateMap = {}
    dies.forEach(d => {
      const lot = Math.round(parseFloat(d.run_id))
      if (!lotDateMap[lot] || d.date > lotDateMap[lot]) lotDateMap[lot] = d.date
    })
    Object.keys(lotDateMap).forEach(lot => {
      lotDateMap[lot] = shiftDate(lotDateMap[lot])
    })

    return { lots, wafersByLot, lotDateMap }
  }, [dies])

  // 데이터 로드 후 최신 val lot 자동 선택
  useEffect(() => {
    if (!dies.length || selLot !== null) return
    const valDies = dies.filter(d => d.split === 'val')
    if (!valDies.length) return
    const maxLot = Math.max(...valDies.map(d => Math.round(parseFloat(d.run_id))))
    setSelLot(maxLot)
  }, [dies, selLot])

  // Lot별 위험 unit 수 바차트 (val 전체)
  const lotBarOption = useMemo(() => {
    if (!dies.length) return null
    const valDies = dies.filter(d => d.split === 'val')
    const lotMap = {}
    valDies.forEach(d => {
      const lot = Math.round(parseFloat(d.run_id))
      if (!lotMap[lot]) lotMap[lot] = { danger: 0, total: 0 }
      lotMap[lot].total++
      if (parseFloat(d.pred) > 0.003412) lotMap[lot].danger++
    })
    const sorted = Object.entries(lotMap).sort((a, b) => a[0] - b[0])
    return {
      tooltip: { trigger: 'axis', formatter: p => `${p[0].axisValue}<br/>위험 unit: ${p[0].value}개` },
      grid: { top: 10, bottom: 50, left: 50, right: 10 },
      xAxis: { type: 'category', data: sorted.map(([lot]) => lotDateMap[lot] ?? lot), axisLabel: { fontSize: 9, rotate: 35 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: [{
        type: 'bar',
        data: sorted.map(([lot, d]) => ({
          value: d.danger,
          lot: parseFloat(lot),
          itemStyle: { color: parseFloat(lot) === selLot ? '#6366F1' : '#EF4444', borderRadius: [3, 3, 0, 0] },
        })),
        barMaxWidth: 24,
      }],
    }
  }, [dies, selLot, lotDateMap])

  // 선택 Lot의 Wafer별 위험 unit 수 바차트
  const waferBarOption = useMemo(() => {
    if (!selLot || !dies.length) return null
    const lotDies = dies.filter(d => d.split === 'val' && Math.round(parseFloat(d.run_id)) === selLot)
    const waferMap = {}
    lotDies.forEach(d => {
      const w = Math.round(parseFloat(d.wafer_no))
      if (!waferMap[w]) waferMap[w] = { danger: 0, total: 0 }
      waferMap[w].total++
      if (parseFloat(d.pred) > 0.003412) waferMap[w].danger++
    })
    const sorted = Object.entries(waferMap).sort((a, b) => a[0] - b[0])
    return {
      tooltip: { trigger: 'axis', formatter: p => `Wafer ${p[0].axisValue}<br/>위험 unit: ${p[0].value}개` },
      grid: { top: 10, bottom: 40, left: 50, right: 10 },
      xAxis: { type: 'category', data: sorted.map(([w]) => `W${w}`), axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
      series: [{
        type: 'bar',
        data: sorted.map(([w, d]) => ({
          value: d.danger,
          wafer: parseFloat(w),
          itemStyle: { color: parseFloat(w) === selWafer ? '#6366F1' : '#F97316', borderRadius: [3, 3, 0, 0] },
        })),
        barMaxWidth: 28,
      }],
    }
  }, [dies, selLot, selWafer])

  // 선택 Wafer의 웨이퍼맵 scatter — 원형 (중심 39,21.5 / 반지름 27)
  const waferMapOption = useMemo(() => {
    if (!selLot || !selWafer || !dies.length) return null
    const raw = dies.filter(d =>
      Math.round(parseFloat(d.run_id)) === selLot &&
      Math.round(parseFloat(d.wafer_no)) === selWafer
    )
    if (!raw.length) return null
    // 원형 영역 안 die만
    const filtered = raw.filter(d => {
      const dx = parseFloat(d.die_x) - WAFER_CX
      const dy = parseFloat(d.die_y) - WAFER_CY
      return Math.sqrt(dx * dx + dy * dy) <= WAFER_R
    })
    const maxPred = Math.max(...filtered.map(d => parseFloat(d.pred)))
    return {
      tooltip: { formatter: p => `die(${p.data[0]}, ${p.data[1]})<br/>예측 불량지수: ${p.data[2].toFixed(6)}` },
      visualMap: {
        min: 0, max: maxPred || 0.01,
        calculable: true, orient: 'horizontal', left: 'center', bottom: 8,
        inRange: { color: ['#22C55E', '#FCD34D', '#EF4444'] },
        textStyle: { fontSize: 10 },
      },
      grid: { top: 10, bottom: 60, left: 10, right: 10, containLabel: false },
      xAxis: {
        type: 'value', min: WAFER_CX - WAFER_R - 1, max: WAFER_CX + WAFER_R + 1,
        show: false, splitLine: { show: false },
      },
      yAxis: {
        type: 'value', min: WAFER_CY - WAFER_R - 1, max: WAFER_CY + WAFER_R + 1,
        show: false, splitLine: { show: false },
      },
      series: [{
        type: 'scatter',
        data: filtered.map(d => [parseFloat(d.die_x), parseFloat(d.die_y), parseFloat(d.pred)]),
        symbolSize: 10,
        emphasis: { scale: 1.5 },
      }],
    }
  }, [dies, selLot, selWafer])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 14 }}>
      데이터 로딩 중…
    </div>
  )

  return (
    <div className="wafermap-page">
      <div className="wm-header">
        <div className="wm-title">🗺 웨이퍼맵</div>
        <div className="wm-desc">Lot 막대 클릭 → Wafer 선택 → 웨이퍼맵 순으로 드릴다운합니다.</div>
      </div>
      <div style={{ fontSize:11, color:'#64748B', marginBottom:8 }}>
        📅 기준일: 2026-05-07 — 최근 WT 완료분 기준 (Lot {Math.max(...(lots.filter(l => l <= 56)))})
      </div>

      {/* Step 1: Lot별 위험 unit 수 */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', marginBottom: 8 }}>
          📅 Lot별 위험 unit 수 — 막대 클릭 시 Wafer 상세
          {selLot && <span style={{ marginLeft: 8, color: '#6366F1' }}>선택: Lot {selLot} ({lotDateMap[selLot] ?? selLot})</span>}
        </div>
        <ReactECharts
          option={lotBarOption}
          style={{ height: 220 }}
          onEvents={{ click: p => { setSelLot(p.data.lot); setSelWafer(null) } }}
        />
      </div>

      {/* Step 2: Wafer별 위험 unit 수 */}
      {selLot && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', marginBottom: 8 }}>
            🏭 Lot {selLot} ({lotDateMap[selLot] ?? selLot}) — Wafer별 위험 unit 수 — 막대 클릭 시 웨이퍼맵
            {selWafer && <span style={{ marginLeft: 8, color: '#6366F1' }}>선택: Wafer {selWafer}</span>}
          </div>
          {waferBarOption
            ? <ReactECharts
                option={waferBarOption}
                style={{ height: 220 }}
                onEvents={{ click: p => setSelWafer(p.data.wafer) }}
              />
            : <div style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: 40 }}>데이터 없음</div>
          }
        </div>
      )}

      {/* Step 3: 웨이퍼맵 히트맵 */}
      {selLot && selWafer && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', marginBottom: 8 }}>
            🗺 Lot {selLot} ({lotDateMap[selLot] ?? selLot}) — Wafer {selWafer} 웨이퍼맵
            <span style={{ marginLeft: 8, fontSize: 11, color: '#64748B', fontWeight: 400 }}>색상: 예측 불량지수 (초록→노랑→빨강)</span>
          </div>
          {waferMapOption
            ? <div style={{ display: 'flex', justifyContent: 'center' }}>
                <ReactECharts
                  ref={waferChartRef}
                  option={waferMapOption}
                  style={{ width: 500, height: 500 }}
                  onChartReady={drawCircle}
                />
              </div>
            : <div style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: 40 }}>데이터 없음</div>
          }
        </div>
      )}
    </div>
  )
}
