/**
 * 계층별 정밀 분석 — 1팀 Drilldown 구조 포팅 (CSV 기반)
 *
 * 좌측  : Lot 트리 (lot → wafer 리스트, 위험률/번호 정렬)
 * 중앙  : WaferMap SVG (단일 wafer die 히트맵 or lot 누적 max)
 * 우측  : Unit 진단 (verdict + pred ppm + grade)
 *
 * 데이터:
 *   - wafer_map.csv  : ufs_serial, run_id, wafer_no, die_x, die_y, pred, health, clf_proba, split, position
 *   - dashboard_units.csv : ufs_serial, run_id, wafer_no, split, health, reg_pred, risk
 */
import { useState, useMemo, useEffect } from 'react'
import { useCSV } from '../hooks/useCSV'
import ALL_DIE_POSITIONS from './diePositions.js'
import './DrilldownV2.css'

// ── 색상 로직 (1팀 colors.ts 포팅) ───────────────────
const NORMAL_STOPS = [
  [0.0, [243, 244, 246]],
  [0.5, [219, 234, 254]],
  [1.0, [165, 215, 220]],
]
const RISK_STOPS = [
  [0.0,  [254, 240, 138]],
  [0.75, [251, 146, 60]],
  [1.0,  [220, 38, 38]],
]

function interp(stops, t) {
  const tt = Math.max(0, Math.min(1, t))
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]
    const [t0, c0] = stops[i - 1]
    if (tt <= t1) {
      const k = (tt - t0) / (t1 - t0 || 1)
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * k)
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * k)
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * k)
      return `rgb(${r},${g},${b})`
    }
  }
  const last = stops[stops.length - 1][1]
  return `rgb(${last.join(',')})`
}

function predColor(pred, predMin, predMax, threshold) {
  if (!isFinite(pred)) return '#f1f5f9'
  if (pred <= threshold) {
    const span = Math.max(1e-9, threshold - predMin)
    return interp(NORMAL_STOPS, (pred - predMin) / span)
  } else {
    const span = Math.max(1e-9, predMax - threshold)
    return interp(RISK_STOPS, (pred - threshold) / span)
  }
}

const COLOR_LEGEND_GRADIENT =
  'linear-gradient(to right, #f3f4f6, #dbeafe, #a5d7dc, #fef08a, #fef08a, #fb923c, #dc2626)'

// 전체 데이터(oof+val+test)의 die 좌표 글로벌 범위 — 웨이퍼맵 격자 고정용
const GLOBAL_DIE_X_MIN = 12, GLOBAL_DIE_X_MAX = 66
const GLOBAL_DIE_Y_MIN = 11, GLOBAL_DIE_Y_MAX = 32

// ── 스케일 계산 ───────────────────────────────────────
function computeScale(allDies) {
  const preds = allDies.map(d => parseFloat(d.pred)).filter(isFinite)
  const gx = { xRange: GLOBAL_DIE_X_MAX - GLOBAL_DIE_X_MIN + 1, yRange: GLOBAL_DIE_Y_MAX - GLOBAL_DIE_Y_MIN + 1, xMin: GLOBAL_DIE_X_MIN, xMax: GLOBAL_DIE_X_MAX, yMin: GLOBAL_DIE_Y_MIN, yMax: GLOBAL_DIE_Y_MAX }
  if (!preds.length) return { predMin: 0, predMax: 0.02, threshold: 0.005, gridXRange: gx.xRange, gridYRange: gx.yRange, gridXMin: gx.xMin, gridXMax: gx.xMax, gridYMin: gx.yMin, gridYMax: gx.yMax }
  preds.sort((a, b) => a - b)
  const predMin = preds[0]
  const predMax = preds[preds.length - 1]
  const q3 = preds[Math.floor(preds.length * 0.75)] ?? predMin
  const threshold = q3
  return { predMin, predMax, threshold, gridXRange: gx.xRange, gridYRange: gx.yRange, gridXMin: gx.xMin, gridXMax: gx.xMax, gridYMin: gx.yMin, gridYMax: gx.yMax }
}

// ── WaferMap SVG 컴포넌트 (1팀 WaferMap.tsx 포팅) ────
function WaferMap({ dies, scale, selectedUnit, onSelectUnit, selectedDie, onSelectDie, mini = false }) {
  const layout = useMemo(() => {
    if (!dies.length) return null
    const xs = dies.map(d => d.die_x)
    const ys = dies.map(d => d.die_y)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    return { xMin, xMax, yMin, yMax, xRange: xMax - xMin + 1, yRange: yMax - yMin + 1 }
  }, [dies])

  if (!layout || !dies.length) {
    return <div className="dd-wmap-empty">표시할 die가 없습니다.</div>
  }

  const dieMap = new Map()
  for (const d of dies) dieMap.set(`${d.die_x},${d.die_y}`, d)

  // ── viewBox 좌표계 ──
  const D      = 800   // 원 지름
  const PAD    = 12    // 상/좌/하/우 동일 여백 (눈금 라벨 제거로 최소화)
  const VB_W   = D + PAD * 2
  const VB_H   = D + PAD * 2
  const cx     = PAD + D / 2
  const cy     = PAD + D / 2
  const radius = D / 2

  const { xMin, xMax, yMin, yMax, xRange, yRange } = layout

  // 전체 데이터 기준 중심/범위 사용 → 웨이퍼마다 포지션이 달라도 격자가 고정됨
  const refXMin = scale.gridXMin ?? xMin
  const refXMax = scale.gridXMax ?? xMax
  const refYMin = scale.gridYMin ?? yMin
  const refYMax = scale.gridYMax ?? yMax
  const refXRange = scale.gridXRange ?? xRange
  const refYRange = scale.gridYRange ?? yRange
  const centerX = (refXMin + refXMax) / 2
  const centerY = (refYMin + refYMax) / 2

  const SCALE = 0.9
  const cellW = (D / refXRange) * SCALE
  const cellH = (D / refYRange) * SCALE

  // mask: 전체 데이터 기준 모든 die 좌표 (웨이퍼마다 격자 일정)
  const mask = ALL_DIE_POSITIONS

  // 격자선: 전체 좌표 범위 기준 (결측 포지션 있어도 격자 일정)
  const gridXs = []
  for (let xi = refXMin; xi <= refXMax + 1; xi++) {
    gridXs.push(cx + (xi - centerX) * cellW - cellW / 2)
  }
  const gridYs = []
  for (let yi = refYMin; yi <= refYMax + 1; yi++) {
    gridYs.push(cy + (yi - centerY) * cellH - cellH / 2)
  }

  return (
    <div className="dd-wmap-inner">
      <div className="dd-wmap-svg-wrap">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}
          className="dd-wmap-svg">
          <defs>
            <clipPath id="waferCircle">
              <circle cx={cx} cy={cy} r={radius} />
            </clipPath>
          </defs>
          <circle cx={cx} cy={cy} r={radius} fill="#fafafa" stroke="#cbd5e1" strokeWidth={1.5} />
          <g clipPath="url(#waferCircle)">
            {/* die 색상 셀 */}
            {mask.map(([dx, dy]) => {
              const die = dieMap.get(`${dx},${dy}`)
              if (!die) return null
              const x = cx + (dx - centerX) * cellW - cellW / 2
              const y = cy + (dy - centerY) * cellH - cellH / 2
              const isUnitSel = die.ufs_serial === selectedUnit
              const isDieSel  = selectedDie && String(die.die_x) === String(selectedDie.die_x) && String(die.die_y) === String(selectedDie.die_y)
              const fill = predColor(parseFloat(die.pred), scale.predMin, scale.predMax, scale.threshold)
              return (
                <g key={`${dx}-${dy}`}>
                  <title>{`${die.ufs_serial ?? ''}
(${dx}, ${dy})
pred=${Math.round(parseFloat(die.pred) * 1e6)} ppm`}</title>
                  <rect
                    x={x} y={y}
                    width={cellW}
                    height={cellH}
                    fill={fill}
                    stroke={isDieSel ? '#7C3AED' : isUnitSel ? '#0f172a' : mini ? 'none' : 'rgba(15,23,42,0.12)'}
                    strokeWidth={isDieSel ? 4 : isUnitSel ? 3 : mini ? 0 : 0.6}
                    style={onSelectUnit ? { cursor: 'pointer' } : undefined}
                    onClick={() => {
                      if (!die.ufs_serial || !onSelectUnit) return
                      onSelectUnit(die.ufs_serial)
                      onSelectDie?.(die)
                    }}
                  />
                </g>
              )
            })}
            {/* 격자선 (die 위에 오버레이) */}
            {gridXs.map((gx, i) => (
              <line key={`gx-${i}`} x1={gx} y1={cy - radius} x2={gx} y2={cy + radius}
                stroke="rgba(100,116,139,0.18)" strokeWidth={mini ? 0.2 : 0.8} />
            ))}
            {gridYs.map((gy, i) => (
              <line key={`gy-${i}`} x1={cx - radius} y1={gy} x2={cx + radius} y2={gy}
                stroke="rgba(100,116,139,0.18)" strokeWidth={mini ? 0.2 : 0.8} />
            ))}
          </g>
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
          {/* notch */}
          <rect x={cx - 18} y={cy + radius - 6} width={36} height={8}
            fill="#fff" stroke="#94a3b8" strokeWidth={1} />
        </svg>
      </div>

    </div>  /* dd-wmap-inner */
  )
}

