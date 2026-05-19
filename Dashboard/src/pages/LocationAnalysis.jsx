import { useMemo, useRef, useState, useCallback } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './LocationAnalysis.css'

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

function useOof() {
  return useCSV('/oof_meta.csv')
}

const THRESH = 0.5

/* ── Position별 ── */
export function PositionPage() {
  const { data, loading } = useOof()

  const posData = useMemo(() => {
    if (!data.length) return []
    const map = {}
    for (const r of data) {
      const pos = parseInt(r.position, 10)
      if (!map[pos]) map[pos] = { total: 0, defect: 0, sum: 0 }
      map[pos].total += 1
      map[pos].sum += parseFloat(r.clf_proba_mean) || 0
      if ((parseFloat(r.clf_proba_mean) || 0) >= THRESH) map[pos].defect += 1
    }
    return [1, 2, 3, 4].map(pos => ({
      pos: `Position ${pos}`,
      rate: map[pos] ? parseFloat((map[pos].defect / map[pos].total * 100).toFixed(2)) : 0,
      count: map[pos] ? map[pos].defect : 0,
      mean_proba: map[pos] ? parseFloat((map[pos].sum / map[pos].total).toFixed(4)) : 0,
    }))
  }, [data])

  if (loading || !posData.length) {
    return <div className="loc-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8', fontSize:14 }}>데이터 로딩 중…</div>
  }

  const maxRate = Math.max(...posData.map(d => d.rate))

  const barOpt = {
    tooltip: { trigger:'axis', formatter: p => `${p[0].name}<br/>불량률: ${p[0].value}%<br/>불량 건수: ${posData[p[0].dataIndex].count.toLocaleString()}건` },
    grid: { top:20, left:90, right:60, bottom:20 },
    xAxis: { type:'value', max: parseFloat((maxRate * 1.3).toFixed(1)), axisLabel:{ formatter:'{value}%', fontSize:10, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    yAxis: { type:'category', data:posData.map(d=>d.pos), axisLabel:{ fontSize:11, color:'#475569' } },
    series: [{
      type:'bar', data:posData.map(d=>d.rate), barMaxWidth:28,
      itemStyle: {
        color: p => ['#3B82F6','#F97316','#EF4444','#8B5CF6'][p.dataIndex],
        borderRadius:[0,5,5,0],
      },
      label:{ show:true, position:'right', formatter:'{c}%', fontSize:11, color:'#475569' },
    }],
  }

  const radarOpt = {
    tooltip: {},
    radar: {
      indicator: posData.map(d => ({ name:d.pos, max: parseFloat((maxRate * 1.4).toFixed(1)) })),
      radius:'65%',
    },
    series: [{
      type:'radar',
      data:[{ value:posData.map(d=>d.rate), name:'불량률', areaStyle:{ color:'rgba(59,130,246,.15)' }, lineStyle:{ color:'#3B82F6' }, itemStyle:{ color:'#3B82F6' } }],
    }],
  }

  return (
    <div className="loc-page">
      <div className="two-col">
        <ChartCard title="📍 Position별 불량률" tag="수평 바차트">
          <ReactECharts option={barOpt} style={{ height:220 }} />
        </ChartCard>
        <ChartCard title="📡 Position 불량 레이더" tag="방사형">
          <ReactECharts option={radarOpt} style={{ height:220 }} />
        </ChartCard>
      </div>
      <ChartCard title="📋 Position별 상세 수치" tag="실데이터">
        <table className="loc-table">
          <thead><tr><th>Position</th><th>불량 건수</th><th>불량률</th><th>평균 예측확률</th><th>위험도</th></tr></thead>
          <tbody>
            {posData.map((d,i) => (
              <tr key={i}>
                <td><b>{d.pos}</b></td>
                <td style={{ fontFamily:'DM Mono,monospace' }}>{d.count.toLocaleString()}</td>
                <td style={{ fontFamily:'DM Mono,monospace', color: d.rate>=5?'#EF4444':d.rate>=4?'#F97316':'#22C55E', fontWeight:600 }}>{d.rate}%</td>
                <td style={{ fontFamily:'DM Mono,monospace', color:'#475569' }}>{d.mean_proba.toFixed(4)}</td>
                <td><span className={`risk-badge ${d.rate>=5?'high':d.rate>=4?'med':'low'}`}>{d.rate>=5?'HIGH':d.rate>=4?'MED':'LOW'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  )
}

/* ── Lot별 ── */
export function LotPage() {
  return (
    <div className="loc-page" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, outline: '3px solid #EF4444', outlineOffset: '-3px' }}>
      <div className="dummy-page-banner">🔴 DUMMY PAGE — run_wf_xy 파싱 후 실제 Lot ID 연결 필요</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>📦 Lot별 분석</div>
      <div style={{ fontSize: 13, color: 'var(--text3)' }}>Lot별 위험 unit 수 및 불량률을 비교합니다.</div>

      <div style={{
        padding: '48px 24px',
        background: '#FEF2F2',
        border: '2px solid #EF4444',
        borderRadius: 12,
        textAlign: 'center',
        color: '#B91C1C',
        fontSize: 13,
      }}>
        🔴 Lot별 바차트 (구현 예정)<br/>
        <span style={{ fontSize: 11, marginTop: 8, display: 'block', color: '#9CA3AF' }}>
          run_wf_xy → Lot ID 파싱 → lot별 불량 unit 수 / 불량률 바차트<br/>
          선택한 lot → wafer별 드릴다운
        </span>
      </div>
    </div>
  )
}

/* ── Wafer별 ── */
export function WaferPage() {
  return (
    <div className="loc-page" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, outline: '3px solid #EF4444', outlineOffset: '-3px' }}>
      <div className="dummy-page-banner">🔴 DUMMY PAGE — run_wf_xy 파싱 후 실제 Wafer 번호 연결 필요</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>🧿 Wafer별 분석</div>
      <div style={{ fontSize: 13, color: 'var(--text3)' }}>Wafer별 불량 분포 및 Position 드릴다운을 제공합니다.</div>

      <div style={{
        padding: '48px 24px',
        background: '#FEF2F2',
        border: '2px solid #EF4444',
        borderRadius: 12,
        textAlign: 'center',
        color: '#B91C1C',
        fontSize: 13,
      }}>
        🔴 Wafer별 히트맵 (구현 예정)<br/>
        <span style={{ fontSize: 11, marginTop: 8, display: 'block', color: '#9CA3AF' }}>
          run_wf_xy → Wafer 번호 파싱 → wafer별 불량률 히트맵<br/>
          선택한 wafer → position별 드릴다운
        </span>
      </div>
    </div>
  )
}

/* ── Unit별 웨이퍼맵 (position 기반 근사 — die_x/die_y 실좌표 아님) ── */
export function UnitMapPage() {
  const { data, loading } = useOof()

  // run_wf_xy가 없으므로 position(1~4) 기반으로 웨이퍼 4분면 시각화
  // 대신: die 위치를 인위적 웨이퍼 격자에 매핑해서 실제 clf_proba 분포를 표현
  const SIZE = 20
  const CENTER = 9.5
  const RADIUS = 9.0

  // position별 평균 clf_proba 계산 (실데이터)
  const posProba = useMemo(() => {
    if (!data.length) return { 1: 0.35, 2: 0.35, 3: 0.35, 4: 0.35 }
    const map = {}
    for (const r of data) {
      const pos = parseInt(r.position, 10)
      if (!map[pos]) map[pos] = { sum: 0, cnt: 0 }
      map[pos].sum += parseFloat(r.clf_proba_mean) || 0
      map[pos].cnt += 1
    }
    const result = {}
    for (const [p, v] of Object.entries(map)) result[p] = v.cnt ? v.sum / v.cnt : 0.35
    return result
  }, [data])

  const hmData = useMemo(() => {
    const result = []
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dist = Math.sqrt((x - CENTER) ** 2 + (y - CENTER) ** 2)
        if (dist > RADIUS) continue
        // 4분면으로 position 매핑 (실 데이터의 position별 평균 proba 반영)
        const quadrant = x >= CENTER
          ? (y >= CENTER ? 4 : 1)   // 우상=P1, 우하=P4
          : (y >= CENTER ? 3 : 2)   // 좌하=P3, 좌상=P2
        const baseProba = posProba[quadrant] || 0.35
        // edge effect (원본 edge effect 반영)
        const edgeFactor = dist > 7 ? 0.15 : dist > 5 ? 0.05 : -0.02
        const noise = (Math.random() - 0.5) * 0.08
        const val = Math.min(1, Math.max(0, baseProba + edgeFactor + noise))
        result.push([x, y, parseFloat(val.toFixed(3))])
      }
    }
    return result
  }, [posProba])

  const axisLabels = [...Array(SIZE).keys()]

  const hmOpt = {
    tooltip: {
      formatter: p => `die (${p.data[0]}, ${p.data[1]})<br/>불량 확률: ${(p.data[2]*100).toFixed(1)}%<br/>Position: ${p.data[0]>=CENTER?(p.data[1]>=CENTER?'P4':'P1'):(p.data[1]>=CENTER?'P3':'P2')}`
    },
    visualMap: {
      min: 0, max: 1,
      calculable: true,
      orient: 'horizontal', bottom: 8, left: 'center',
      inRange: { color: ['#FFFFFF','#FFE4E4','#FCA5A5','#F87171','#EF4444'] },
      textStyle: { fontSize: 10, color: '#94A3B8' },
      text: ['불량(1.0)','정상(0.0)'],
    },
    grid: { top: 0, left: 0, right: 0, bottom: 55 },
    xAxis: {
      type: 'category', data: axisLabels,
      axisLabel: { show: false },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category', data: axisLabels,
      axisLabel: { show: false },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
    },
    series: [{
      type: 'heatmap', data: hmData,
      itemStyle: { borderColor: '#fff', borderWidth: 0.5 },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.2)' } },
    }],
    graphic: [],
  }

  const shimmerRef = useRef(null)
  const [shimmer, setShimmer] = useState({ x: 50, y: 50, opacity: 0 })

  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setShimmer({ x, y, opacity: 1 })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setShimmer(s => ({ ...s, opacity: 0 }))
  }, [])

  if (loading) {
    return <div className="loc-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8', fontSize:14 }}>데이터 로딩 중…</div>
  }

  // position별 불량률 요약
  const posSummary = [1,2,3,4].map(p => ({
    pos: `P${p}`, proba: posProba[p] ? (posProba[p]*100).toFixed(1) : '-',
    color: ['#3B82F6','#8B5CF6','#EF4444','#F97316'][p-1],
  }))

  return (
    <div className="loc-page">
      <ChartCard title="🗺 웨이퍼맵 — Position별 불량 확률 분포" tag="clf_proba_mean 기반">
        <div style={{
          padding: '7px 12px',
          background: '#FFFBEB',
          border: '1.5px solid #F59E0B',
          borderRadius: 6,
          fontSize: 11,
          color: '#92400E',
          marginBottom: 10,
        }}>
          🟡 <b>근사 시각화</b> — die_x/die_y 실좌표 없음. position(1~4)을 4분면에 매핑하고 노이즈를 추가한 근사치입니다. 실제 웨이퍼 좌표 데이터 연결 시 교체 필요.
        </div>
        <div style={{ fontSize:11, color:'#94A3B8', marginBottom:8, display:'flex', gap:16, flexWrap:'wrap' }}>
          {posSummary.map(s => (
            <span key={s.pos}>
              <span style={{ color:s.color, fontWeight:700 }}>{s.pos}</span>: 평균 {s.proba}%
            </span>
          ))}
          <span style={{ marginLeft:'auto' }}>
            <span style={{ color:'#EF4444', fontWeight:600 }}>빨간색</span> = 불량 위험 높음 &nbsp;·&nbsp;
            <span style={{ color:'#94A3B8' }}>흰색</span> = 정상
          </span>
        </div>
        <div style={{ display:'flex', justifyContent:'center' }}>
          <div
            ref={shimmerRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ position:'relative', width: 620, height: 620, borderRadius:'50%', cursor:'crosshair' }}
          >
            <ReactECharts option={hmOpt} style={{ width: '100%', height: '100%' }} />
            {/* 웨이퍼 광택 — 메인 무지개 레이어 */}
            <div style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              pointerEvents: 'none',
              transition: 'opacity 0.1s ease',
              opacity: shimmer.opacity,
              background: `
                radial-gradient(ellipse 60% 40% at ${shimmer.x}% ${shimmer.y}%,
                  rgba(255,255,255,0.7) 0%,
                  rgba(255,50,150,0.5) 8%,
                  rgba(255,200,0,0.5) 18%,
                  rgba(0,255,120,0.5) 28%,
                  rgba(0,150,255,0.5) 40%,
                  rgba(150,0,255,0.5) 55%,
                  rgba(255,50,50,0.3) 70%,
                  transparent 90%
                )
              `,
              mixBlendMode: 'screen',
            }} />
            {/* 2번째 — 하이라이트 흰빛 핵심 */}
            <div style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              pointerEvents: 'none',
              opacity: shimmer.opacity,
              background: `
                radial-gradient(ellipse 20% 12% at ${shimmer.x}% ${shimmer.y}%,
                  rgba(255,255,255,0.6) 0%,
                  rgba(255,255,255,0.3) 40%,
                  transparent 100%
                )
              `,
              mixBlendMode: 'screen',
            }} />
            {/* 3번째 — 반대편 보조 무지개 */}
            <div style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              pointerEvents: 'none',
              opacity: shimmer.opacity * 0.35,
              background: `
                radial-gradient(ellipse 40% 25% at ${100 - shimmer.x}% ${100 - shimmer.y}%,
                  rgba(0,255,255,0.6) 0%,
                  rgba(255,0,200,0.4) 30%,
                  rgba(255,255,0,0.3) 60%,
                  transparent 100%
                )
              `,
              mixBlendMode: 'screen',
            }} />
          </div>
        </div>
      </ChartCard>
    </div>
  )
}

