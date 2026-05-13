/**
 * 계층별 정밀 분석 — 1팀 Drilldown 구조 포팅 (CSV 기반)
 *
 * 좌측  : Lot 트리 (lot → wafer 리스트, 위험률/번호 정렬)
 * 중앙  : WaferMap SVG (단일 wafer die 히트맵 or lot 누적 max)
 * 우측  : Unit 진단 (verdict + pred ppm + grade)
 *
 * 데이터:
 *   - wafer_map.csv  : ufs_serial, run_id, wafer_no, die_x, die_y, pred, health, clf_proba, split
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
function WaferMap({ dies, scale, selectedUnit, onSelectUnit }) {
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
  const margin = 6
  const inner = VB - margin * 2
  const { xMin, xMax, yMin, yMax, xRange, yRange } = layout
  const cellW = inner / xRange
  const cellH = inner / yRange
  const centerX = (xMin + xMax) / 2
  const centerY = (yMin + yMax) / 2
  const cx = VB / 2, cy = VB / 2
  const radius = inner / 2

  // mask: 모든 die 좌표 집합
  const mask = [...dieMap.keys()].map(k => k.split(',').map(Number))

  return (
    <div className="dd-wmap-container">
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
            {mask.map(([dx, dy]) => {
              const die = dieMap.get(`${dx},${dy}`)
              const x = cx + (dx - centerX) * cellW - cellW / 2
              const y = cy + (dy - centerY) * cellH - cellH / 2
              const isSelected = die?.ufs_serial === selectedUnit
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
                    stroke={isSelected ? '#0f172a' : die ? 'rgba(15,23,42,0.12)' : 'rgba(15,23,42,0.04)'}
                    strokeWidth={isSelected ? 3 : 0.6}
                    style={die && onSelectUnit ? { cursor: 'pointer' } : undefined}
                    onClick={() => die?.ufs_serial && onSelectUnit?.(die.ufs_serial)}
                  />
                </g>
              )
            })}
          </g>
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
          {/* notch */}
          <rect x={cx - 18} y={cy + radius - 6} width={36} height={8}
            fill="#fff" stroke="#94a3b8" strokeWidth={1} />
        </svg>
      </div>

      {/* 범례 */}
      <div className="dd-wmap-legend">
        <div className="dd-wmap-legend-title">예측값 (ppm)</div>
        <div className="dd-wmap-legend-section">
          <div className="dd-wmap-legend-label">정상</div>
          {[0, 0.5, 1].map((t, i, arr) => {
            const next = arr[i + 1] ?? 1.01
            const v = scale.predMin + (scale.threshold - scale.predMin) * t
            const vNext = scale.predMin + (scale.threshold - scale.predMin) * next
            return (
              <div key={`n-${t}`} className="dd-wmap-legend-row">
                <span className="dd-wmap-legend-dot"
                  style={{ background: predColor(v, scale.predMin, scale.predMax, scale.threshold) }} />
                <span className="dd-wmap-legend-val">
                  {next > 1 ? `≤ ${Math.round(v * 1e6)}` : `~${Math.round(vNext * 1e6)}`}
                </span>
              </div>
            )
          })}
        </div>
        <div className="dd-wmap-legend-section">
          <div className="dd-wmap-legend-label risk">위험 (≥ τ)</div>
          {[0, 0.5, 1].map((t, i) => {
            const v = scale.threshold + (scale.predMax - scale.threshold) * t
            return (
              <div key={`r-${t}`} className="dd-wmap-legend-row">
                <span className="dd-wmap-legend-dot"
                  style={{ background: predColor(v, scale.predMin, scale.predMax, scale.threshold) }} />
                <span className="dd-wmap-legend-val">
                  {i === 2 ? `≥ ${Math.round(v * 1e6)}` : `${Math.round(v * 1e6)}~`}
                </span>
              </div>
            )
          })}
        </div>
        <div className="dd-wmap-legend-meta">
          <div>{dies.length} dies</div>
          <div>{xRange}×{yRange} grid</div>
          <div>τ = <span className="mono">{Math.round(scale.threshold * 1e6)} ppm</span></div>
        </div>
        <div className="dd-wmap-legend-bar" style={{ background: COLOR_LEGEND_GRADIENT }} />
      </div>
    </div>
  )
}