// ── SHAP 바 (shap_beeswarm.csv 기반 unit별 실제 SHAP, fallback: shap_bar.csv 전체 평균) ─
function ShapBar({ shapData, shapBeeswarm, ufsSerial, selectedFeature, onSelectFeature }) {
  const unitShap = useMemo(() => {
    if (!shapBeeswarm?.length || !ufsSerial) return null
    const rows = shapBeeswarm.filter(r => r.ufs_serial === ufsSerial)
    if (!rows.length) return null
    return rows.map(r => ({
      feature: r.feature,
      val: parseFloat(r.shap_value) || 0,
      magnitude: Math.abs(parseFloat(r.shap_value) || 0),
    })).sort((a, b) => b.magnitude - a.magnitude).slice(0, 10)
  }, [shapBeeswarm, ufsSerial])

  const allBars = unitShap ?? (
    shapData?.length
      ? shapData.slice(0, 20).map(f => ({
          feature: f.feature,
          val: parseFloat(f.mean_shap ?? f.effect_norm) || 0,
          magnitude: Math.abs(parseFloat(f.mean_abs_shap ?? f.lgbm_gain) || 0),
        })).sort((a, b) => b.magnitude - a.magnitude)
      : []
  )
  const bars = allBars.filter(b => /^X\d+$/.test(b.feature)).slice(0, 10)

  if (!bars.length) return null
  const maxMag = Math.max(...bars.map(b => b.magnitude), 1e-9)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
      {bars.map(b => {
        const w = Math.round(b.magnitude / maxMag * 100)
        const clr = b.val >= 0 ? '#ef4444' : '#3b82f6'
        const isSelected = selectedFeature === b.feature
        return (
          <div
            key={b.feature}
            onClick={() => onSelectFeature?.(isSelected ? null : b.feature)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
              cursor: onSelectFeature ? 'pointer' : undefined,
              background: isSelected ? '#eff6ff' : 'transparent',
              borderRadius: 4, padding: '1px 2px',
              outline: isSelected ? '1.5px solid #3b82f6' : 'none',
            }}
          >
            <span style={{ width: 60, textAlign: 'right', fontFamily: 'monospace', color: isSelected ? '#1d4ed8' : '#374151', flexShrink: 0, fontWeight: isSelected ? 700 : 400 }}>{b.feature}</span>
            <div style={{ flex: 1, background: '#f1f5f9', height: 10, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${w}%`, height: '100%', background: clr, borderRadius: 2 }} />
            </div>
            <span style={{ width: 52, fontSize: 11, color: clr, fontWeight: 700, textAlign: 'right' }}>{b.val >= 0 ? '+' : ''}{Math.round(b.val * 1e6).toLocaleString()}</span>
          </div>
        )
      })}
      {onSelectFeature && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>막대 클릭 → 웨이퍼 히트맵</div>}
    </div>
  )
}

// ── 피처 웨이퍼 히트맵 ────────────────────────────────
const FEAT_HEATMAP_STOPS = [
  [0.0, [219, 234, 254]],
  [0.5, [250, 250, 200]],
  [1.0, [220, 38,  38]],
]

function FeatureWaferMap({ feature, featNormData }) {
  const heatDies = useMemo(() => {
    if (!feature || !featNormData?.length) return []
    return featNormData
      .filter(r => r.feature === feature)
      .map(r => ({
        die_x: parseInt(r.die_x),
        die_y: parseInt(r.die_y),
        val: parseFloat(r.feat_norm),
      }))
      .filter(d => isFinite(d.val))
  }, [feature, featNormData])

  if (!feature) return null
  if (!featNormData?.length) return (
    <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '8px 0' }}>
      피처 데이터 로딩 중..
    </div>
  )
  if (!heatDies.length) return (
    <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '8px 0' }}>
      {feature} 데이터 없음
    </div>
  )

  const D = 800, PAD = 12
  const VB_W = D + PAD * 2, VB_H = D + PAD * 2
  const cx = PAD + D / 2, cy = PAD + D / 2, radius = D / 2
  const refXMin = GLOBAL_DIE_X_MIN, refXMax = GLOBAL_DIE_X_MAX
  const refYMin = GLOBAL_DIE_Y_MIN, refYMax = GLOBAL_DIE_Y_MAX
  const refXRange = refXMax - refXMin + 1, refYRange = refYMax - refYMin + 1
  const centerX = (refXMin + refXMax) / 2, centerY = (refYMin + refYMax) / 2
  const SCALE = 0.9
  const cellW = (D / refXRange) * SCALE, cellH = (D / refYRange) * SCALE

  const dieMap = new Map()
  heatDies.forEach(d => dieMap.set(`${d.die_x},${d.die_y}`, d.val))

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>
        {feature} 웨이퍼 히트맵
        <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 4 }}>feat_norm 기준</span>
      </div>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', maxWidth: 220, display: 'block', margin: '0 auto' }}>
        <defs>
          <clipPath id="featWaferCircle">
            <circle cx={cx} cy={cy} r={radius} />
          </clipPath>
        </defs>
        <circle cx={cx} cy={cy} r={radius} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1.5} />
        <g clipPath="url(#featWaferCircle)">
          {ALL_DIE_POSITIONS.map(([dx, dy]) => {
            const val = dieMap.get(`${dx},${dy}`)
            if (val == null) return null
            const x = cx + (dx - centerX) * cellW - cellW / 2
            const y = cy + (dy - centerY) * cellH - cellH / 2
            const fill = interp(FEAT_HEATMAP_STOPS, val)
            return (
              <rect key={`${dx}-${dy}`} x={x} y={y} width={cellW} height={cellH}
                fill={fill} stroke="rgba(15,23,42,0.08)" strokeWidth={0.4}>
                <title>{`(${dx},${dy})  ${feature}=${val.toFixed(3)}`}</title>
              </rect>
            )
          })}
        </g>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
        <rect x={cx - 18} y={cy + radius - 6} width={36} height={8} fill="#fff" stroke="#94a3b8" strokeWidth={1} />
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, fontSize: 10, color: '#64748b' }}>
        <span>낮음</span>
        <div style={{ flex: 1, height: 7, borderRadius: 3, background: 'linear-gradient(to right, #dbeafe, #fafac8, #dc2626)' }} />
        <span>높음</span>
      </div>
    </div>
  )
}

// ── Unit 진단 패널 (1팀 우측 패널 포팅) ──────────────
function UnitReport({ ufsSerial, allDies, scale, onClose, shapData, shapBeeswarm, unitData, featNormData }) {
  const [selectedFeature, setSelectedFeature] = useState(null)
  const dies = useMemo(() =>
    ufsSerial ? allDies.filter(d => d.ufs_serial === ufsSerial) : [],
    [ufsSerial, allDies]
  )

  // dashboard_units.csv에서 anomaly_score 조회
  const { anomalyScore } = useMemo(() => {
    if (!ufsSerial || !unitData?.length) return { anomalyScore: null }
    const row = unitData.find(u => u.ufs_serial === ufsSerial)
    if (!row) return { anomalyScore: null }
    const v = parseFloat(row.anomaly_score)
    return { anomalyScore: isFinite(v) ? v : null }
  }, [ufsSerial, unitData])

  if (!ufsSerial) return (
    <div className="dd-report-empty">
      wafer map의 die를 클릭하면 진단이 표시됩니다.
    </div>
  )

  if (!dies.length) return (
    <div className="dd-report-empty">데이터 없음</div>
  )

  // unit 예측값 = 4개 die pred 평균
  const predVals = dies.map(d => parseFloat(d.pred)).filter(isFinite)
  const pred = predVals.length ? predVals.reduce((a, b) => a + b, 0) / predVals.length : 0
  const ppm = Math.round(pred * 1e6)
  const isRisk = pred > scale.threshold
  const waferNo = dies[0].wafer_no ?? null
  const runId   = dies[0].run_id ?? null
  // 불량 확률: 4개 die clf_proba 평균
  const clfVals = dies.map(d => d.clf_proba !== undefined ? parseFloat(d.clf_proba) : null).filter(v => v !== null && isFinite(v))
  const clfProba = clfVals.length ? clfVals.reduce((a, b) => a + b, 0) / clfVals.length : null

  // 가장 위험한 die (같은 ufs_serial 내)
  const worstDie = dies.reduce((best, d) =>
    parseFloat(d.pred) > parseFloat(best.pred) ? d : best, dies[0])

  return (
    <div className="dd-report">
      {/* verdict 헤더 */}
      <div className={`dd-verdict ${isRisk ? 'risk' : 'normal'}`}>
        <div className="dd-verdict-row">
          <span className={`dd-verdict-badge ${isRisk ? 'risk' : 'normal'}`}>
            {isRisk ? '⚠ 위험' : '✓ 정상'}
          </span>
          {onClose && <button className="dd-report-close" onClick={onClose}>✕</button>}
        </div>
        <div className="dd-verdict-serial">
          <span className="dd-verdict-serial-main">{ufsSerial}</span>
          {runId && waferNo && (
            <span className="dd-verdict-serial-sub">Lot {runId} · Wafer #{waferNo}</span>
          )}
        </div>
        <div className="dd-verdict-pred">
          {ppm.toLocaleString()} ppm
        </div>
      </div>

      {/* 주요 기여 변수 (unit별 SHAP - shap_beeswarm.csv 기반) */}
      <div className="dd-section" style={{ padding: '6px 4px 4px' }}>
        <div className="dd-section-title">주요 기여 변수 Top 10 <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>unit별 SHAP</span><span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>(ppm)</span></div>
        <ShapBar shapData={shapData} shapBeeswarm={shapBeeswarm} ufsSerial={ufsSerial} selectedFeature={selectedFeature} onSelectFeature={setSelectedFeature} />
      </div>

      {/* 이상도 점수 (IsolationForest — dashboard_units.csv anomaly_score) */}
      {anomalyScore !== null && (() => {
        const score = Math.round(anomalyScore)
        const scoreColor = score >= 70 ? '#dc2626' : score >= 40 ? '#f97316' : '#16a34a'
        return (
          <div className="dd-section-box">
            <div className="dd-section-title">이상도 점수 <span style={{ fontSize: 11, color: '#64748b' }}>IsolationForest · 0~100</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <div style={{ fontSize: 25, fontWeight: 900, color: scoreColor, fontFamily: 'monospace' }}>{score}</div>
              <div style={{ flex: 1 }}>
                <div style={{ background: '#f1f5f9', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${score}%`, height: '100%', background: scoreColor, borderRadius: 4 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 11, color: '#94a3b8' }}>
                  <span>0 정상</span>
                  <span style={{ color: '#f97316' }}>40 주의</span>
                  <span style={{ color: '#dc2626' }}>70 위험</span>
                  <span>100</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
              정상 유닛들의 공정 피처 분포를 학습해서, 해당 유닛이 그 분포에서 얼마나 벗어났는지를 0~100으로 나타낸 값.
            </div>
          </div>
        )
      })()}

      {/* 가장 위험한 die */}
      {worstDie && (
        <div className="dd-section-box">
          <div className="dd-detail-key" style={{ marginBottom: 4 }}>가장 위험한 die</div>
          <div className="dd-worst-die mono">
            ({worstDie.die_x}, {worstDie.die_y}) ·{' '}
            <span className="danger">{Math.round(parseFloat(worstDie.pred) * 1e6).toLocaleString()} ppm</span>
          </div>
        </div>
      )}

      {/* 보고서 생성 버튼은 AI Agent 서버 비활성으로 인해 숨김 */}

      {/* 피처 웨이퍼 히트맵 (SHAP 막대 클릭 시 표시) */}
      {selectedFeature && (
        <div className="dd-section-box">
          <FeatureWaferMap feature={selectedFeature} featNormData={featNormData} />
        </div>
      )}
    </div>
  )
}