/* ── Die 좌표 히트맵 (location_stats.csv 실데이터) ── */
export function DieMapPage() {
  const { data: locData, loading } = useCSV('/location_stats.csv')

  const { heatData, xLabels, yLabels, maxPpm, avgPpm, highCells } = useMemo(() => {
    if (!locData.length) return { heatData: [], xLabels: [], yLabels: [], maxPpm: 0, avgPpm: 0, highCells: 0 }

    const xs = locData.map(d => parseInt(d.die_x)).filter(isFinite)
    const ys = locData.map(d => parseInt(d.die_y)).filter(isFinite)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)

    const xLabels = [...Array(xMax - xMin + 1)].map((_, i) => xMin + i)
    const yLabels = [...Array(yMax - yMin + 1)].map((_, i) => yMin + i)

    const ppmVals = locData.map(d => parseFloat(d.ppm_mean)).filter(isFinite)
    const maxPpm  = Math.max(...ppmVals, 1)
    const avgPpm  = ppmVals.length ? Math.round(ppmVals.reduce((a, b) => a + b, 0) / ppmVals.length) : 0

    const heatData = locData.map(d => [
      parseInt(d.die_x) - xMin,
      parseInt(d.die_y) - yMin,
      parseFloat(d.ppm_mean) || 0,
    ])

    const riskPpm = maxPpm * 0.292  // 29.2% threshold 근사
    const highCells = locData.filter(d => parseFloat(d.risk_rate) > 30).length

    return { heatData, xLabels, yLabels, maxPpm, avgPpm, highCells }
  }, [locData])

  const xMin = heatData.length ? Math.min(...locData.map(d => parseInt(d.die_x))) : 0
  const yMin = heatData.length ? Math.min(...locData.map(d => parseInt(d.die_y))) : 0
  const locIndex = useMemo(() => {
    const m = {}
    locData.forEach(d => { m[`${d.die_x},${d.die_y}`] = d })
    return m
  }, [locData])

  if (loading) return (
    <div className="loc-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8', fontSize:14 }}>데이터 로딩 중…</div>
  )
  if (!heatData.length) return (
    <div className="loc-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8', fontSize:14 }}>location_stats.csv 없음</div>
  )

  const hmOpt = {
    tooltip: {
      formatter: p => {
        const realX = p.data[0] + xMin
        const realY = p.data[1] + yMin
        const d = locIndex[`${realX},${realY}`] || {}
        return [
          `Die (${realX}, ${realY})`,
          `평균 PPM: <b>${Math.round(p.data[2]).toLocaleString()}</b>`,
          `최대 PPM: ${Math.round(parseFloat(d.ppm_max) || 0).toLocaleString()}`,
          `위험률: ${parseFloat(d.risk_rate || 0).toFixed(1)}%`,
          `샘플 수: ${parseInt(d.count || 0).toLocaleString()}`,
          `반경: ${parseFloat(d.radial_dist || 0).toFixed(1)}`,
        ].join('<br/>')
      }
    },
    visualMap: {
      min: 0, max: maxPpm,
      calculable: true,
      orient: 'horizontal', bottom: 4, left: 'center',
      inRange: { color: ['#eff6ff', '#bfdbfe', '#fef3c7', '#fca5a5', '#dc2626'] },
      textStyle: { fontSize: 10, color: '#94A3B8' },
      text: [`${Math.round(maxPpm).toLocaleString()} ppm`, '0'],
    },
    grid: { top: 20, left: 40, right: 30, bottom: 70 },
    xAxis: {
      type: 'category', data: xLabels,
      axisLabel: { fontSize: 8, color: '#94A3B8', interval: Math.floor(xLabels.length / 10) },
      splitLine: { show: false },
      name: 'die_x', nameTextStyle: { fontSize: 10, color: '#94A3B8' },
    },
    yAxis: {
      type: 'category', data: yLabels,
      axisLabel: { fontSize: 8, color: '#94A3B8', interval: Math.floor(yLabels.length / 10) },
      splitLine: { show: false },
      name: 'die_y', nameTextStyle: { fontSize: 10, color: '#94A3B8' },
    },
    series: [{
      type: 'heatmap', data: heatData,
      itemStyle: { borderColor: '#fff', borderWidth: 0.3 },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.3)' } },
    }],
  }

  // 반경별 집계
  const radialBins = useMemo(() => {
    if (!locData.length) return []
    const bins = [
      { label: '0-3', min: 0, max: 3 },
      { label: '3-6', min: 3, max: 6 },
      { label: '6-9', min: 6, max: 9 },
      { label: '9-12', min: 9, max: 12 },
      { label: '12+', min: 12, max: Infinity },
    ]
    return bins.map(bin => {
      const rows = locData.filter(d => {
        const r = parseFloat(d.radial_dist)
        return isFinite(r) && r >= bin.min && r < bin.max
      })
      const ppmVals = rows.map(d => parseFloat(d.ppm_mean)).filter(isFinite)
      return {
        label: bin.label,
        avgPpm: ppmVals.length ? Math.round(ppmVals.reduce((a, b) => a + b, 0) / ppmVals.length) : 0,
        cellCount: rows.length,
        avgRisk: rows.length
          ? parseFloat((rows.map(d => parseFloat(d.risk_rate) || 0).reduce((a, b) => a + b, 0) / rows.length).toFixed(1))
          : 0,
      }
    })
  }, [locData])

  const radialOpt = {
    tooltip: { trigger: 'axis', formatter: p => `반경 ${p[0].name}<br/>평균 PPM: ${p[0].value.toLocaleString()}<br/>위험률: ${radialBins[p[0].dataIndex]?.avgRisk}%` },
    grid: { top: 20, left: 60, right: 30, bottom: 30 },
    xAxis: { type: 'category', data: radialBins.map(b => b.label), axisLabel: { fontSize: 10, color: '#475569' }, name: '반경', nameTextStyle: { fontSize: 10, color: '#94A3B8' } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#94A3B8', formatter: v => `${v.toLocaleString()}` }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
    series: [{
      type: 'bar', data: radialBins.map(b => b.avgPpm), barMaxWidth: 40,
      itemStyle: { color: p => ['#22c55e','#84cc16','#eab308','#f97316','#dc2626'][p.dataIndex], borderRadius: [4, 4, 0, 0] },
      label: { show: true, position: 'top', fontSize: 10, formatter: p => p.value.toLocaleString() },
    }],
  }

  return (
    <div className="loc-page">
      {/* 요약 수치 */}
      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { label: 'Die 좌표 수', val: locData.length.toLocaleString(), color: '#3b82f6' },
          { label: '평균 PPM', val: avgPpm.toLocaleString(), color: '#f97316' },
          { label: '최대 PPM', val: Math.round(maxPpm).toLocaleString(), color: '#dc2626' },
          { label: '위험률>30% 셀', val: highCells.toLocaleString(), color: '#8b5cf6' },
        ].map((s, i) => (
          <div key={i} style={{
            flex: 1, padding: '10px 14px',
            background: 'var(--surface)', border: '1.5px solid var(--border)', borderRadius: 8,
          }}>
            <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.color, fontFamily: 'DM Mono,monospace' }}>{s.val}</div>
          </div>
        ))}
      </div>

      <ChartCard title="🗺 Die 좌표별 평균 예측 PPM" tag="location_stats.csv">
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          셀 색상: 밝은 파랑(낮음) → 노랑 → 빨강(높음). 마우스 올리면 상세 수치 표시.
        </div>
        <ReactECharts option={hmOpt} style={{ height: 460 }} />
      </ChartCard>

      <ChartCard title="📡 반경별 평균 PPM (Edge 효과)" tag="die_x/die_y 중심 거리">
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
          웨이퍼 중심(반경 0)에서 외곽(반경 12+)으로 갈수록 PPM이 높아지는지 확인합니다.
        </div>
        <ReactECharts option={radialOpt} style={{ height: 200 }} />
        <table className="loc-table" style={{ marginTop: 8 }}>
          <thead><tr><th>반경 구간</th><th>셀 수</th><th>평균 PPM</th><th>평균 위험률</th></tr></thead>
          <tbody>
            {radialBins.map((b, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{b.label}</td>
                <td style={{ fontFamily: 'DM Mono,monospace' }}>{b.cellCount}</td>
                <td style={{ fontFamily: 'DM Mono,monospace', color: b.avgPpm > avgPpm ? '#dc2626' : '#16a34a', fontWeight: 600 }}>{b.avgPpm.toLocaleString()}</td>
                <td style={{ fontFamily: 'DM Mono,monospace' }}>{b.avgRisk}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ChartCard>
    </div>
  )
}

/* ── Wafer별 히트맵 + Zone별 ── */
export function WaferZonePage() {
  const { data, loading } = useOof()

  // ufs_serial의 숫자로 wafer 그룹 추정 (serial // 100 % 25 → W01~W25)
  const waferPosData = useMemo(() => {
    if (!data.length) return { wafers: [], positions: ['P1','P2','P3','P4'], cells: [] }
    const map = {}
    for (const r of data) {
      const num = parseInt((r.ufs_serial || '').replace(/\D/g, ''), 10) || 0
      const wafer = `W${String((Math.floor(num / 100) % 12) + 1).padStart(2, '0')}`
      const pos = `P${r.position}`
      const key = `${wafer}|${pos}`
      if (!map[key]) map[key] = { sum: 0, cnt: 0 }
      map[key].sum += parseFloat(r.clf_proba_mean) || 0
      map[key].cnt += 1
    }
    const wafers = [...new Set(Object.keys(map).map(k => k.split('|')[0]))].sort()
    const positions = ['P1','P2','P3','P4']
    const cells = []
    wafers.forEach((w, wi) => {
      positions.forEach((p, pi) => {
        const key = `${w}|${p}`
        const v = map[key] ? map[key].sum / map[key].cnt : null
        if (v !== null) cells.push([pi, wi, parseFloat(v.toFixed(3))])
      })
    })
    return { wafers, positions, cells }
  }, [data])

  // Zone별: unit serial 기준 (앞 절반 = center, 다음 = middle, 나머지 = edge)
  const zoneData = useMemo(() => {
    if (!data.length) return { center: 0, middle: 0, edge: 0 }
    const unitMap = {}
    for (const r of data) {
      const uid = r.ufs_serial
      const p = parseFloat(r.clf_proba_mean) || 0
      if (!unitMap[uid]) unitMap[uid] = { maxP: p }
      else unitMap[uid].maxP = Math.max(unitMap[uid].maxP, p)
    }
    const nums = Object.entries(unitMap).map(([uid, v]) => {
      const n = parseInt(uid.replace(/\D/g, ''), 10) || 0
      return { n, maxP: v.maxP }
    }).sort((a, b) => a.n - b.n)
    const total = nums.length
    const third = Math.floor(total / 3)
    let center = 0, middle = 0, edge = 0
    nums.forEach((u, i) => {
      if (u.maxP < THRESH) return
      if (i < third) center++
      else if (i < third * 2) middle++
      else edge++
    })
    return { center, middle, edge }
  }, [data])

  if (loading || !waferPosData.wafers.length) {
    return <div className="loc-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8', fontSize:14 }}>데이터 로딩 중…</div>
  }

  const waferOpt = {
    tooltip: { formatter: p => `${waferPosData.wafers[p.data[1]]} · ${waferPosData.positions[p.data[0]]}<br/>평균 불량확률: ${(p.data[2]*100).toFixed(1)}%` },
    visualMap: { min:0, max:1, orient:'horizontal', bottom:0, left:'center',
      inRange:{ color:['#F0FDF4','#FFF7ED','#FEF2F2','#EF4444'] },
      textStyle:{ fontSize:10, color:'#94A3B8' }, text:['불량','정상'] },
    grid: { top:10, left:50, right:20, bottom:60 },
    xAxis: { type:'category', data:waferPosData.positions, axisLabel:{ fontSize:11, color:'#475569' } },
    yAxis: { type:'category', data:waferPosData.wafers, axisLabel:{ fontSize:10, color:'#94A3B8' } },
    series: [{ type:'heatmap', data:waferPosData.cells, emphasis:{ itemStyle:{ shadowBlur:8 } } }],
  }

  const totalZone = zoneData.center + zoneData.middle + zoneData.edge || 1
  const zoneOpt = {
    tooltip: { trigger:'item', formatter:'{b}: {c}건 ({d}%)' },
    legend: { bottom:0, textStyle:{ fontSize:11, color:'#475569' } },
    series: [{
      type:'pie', radius:['30%','70%'], center:['50%','45%'],
      data:[
        { value:zoneData.center, name:'Serial 하위 1/3 (Center)', itemStyle:{ color:'#22C55E' } },
        { value:zoneData.middle, name:'Serial 중간 1/3 (Middle)', itemStyle:{ color:'#F97316' } },
        { value:zoneData.edge,   name:'Serial 상위 1/3 (Edge)',   itemStyle:{ color:'#EF4444' } },
      ],
      label:{ fontSize:11 },
    }],
  }

  return (
    <div className="loc-page">
      <ChartCard title="📊 Wafer × Position 불량 히트맵" tag="clf_proba_mean 평균">
        <div style={{
          padding: '7px 12px',
          background: '#FFFBEB',
          border: '1.5px solid #F59E0B',
          borderRadius: 6,
          fontSize: 11,
          color: '#92400E',
          marginBottom: 10,
        }}>
          🟡 <b>Wafer 그룹이 가짜</b> — ufs_serial 숫자를 100으로 나눈 나머지로 W01~W12를 임의 추정한 값입니다. run_wf_xy 실데이터 연결 시 교체 필요.
        </div>
        <ReactECharts option={waferOpt} style={{ height:320 }} />
      </ChartCard>
      <ChartCard title="🎯 Serial 구간별 불량 분포" tag="구간별 불량 unit 수">
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ flex:1 }}>
            <ReactECharts option={zoneOpt} style={{ height:220 }} />
          </div>
          <div style={{ width:200 }}>
            {[
              { zone:'상위 1/3 (Edge)',   count:zoneData.edge,   rate:(zoneData.edge/totalZone*100).toFixed(1),   color:'#EF4444', desc:'Serial 상위 그룹 — 불량 집중 여부 확인' },
              { zone:'중간 1/3 (Middle)', count:zoneData.middle, rate:(zoneData.middle/totalZone*100).toFixed(1), color:'#F97316', desc:'중간 Serial 그룹' },
              { zone:'하위 1/3 (Center)', count:zoneData.center, rate:(zoneData.center/totalZone*100).toFixed(1), color:'#22C55E', desc:'Serial 하위 그룹' },
            ].map((z,i) => (
              <div key={i} style={{ marginBottom:12, padding:'8px 10px', borderRadius:8, border:'1px solid #E2E8F0' }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ fontSize:11, fontWeight:600, color:z.color }}>{z.zone}</span>
                  <span style={{ fontSize:12, fontFamily:'DM Mono,monospace', fontWeight:700, color:z.color }}>{z.rate}%</span>
                </div>
                <div style={{ fontSize:10, color:'#94A3B8', marginTop:3 }}>{z.desc} ({z.count.toLocaleString()}건)</div>
              </div>
            ))}
          </div>
        </div>
      </ChartCard>
    </div>
  )
}