// ── Unit 진단 패널 (1팀 우측 패널 포팅) ──────────────
function UnitReport({ ufsSerial, allDies, scale, onClose }) {
  const dies = useMemo(() =>
    ufsSerial ? allDies.filter(d => d.ufs_serial === ufsSerial) : [],
    [ufsSerial, allDies]
  )

  if (!ufsSerial) return (
    <div className="dd-report-empty">
      wafer map의 die를 클릭하면 진단이 표시됩니다.
    </div>
  )

  if (!dies.length) return (
    <div className="dd-report-empty">데이터 없음</div>
  )

  const pred = parseFloat(dies[0].pred)
  const ppm = Math.round(pred * 1e6)
  const isRisk = pred > scale.threshold
  const health = dies[0].health !== undefined ? parseFloat(dies[0].health) : null
  const waferNo = dies[0].wafer_no ?? null
  const runId   = dies[0].run_id ?? null
  const clfProba = dies[0].clf_proba !== undefined ? parseFloat(dies[0].clf_proba) : null

  // pred 백분위 (전체 dies 기준)
  const allPreds = allDies.map(d => parseFloat(d.pred)).filter(isFinite).sort((a, b) => a - b)
  const rank = allPreds.length
    ? allPreds.filter(p => p <= pred).length / allPreds.length
    : 0

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
          <span className="dd-verdict-serial">
            {ufsSerial}
            {runId && waferNo && (
              <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text3)' }}>
                · Lot {runId} · Wafer #{waferNo}
              </span>
            )}
          </span>
          {onClose && <button className="dd-report-close" onClick={onClose}>✕</button>}
        </div>
        <div className="dd-verdict-pred">
          pred {pred.toFixed(5)}
          <span className="dd-verdict-chip tbd" title="모델 예측 신뢰구간 산출 미연결 — TBD">
            ⚠ 95% 신뢰구간 TBD
          </span>
        </div>
      </div>

      {/* 칩 */}
      <div className="dd-chips">
        {isRisk && (
          <span className="dd-chip danger" title="pred > threshold (상위 위험 구간)">
            ⚠ 위험 분류
          </span>
        )}
        <span className="dd-chip info" title="전체 pred 백분위">
          · 백분위 {(rank * 100).toFixed(1)}%
        </span>
      </div>

      {/* SHAP TBD */}
      <div className="dd-section">
        <div className="dd-section-title">
          주요 기여 변수 Top 20
          <span className="dd-verdict-chip tbd">⚠ TBD</span>
        </div>
        <div className="dd-tbd-block">
          unit별 SHAP feature attribution이 아직 연결되지 않았습니다.
        </div>
      </div>

      {/* 이상도 TBD */}
      <div className="dd-section-box">
        <div className="dd-section-title">
          이상도 점수
          <span className="dd-verdict-chip tbd">⚠ TBD</span>
        </div>
        <div className="dd-section-desc">
          다변량 이상도 산출 (IsolationForest 또는 Mahalanobis) 미연결 — TBD.
        </div>
      </div>

      {/* 예측 상세 */}
      <div className="dd-section-box">
        <div className="dd-section-title">예측 상세</div>
        <div className="dd-detail-rows">
          <div className="dd-detail-row">
            <span className="dd-detail-key">예측 PPM</span>
            <span className={`dd-detail-val mono ${isRisk ? 'danger' : ''}`}>{ppm.toLocaleString()} ppm</span>
          </div>
          {health !== null && (
            <div className="dd-detail-row">
              <span className="dd-detail-key">실제 Health</span>
              <span className="dd-detail-val mono">{health === 0 ? '0 (정상)' : health.toFixed(6)}</span>
            </div>
          )}
          {clfProba !== null && (
            <div className="dd-detail-row">
              <span className="dd-detail-key">CLF 확률</span>
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

      <button className="dd-report-btn" disabled>📄 보고서 생성</button>
    </div>
  )
}

// ── 메인 ─────────────────────────────────────────────
export default function Drilldown() {
  const { data: dieData, loading: loadingDie } = useCSV('/wafer_map.csv')

  const [selectedLot, setSelectedLot]   = useState(null)
  const [selectedKey, setSelectedKey]   = useState(null)
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [search, setSearch]             = useState('')
  const [expandedLot, setExpandedLot]   = useState(null)
  const [waferSort, setWaferSort]       = useState('default') // 'default' | 'risk_desc'

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
      return rB - rA
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
  }, [dieData, scale, search])

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

  useEffect(() => { setSelectedUnit(null) }, [selectedKey])

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
                        className={`dd-wafer-sort-btn ${waferSort === 'risk_desc' ? 'active' : ''}`}
                        onClick={() => setWaferSort(s => s === 'risk_desc' ? 'default' : 'risk_desc')}
                      >
                        {waferSort === 'risk_desc' ? '▼ 위험률순' : '· 위험률순'}
                      </button>
                      {[...waferList]
                        .sort((a, b) => waferSort === 'risk_desc'
                          ? (b.riskDies / b.dies) - (a.riskDies / a.dies)
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

        {/* ── 중: WaferMap ── */}
        <div className="dd-center-panel">
          {!selectedKey && !selectedLot && (
            <div className="dd-center-panel-inner">
              <div className="dd-panel-title">Wafer Map</div>
              <div className="dd-map-hint">← 좌측 목록에서 Lot을 클릭해 펼친 후 Wafer를 선택하세요</div>
            </div>
          )}

          {/* 단일 wafer */}
          {selectedKey && (
            <div className="dd-center-panel-inner">
              <div className="dd-panel-header">
                <span className="dd-panel-title">Wafer {selectedKey.replace('_', ' · #')}</span>
                <span className="dd-panel-meta">Dies {selectedDies.length}</span>
              </div>
              <WaferMap
                dies={selectedDies}
                scale={scale}
                selectedUnit={selectedUnit}
                onSelectUnit={setSelectedUnit}
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
              <WaferMap
                dies={lotAccumDies}
                scale={scale}
                selectedUnit={selectedUnit}
                onSelectUnit={setSelectedUnit}
              />
            </div>
          )}
        </div>

        {/* ── 우: Unit 진단 ── */}
        <div className="dd-right-panel">
          <div className="dd-panel-title">Unit 진단</div>
          <UnitReport
            ufsSerial={selectedUnit}
            allDies={dieData}
            scale={scale}
            onClose={selectedUnit ? () => setSelectedUnit(null) : undefined}
          />
        </div>

      </div>
    </div>
  )
}