// ── 보고서 생성 버튼 ─────────────────────────────────
const AI_AGENT_URL = 'http://localhost:8000'

function ReportButton({ ufsSerial, ppm, isRisk, worstDie, grade }) {
  const [status, setStatus] = useState('idle')  // idle | loading | done | error

  async function handleReport() {
    setStatus('loading')
    try {
      const report_data = {
        unit: {
          ufs_serial: ufsSerial,
          ppm,
          risk: isRisk ? 'HIGH' : 'LOW',
          grade: grade ?? '',
          worst_die: worstDie ? `(${worstDie.die_x}, ${worstDie.die_y}) · ${Math.round(parseFloat(worstDie.pred) * 1e6).toLocaleString()} ppm` : '',
        },
        generated_at: new Date().toLocaleString('ko-KR'),
      }

      const res = await fetch(`${AI_AGENT_URL}/report/pptx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_data, filename: `보고서_${ufsSerial}.pptx` }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `보고서_${ufsSerial}.pptx`
      a.click()
      URL.revokeObjectURL(url)
      setStatus('done')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  const label = status === 'loading' ? '⏳ 생성 중…' : status === 'done' ? '✅ 완료' : status === 'error' ? '❌ 실패 (AI Agent 서버 확인)' : '📄 보고서 생성'
  const disabled = status === 'loading'

  return (
    <button
      className={`dd-report-btn${status === 'error' ? ' dd-report-btn-err' : ''}`}
      onClick={handleReport}
      disabled={disabled}
      title="AI Agent 서버(localhost:8000)에서 PPTX 보고서 생성"
    >
      {label}
    </button>
  )
}

// ── 웨이퍼 하단: 임계값 게이지 + 포지션별 ppm 바 ─────
function WaferBottomPanel({ ufsSerial, allDies, scale, selectedDie, onSelectDie }) {
  const dies = useMemo(() =>
    ufsSerial ? allDies.filter(d => d.ufs_serial === ufsSerial) : [],
    [ufsSerial, allDies]
  )

  const thPpm  = Math.round(scale.threshold * 1e6)
  const maxPpm = Math.round(scale.predMax * 1e6)

  // 포지션 바 (unit 선택 시)
  const sorted = [...dies].sort((a, b) => parseInt(a.position || 0) - parseInt(b.position || 0))
  // 바 길이 기준: scale.predMax 기준 통일 (임계선 위치와 동일 스케일)
  const posMaxPpm = Math.round(scale.predMax * 1e6) || 1

  if (!ufsSerial) {
    return (
      <div className="dd-bottom-panel">
        <div className="dd-bottom-hint">웨이퍼맵에서 유닛을 클릭하면 임계값 및 포지션별 상세가 표시됩니다.</div>
      </div>
    )
  }

  return (
    <div className="dd-bottom-panel">
      {/* ① 임계값 설명 게이지 */}
      <div className="dd-bottom-thresh">
        <div className="dd-bottom-thresh-label">
          <span className="dd-bottom-thresh-title">임계값 (τ)</span>
          <span className="dd-bottom-thresh-val">{thPpm.toLocaleString()} ppm</span>
          <span className="dd-bottom-thresh-sub">전체 pred Q3 기준</span>
        </div>
        <div className="dd-bottom-thresh-bar-wrap">
          {/* 정상 50% + 위험 50% 고정 분할 */}
          <div style={{ display: 'flex', width: '100%', height: 12, borderRadius: 4, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            <div style={{ width: '50%', height: '100%', background: 'linear-gradient(to right, #f3f4f6, #dbeafe, #a5d7dc)' }} />
            <div style={{ width: '50%', height: '100%', background: 'linear-gradient(to right, #fef08a, #fef08a, #fb923c, #dc2626)' }} />
          </div>
          {/* 마커: 항상 50% */}
          <div className="dd-bottom-thresh-marker" style={{ left: '50%' }}>
            <div className="dd-bottom-thresh-marker-line" />
            <div className="dd-bottom-thresh-marker-label">{thPpm.toLocaleString()}</div>
          </div>
          <div className="dd-bottom-thresh-ends">
            <span>0 ppm</span>
            <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', color: '#92400E', fontSize: 10 }}>← 정상 | 위험 →</span>
            <span>{maxPpm.toLocaleString()} ppm</span>
          </div>
        </div>
      </div>

      {/* ② 포지션별 ppm 바 */}
      {sorted.length > 0 && (
        <div className="dd-bottom-pos">
          <div className="dd-bottom-pos-title">
            포지션별 예측 ppm
            <span className="dd-bottom-pos-serial"> · {ufsSerial}</span>
          </div>
          <div className="dd-bottom-pos-grid">
            {sorted.map(die => {
              const pred   = parseFloat(die.pred)
              const ppm    = Math.round(pred * 1e6)
              const isRisk = pred > scale.threshold
              const pos    = die.position || '?'
              const isDieSel = selectedDie &&
                String(die.die_x) === String(selectedDie.die_x) &&
                String(die.die_y) === String(selectedDie.die_y)
              const fillColor = predColor(pred, scale.predMin, scale.predMax, scale.threshold)

              // threshold가 항상 50%가 되도록 좌우 스케일 분리
              const thresh = scale.threshold
              const barW = isRisk
                ? 50 + Math.round(((pred - thresh) / Math.max(1e-9, scale.predMax - thresh)) * 50)
                : Math.round((pred / Math.max(1e-9, thresh)) * 50)

              return (
                <div
                  key={`${die.die_x}-${die.die_y}`}
                  className={`dd-bpos-row ${isDieSel ? 'selected' : ''} ${isRisk ? 'risk' : ''}`}
                  onClick={() => onSelectDie?.(die)}
                >
                  <div className="dd-bpos-header">
                    <span className="dd-bpos-num">P{pos}</span>
                    <span className="dd-bpos-chip" style={{ background: fillColor }} />
                    <span className={`dd-bpos-ppm ${isRisk ? 'danger' : ''}`}>
                      {ppm.toLocaleString()} ppm
                    </span>
                    <span className="dd-bpos-coord">({die.die_x},{die.die_y})</span>
                    {isDieSel && <span className="dd-bpos-sel-arrow">◀</span>}
                  </div>
                  <div className="dd-bpos-track">
                    <div className="dd-bpos-fill"
                      style={{ width: `${barW}%`, background: fillColor }} />
                    <div className="dd-bpos-thresh-line" style={{ left: '50%' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Die 진단 패널 ──────────────────────────────────────
function DieReport({ die, scale, onClose }) {
  if (!die) return (
    <div className="dd-report-empty">웨이퍼맵에서 다이를 클릭하면 진단 결과가 표시됩니다.</div>
  )

  const pred    = parseFloat(die.pred)
  const ppm     = Math.round(pred * 1e6)
  const isRisk  = pred > scale.threshold
  const clf     = die.clf_proba !== undefined ? parseFloat(die.clf_proba) : null
  const thPpm   = Math.round(scale.threshold * 1e6)

  const barPct  = Math.min(100, Math.round((pred / scale.predMax) * 100))
  const barColor = isRisk ? '#EF4444' : '#22C55E'

  return (
    <div className="dd-report">
      {/* 좌표 + ppm 요약 (verdict 대신 compact 헤더) */}
      <div className={`dd-die-header ${isRisk ? 'risk' : 'normal'}`}>
        <div className="dd-die-header-row">
          <span className={`dd-verdict-badge ${isRisk ? 'risk' : 'normal'}`} style={{ fontSize: 12 }}>
            {isRisk ? '⚠ 위험' : '✓ 정상'}
          </span>
          <span className="dd-die-coord-main">({die.die_x}, {die.die_y})</span>
          {onClose && <button className="dd-report-close" onClick={onClose}>✕</button>}
        </div>
        <div className="dd-verdict-pred" style={{ fontSize: 11 }}>{ppm.toLocaleString()} ppm</div>
      </div>

      {/* 위험도 게이지 */}
      <div className="dd-section-box">
        <div className="dd-section-title">예측 위험도</div>
        <div style={{ margin: '8px 0 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>
            <span>0 ppm</span>
            <span style={{ color: '#F97316' }}>임계 {thPpm.toLocaleString()}</span>
            <span>{Math.round(scale.predMax * 1e6).toLocaleString()} ppm</span>
          </div>
          <div style={{ height: 10, background: '#F1F5F9', borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: `${Math.round((scale.threshold / scale.predMax) * 100)}%`, top: 0, bottom: 0, width: 2, background: '#F97316', zIndex: 1 }} />
            <div style={{ width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 5, transition: 'width .3s' }} />
          </div>
        </div>
      </div>

      {/* 상세 수치 */}
      <div className="dd-section-box">
        <div className="dd-section-title">Die 상세</div>
        <div className="dd-detail-rows">
          <div className="dd-detail-row">
            <span className="dd-detail-key">좌표</span>
            <span className="dd-detail-val mono">({die.die_x}, {die.die_y})</span>
          </div>
          <div className="dd-detail-row">
            <span className="dd-detail-key">예측 PPM</span>
            <span className={`dd-detail-val mono ${isRisk ? 'danger' : ''}`}>{ppm.toLocaleString()} ppm</span>
          </div>
          <div className="dd-detail-row">
            <span className="dd-detail-key">임계 대비</span>
            <span className={`dd-detail-val mono ${isRisk ? 'danger' : ''}`}>
              {isRisk ? `+${(ppm - thPpm).toLocaleString()} ppm 초과` : `${(thPpm - ppm).toLocaleString()} ppm 여유`}
            </span>
          </div>
          {clf !== null && (
            <div className="dd-detail-row">
              <span className="dd-detail-key">불량 확률</span>
              <span className="dd-detail-val mono">{(clf * 100).toFixed(1)}%</span>
            </div>
          )}
          <div className="dd-detail-row">
            <span className="dd-detail-key">소속 Unit</span>
            <span className="dd-detail-val mono" style={{ fontSize: 11 }}>{die.ufs_serial}</span>
          </div>
          <div className="dd-detail-row">
            <span className="dd-detail-key">Lot · Wafer</span>
            <span className="dd-detail-val mono">Lot {die.run_id} · #{die.wafer_no}</span>
          </div>
        </div>
      </div>

      {/* 위험 판정 근거 */}
      <div className="dd-section-box">
        <div className="dd-section-title">판정 근거</div>
        <div className="dd-section-desc">
          {isRisk
            ? `예측 PPM(${ppm.toLocaleString()})이 임계값(${thPpm.toLocaleString()} ppm)을 초과합니다. 이 Die가 속한 Unit(${die.ufs_serial})의 정밀 점검이 권장됩니다.`
            : `예측 PPM(${ppm.toLocaleString()})이 임계값(${thPpm.toLocaleString()} ppm) 이하입니다. 현재 정상 범위입니다.`
          }
        </div>
      </div>
    </div>
  )
}

// ── 메인 ─────────────────────────────────────────────
// ── Wafer 패턴 휴리스틱 분류 ──
// die 위치 + pred를 받아 Edge Ring / Center Cluster / Random / Normal 분류
function classifyWaferPattern(dies, threshold) {
  if (!dies.length) return 'normal'
  const xs = dies.map(d => d.die_x), ys = dies.map(d => d.die_y)
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2
  const rMax = Math.max(...dies.map(d => Math.hypot(d.die_x - cx, (d.die_y - cy) * 2.5)))
  if (rMax === 0) return 'normal'

  let centerSum = 0, centerN = 0
  let edgeSum = 0, edgeN = 0
  let highCount = 0

  dies.forEach(d => {
    const r = Math.hypot(d.die_x - cx, (d.die_y - cy) * 2.5) / rMax
    const p = parseFloat(d.pred)
    if (!isFinite(p)) return
    if (p > threshold) highCount++
    if (r < 0.45) { centerSum += p; centerN++ }
    if (r > 0.75) { edgeSum += p; edgeN++ }
  })

  if (centerN === 0 || edgeN === 0) return 'normal'
  const centerAvg = centerSum / centerN
  const edgeAvg = edgeSum / edgeN
  const highRatio = highCount / dies.length

  // 위험 die 비율이 낮으면 정상
  if (highRatio < 0.05) return 'normal'

  // Edge Ring: 외곽이 중심 대비 1.6배 이상
  if (edgeAvg > centerAvg * 1.6 && edgeAvg > threshold * 0.3) return 'edge'

  // Center Cluster: 중심이 외곽 대비 1.6배 이상
  if (centerAvg > edgeAvg * 1.6 && centerAvg > threshold * 0.3) return 'center'

  // 그 외 위험 die가 흩어진 경우
  return 'random'
}

const PATTERN_META = {
  edge:   { label: 'Edge Ring',      color: '#EF4444', desc: '외곽 die 불량 집중 — 식각/세정 균일성 의심' },
  center: { label: 'Center Cluster', color: '#F59E0B', desc: '중심 die 불량 집중 — CMP/Coater 중심 결함 의심' },
  random: { label: 'Random Scatter', color: '#3B82F6', desc: '불량 산발 — 파티클/오염 가능성' },
  normal: { label: 'Normal',         color: '#22C55E', desc: '뚜렷한 패턴 없음' },
}

export default function DrilldownV2({ initialSelection }) {
  const { data: summaryData, loading: loadingSummary } = useCSV('/dashboard_lot_summary.csv')
  const { data: shapData } = useCSV('/shap_bar.csv')
  const { data: featNormData } = useCSV('/wafer_feat_norm.csv')
  const { data: unitData } = useCSV('/dashboard_units.csv')
  const { data: lotPatternsAll } = useCSV('/dashboard_lot_patterns.csv')
  const [lotPatternMaps, setLotPatternMaps] = useState({})
  useEffect(() => {
    fetch('/dashboard_lot_pattern_maps.json')
      .then(r => r.ok ? r.json() : {})
      .then(setLotPatternMaps)
      .catch(() => {})
  }, [])

  const [globalScale, setGlobalScale] = useState(null)
  useEffect(() => {
    fetch('/wafer_scale.json').then(r => r.json()).then(s => setGlobalScale({
      predMin: s.pred_min,
      predMax: s.pred_max,
      threshold: s.threshold,
      gridXRange: GLOBAL_DIE_X_MAX - GLOBAL_DIE_X_MIN + 1,
      gridYRange: GLOBAL_DIE_Y_MAX - GLOBAL_DIE_Y_MIN + 1,
      gridXMin: GLOBAL_DIE_X_MIN, gridXMax: GLOBAL_DIE_X_MAX,
      gridYMin: GLOBAL_DIE_Y_MIN, gridYMax: GLOBAL_DIE_Y_MAX,
    })).catch(() => {})
  }, [])

  const [selectedLot, setSelectedLot]   = useState(null)
  const [selectedKey, setSelectedKey]   = useState(null)
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [shapBeeswarmEnabled, setShapBeeswarmEnabled] = useState(false)
  const { data: shapBeeswarm } = useCSV(shapBeeswarmEnabled ? '/shap_beeswarm.csv' : null)
  const [selectedDie,  setSelectedDie]  = useState(null)
  const [search, setSearch]             = useState('')
  const [expandedLot, setExpandedLot]   = useState(null)

  // lot 클릭 시 해당 lot의 wafer_map만 로드
  const [loadedLot, setLoadedLot] = useState(null)
  const { data: dieData, loading: loadingDie } = useCSV(loadedLot ? `/wafer_map_lots/lot_${loadedLot}.csv` : null)

  // 외부에서 initialSelection 전달받으면 자동 선택 (Lot 즉시 → die 로드 트리거)
  useEffect(() => {
    if (!initialSelection) return
    const { lot } = initialSelection
    if (lot) {
      setSelectedLot(String(lot))
      setExpandedLot(String(lot))
      setLoadedLot(String(lot))
      setActiveTab('default')
    }
  }, [initialSelection])

  // die 데이터 도착 후 wafer/unit 선택 (selectedKey 리셋 effect보다 나중)
  useEffect(() => {
    if (!initialSelection || !dieData.length) return
    const { lot, wafer, unit } = initialSelection
    if (lot && wafer) {
      setSelectedKey(`${lot}_${wafer}`)
    }
    if (unit) {
      setTimeout(() => setSelectedUnit(unit), 0)
    }
  }, [initialSelection, dieData])
  const [waferSort, setWaferSort]       = useState('default') // 'default' | 'risk_desc' | 'risk_asc'
  const [lotSort, setLotSort]           = useState('risk_desc') // 'risk_desc' | 'risk_asc' | 'default'
  const [activeTab, setActiveTab]       = useState('pattern')   // 'pattern' | 'default'
  const [selectedPattern, setSelectedPattern] = useState(null)  // 'edge' | 'center' | 'random' | 'normal'
  const [zoomLot, setZoomLot] = useState(null)

  const scale = useMemo(() => globalScale ?? computeScale(dieData), [globalScale, dieData])

  const lotTree = useMemo(() => {
    if (!summaryData.length) return []
    const lotMap = {}
    summaryData.forEach(d => {
      const lotNum = parseInt(d.run_id)
      // 원본 0_data 기준 lot 1~28만 표시 (29~84는 split 시뮬레이션 분배)
      if (!(lotNum >= 1 && lotNum <= 28)) return
      const lot = String(d.run_id)
      const wno = String(d.wafer_no)
      const key = `${lot}_${wno}`
      if (!lotMap[lot]) lotMap[lot] = { lot, wafers: {}, totalDies: 0, riskDies: 0, ppmSum: 0 }
      lotMap[lot].wafers[wno] = {
        wno, key,
        dies: d.total_dies,
        riskDies: d.risk_dies,
        avgPpm: d.avg_ppm,
      }
      lotMap[lot].totalDies += d.total_dies
      lotMap[lot].riskDies  += d.risk_dies
      lotMap[lot].ppmSum    += d.avg_ppm * d.total_dies
    })
    let lots = Object.values(lotMap)
    if (search.trim()) {
      const q = search.toLowerCase()
      lots = lots.filter(l =>
        l.lot.includes(q) || Object.keys(l.wafers).some(w => w.includes(q))
      )
    }
    lots.sort((a, b) => {
      const rA = a.totalDies ? a.riskDies / a.totalDies : 0
      const rB = b.totalDies ? b.riskDies / b.totalDies : 0
      if (lotSort === 'risk_asc') return rA - rB
      if (lotSort === 'default') return parseInt(a.lot) - parseInt(b.lot)
      return rB - rA
    })
    return lots.map(l => ({
      ...l,
      riskRatio: l.totalDies ? l.riskDies / l.totalDies : 0,
      avgPpm: l.totalDies ? Math.round(l.ppmSum / l.totalDies) : 0,
      waferList: Object.values(l.wafers).sort((a, b) => parseInt(a.wno) - parseInt(b.wno)),
    }))
  }, [summaryData, search, lotSort])

  const selectedDies = useMemo(() => {
    if (!selectedKey) return []
    const [lot, wno] = selectedKey.split('_')
    return dieData.filter(d => String(d.run_id) === lot && String(d.wafer_no) === wno)
  }, [dieData, selectedKey])

  const lotAccumDies = useMemo(() => {
    if (!selectedLot || selectedKey) return []
    const lotDies = dieData.filter(d => String(d.run_id) === selectedLot)
    const posMap = {}
    lotDies.forEach(d => {
      const k = `${d.die_x},${d.die_y}`
      if (!posMap[k] || parseFloat(d.pred) > parseFloat(posMap[k].pred)) posMap[k] = d
    })
    return Object.values(posMap)
  }, [dieData, selectedLot, selectedKey])

  useEffect(() => { setSelectedUnit(null); setSelectedDie(null) }, [selectedKey])
  useEffect(() => { if (selectedUnit) setShapBeeswarmEnabled(true) }, [selectedUnit])

  // ── 패턴 분류: 현재 로드된 lot의 wafer별 패턴 분류 ──
  const patternResult = useMemo(() => {
    if (!dieData.length || !scale) return null
    const threshold = scale.threshold

    // wafer별 die 그룹핑
    const waferMap = {}
    dieData.forEach(d => {
      const lot = String(d.run_id)
      const wno = String(d.wafer_no)
      const key = `${lot}_${wno}`
      if (!waferMap[key]) waferMap[key] = { lot, wno, dies: [] }
      waferMap[key].dies.push(d)
    })

    // 각 wafer 분류
    const classified = Object.values(waferMap).map(w => ({
      ...w,
      pattern: classifyWaferPattern(w.dies, threshold),
      riskRatio: w.dies.filter(d => parseFloat(d.pred) > threshold).length / w.dies.length,
      avgPred: w.dies.reduce((s, d) => s + parseFloat(d.pred), 0) / w.dies.length,
    }))

    // 카테고리별 집계
    const buckets = { edge: [], center: [], random: [], normal: [] }
    classified.forEach(w => buckets[w.pattern].push(w))
    return { wafers: classified, buckets }
  }, [dieData, scale])

  // ── 전체 Lot 패턴 집계 (사전 계산 파일 기반) ──
  const lotPatternBuckets = useMemo(() => {
    const buckets = { edge: [], center: [], random: [], normal: [] }
    lotPatternsAll.forEach(r => {
      const p = String(r.pattern)
      if (buckets[p]) buckets[p].push({
        lot: String(r.lot),
        pattern: p,
        riskRatio: parseFloat(r.risk_ratio) || 0,
        avgPred: parseFloat(r.avg_pred) || 0,
        nDies: parseInt(r.n_dies) || 0,
        nWafers: parseInt(r.n_wafers) || 0,
      })
    })
    return buckets
  }, [lotPatternsAll])

  // ── Lot 통합 패턴: 선택된 Lot의 모든 wafer die를 합친 통합맵 기준 분류 ──
  const lotPattern = useMemo(() => {
    if (!selectedLot || !scale || !lotAccumDies.length) return null
    const pat = classifyWaferPattern(lotAccumDies, scale.threshold)
    const riskN = lotAccumDies.filter(d => parseFloat(d.pred) > scale.threshold).length
    return {
      pattern: pat,
      dies: lotAccumDies,
      riskRatio: riskN / lotAccumDies.length,
      avgPred: lotAccumDies.reduce((s, d) => s + parseFloat(d.pred), 0) / lotAccumDies.length,
    }
  }, [selectedLot, scale, lotAccumDies])

  // 절대 임계: ~70% 초록, 70~85% 노랑, 85%+ 빨강
  // 바 길이: 70% 미만 → 아주 짧음, 70~85% → 0~50%, 85%+ → 50~100%
  function absBarWidth(ratio) {
    if (ratio < 0.70) return `${Math.round(ratio / 0.70 * 15)}%`
    if (ratio < 0.85) return `${Math.round((ratio - 0.70) / 0.15 * 50)}%`
    return `${Math.round(50 + (ratio - 0.85) / 0.15 * 50)}%`
  }
  function absClass(ratio) {
    return ratio >= 0.85 ? 'danger' : ratio >= 0.70 ? 'warn' : 'ok'
  }

  const currentDies = selectedKey ? selectedDies : lotAccumDies

  return (
    <div className="drilldown">

      {/* ── 탭 바 ── */}
      <div className="dd-tab-bar">
        <button
          className={`dd-tab ${activeTab === 'pattern' ? 'active' : ''}`}
          onClick={() => setActiveTab('pattern')}
        >
          패턴 분류 (Lot 통합)
        </button>
        <button
          className={`dd-tab ${activeTab === 'default' ? 'active' : ''}`}
          onClick={() => setActiveTab('default')}
        >
          기본 보기 (Lot → Wafer → Unit)
        </button>
      </div>

      {activeTab === 'pattern' && (
        <div className="dd-pattern-view">
          {/* 전체 Lot 패턴 요약 카드 4개 */}
          {lotPatternsAll.length > 0 && (
            <div className="dd-pattern-cards">
              {['edge', 'center', 'random', 'normal'].map(pat => {
                const meta = PATTERN_META[pat]
                const lots = lotPatternBuckets[pat]
                const pct = lotPatternsAll.length
                  ? (lots.length / lotPatternsAll.length * 100).toFixed(0)
                  : 0
                const isActive = selectedPattern === pat
                return (
                  <div
                    key={pat}
                    className={`dd-pattern-card ${isActive ? 'active' : ''}`}
                    style={{ borderColor: isActive ? meta.color : undefined }}
                    onClick={() => setSelectedPattern(isActive ? null : pat)}
                  >
                    <div className="dd-pattern-card-head" style={{ color: meta.color }}>
                      <span className="dd-pattern-dot" style={{ background: meta.color }} />
                      {meta.label}
                    </div>
                    <div className="dd-pattern-card-count">
                      {lots.length}<span style={{ fontSize: 12, color: '#94A3B8' }}> Lot ({pct}%)</span>
                    </div>
                    <div className="dd-pattern-card-desc">{meta.desc}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 선택된 패턴의 Lot: 좌(썸네일) + 우(미리보기) */}
          {selectedPattern && lotPatternBuckets[selectedPattern].length > 0 && (
            <div className="dd-pattern-explorer">
              <div className="dd-pattern-grid">
                <div className="dd-pattern-grid-title">
                  {PATTERN_META[selectedPattern].label} — {lotPatternBuckets[selectedPattern].length} Lot
                </div>
                <div className="dd-pattern-map-grid">
                  {lotPatternBuckets[selectedPattern]
                    .sort((a, b) => b.riskRatio - a.riskRatio)
                    .map(l => {
                      const rawDies = lotPatternMaps[l.lot] || []
                      const dies = rawDies.map(([x, y, p]) => ({ die_x: x, die_y: y, pred: p }))
                      const isActive = zoomLot && zoomLot.lot === l.lot
                      return (
                        <div
                          key={l.lot}
                          className={`dd-pattern-mini ${isActive ? 'active' : ''}`}
                          onClick={() => setZoomLot(l)}
                          title="클릭 → 우측에 크게 보기"
                        >
                          <div className="dd-pattern-mini-head">
                            Lot {l.lot}
                            <span className="dd-pattern-mini-risk">{(l.riskRatio * 100).toFixed(0)}%</span>
                          </div>
                          <div className="dd-pattern-mini-map">
                            {scale && dies.length > 0 && <WaferMap dies={dies} scale={scale} mini />}
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>

              {/* 우측 미리보기 패널 */}
              <div className="dd-pattern-preview">
                {!zoomLot && (
                  <div className="dd-pattern-preview-empty">
                    좌측에서 Lot을 선택하면 크게 표시됩니다.
                  </div>
                )}
                {zoomLot && (() => {
                  const rawDies = lotPatternMaps[zoomLot.lot] || []
                  const dies = rawDies.map(([x, y, p]) => ({ die_x: x, die_y: y, pred: p }))
                  const meta = PATTERN_META[zoomLot.pattern]
                  return (
                    <>
                      <div className="dd-pattern-preview-head">
                        <div>
                          <div className="dd-zoom-lot">Lot {zoomLot.lot}</div>
                          <div className="dd-zoom-pat" style={{ color: meta.color }}>
                            <span className="dd-pattern-dot" style={{ background: meta.color }} />
                            {meta.label}
                          </div>
                        </div>
                        <div className="dd-zoom-stats">
                          <div>die <b>{zoomLot.nDies}</b></div>
                          <div>wafer <b>{zoomLot.nWafers}</b></div>
                          <div>위험 <b style={{ color: '#EF4444' }}>{(zoomLot.riskRatio * 100).toFixed(1)}%</b></div>
                          <div>평균 <b>{Math.round(zoomLot.avgPred * 1e6).toLocaleString()} ppm</b></div>
                        </div>
                      </div>
                      <div className="dd-pattern-preview-map">
                        {scale && dies.length > 0 && <WaferMap dies={dies} scale={scale} mini />}
                      </div>
                      <div className="dd-zoom-actions">
                        <button
                          className="dd-zoom-btn"
                          onClick={() => {
                            setSelectedLot(zoomLot.lot)
                            setExpandedLot(zoomLot.lot)
                            setLoadedLot(zoomLot.lot)
                            setSelectedKey(null)
                            setActiveTab('default')
                          }}
                        >
                          기본 보기에서 상세 분석 →
                        </button>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          )}

        </div>
      )}

      {activeTab === 'default' && (
      <div className="dd-body-3col">

        {/* ── 좌: 아코디언 트리 ── */}
        <div className="dd-left-panel">
          <div className="dd-tree-controls">
            <input
              className="dd-search-input"
              placeholder="Lot 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button
              className={`dd-wafer-sort-btn ${lotSort !== 'default' ? 'active' : ''}`}
              onClick={() => setLotSort(s => s === 'risk_desc' ? 'risk_asc' : s === 'risk_asc' ? 'default' : 'risk_desc')}
            >
              {lotSort === 'risk_desc' ? '▼ 위험률순' : lotSort === 'risk_asc' ? '▲ 위험률순' : '· 번호순'}
            </button>
          </div>

          {/* 컬럼 헤더 */}
          <div className="dd-tree-col-header">
            <span className="dd-col-lot">LOT</span>
            <span className="dd-col-bar">불량비율</span>
            <span className="dd-col-pct">%</span>
            <span className="dd-col-ppm">avg PPM</span>
          </div>

          <div className="dd-tree-list">
            {loadingSummary && <div className="dd-tree-hint">로딩 중...</div>}
            {!loadingDie && lotTree.length === 0 && (
              <div className="dd-tree-hint">결과 없음</div>
            )}
            {lotTree.map(({ lot, riskRatio, avgPpm, waferList }) => {
              const isExpanded = expandedLot === lot
              const isLotSel   = selectedLot === lot
              const riskPct    = (riskRatio * 100).toFixed(1)
              const riskClass  = absClass(riskRatio)

              return (
                <div key={lot} className="dd-lot-group">
                  {/* Lot 행 */}
                  <button
                    className={`dd-lot-btn ${isLotSel ? 'selected' : ''}`}
                    onClick={() => {
                      const next = isExpanded ? null : lot
                      setExpandedLot(next)
                      setSelectedLot(next)
                      setSelectedKey(null)
                      setSelectedUnit(null)
                      if (next) setLoadedLot(next)
                    }}
                  >
                    <span className="dd-lot-arrow">{isExpanded ? '▾' : '▸'}</span>
                    <span className="dd-lot-name">Lot {lot}</span>
                    <div className="dd-lot-bar-wrap">
                      <div
                        className={`dd-lot-bar-fill ${riskClass}`}
                        style={{ width: absBarWidth(riskRatio) }}
                      />
                    </div>
                    <span className={`dd-lot-pct ${riskClass}`}>{riskPct}%</span>
                    <span className="dd-lot-ppm">{avgPpm.toLocaleString()}</span>
                  </button>

                  {/* Wafer 서브 리스트 */}
                  {isExpanded && (
                    <div className="dd-wafer-list">
                      <button
                        className={`dd-wafer-sort-btn ${waferSort !== 'default' ? 'active' : ''}`}
                        onClick={() => setWaferSort(s => s === 'default' ? 'risk_desc' : s === 'risk_desc' ? 'risk_asc' : 'default')}
                      >
                        {waferSort === 'risk_desc' ? '▼ 위험률 내림차순' : waferSort === 'risk_asc' ? '▲ 위험률 오름차순' : '· 번호순'}
                      </button>
                      {[...waferList]
                        .sort((a, b) => waferSort === 'risk_desc'
                          ? (b.riskDies / b.dies) - (a.riskDies / a.dies)
                          : waferSort === 'risk_asc'
                          ? (a.riskDies / a.dies) - (b.riskDies / b.dies)
                          : parseInt(a.wno) - parseInt(b.wno)
                        )
                        .map(w => {
                        const wRatio  = w.dies ? w.riskDies / w.dies : 0
                        const wClass  = absClass(wRatio)
                        const wPpm    = w.avgPpm
                        const isSel   = selectedKey === w.key
                        return (
                          <button
                            key={w.key}
                            className={`dd-wafer-btn ${isSel ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedLot(lot)
                              setSelectedKey(isSel ? null : w.key)
                              setSelectedUnit(null)
                              setLoadedLot(lot)
                            }}
                          >
                            <span className="dd-wafer-no">#{w.wno}</span>
                            <div className="dd-lot-bar-wrap">
                              <div
                                className={`dd-lot-bar-fill ${wClass}`}
                                style={{ width: absBarWidth(wRatio) }}
                              />
                            </div>
                            <span className={`dd-lot-pct ${wClass}`}>{(wRatio * 100).toFixed(0)}%</span>
                            <span className="dd-lot-ppm">{wPpm.toLocaleString()}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}

                </div>
              )
            })}
          </div>
        </div>

        {/* ── 중: WaferMap + 하단 패널 ── */}
        <div className="dd-center-panel">
          {!selectedKey && !selectedLot && (
            <div className="dd-center-panel-inner">
              <div className="dd-panel-title">Wafer Map</div>
              <div className="dd-map-hint">← 좌측 목록에서 Lot을 클릭해 펼친 후 Wafer를 선택하세요</div>
              <WaferBottomPanel
                ufsSerial={null}
                allDies={[]}
                scale={scale}
                selectedDie={null}
                onSelectDie={setSelectedDie}
              />
            </div>
          )}

          {/* 단일 wafer */}
          {selectedKey && (
            <div className="dd-center-panel-inner">
              <div className="dd-panel-header">
                <span className="dd-panel-title">Wafer {selectedKey.replace('_', ' · #')}</span>
                <span className="dd-panel-meta">Dies {selectedDies.length}</span>
              </div>
              <div className="dd-wmap-top">
                <WaferMap
                  dies={selectedDies}
                  scale={scale}
                  selectedUnit={selectedUnit}
                  onSelectUnit={setSelectedUnit}
                  selectedDie={selectedDie}
                  onSelectDie={setSelectedDie}
                />
              </div>
              <WaferBottomPanel
                ufsSerial={selectedUnit}
                allDies={selectedDies}
                scale={scale}
                selectedDie={selectedDie}
                onSelectDie={setSelectedDie}
              />
            </div>
          )}

          {/* lot 누적 */}
          {!selectedKey && selectedLot && (
            <div className="dd-center-panel-inner">
              <div className="dd-panel-header">
                <span className="dd-panel-title">Lot {selectedLot} — 누적 (max)</span>
                <span className="dd-panel-meta">
                  unique positions {lotAccumDies.length}
                </span>
              </div>
              <div className="dd-map-hint sm">
                lot 내 모든 wafer를 같은 die 좌표로 겹친 max 집계 — 좌측에서 Wafer를 선택하면 단일 보기로 전환
              </div>
              <div className="dd-wmap-top">
                <WaferMap
                  dies={lotAccumDies}
                  scale={scale}
                  selectedUnit={null}
                  onSelectUnit={undefined}
                />
              </div>
              <WaferBottomPanel
                ufsSerial={null}
                allDies={lotAccumDies}
                scale={scale}
                selectedDie={null}
                onSelectDie={setSelectedDie}
              />
            </div>
          )}
        </div>

        {/* ── 우: Unit | Die 가로 2열 진단 ── */}
        <div className="dd-right-panel">
          {/* Unit 진단 열 */}
          <div className="dd-right-unit-col">
            <div className="dd-right-panel-title">Unit 진단</div>
            <UnitReport
              ufsSerial={selectedUnit}
              allDies={selectedDies}
              scale={scale}
              shapData={shapData}
              shapBeeswarm={shapBeeswarm}
              unitData={unitData}
              featNormData={featNormData}
              onClose={selectedUnit ? () => { setSelectedUnit(null); setSelectedDie(null) } : undefined}
            />
          </div>
          {/* Die 진단 열 */}
          <div className="dd-right-die-col">
            <div className="dd-right-panel-title">Die 진단</div>
            <DieReport
              die={selectedDie}
              scale={scale}
              onClose={selectedDie ? () => setSelectedDie(null) : undefined}
            />
          </div>
        </div>

      </div>
      )}
    </div>
  )
}
