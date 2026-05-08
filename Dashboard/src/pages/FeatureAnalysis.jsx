import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './FeatureAnalysis.css'

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

function useFeatureData(topN = 20) {
  const { data, loading } = useCSV('/feature_importance.csv')

  const top = useMemo(() => {
    if (!data.length) return []
    return [...data]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, topN)
      .map(r => ({
        feature: r.feature,
        lgbm: parseFloat(r.lgbm_gain) || 0,
        et: parseFloat(r.et_impurity) || 0,
        enet: parseFloat(r.enet_abs_coef) || 0,
        lgbm_rank: parseFloat(r.lgbm_rank) || 999,
        et_rank: parseFloat(r.et_rank) || 999,
        enet_rank: parseFloat(r.enet_rank) || 999,
        lgbm_weak: r.lgbm_weak === 'True' || r.lgbm_weak === true,
        et_weak: r.et_weak === 'True' || r.et_weak === true,
        enet_zero: r.enet_zero === 'True' || r.enet_zero === true,
      }))
  }, [data, topN])

  return { top, loading }
}

/* ── Feature Importance ── */
export function ImportancePage() {
  const { top, loading } = useFeatureData(15)
  const { data: distData } = useCSV('/feature_dist.csv')
  const { data: unitData } = useCSV('/dashboard_units.csv')
  const { data: shapRaw } = useCSV('/shap_data.csv')
  const [selectedFeat, setSelectedFeat] = useState(null)

  const topNames = useMemo(() => top.map(d => d.feature), [top])
  const lgbmVals = useMemo(() => top.map(d => d.lgbm), [top])

  // ufs_serial → risk 매핑 (예측값 기준 HIGH/MED/LOW)
  const riskMap = useMemo(() => {
    if (!unitData.length) return {}
    return Object.fromEntries(unitData.map(r => [r.ufs_serial, r.risk]))
  }, [unitData])

  // 박스플롯 통계 계산 (min, Q1, median, Q3, max)
  function boxStats(arr) {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    const n = s.length
    const q = p => {
      const idx = p * (n - 1)
      const lo = Math.floor(idx), hi = Math.ceil(idx)
      return s[lo] + (s[hi] - s[lo]) * (idx - lo)
    }
    return [s[0], q(0.25), q(0.5), q(0.75), s[n - 1]]
  }

  // 박스플롯 옵션
  const boxOpt = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(riskMap).length) return null
    const high  = distData.filter(r => riskMap[r.ufs_serial] === 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => riskMap[r.ufs_serial] !== 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const bHigh  = boxStats(high)
    const bOther = boxStats(other)
    if (!bHigh || !bOther) return null

    return {
      tooltip: {
        trigger: 'item',
        alwaysShowContent: true,
        position: (point, params, dom, rect, size) => [size.viewSize[0] - size.contentSize[0] - 12, 8],
        formatter: p => {
          const d = p.data.value ?? p.data
          const label = p.dataIndex === 0 ? '🔴 고위험(HIGH)' : '🔵 저위험(MED/LOW)'
          const color = p.dataIndex === 0 ? '#EF4444' : '#3B82F6'
          return `<span style="font-weight:700;color:${color}">${label}</span><br/>중앙값: <b>${d[2].toFixed(4)}</b><br/>Q1: ${d[1].toFixed(4)} / Q3: ${d[3].toFixed(4)}`
        }
      },
      grid: { top: 16, left: 70, right: 16, bottom: 24 },
      xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      // 단일 Y축, data 순서: index 0=아래(고위험/빨강), index 1=위(저위험/파랑)
      yAxis: { type: 'category', data: ['고위험', '저위험'], axisLabel: { fontSize: 11, color: '#475569' } },
      series: [
        {
          type: 'boxplot',
          data: [
            { value: bHigh,  itemStyle: { color: 'rgba(239,68,68,.2)', borderColor: 'rgba(239,68,68,.9)', borderWidth: 2 } },
            { value: bOther, itemStyle: { color: 'rgba(59,130,246,.2)', borderColor: 'rgba(59,130,246,.9)', borderWidth: 2 } },
          ],
        },
      ],
    }
  }, [distData, riskMap, selectedFeat])

  // 선택된 피처의 고위험/저위험 분포 (예측값 기준)
  const distOpt = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(riskMap).length) return null
    const high = distData.filter(r => riskMap[r.ufs_serial] === 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => riskMap[r.ufs_serial] !== 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    if (!high.length || !other.length) return null

    // 히스토그램 bin 생성
    const allVals = [...high, ...other]
    const mn = Math.min(...allVals), mx = Math.max(...allVals)
    const BINS = 30
    const step = (mx - mn) / BINS || 1
    const bins = Array.from({ length: BINS }, (_, i) => mn + i * step)

    function toBins(arr) {
      const counts = new Array(BINS).fill(0)
      arr.forEach(v => {
        const idx = Math.min(Math.floor((v - mn) / step), BINS - 1)
        counts[idx]++
      })
      return counts.map(c => +(c / arr.length * 100).toFixed(2))
    }

    return {
      tooltip: { trigger:'axis', formatter: p => `${selectedFeat} = ${p[0].name}<br/>고위험(HIGH): ${p[0].value}%<br/>저위험(MED/LOW): ${p[1]?.value ?? 0}%` },
      legend: { data:['고위험(HIGH)','저위험(MED/LOW)'], bottom:0, textStyle:{ fontSize:10 } },
      grid: { top:10, left:44, right:16, bottom:36 },
      xAxis: { type:'category', data: bins.map(b => b.toFixed(1)), axisLabel:{ fontSize:8, color:'#94A3B8', rotate:30 }, boundaryGap: false },
      yAxis: { type:'value', name:'비율(%)', nameTextStyle:{ fontSize:9, color:'#94A3B8' }, axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
      series: [
        {
          name:'고위험(HIGH)', type:'line', data: toBins(high),
          smooth: true, symbol:'none',
          lineStyle:{ color:'rgba(239,68,68,.9)', width:2 },
          areaStyle:{ color:'rgba(239,68,68,.15)' },
        },
        {
          name:'저위험(MED/LOW)', type:'line', data: toBins(other),
          smooth: true, symbol:'none',
          lineStyle:{ color:'rgba(59,130,246,.9)', width:2 },
          areaStyle:{ color:'rgba(59,130,246,.15)' },
        },
      ],
    }
  }, [distData, unitData, riskMap, selectedFeat])

  const reversedTopNames = useMemo(() => [...topNames].reverse(), [topNames])
  const reversedLgbmVals = useMemo(() => [...lgbmVals].reverse(), [lgbmVals])

  // KPI: 고위험/저위험 unit 수, 비율, threshold
  const riskKpi = useMemo(() => {
    if (!unitData.length) return null
    const total  = unitData.length
    const high   = unitData.filter(r => r.risk === 'HIGH')
    const other  = unitData.filter(r => r.risk !== 'HIGH')
    const thresh = unitData.reduce((mx, r) => {
      const v = parseFloat(r.pred ?? r.predicted ?? r.health_pred ?? 0)
      return isNaN(v) ? mx : Math.max(mx, v)
    }, 0)
    const highPreds  = high.map(r => parseFloat(r.pred ?? r.predicted ?? r.health_pred ?? 0)).filter(v => !isNaN(v))
    const otherPreds = other.map(r => parseFloat(r.pred ?? r.predicted ?? r.health_pred ?? 0)).filter(v => !isNaN(v))
    const minHigh  = highPreds.length  ? Math.min(...highPreds).toFixed(4)  : '-'
    const maxOther = otherPreds.length ? Math.max(...otherPreds).toFixed(4) : '-'
    return {
      total, highN: high.length, otherN: other.length,
      highPct: ((high.length / total) * 100).toFixed(1),
      otherPct: ((other.length / total) * 100).toFixed(1),
      minHigh, maxOther,
    }
  }, [unitData])

  // 박스플롯 통계 요약 (선택 피처 기준)
  const boxSummary = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(riskMap).length) return null
    const high  = distData.filter(r => riskMap[r.ufs_serial] === 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => riskMap[r.ufs_serial] !== 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    if (!high.length || !other.length) return null
    const med = arr => { const s = [...arr].sort((a,b)=>a-b); const m = (s.length-1)/2; return (s[Math.floor(m)]+s[Math.ceil(m)])/2 }
    const iqr = arr => { const s = [...arr].sort((a,b)=>a-b); const n=s.length; const q1=s[Math.floor(n*0.25)]; const q3=s[Math.floor(n*0.75)]; return (q3-q1) }
    return {
      highN: high.length, otherN: other.length,
      highMed: med(high).toFixed(4), otherMed: med(other).toFixed(4),
      highIqr: iqr(high).toFixed(4), otherIqr: iqr(other).toFixed(4),
    }
  }, [distData, riskMap, selectedFeat])

  // SHAP 데이터: |effect_norm| 내림차순 정렬
  const shapSorted = useMemo(() => {
    if (!shapRaw.length) return []
    return [...shapRaw]
      .map(r => ({ feature: r.feature, value: parseFloat(r.effect_norm) || 0 }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  }, [shapRaw])

  // 선택된 피처의 SHAP 정보 (rank, value)
  const shapInfo = useMemo(() => {
    if (!selectedFeat || !shapSorted.length) return null
    const idx = shapSorted.findIndex(d => d.feature === selectedFeat)
    if (idx === -1) return null
    return { feature: shapSorted[idx].feature, value: shapSorted[idx].value, rank: idx + 1 }
  }, [selectedFeat, shapSorted])

  // SHAP 바차트 옵션 — 선택 피처 보라색 하이라이트
  const shapChartOpt = useMemo(() => {
    if (!shapSorted.length || !selectedFeat) return null
    const reversed = [...shapSorted].reverse()
    return {
      tooltip: {
        trigger: 'axis',
        formatter: p => {
          const val = p[0].value
          const isSelected = p[0].name === selectedFeat
          return `${p[0].name}${isSelected ? '  ← 선택된 피처' : ''}<br/>${val >= 0 ? '+' : ''}${val.toFixed(4)}<br/>${val >= 0 ? '🔴 위험 증가 기여' : '🔵 위험 감소 기여'}`
        }
      },
      grid: { top: 8, left: 80, right: 110, bottom: 8 },
      xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      yAxis: { type: 'category', data: reversed.map(d => d.feature), axisLabel: { fontSize: 10, color: '#475569', fontFamily: 'DM Mono,monospace' } },
      series: [{
        type: 'bar',
        barMaxWidth: 16,
        data: reversed.map(d => {
          const isSel = d.feature === selectedFeat
          return {
            value: d.value,
            itemStyle: {
              color: isSel ? '#7C3AED' : (d.value >= 0 ? 'rgba(239,68,68,0.45)' : 'rgba(59,130,246,0.45)'),
              borderColor: isSel ? '#5B21B6' : 'transparent',
              borderWidth: isSel ? 2 : 0,
              borderRadius: d.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
            label: {
              show: isSel,
              position: d.value >= 0 ? 'right' : 'left',
              formatter: `${d.value >= 0 ? '+' : ''}${d.value.toFixed(4)}`,
              fontSize: 10,
              color: '#5B21B6',
              fontWeight: 700,
            },
          }
        }),
      }],
    }
  }, [shapSorted, selectedFeat])

  const BAR_COLORS = ['#3B82F6','#3B82F6','#3B82F6','#60A5FA','#60A5FA','#93C5FD','#93C5FD','#BFDBFE','#BFDBFE','#BFDBFE','#DBEAFE','#DBEAFE','#EFF6FF','#EFF6FF','#EFF6FF']

  const hbarOpt = useMemo(() => ({
    tooltip: { trigger:'item', formatter: p => `${p.name}<br/>LGBM Gain: ${Number(p.value).toExponential(3)}<br/>클릭하면 분포 확인` },
    grid: { top:10, left:66, right:60, bottom:10 },
    xAxis: { type:'value', axisLabel:{ fontSize:9, color:'#94A3B8' }, splitLine:{ lineStyle:{ color:'#F1F5F9' } } },
    yAxis: { type:'category', data: reversedTopNames, axisLabel:{ fontSize:10, color:'#475569', fontFamily:'DM Mono,monospace' } },
    series: [{
      type:'bar',
      data: reversedLgbmVals.map((v, i) => {
        const feat = reversedTopNames[i]
        const isSelected = feat === selectedFeat
        return {
          value: v,
          itemStyle: {
            color: isSelected ? '#2563EB' : (BAR_COLORS[i] || '#DBEAFE'),
            borderColor: isSelected ? '#1E293B' : 'transparent',
            borderWidth: isSelected ? 2 : 0,
            borderRadius: [0,4,4,0],
          }
        }
      }),
      barMaxWidth:16,
      label:{ show:true, position:'right', fontSize:9, formatter: p => Number(p.value).toExponential(2), color:'#475569' },
    }],
  }), [reversedTopNames, reversedLgbmVals, selectedFeat])


  if (loading || !top.length) {
    return (
      <div className="feat-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>
        데이터 로딩 중…
      </div>
    )
  }

  return (
    <div className="feat-page" style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:16, alignItems:'stretch', flex:1, minHeight:0 }}>

        {/* 왼쪽: 막대차트 — 오른쪽 높이에 맞춰 늘어남 */}
        <div className="chart-card feat-left-card">
          <div className="cc-header">
            <div className="cc-title">🏆 LGBM Gain Top-15<span className="cc-tag">피처 클릭 → 분포 확인</span></div>
          </div>
          <div className="cc-body" style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
            <div style={{ flex:1, minHeight: 600 }}>
              <ReactECharts
                option={hbarOpt}
                style={{ height: '100%' }}
                onEvents={{
                  click: p => {
                    const feat = reversedTopNames[p.dataIndex]
                    if (feat) setSelectedFeat(feat)
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* 오른쪽: 선택 피처 헤더 + 분포/SHAP 나란히 + 박스플롯 full-width */}
        {selectedFeat && distOpt ? (
          <div style={{ display:'flex', flexDirection:'column', gap:10, minHeight:0 }}>

            {/* 선택 피처 헤더 */}
            <div style={{ padding:'8px 14px', background:'#F8FAFC', borderRadius:8, border:'1px solid #E2E8F0', fontSize:13, fontWeight:700, color:'#1E293B', fontFamily:'DM Mono,monospace' }}>
              선택 Feature : <span style={{ color:'#2563EB' }}>{selectedFeat}</span>
            </div>

            {/* 중단: 분포 비교 + SHAP 나란히 */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              <ChartCard title="📉 고위험 vs 저위험 분포" tag="히스토그램">
                {riskKpi && (
                  <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                    <div style={{ flex:1, background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.25)', borderRadius:8, padding:'8px 12px' }}>
                      <div style={{ fontSize:13, color:'#94A3B8' }}>🔴 고위험 (예측값 &gt; threshold)</div>
                    </div>
                    <div style={{ flex:1, background:'rgba(59,130,246,.06)', border:'1px solid rgba(59,130,246,.25)', borderRadius:8, padding:'8px 12px' }}>
                      <div style={{ fontSize:13, color:'#94A3B8' }}>🔵 저위험 (예측값 ≤ threshold)</div>
                    </div>
                  </div>
                )}
                <ReactECharts option={distOpt} style={{ height: 330 }} />
              </ChartCard>

              {shapChartOpt ? (
                <ChartCard
                  title="🧬 SHAP 기여도"
                  tag={shapInfo ? `순위 #${shapInfo.rank}` : 'Top-20 밖'}
                >
                  {shapInfo && (
                    <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                      <div style={{ flex:1, background:'rgba(124,58,237,.06)', border:'1px solid rgba(124,58,237,.25)', borderRadius:8, padding:'8px 12px' }}>
                        <div style={{ fontSize:20, fontWeight:700, color: shapInfo.value >= 0 ? '#EF4444' : '#3B82F6' }}>
                          {shapInfo.value >= 0 ? '▲ 위험 증가' : '▼ 위험 감소'}&nbsp;
                          <span style={{ fontSize:14, fontFamily:'DM Mono,monospace', color:'#7C3AED' }}>
                            {shapInfo.value >= 0 ? '+' : ''}{shapInfo.value.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  <ReactECharts option={shapChartOpt} style={{ height: shapInfo ? 330 : 380 }} />
                </ChartCard>
              ) : (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', borderRadius:10, border:'2px dashed #E2E8F0', color:'#94A3B8', fontSize:12 }}>
                  SHAP 데이터 없음
                </div>
              )}
            </div>

            {/* 하단: 박스플롯 full-width — 남은 공간 꽉 채움 */}
            {boxOpt && (
              <div style={{ flex:1, minHeight: 160, display:'flex', flexDirection:'column' }}>
                <div className="chart-card" style={{ flex:1, display:'flex', flexDirection:'column' }}>
                  <div className="cc-header">
                    <div className="cc-title">📦 박스플롯 비교<span className="cc-tag">중앙값·IQR</span></div>
                  </div>
                  <div className="cc-body" style={{ flex:1, minHeight:0 }}>
                    <ReactECharts option={boxOpt} style={{ height:'100%', minHeight: 130 }} />
                  </div>
                </div>
              </div>
            )}

            {shapChartOpt && (
              <ChartCard
                title={`🧬 ${selectedFeat} — SHAP 기여도 분석`}
                tag={shapInfo ? `SHAP 순위 #${shapInfo.rank}` : 'SHAP Top-20'}
              >
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>
                  {shapInfo ? (
                    <>
                      <span style={{ fontWeight: 700, color: shapInfo.value >= 0 ? '#EF4444' : '#3B82F6', marginRight: 8 }}>
                        {shapInfo.value >= 0 ? '▲ 위험 증가 기여' : '▼ 위험 감소 기여'}
                      </span>
                      effect_norm:&nbsp;
                      <b style={{ fontFamily: 'DM Mono,monospace', color: '#7C3AED' }}>
                        {shapInfo.value >= 0 ? '+' : ''}{shapInfo.value.toFixed(4)}
                      </b>
                      &nbsp;·&nbsp;전체 SHAP 순위&nbsp;
                      <b style={{ fontFamily: 'DM Mono,monospace', color: '#7C3AED' }}>#{shapInfo.rank}</b>
                    </>
                  ) : (
                    <span style={{ color: '#94A3B8' }}>이 피처는 SHAP Top-20 범위 밖입니다.</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 6 }}>
                  <span style={{ color: '#7C3AED', fontWeight: 700 }}>■</span> 선택 피처&nbsp;&nbsp;
                  <span style={{ color: 'rgba(239,68,68,0.8)', fontWeight: 700 }}>■</span> 위험 증가&nbsp;&nbsp;
                  <span style={{ color: 'rgba(59,130,246,0.8)', fontWeight: 700 }}>■</span> 위험 감소
                </div>
                <ReactECharts option={shapChartOpt} style={{ height: 360 }} />
              </ChartCard>
            )}
          </div>
        ) : (
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            borderRadius:10, border:'2px dashed #E2E8F0',
            flexDirection:'column', gap:8, color:'#94A3B8', fontSize:12,
            minHeight: 300,
          }}>
            <div style={{ fontSize:24 }}>👆</div>
            왼쪽 막대를 클릭하면<br/>분포가 여기에 표시됩니다
          </div>
        )}
      </div>
    </div>
  )
}

/* ── SHAP 분석 ── */
export function ShapPage() {
  const { data: barData, loading: loadingBar } = useCSV('/shap_bar.csv')
  const { data: beeData, loading: loadingBee } = useCSV('/shap_beeswarm.csv')
  // Top-15 피처 목록 (shap_bar rank 순)
  const topFeats = useMemo(() => {
    if (!barData.length) return []
    return [...barData]
      .sort((a, b) => parseFloat(a.rank) - parseFloat(b.rank))
      .slice(0, 15)
      .map(r => r.feature)
  }, [barData])

  // SHAP Bar — 양방향 (mean SHAP 부호 포함, shap_bar.csv에서 직접 읽음)
  const shapBarOpt = useMemo(() => {
    if (!barData.length) return null
    const top15 = [...barData]
      .sort((a, b) => parseFloat(a.rank) - parseFloat(b.rank))
      .slice(0, 15)
    const items = top15.map(r => ({
      feature: r.feature,
      val: parseFloat(r.mean_shap) || 0,
    })).sort((a, b) => a.val - b.val)

    const feats = items.map(d => d.feature)
    const vals  = items.map(d => d.val)
    const maxAbs = Math.max(...vals.map(Math.abs))

    return {
      tooltip: {
        trigger: 'axis',
        formatter: p => {
          const v = parseFloat(p[0].value)
          return `${p[0].name}<br/>mean SHAP: ${v.toFixed(6)}<br/>${v >= 0 ? '위험 기여 ↑' : '위험 억제 ↓'}`
        },
      },
      grid: { top: 8, left: 90, right: 24, bottom: 24 },
      xAxis: {
        type: 'value',
        min: -maxAbs * 1.2, max: maxAbs * 1.2,
        axisLabel: { fontSize: 9, color: '#94A3B8', formatter: v => v.toFixed(4) },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { show: true, lineStyle: { color: '#E2E8F0' } },
      },
      yAxis: {
        type: 'category', data: feats,
        axisLabel: { fontSize: 10, color: '#475569', fontFamily: 'DM Mono,monospace' },
      },
      series: [{
        type: 'bar', barMaxWidth: 14,
        data: vals.map((v) => {
          const isPos = v >= 0
          return {
            value: v,
            itemStyle: {
              color: isPos ? 'rgba(239,68,68,0.75)' : 'rgba(59,130,246,0.75)',
              borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          }
        }),
        markLine: {
          silent: true,
          data: [{ xAxis: 0, lineStyle: { color: '#94A3B8', type: 'solid', width: 1 } }],
        },
      }],
    }
  }, [barData])

  // Beeswarm: Top-15 피처 전체, x=SHAP value, y=피처명, 색=feat_norm
  const beeswarmOpt = useMemo(() => {
    if (!beeData.length || !topFeats.length) return null

    const top15 = topFeats.slice(0, 15)

    // 피처별 샘플링 (각 500개)
    const series = top15.map((feat, fi) => {
      const rows = beeData.filter(r => r.feature === feat)
      const sampled = rows.length > 500
        ? rows.filter((_, i) => i % Math.ceil(rows.length / 500) === 0)
        : rows
      return {
        name: feat,
        type: 'scatter',
        data: sampled.map(r => [
          parseFloat(r.shap_value),
          fi,                          // y = 피처 인덱스
          parseFloat(r.feat_norm),     // 색상용
        ]),
        symbolSize: 5,
        itemStyle: {
          // feat_norm 0=파랑, 1=빨강 그라데이션
          color: p => {
            const norm = p.data[2]
            const r = Math.round(59  + (239 - 59)  * norm)
            const g = Math.round(130 + (68  - 130) * norm)
            const b = Math.round(246 + (68  - 246) * norm)
            return `rgba(${r},${g},${b},0.6)`
          },
        },
        encode: { x: 0, y: 1 },
      }
    })

    let xMin = Infinity, xMax = -Infinity
    beeData.forEach(r => {
      const v = parseFloat(r.shap_value)
      if (v < xMin) xMin = v
      if (v > xMax) xMax = v
    })
    const xPad = (xMax - xMin) * 0.05

    return {
      tooltip: {
        trigger: 'item',
        formatter: p => {
          const feat = top15[p.data[1]]
          const sv = parseFloat(p.data[0])
          const fn = parseFloat(p.data[2])
          return `<b>${feat}</b><br/>SHAP: ${sv.toFixed(5)}<br/>피처값(정규화): ${fn.toFixed(3)}<br/>${sv >= 0 ? '위험 기여 ↑' : '위험 기여 ↓'}`
        },
      },
      grid: { top: 12, left: 100, right: 60, bottom: 36 },
      xAxis: {
        type: 'value',
        name: 'SHAP value',
        nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { fontSize: 10, color: '#64748B' },
        min: +(xMin - xPad).toFixed(4),
        max: +(xMax + xPad).toFixed(4),
        axisLabel: { fontSize: 9, color: '#94A3B8', formatter: v => v.toFixed(3) },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
      },
      yAxis: {
        type: 'value',
        min: -0.5, max: top15.length - 0.5,
        interval: 1,
        axisLabel: {
          fontSize: 10, color: '#475569',
          fontFamily: 'DM Mono,monospace',
          formatter: v => top15[Math.round(v)] ?? '',
        },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      visualMap: {
        show: true,
        type: 'continuous',
        min: 0, max: 1,
        dimension: 2,
        orient: 'vertical',
        right: 8, top: 'middle',
        text: ['피처값↑', '피처값↓'],
        textStyle: { fontSize: 9, color: '#64748B' },
        inRange: { color: ['#3B82F6', '#EF4444'] },
        itemWidth: 12, itemHeight: 80,
      },
      series: [
        ...series,
        {
          type: 'line', data: [],
          markLine: {
            silent: true, symbol: 'none',
            data: [{ xAxis: 0, lineStyle: { color: '#94A3B8', type: 'dashed', width: 1 } }],
          },
        },
      ],
    }
  }, [beeData, topFeats])

  const loading = loadingBar || loadingBee

  if (loading) {
    return (
      <div className="feat-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94A3B8', fontSize:14 }}>
        데이터 로딩 중…
      </div>
    )
  }

  const top1 = barData.find(r => parseFloat(r.rank) === 1)

  return (
    <div className="feat-page">
      {/* KPI 요약 */}
      <div style={{ display:'flex', gap:10, marginBottom:12 }}>
        {[
          { label:'분석 피처 수',  value: barData.length, color:'#7C3AED' },
          { label:'Top-1 피처',   value: top1?.feature ?? '-', color:'#7C3AED' },
          { label:'Top-1 mean SHAP', value: top1 ? parseFloat(top1.mean_shap || top1.mean_abs_shap).toFixed(5) : '-', color:'#7C3AED' },
        ].map((s, i) => (
          <div key={i} className="stat-card-feat" style={{ borderTop:`3px solid ${s.color}`, flex:1 }}>
            <div style={{ fontSize:i===1?12:18, fontWeight:700, fontFamily:'DM Mono,monospace', color:s.color }}>{s.value}</div>
            <div style={{ fontSize:10, color:'#64748B', marginTop:3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>
        {/* 왼쪽: SHAP Bar */}
        <ChartCard title="📊 피처별 mean SHAP Top-15" tag="">
          <div style={{ fontSize:11, color:'#64748B', marginBottom:6 }}>
            <span style={{ color:'#EF4444', fontWeight:600 }}>빨강(오른쪽)</span> = 위험 기여 증가 &nbsp;
            <span style={{ color:'#3B82F6', fontWeight:600 }}>파랑(왼쪽)</span> = 위험 억제
          </div>
          {shapBarOpt
            ? <ReactECharts option={shapBarOpt} style={{ height: 430 }} />
            : <div style={{ color:'#94A3B8', padding:20, textAlign:'center' }}>데이터 없음</div>
          }
        </ChartCard>

        {/* 오른쪽: Beeswarm */}
        <ChartCard title="🐝 SHAP Beeswarm — Top-15 피처" tag="피처값↑=빨강 / 피처값↓=파랑">
          <div style={{ fontSize:11, color:'#64748B', marginBottom:6 }}>
            각 점 = unit 1개. x축 오른쪽(SHAP↑) = 위험 기여 증가, 왼쪽(SHAP↓) = 위험 억제.
            점 색상은 해당 피처의 값 크기 (파랑=낮음, 빨강=높음)
          </div>
          {beeswarmOpt
            ? <ReactECharts option={beeswarmOpt} style={{ height: 430 }} />
            : <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:430, color:'#94A3B8', fontSize:12 }}>
                데이터 로딩 중…
              </div>
          }
        </ChartCard>
      </div>
    </div>
  )
}
