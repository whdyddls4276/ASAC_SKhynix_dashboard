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
import './Drilldown.css'

// ── 색상 로직 (1팀 colors.ts 포팅) ───────────────────
const NORMAL_STOPS = [
  [0.0, [243, 244, 246]],
  [0.5, [219, 234, 254]],
  [1.0, [165, 215, 220]],
]
const RISK_STOPS = [
  [0.0, [254, 240, 138]],
  [0.5, [251, 146, 60]],
  [1.0, [220, 38, 38]],
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
  'linear-gradient(to right, #f3f4f6, #dbeafe, #a5d7dc, #fef08a, #fb923c, #dc2626)'

// ── 스케일 계산 ───────────────────────────────────────
function computeScale(allDies) {
  const preds = allDies.map(d => parseFloat(d.pred)).filter(isFinite)
  if (!preds.length) return { predMin: 0, predMax: 0.02, threshold: 0.005 }
  preds.sort((a, b) => a - b)
  const predMin = preds[0]
  const predMax = preds[preds.length - 1]
  // threshold = p70.8 (defect비율 기준)
  const threshold = preds[Math.floor(preds.length * 0.708)] ?? predMin
  return { predMin, predMax, threshold }
}

// ── WaferMap SVG 컴포넌트 (1팀 WaferMap.tsx 포팅) ────
function WaferMap({ dies, scale, selectedUnit, onSelectUnit, selectedDie, onSelectDie }) {
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

  const VB = 1000
  const margin = 40
  const inner = VB - margin * 2
  const { xMin, xMax, yMin, yMax, xRange, yRange } = layout
  const cellW = inner / xRange
  const cellH = inner / yRange
  const centerX = (xMin + xMax) / 2
  const centerY = (yMin + yMax) / 2
  const cx = VB / 2, cy = VB / 2
  const radius = VB / 2 - margin * 0.3

  // mask: 모든 die 좌표 집합
  const mask = [...dieMap.keys()].map(k => k.split(',').map(Number))

  // 격자선: 모든 die 셀 경계마다 (각 die 사이)
  const gridXs = []
  for (let xi = xMin; xi <= xMax + 1; xi++) {
    gridXs.push(cx + (xi - centerX) * cellW - cellW / 2)
  }
  const gridYs = []
  for (let yi = yMin; yi <= yMax + 1; yi++) {
    gridYs.push(cy + (yi - centerY) * cellH - cellH / 2)
  }
  // 눈금 라벨용 step (너무 많으면 생략)
  const labelXStep = Math.max(1, Math.ceil(xRange / 20))
  const labelYStep = Math.max(1, Math.ceil(yRange / 20))

  return (
    <div className="dd-wmap-inner">
      <div className="dd-wmap-svg-wrap">
        <svg viewBox={`0 0 ${VB} ${VB}`} preserveAspectRatio="xMidYMid meet"
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
              const x = cx + (dx - centerX) * cellW - cellW / 2
              const y = cy + (dy - centerY) * cellH - cellH / 2
              const isUnitSel = die?.ufs_serial === selectedUnit
              const isDieSel  = selectedDie && die && String(die.die_x) === String(selectedDie.die_x) && String(die.die_y) === String(selectedDie.die_y)
              const fill = die
                ? predColor(parseFloat(die.pred), scale.predMin, scale.predMax, scale.threshold)
                : '#f1f5f9'
              return (
                <g key={`${dx}-${dy}`}>
                  <title>
                    {die
                      ? `${die.ufs_serial ?? ''}\n(${dx}, ${dy})\npred=${Math.round(parseFloat(die.pred) * 1e6)} ppm`
                      : `(${dx}, ${dy}) — die 없음`}
                  </title>
                  <rect
                    x={x} y={y}
                    width={Math.max(0, cellW - 0.6)}
                    height={Math.max(0, cellH - 0.6)}
                    fill={fill}
                    stroke={isDieSel ? '#7C3AED' : isUnitSel ? '#0f172a' : die ? 'rgba(15,23,42,0.12)' : 'rgba(15,23,42,0.04)'}
                    strokeWidth={isDieSel ? 4 : isUnitSel ? 3 : 0.6}
                    style={die && onSelectUnit ? { cursor: 'pointer' } : undefined}
                    onClick={() => {
                      if (!die?.ufs_serial || !onSelectUnit) return
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
                stroke="rgba(100,116,139,0.18)" strokeWidth={0.8} />
            ))}
            {gridYs.map((gy, i) => (
              <line key={`gy-${i}`} x1={cx - radius} y1={gy} x2={cx + radius} y2={gy}
                stroke="rgba(100,116,139,0.18)" strokeWidth={0.8} />
            ))}
          </g>
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
          {/* notch */}
          <rect x={cx - 18} y={cy + radius - 6} width={36} height={8}
            fill="#fff" stroke="#94a3b8" strokeWidth={1} />
          {/* x축 눈금 라벨 (하단, 촘촘하면 skip) */}
          {gridXs.filter((_, i) => i % labelXStep === 0).map((gx, i) => {
            const xVal = xMin + i * labelXStep
            return (
              <text key={`lx-${i}`} x={gx + cellW / 2} y={cy + radius + 22}
                textAnchor="middle" fontSize={18} fill="#94a3b8">{xVal}</text>
            )
          })}
          {/* y축 눈금 라벨 (우측, 촘촘하면 skip) */}
          {gridYs.filter((_, i) => i % labelYStep === 0).map((gy, i) => {
            const yVal = yMin + i * labelYStep
            return (
              <text key={`ly-${i}`} x={cx + radius + 18} y={gy + cellH / 2}
                dominantBaseline="middle" fontSize={18} fill="#94a3b8">{yVal}</text>
            )
          })}
        </svg>
      </div>

    </div>  /* dd-wmap-inner */
  )
}

// ── SHAP 바 (shap_data.csv의 lgbm_gain 기반 실제 순위) ─
function ShapBar({ shapData }) {
  if (!shapData.length) return null
  const bars = shapData.slice(0, 10).map(f => ({
    feature: f.feature,
    val: parseFloat(f.effect_norm) || 0,
    gain: parseFloat(f.lgbm_gain) || 0,
  })).sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))
  const maxGain = Math.max(...bars.map(b => b.gain), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
      {bars.map(b => {
        const w = Math.round(b.gain / maxGain * 100)
        const clr = b.val >= 0 ? '#ef4444' : '#3b82f6'
        return (
          <div key={b.feature} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 60, textAlign: 'right', fontFamily: 'monospace', color: '#374151', flexShrink: 0 }}>{b.feature}</span>
            <div style={{ flex: 1, background: '#f1f5f9', height: 10, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${w}%`, height: '100%', background: clr, borderRadius: 2 }} />
            </div>
            <span style={{ width: 36, fontSize: 10, color: clr, fontWeight: 700, textAlign: 'right' }}>{b.val >= 0 ? '+' : ''}{b.val.toFixed(2)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Unit 진단 패널 (1팀 우측 패널 포팅) ──────────────
function UnitReport({ ufsSerial, allDies, scale, onClose, shapData, unitData }) {
  const dies = useMemo(() =>
    ufsSerial ? allDies.filter(d => d.ufs_serial === ufsSerial) : [],
    [ufsSerial, allDies]
  )

  // dashboard_units.csv에서 anomaly_score, CI 조회
  const anomalyScore = useMemo(() => {
    if (!ufsSerial || !unitData?.length) return null
    const row = unitData.find(u => u.ufs_serial === ufsSerial)
    const v = row ? parseFloat(row.anomaly_score) : NaN
    return isFinite(v) ? v : null
  }, [ufsSerial, unitData])

  const ciData = useMemo(() => {
    if (!ufsSerial || !unitData?.length) return null
    const row = unitData.find(u => u.ufs_serial === ufsSerial)
    if (!row) return null
    const lo = parseFloat(row.ci_low)
    const hi = parseFloat(row.ci_high)
    if (!isFinite(lo) || !isFinite(hi)) return null
    return { lo: Math.round(lo * 1e6), hi: Math.round(hi * 1e6) }
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
          {ciData ? (
            <span style={{ fontSize: 10, color: '#64748b', marginLeft: 8 }}>
              95% CI [{ciData.lo.toLocaleString()} ~ {ciData.hi.toLocaleString()}]
            </span>
          ) : (
            <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 8 }}>CI 산출 중…</span>
          )}
        </div>
      </div>

      {/* 주요 기여 변수 (전체 모델 SHAP 순위 — unit별 실제 기여도 아님) */}
      <div className="dd-section dummy-outline" style={{ padding: '6px 4px 4px' }}>
        <div className="dd-section-title">주요 기여 변수 Top 10 <span style={{ fontSize: 9, color: '#EF4444', fontWeight: 700 }}>모델 전체 순위</span></div>
        <ShapBar shapData={shapData} />
      </div>

      {/* 이상도 점수 (IsolationForest — dashboard_units.csv anomaly_score) */}
      {anomalyScore !== null && (() => {
        const score = Math.round(anomalyScore)
        const scoreColor = score >= 70 ? '#dc2626' : score >= 40 ? '#f97316' : '#16a34a'
        return (
          <div className="dd-section-box">
            <div className="dd-section-title">이상도 점수 <span style={{ fontSize: 9, color: '#64748b' }}>IsolationForest · 0~100</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor, fontFamily: 'monospace' }}>{score}</div>
              <div style={{ flex: 1 }}>
                <div style={{ background: '#f1f5f9', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${score}%`, height: '100%', background: scoreColor, borderRadius: 4 }} />
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 예측 상세 */}
      <div className="dd-section-box">
        <div className="dd-section-title">예측 상세</div>
        <div className="dd-detail-rows">
          <div className="dd-detail-row">
            <span className="dd-detail-key">예측 PPM</span>
            <span className={`dd-detail-val mono ${isRisk ? 'danger' : ''}`}>{ppm.toLocaleString()} ppm</span>
          </div>
          {clfProba !== null && (
            <div className="dd-detail-row">
              <span className="dd-detail-key">불량 확률</span>
              <span className="dd-detail-val mono">{(clfProba * 100).toFixed(1)}%</span>
            </div>
          )}
          <div className="dd-detail-row">
            <span className="dd-detail-key">Die 수</span>
            <span className="dd-detail-val">{dies.length}</span>
          </div>
        </div>
      </div>

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

      <ReportButton ufsSerial={ufsSerial} ppm={ppm} isRisk={isRisk} worstDie={worstDie} grade={
        unitData?.find?.(u => u.ufs_serial === ufsSerial)?.grade ?? null
      } />
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
    } catch (e) {
      console.error('보고서 생성 실패:', e)
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
          <span className="dd-bottom-thresh-sub">train 상위 29.2% 기준</span>
        </div>
        <div className="dd-bottom-thresh-bar-wrap">
          <div className="dd-bottom-thresh-gradient" style={{ background: COLOR_LEGEND_GRADIENT }} />
          <div className="dd-bottom-thresh-marker"
            style={{ left: `${Math.round((scale.threshold / (scale.predMax || 1)) * 100)}%` }}>
            <div className="dd-bottom-thresh-marker-line" />
            <div className="dd-bottom-thresh-marker-label">{thPpm.toLocaleString()}</div>
          </div>
          <div className="dd-bottom-thresh-ends">
            <span>0</span>
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
              const barW   = Math.round((ppm / posMaxPpm) * 100)
              const isDieSel = selectedDie &&
                String(die.die_x) === String(selectedDie.die_x) &&
                String(die.die_y) === String(selectedDie.die_y)
              const fillColor = predColor(pred, scale.predMin, scale.predMax, scale.threshold)

              return (
                <div
                  key={pos}
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
                      style={{ width: `${barW}%`, background: isRisk ? '#EF4444' : '#60A5FA' }} />
                    <div className="dd-bpos-thresh-line"
                      style={{ left: `${Math.round((scale.threshold / (scale.predMax || 1)) * 100)}%` }} />
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

// ── 선택 Unit의 4-Die Position 세로 뷰 (우측 패널용 compact) ─
function UnitDieComparison({ ufsSerial, allDies, scale, selectedDie, onSelectDie }) {
  const dies = useMemo(() =>
    ufsSerial ? allDies.filter(d => d.ufs_serial === ufsSerial) : [],
    [ufsSerial, allDies]
  )

  if (!ufsSerial || !dies.length) return null

  const sorted = [...dies].sort((a, b) => parseInt(a.position || 0) - parseInt(b.position || 0))
  // scale.predMax 기준으로 통일 (임계선과 같은 스케일)
  const maxPpm = Math.round(scale.predMax * 1e6) || 1

  return (
    <div className="dd-unit-compare">
      <div className="dd-unit-compare-title">
        <span className="dd-unit-compare-serial">{ufsSerial}</span>
        <span className="dd-unit-compare-sub">Position별 예측</span>
      </div>
      <div className="dd-pos-list">
        {sorted.map(die => {
          const pred   = parseFloat(die.pred)
          const ppm    = Math.round(pred * 1e6)
          const isRisk = pred > scale.threshold
          const clf    = die.clf_proba !== undefined ? parseFloat(die.clf_proba) : null
          const pos    = die.position || '?'
          const isDieSel = selectedDie &&
            String(die.die_x) === String(selectedDie.die_x) &&
            String(die.die_y) === String(selectedDie.die_y)

          const fillColor = predColor(pred, scale.predMin, scale.predMax, scale.threshold)
          const barW = Math.round((ppm / maxPpm) * 100)

          return (
            <div
              key={pos}
              className={`dd-pos-row ${isDieSel ? 'selected' : ''} ${isRisk ? 'risk' : ''}`}
              onClick={() => onSelectDie?.(die)}
            >
              <div className="dd-pos-arrow">{isDieSel ? '▶' : ''}</div>
              <div className="dd-pos-num">P{pos}</div>
              <div className="dd-pos-chip" style={{ background: fillColor }} />
              <div className="dd-pos-bar-wrap">
                <div className="dd-pos-bar-track">
                  <div
                    className="dd-pos-bar-fill"
                    style={{ width: `${barW}%`, background: isRisk ? '#EF4444' : '#60A5FA' }}
                  />
                  <div
                    className="dd-pos-bar-threshold"
                    style={{ left: `${Math.round((scale.threshold / (scale.predMax || 1)) * 100)}%` }}
                  />
                </div>
                <div className={`dd-pos-bar-label ${isRisk ? 'danger' : ''}`}>
                  {ppm.toLocaleString()} <span className="dd-pos-unit">ppm</span>
                  {clf !== null && (
                    <span className="dd-pos-clf"> · {(clf * 100).toFixed(0)}%</span>
                  )}
                </div>
              </div>
              <div className="dd-pos-coord">({die.die_x},{die.die_y})</div>
            </div>
          )
        })}
      </div>
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
        <div className="dd-verdict-pred" style={{ fontSize: 14 }}>{ppm.toLocaleString()} ppm</div>
      </div>

      {/* 위험도 게이지 */}
      <div className="dd-section-box">
        <div className="dd-section-title">예측 위험도</div>
        <div style={{ margin: '8px 0 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94A3B8', marginBottom: 4 }}>
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
            <span className="dd-detail-val mono" style={{ fontSize: 10 }}>{die.ufs_serial}</span>
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
export default function Drilldown() {
  const { data: dieData, loading: loadingDie } = useCSV('/wafer_map.csv')
  const { data: shapData } = useCSV('/shap_data.csv')
  const { data: unitData } = useCSV('/dashboard_units.csv')

  const [selectedLot, setSelectedLot]   = useState(null)
  const [selectedKey, setSelectedKey]   = useState(null)
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [selectedDie,  setSelectedDie]  = useState(null)
  const [search, setSearch]             = useState('')
  const [expandedLot, setExpandedLot]   = useState(null)
  const [waferSort, setWaferSort]       = useState('default') // 'default' | 'risk_desc' | 'risk_asc'
  const [lotSort, setLotSort]           = useState('risk_desc') // 'risk_desc' | 'risk_asc' | 'default'

  const scale = useMemo(() => computeScale(dieData), [dieData])

  const lotTree = useMemo(() => {
    if (!dieData.length) return []
    const lotMap = {}
    dieData.forEach(d => {
      const lot = String(d.run_id)
      const wno = String(d.wafer_no)
      const key = `${lot}_${wno}`
      if (!lotMap[lot]) lotMap[lot] = { lot, wafers: {}, totalDies: 0, riskDies: 0 }
      if (!lotMap[lot].wafers[wno]) lotMap[lot].wafers[wno] = { wno, key, dies: 0, riskDies: 0, predSum: 0 }
      const pred = parseFloat(d.pred)
      lotMap[lot].wafers[wno].dies++
      lotMap[lot].wafers[wno].predSum += isFinite(pred) ? pred : 0
      lotMap[lot].totalDies++
      lotMap[lot].predSum = (lotMap[lot].predSum || 0) + (isFinite(pred) ? pred : 0)
      if (pred > scale.threshold) {
        lotMap[lot].wafers[wno].riskDies++
        lotMap[lot].riskDies++
      }
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
      return rB - rA // risk_desc (기본)
    })
    return lots.map(l => ({
      ...l,
      riskRatio: l.totalDies ? l.riskDies / l.totalDies : 0,
      avgPpm: l.totalDies ? Math.round(l.predSum / l.totalDies * 1e6) : 0,
      waferList: Object.values(l.wafers).sort((a, b) => parseInt(a.wno) - parseInt(b.wno)).map(w => ({
        ...w,
        avgPpm: w.dies ? Math.round(w.predSum / w.dies * 1e6) : 0,
      }))
    }))
  }, [dieData, scale, search, lotSort])

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

  function handleSelectDie(die) {
    setSelectedDie(die)
  }

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
            {loadingDie && <div className="dd-tree-hint">로딩 중...</div>}
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
                onSelectDie={handleSelectDie}
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
                  onSelectDie={handleSelectDie}
                />
              </div>
              <WaferBottomPanel
                ufsSerial={selectedUnit}
                allDies={selectedDies}
                scale={scale}
                selectedDie={selectedDie}
                onSelectDie={handleSelectDie}
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
                onSelectDie={handleSelectDie}
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
              allDies={dieData}
              scale={scale}
              shapData={shapData}
              unitData={unitData}
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
    </div>
  )
}
