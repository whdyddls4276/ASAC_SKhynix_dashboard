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

export function ImportancePage() {
  const { data: impRaw, loading } = useCSV('/feature_importance.csv')
  const { data: distData }        = useCSV('/feature_dist.csv')
  const { data: unitData }        = useCSV('/dashboard_units.csv')
  const { data: shapRaw }         = useCSV('/shap_data.csv')

  const [selectedFeat, setSelectedFeat] = useState(null)

  // ── LGBM Top-15
  const lgbmTop = useMemo(() => {
    if (!impRaw.length) return []
    return [...impRaw]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 15)
      .map(r => ({ feature: r.feature, value: parseFloat(r.lgbm_gain) || 0 }))
  }, [impRaw])

  // ── SHAP Top-15 (shap_data.csv 기준, lgbm_rank 순)
  const shapTop = useMemo(() => {
    if (!shapRaw.length) return []
    return [...shapRaw]
      .sort((a, b) => parseFloat(a.lgbm_rank) - parseFloat(b.lgbm_rank))
      .slice(0, 15)
      .map(r => ({ feature: r.feature, value: parseFloat(r.effect_norm) || 0 }))
  }, [shapRaw])

  // ── risk 매핑
  const riskMap = useMemo(() => {
    if (!unitData.length) return {}
    return Object.fromEntries(unitData.map(r => [r.ufs_serial, r.risk]))
  }, [unitData])

  // ── 박스플롯 통계
  function boxStats(arr) {
    if (!arr.length) return null
    const s = [...arr].sort((a, b) => a - b)
    const n = s.length
    const q = p => { const i = p*(n-1), lo=Math.floor(i), hi=Math.ceil(i); return s[lo]+(s[hi]-s[lo])*(i-lo) }
    return [s[0], q(0.25), q(0.5), q(0.75), s[n-1]]
  }

  // ── 히스토그램
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
      tooltip: { trigger: 'axis', formatter: p => `${p[0].name}<br/>고위험: ${p[0].value}%<br/>저위험: ${p[1]?.value ?? 0}%` },
      legend: { data: ['고위험(HIGH)', '저위험(MED/LOW)'], bottom: 0, textStyle: { fontSize: 10 } },
      grid: { top: 10, left: 44, right: 16, bottom: 36 },
      xAxis: { type: 'category', data: bins.map(b => b.toFixed(1)), axisLabel: { fontSize: 8, color: '#94A3B8', rotate: 30 }, boundaryGap: false },
      yAxis: { type: 'value', name: '비율(%)', nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      series: [
        { name: '고위험(HIGH)',    type: 'line', data: toBins(high),  smooth: true, symbol: 'none', lineStyle: { color: 'rgba(239,68,68,.9)',  width: 2 }, areaStyle: { color: 'rgba(239,68,68,.15)' } },
        { name: '저위험(MED/LOW)', type: 'line', data: toBins(other), smooth: true, symbol: 'none', lineStyle: { color: 'rgba(59,130,246,.9)', width: 2 }, areaStyle: { color: 'rgba(59,130,246,.15)' } },
      ],
    }
  }, [distData, riskMap, selectedFeat])

  // ── 박스플롯
  const boxOpt = useMemo(() => {
    if (!distData.length || !selectedFeat || !Object.keys(riskMap).length) return null
    const high  = distData.filter(r => riskMap[r.ufs_serial] === 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const other = distData.filter(r => riskMap[r.ufs_serial] !== 'HIGH').map(r => parseFloat(r[selectedFeat])).filter(v => !isNaN(v))
    const bH = boxStats(high), bO = boxStats(other)
    if (!bH || !bO) return null
    return {
      tooltip: { trigger: 'item', formatter: p => {
        const d = p.data.value ?? p.data
        const label = p.dataIndex === 0 ? '🔴 고위험' : '🔵 저위험'
        const color = p.dataIndex === 0 ? '#EF4444' : '#3B82F6'
        return `<span style="font-weight:700;color:${color}">${label}</span><br/>중앙값: <b>${d[2].toFixed(4)}</b><br/>Q1: ${d[1].toFixed(4)} / Q3: ${d[3].toFixed(4)}`
      }},
      grid: { top: 16, left: 70, right: 16, bottom: 24 },
      xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
      yAxis: { type: 'category', data: ['고위험', '저위험'], axisLabel: { fontSize: 11, color: '#475569' } },
      series: [{
        type: 'boxplot',
        data: [
          { value: bH, itemStyle: { color: 'rgba(239,68,68,.2)',  borderColor: 'rgba(239,68,68,.9)',  borderWidth: 2 } },
          { value: bO, itemStyle: { color: 'rgba(59,130,246,.2)', borderColor: 'rgba(59,130,246,.9)', borderWidth: 2 } },
        ],
      }],
    }
  }, [distData, riskMap, selectedFeat])

  // ── LGBM 바차트 옵션
  const lgbmNames = useMemo(() => [...lgbmTop.map(d => d.feature)].reverse(), [lgbmTop])
  const lgbmOpt = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: p => `${p.name}<br/>LGBM Gain: ${Number(p.value).toExponential(3)}` },
    grid: { top: 10, left: 66, right: 56, bottom: 10 },
    xAxis: { type: 'value', axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } } },
    yAxis: { type: 'category', data: lgbmNames, axisLabel: { fontSize: 10, color: '#475569', fontFamily: 'DM Mono,monospace' } },
    series: [{
      type: 'bar', barMaxWidth: 14,
      data: [...lgbmTop].reverse().map(d => {
        const isSel = d.feature === selectedFeat
        return {
          value: d.value,
          itemStyle: {
            color: isSel ? '#2563EB' : 'rgba(59,130,246,0.55)',
            borderColor: isSel ? '#1E293B' : 'transparent',
            borderWidth: isSel ? 3 : 0,
            borderRadius: [0, 4, 4, 0],
          }
        }
      }),
      label: { show: true, position: 'right', fontSize: 9, formatter: p => Number(p.value).toExponential(2), color: '#475569' },
    }],
  }), [lgbmTop, lgbmNames, selectedFeat])

  // ── SHAP 바차트 옵션
  const shapNames = useMemo(() => [...shapTop.map(d => d.feature)].reverse(), [shapTop])
  const shapOpt = useMemo(() => {
    if (!shapTop.length) return null
    const maxAbs = Math.max(...shapTop.map(d => Math.abs(d.value)))
    return {
      tooltip: { trigger: 'item', formatter: p => {
        const v = parseFloat(p.value)
        return `${p.name}<br/>mean SHAP: ${v.toFixed(6)}<br/>${v >= 0 ? '위험 기여 ↑' : '위험 억제 ↓'}`
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
        type: 'bar', barMaxWidth: 14,
        data: [...shapTop].reverse().map(d => {
          const isSel = d.feature === selectedFeat
          return {
            value: d.value,
            itemStyle: {
              color: isSel ? '#7C3AED' : (d.value >= 0 ? 'rgba(239,68,68,0.55)' : 'rgba(59,130,246,0.55)'),
              borderColor: isSel ? '#5B21B6' : 'transparent',
              borderWidth: isSel ? 3 : 0,
              borderRadius: d.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          }
        }),
        markLine: { silent: true, data: [{ xAxis: 0, lineStyle: { color: '#94A3B8', type: 'solid', width: 1 } }] },
      }],
    }
  }, [shapTop, shapNames, selectedFeat])

  if (loading) return (
    <div className="feat-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 14 }}>
      데이터 로딩 중…
    </div>
  )

  return (
    <div className="feat-page" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* 선택된 피처 표시 */}
      <div style={{ padding: '7px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12, color: '#64748B' }}>
        {selectedFeat
          ? <><span style={{ fontWeight: 700, color: '#1E293B', fontFamily: 'DM Mono,monospace' }}>{selectedFeat}</span> 선택됨 — 아래 히스토그램·박스플롯 업데이트</>
          : '막대를 클릭하면 히스토그램과 박스플롯이 표시됩니다'}
      </div>

      {/* 상단: LGBM + SHAP 나란히 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ChartCard title="🏆 Feature Importance — LGBM Gain Top-15" tag="클릭 → 분포 확인">
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.6 }}>
            모델이 예측할 때 <b>각 피처를 얼마나 많이 활용했는지</b>를 나타냅니다.
            값이 클수록 해당 피처가 불량 예측에 중요하게 사용된 것입니다.
          </div>
          <ReactECharts
            option={lgbmOpt}
            style={{ height: 370 }}
            onEvents={{ click: p => { const f = lgbmNames[p.dataIndex]; if (f) setSelectedFeat(f) } }}
          />
        </ChartCard>

        <ChartCard title="🧬 불량 기여 방향 — SHAP effect Top-15" tag="클릭 → 분포 확인">
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.6 }}>
            <span style={{ color: '#EF4444', fontWeight: 600 }}>빨강(+)</span> = 불량 위험을 높이는 피처 &nbsp;
            <span style={{ color: '#3B82F6', fontWeight: 600 }}>파랑(-)</span> = 불량 위험을 낮추는 피처.
            절대값이 클수록 예측 결과에 더 큰 영향을 줍니다.
          </div>
          {shapOpt
            ? <ReactECharts
                option={shapOpt}
                style={{ height: 370 }}
                onEvents={{ click: p => { const f = shapNames[p.dataIndex]; if (f) setSelectedFeat(f) } }}
              />
            : <div style={{ color: '#94A3B8', textAlign: 'center', paddingTop: 40 }}>SHAP 데이터 없음</div>
          }
        </ChartCard>
      </div>

      {/* 하단: 히스토그램 + 박스플롯 나란히 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ChartCard title="📉 고위험 vs 저위험 분포" tag={selectedFeat ?? '피처를 선택하세요'}>
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.6 }}>
            선택한 피처의 값 분포를 고위험/저위험 그룹별로 비교합니다.
            두 선이 <b>많이 겹칠수록</b> 구분력이 낮고, <b>떨어져 있을수록</b> 불량 예측에 효과적인 피처입니다.
          </div>
          {distOpt
            ? <ReactECharts option={distOpt} style={{ height: 210 }} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 210, color: '#94A3B8', fontSize: 12, flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 20 }}>👆</span>위 막대를 클릭하세요
              </div>
          }
        </ChartCard>

        <ChartCard title="📦 박스플롯 비교" tag={selectedFeat ?? '피처를 선택하세요'}>
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, lineHeight: 1.6 }}>
            중앙값(가운데 선)과 IQR(박스 너비)로 두 그룹의 분포를 비교합니다.
            <span style={{ color: '#EF4444', fontWeight: 600 }}>고위험</span>과 <span style={{ color: '#3B82F6', fontWeight: 600 }}>저위험</span>의 박스가 <b>겹치지 않을수록</b> 구분력이 높은 피처입니다.
          </div>
          {boxOpt
            ? <ReactECharts option={boxOpt} style={{ height: 210 }} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 210, color: '#94A3B8', fontSize: 12, flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 20 }}>👆</span>위 막대를 클릭하세요
              </div>
          }
        </ChartCard>
      </div>
    </div>
  )
}
