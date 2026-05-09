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

function useFeatureData(topN = 15) {
  const { data, loading } = useCSV('/feature_importance.csv')
  const top = useMemo(() => {
    if (!data.length) return []
    return [...data]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, topN)
      .map(r => ({
        feature: r.feature,
        lgbm: parseFloat(r.lgbm_gain) || 0,
      }))
  }, [data, topN])
  return { top, loading }
}

export function ImportancePage() {
  const { top, loading } = useFeatureData(15)
  const { data: distData } = useCSV('/feature_dist.csv')
  const { data: unitData } = useCSV('/dashboard_units.csv')
  const { data: shapRaw }  = useCSV('/shap_bar.csv')

  const [selectedFeat, setSelectedFeat] = useState(null)
  const [activeTab, setActiveTab]       = useState('lgbm') // 'lgbm' | 'shap'

  // ufs_serial → risk 매핑
  const riskMap = useMemo(() => {
    if (!unitData.length) return {}
    return Object.fromEntries(unitData.map(r => [r.ufs_serial, r.risk]))
  }, [unitData])

  // SHAP Top-15 (mean_shap 절대값 기준)
  const shapTop = useMemo(() => {
    if (!shapRaw.length) return []
    return [...shapRaw]
      .sort((a, b) => parseFloat(a.rank) - parseFloat(b.rank))
      .slice(0, 15)
      .map(r => ({ feature: r.feature, value: parseFloat(r.mean_shap) || 0 }))
  }, [shapRaw])

  // ── 박스플롯 통계
  function boxStats(arr) {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    const n = s.length
    const q = p => { const idx = p*(n-1); const lo=Math.floor(idx),hi=Math.ceil(idx); return s[lo]+(s[hi]-s[lo])*(idx-lo) }
    return [s[0], q(0.25), q(0.5), q(0.75), s[n-1]]
  }

  // ── 박스플롯 옵션
  const boxOpt = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(riskMap).length) return null
    const high  = distData.filter(r => riskMap[r.ufs_serial] === 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => riskMap[r.ufs_serial] !== 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const bHigh = boxStats(high), bOther = boxStats(other)
    if (!bHigh || !bOther) return null
    return {
      tooltip: {
        trigger: 'item',
        formatter: p => {
          const d = p.data.value ?? p.data
          const label = p.dataIndex === 0 ? '🔴 고위험(HIGH)' : '🔵 저위험(MED/LOW)'
          const color = p.dataIndex === 0 ? '#EF4444' : '#3B82F6'
          return `<span style="font-weight:700;color:${color}">${label}</span><br/>중앙값: <b>${d[2].toFixed(4)}</b><br/>Q1: ${d[1].toFixed(4)} / Q3: ${d[3].toFixed(4)}`
        }
      },
      grid: { top: 16, left: 70, right: 16, bottom: 24 },
      xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      yAxis: { type: 'category', data: ['고위험', '저위험'], axisLabel: { fontSize: 11, color: '#475569' } },
      series: [{
        type: 'boxplot',
        data: [
          { value: bHigh,  itemStyle: { color: 'rgba(239,68,68,.2)',  borderColor: 'rgba(239,68,68,.9)',  borderWidth: 2 } },
          { value: bOther, itemStyle: { color: 'rgba(59,130,246,.2)', borderColor: 'rgba(59,130,246,.9)', borderWidth: 2 } },
        ],
      }],
    }
  }, [distData, riskMap, selectedFeat])

  // ── 히스토그램 옵션
  const distOpt = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(riskMap).length) return null
    const high  = distData.filter(r => riskMap[r.ufs_serial] === 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => riskMap[r.ufs_serial] !== 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    if (!high.length || !other.length) return null
    const allVals = [...high, ...other]
    const mn = Math.min(...allVals), mx = Math.max(...allVals)
    const BINS = 30, step = (mx - mn) / BINS || 1
    const bins = Array.from({ length: BINS }, (_, i) => mn + i * step)
    function toBins(arr) {
      const counts = new Array(BINS).fill(0)
      arr.forEach(v => { const idx = Math.min(Math.floor((v - mn) / step), BINS - 1); counts[idx]++ })
      return counts.map(c => +(c / arr.length * 100).toFixed(2))
    }
    return {
      tooltip: { trigger: 'axis', formatter: p => `${selectedFeat} = ${p[0].name}<br/>고위험: ${p[0].value}%<br/>저위험: ${p[1]?.value ?? 0}%` },
      legend: { data: ['고위험(HIGH)', '저위험(MED/LOW)'], bottom: 0, textStyle: { fontSize: 10 } },
      grid: { top: 10, left: 44, right: 16, bottom: 36 },
      xAxis: { type: 'category', data: bins.map(b => b.toFixed(1)), axisLabel: { fontSize: 8, color: '#94A3B8', rotate: 30 }, boundaryGap: false },
      yAxis: { type: 'value', name: '비율(%)', nameTextStyle: { fontSize: 9, color: '#94A3B8' }, axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      series: [
        { name: '고위험(HIGH)',    type: 'line', data: toBins(high),  smooth: true, symbol: 'none', lineStyle: { color: 'rgba(239,68,68,.9)',  width: 2 }, areaStyle: { color: 'rgba(239,68,68,.15)' } },
        { name: '저위험(MED/LOW)', type: 'line', data: toBins(other), smooth: true, symbol: 'none', lineStyle: { color: 'rgba(59,130,246,.9)', width: 2 }, areaStyle: { color: 'rgba(59,130,246,.15)' } },
      ],
    }
  }, [distData, riskMap, selectedFeat])

  // ── LGBM 바차트
  const lgbmNames = useMemo(() => [...top.map(d => d.feature)].reverse(), [top])
  const lgbmVals  = useMemo(() => [...top.map(d => d.lgbm)].reverse(),    [top])
  const BAR_COLORS = ['#3B82F6','#3B82F6','#3B82F6','#60A5FA','#60A5FA','#93C5FD','#93C5FD','#BFDBFE','#BFDBFE','#BFDBFE','#DBEAFE','#DBEAFE','#EFF6FF','#EFF6FF','#EFF6FF']

  const lgbmOpt = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br/>LGBM Gain: ${Number(p.value).toExponential(3)}<br/>클릭하면 분포 확인` },
    grid: { top: 10, left: 66, right: 60, bottom: 10 },
    xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
    yAxis: { type: 'category', data: lgbmNames, axisLabel: { fontSize: 10, color: '#475569', fontFamily: 'DM Mono,monospace' } },
    series: [{
      type: 'bar', barMaxWidth: 16,
      data: lgbmVals.map((v, i) => {
        const feat = lgbmNames[i]
        const isSel = feat === selectedFeat
        return {
          value: v,
          itemStyle: {
            color: isSel ? '#2563EB' : (BAR_COLORS[i] || '#DBEAFE'),
            borderColor: isSel ? '#1E293B' : 'transparent',
            borderWidth: isSel ? 2 : 0,
            borderRadius: [0, 4, 4, 0],
          }
        }
      }),
      label: { show: true, position: 'right', fontSize: 9, formatter: p => Number(p.value).toExponential(2), color: '#475569' },
    }],
  }), [lgbmNames, lgbmVals, selectedFeat])

  // ── SHAP 바차트
  const shapNames = useMemo(() => [...shapTop.map(d => d.feature)].reverse(), [shapTop])
  const shapVals  = useMemo(() => [...shapTop.map(d => d.value)].reverse(),   [shapTop])

  const shapOpt = useMemo(() => {
    if (!shapTop.length) return null
    const maxAbs = Math.max(...shapVals.map(Math.abs))
    return {
      tooltip: { trigger: 'item', formatter: p => {
        const v = parseFloat(p.value)
        return `${p.name}<br/>mean SHAP: ${v.toFixed(6)}<br/>${v >= 0 ? '위험 기여 ↑' : '위험 억제 ↓'}<br/>클릭하면 분포 확인`
      }},
      grid: { top: 10, left: 66, right: 24, bottom: 10 },
      xAxis: {
        type: 'value', min: -maxAbs * 1.2, max: maxAbs * 1.2,
        axisLabel: { fontSize: 9, color: '#94A3B8', formatter: v => v.toFixed(4) },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
      },
      yAxis: { type: 'category', data: shapNames, axisLabel: { fontSize: 10, color: '#475569', fontFamily: 'DM Mono,monospace' } },
      series: [{
        type: 'bar', barMaxWidth: 16,
        data: shapVals.map((v, i) => {
          const feat = shapNames[i]
          const isSel = feat === selectedFeat
          return {
            value: v,
            itemStyle: {
              color: isSel ? '#7C3AED' : (v >= 0 ? 'rgba(239,68,68,0.65)' : 'rgba(59,130,246,0.65)'),
              borderColor: isSel ? '#5B21B6' : 'transparent',
              borderWidth: isSel ? 2 : 0,
              borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          }
        }),
        markLine: { silent: true, data: [{ xAxis: 0, lineStyle: { color: '#94A3B8', type: 'solid', width: 1 } }] },
      }],
    }
  }, [shapTop, shapNames, shapVals, selectedFeat])

  if (loading) return (
    <div className="feat-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 14 }}>
      데이터 로딩 중…
    </div>
  )

  return (
    <div className="feat-page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, alignItems: 'stretch', flex: 1, minHeight: 0 }}>

        {/* 왼쪽: LGBM / SHAP 탭 */}
        <div className="chart-card feat-left-card">
          {/* 탭 */}
          <div style={{ display: 'flex', borderBottom: '1.5px solid #E2E8F0', marginBottom: 8 }}>
            {[{ id: 'lgbm', label: '🏆 LGBM Gain' }, { id: 'shap', label: '🧬 SHAP' }].map(t => (
              <button
                key={t.id}
                onClick={() => { setActiveTab(t.id); setSelectedFeat(null) }}
                style={{
                  flex: 1, padding: '8px 0', fontSize: 12, fontWeight: activeTab === t.id ? 700 : 400,
                  color: activeTab === t.id ? '#2563EB' : '#94A3B8',
                  background: 'none', border: 'none', borderBottom: activeTab === t.id ? '2.5px solid #2563EB' : '2.5px solid transparent',
                  cursor: 'pointer', marginBottom: -1.5,
                }}
              >{t.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 8, paddingLeft: 4 }}>
            막대 클릭 → 분포 확인
          </div>
          <div style={{ flex: 1, minHeight: 560 }}>
            {activeTab === 'lgbm' ? (
              <ReactECharts
                option={lgbmOpt}
                style={{ height: '100%' }}
                onEvents={{ click: p => { const feat = lgbmNames[p.dataIndex]; if (feat) setSelectedFeat(feat) } }}
              />
            ) : (
              shapOpt
                ? <ReactECharts
                    option={shapOpt}
                    style={{ height: '100%' }}
                    onEvents={{ click: p => { const feat = shapNames[p.dataIndex]; if (feat) setSelectedFeat(feat) } }}
                  />
                : <div style={{ color: '#94A3B8', textAlign: 'center', paddingTop: 40 }}>SHAP 데이터 없음</div>
            )}
          </div>
        </div>

        {/* 오른쪽: 선택 피처 히스토그램 + 박스플롯 */}
        {selectedFeat && distOpt ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>

            {/* 헤더 */}
            <div style={{ padding: '8px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 13, fontWeight: 700, color: '#1E293B', fontFamily: 'DM Mono,monospace' }}>
              선택 Feature : <span style={{ color: '#2563EB' }}>{selectedFeat}</span>
            </div>

            {/* 히스토그램 */}
            <ChartCard title="📉 고위험 vs 저위험 분포" tag="히스토그램">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1, background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '7px 12px', fontSize: 11, color: '#94A3B8' }}>
                  🔴 고위험 (예측값 &gt; threshold)
                </div>
                <div style={{ flex: 1, background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.25)', borderRadius: 8, padding: '7px 12px', fontSize: 11, color: '#94A3B8' }}>
                  🔵 저위험 (예측값 ≤ threshold)
                </div>
              </div>
              <ReactECharts option={distOpt} style={{ height: 280 }} />
            </ChartCard>

            {/* 박스플롯 */}
            {boxOpt && (
              <ChartCard title="📦 박스플롯 비교" tag="중앙값·IQR">
                <ReactECharts option={boxOpt} style={{ height: 160 }} />
              </ChartCard>
            )}
          </div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, border: '2px dashed #E2E8F0',
            flexDirection: 'column', gap: 8, color: '#94A3B8', fontSize: 12, minHeight: 300,
          }}>
            <div style={{ fontSize: 24 }}>👆</div>
            왼쪽 막대를 클릭하면<br />분포가 여기에 표시됩니다
          </div>
        )}
      </div>
    </div>
  )
}
