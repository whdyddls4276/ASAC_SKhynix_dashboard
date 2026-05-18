import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { useCSV } from '../hooks/useCSV'
import './ModelPerformance.css'

const BASELINE_RMSE = 0.0150
const FIXED_DATE    = '2026-06-11'

function ChartCard({ title, tag, children, scrollable }) {
  return (
    <div className="mp-chart-card">
      <div className="mp-cc-header">
        <span className="mp-cc-title">{title}</span>
        {tag && <span className="mp-cc-tag">{tag}</span>}
      </div>
      <div className={scrollable ? 'mp-cc-scroll' : 'mp-cc-body'}>
        {children}
      </div>
    </div>
  )
}

// 항목 수에 따라 ECharts 높이 동적 계산 (항목 1개 = 28px, 최소 100px)
const chartH = (count) => Math.max(100, count * 28)

function KpiBox({ label, value, sub }) {
  return (
    <div className="mp-kpi">
      <div className="mp-kpi-val">{value}</div>
      <div className="mp-kpi-label">{label}</div>
      {sub && <div className="mp-kpi-sub">{sub}</div>}
    </div>
  )
}

export default function ModelPerformance() {
  const { data: metricsRaw }  = useCSV('/metrics.csv')
  const { data: fiRaw }       = useCSV('/feature_importance.csv')
  const { data: shapBarRaw }  = useCSV('/shap_bar.csv')
  const { data: unitsRaw }    = useCSV('/dashboard_units.csv')
  const { data: featDistRaw } = useCSV('/feature_dist.csv')

  // 클릭으로 선택된 피처 → 우하단 스캐터 연동
  const [selFeat, setSelFeat] = useState(null)

  // ── metrics ──
  const metrics = useMemo(() => {
    if (!metricsRaw.length) return null
    const get = (stage, model, split, metric = 'rmse') => {
      const row = metricsRaw.find(r =>
        r.stage === stage && r.model === model && r.split === split && r.metric === metric)
      return row ? parseFloat(row.value) : null
    }
    return {
      ensemble_val: get('reg', 'ensemble', 'val'),
      lgbm_val:     get('reg', 'lgbm',     'val'),
    }
  }, [metricsRaw])

  // ── 피처 임포턴스 Top-20 ──
  const top20Fi = useMemo(() => {
    if (!fiRaw.length) return []
    return [...fiRaw]
      .sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 20)
  }, [fiRaw])

  const fiOption = useMemo(() => {
    if (!top20Fi.length) return null
    const reversed = [...top20Fi].reverse() // 아래에서 위로 = 1위가 맨 위
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: p => `<b>${p[0].name}</b><br/>중요도: ${parseFloat(p[0].value).toFixed(1)}`,
      },
      grid: { top: 8, bottom: 8, left: 8, right: 70, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { fontSize: 9, color: '#94A3B8' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      yAxis: {
        type: 'category',
        data: reversed.map(d => d.feature),
        axisLabel: { fontSize: 10, color: '#374151', fontFamily: 'monospace' },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: reversed.map((d, i) => ({
          value: parseFloat(d.lgbm_gain),
          itemStyle: {
            color: d.feature === selFeat
              ? '#7C3AED'
              : i >= 15 ? '#EF4444' : i >= 10 ? '#F97316' : '#3B82F6',
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barMaxWidth: 14,
        label: {
          show: true, position: 'right', fontSize: 9, color: '#64748B',
          formatter: p => parseFloat(p.value).toFixed(1),
        },
      }],
    }
  }, [top20Fi, selFeat])

  // ── SHAP 전체 (shapBarRaw 있는 만큼 전부) ──
  const top20Shap = useMemo(() => {
    if (!shapBarRaw.length) return []
    return [...shapBarRaw]
      .sort((a, b) => parseFloat(b.mean_abs_shap) - parseFloat(a.mean_abs_shap))
  }, [shapBarRaw])

  const shapOption = useMemo(() => {
    if (!top20Shap.length) return null
    const reversed = [...top20Shap].reverse()
    const xMax = Math.max(...reversed.map(d => parseFloat(d.mean_abs_shap)))
    const xBound = Math.ceil(xMax * 1.2 * 1000) / 1000
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: p => {
          const v = parseFloat(p[0].value)
          return `<b>${p[0].name}</b><br/>평균 기여도: ${v.toFixed(5)}<br/>${v >= 0 ? '▲ 불량 증가 방향' : '▼ 불량 감소 방향'}`
        },
      },
      grid: { top: 8, bottom: 20, left: 8, right: 16, containLabel: true },
      xAxis: {
        type: 'value', min: -xBound, max: xBound,
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: reversed.map(d => d.feature),
        axisLabel: { fontSize: 10, color: '#374151', fontFamily: 'monospace' },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: reversed.map(d => {
          const v = parseFloat(d.mean_shap)
          return {
            value: +v.toFixed(5),
            itemStyle: {
              color: d.feature === selFeat
                ? '#7C3AED'
                : v >= 0 ? '#EF4444' : '#3B82F6',
              borderRadius: v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          }
        }),
        barMaxWidth: 14,
        label: { show: false },
      }],
    }
  }, [top20Shap, selFeat])

  // 피처/SHAP 클릭 → selFeat 토글
  const onFiClick   = p => { if (p.name) setSelFeat(f => f === p.name ? null : p.name) }
  const onShapClick = p => { if (p.name) setSelFeat(f => f === p.name ? null : p.name) }

  // ── 피처 분포 스캐터 (피처 클릭 연동) ── 먼저 선언해야 riskDistOption에서 사용 가능
  const top5FeatNames = useMemo(() =>
    [...fiRaw].sort((a, b) => parseFloat(b.lgbm_gain) - parseFloat(a.lgbm_gain))
      .slice(0, 5).map(d => d.feature),
    [fiRaw])

  // feature_dist.csv 컬럼 목록 (ufs_serial, health, is_defect 제외)
  const featDistCols = useMemo(() => {
    if (!featDistRaw.length) return []
    return Object.keys(featDistRaw[0]).filter(k => !['ufs_serial','health','is_defect'].includes(k))
  }, [featDistRaw])

  const activeFeat = useMemo(() => {
    if (!featDistCols.length) return null
    // 클릭한 피처가 feature_dist 컬럼에 있으면 사용
    if (selFeat && featDistCols.includes(selFeat)) return selFeat
    // 없으면 feature_dist 첫 번째 컬럼
    return featDistCols[0]
  }, [selFeat, featDistCols])

  // ── 고위험 vs 저위험 피처값 분포 — 밀도 라인 차트 + 중앙값 점선 ──
  const riskDistOption = useMemo(() => {
    if (!featDistRaw.length || !activeFeat) return null

    const highVals = [], lowVals = []
    for (const r of featDistRaw) {
      const x = parseFloat(r[activeFeat])
      if (!isFinite(x)) continue
      if (parseInt(r.is_defect) === 1) highVals.push(x)
      else lowVals.push(x)
    }
    if (!highVals.length && !lowVals.length) return null

    const allVals = [...highVals, ...lowVals]
    const minV = Math.min(...allVals)
    const maxV = Math.max(...allVals)
    const BIN  = 40
    const binSz = (maxV - minV) / BIN || 1
    const bins  = Array.from({ length: BIN }, (_, i) => minV + i * binSz)

    // 중앙값 → 가장 가까운 bin 인덱스
    const median = arr => {
      const s = [...arr].sort((a, b) => a - b)
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    const toBinIdx = v => {
      const idx = bins.findIndex((b, i) => v < (i === BIN - 1 ? Infinity : bins[i + 1]))
      return idx < 0 ? BIN - 1 : idx
    }
    const medHighIdx = toBinIdx(median(highVals))
    const medLowIdx  = toBinIdx(median(lowVals))

    const mkDensity = vals => bins.map((b, i) => {
      const next = i === BIN - 1 ? Infinity : bins[i + 1]
      const cnt = vals.filter(v => v >= b && v < next).length
      return vals.length ? +(cnt / vals.length * 100).toFixed(2) : 0
    })

    const fmtX = v => {
      if (Math.abs(v) >= 1000) return v.toFixed(0)
      if (Math.abs(v) >= 10)   return v.toFixed(1)
      return v.toFixed(3)
    }

    const xLabels = bins.map(b => fmtX(b))

    return {
      tooltip: {
        trigger: 'axis',
        formatter: p => {
          const lines = p
            .filter(s => s.seriesType !== 'effectScatter')
            .map(s => `${s.marker}${s.seriesName}: ${s.value}%`)
          return lines.join('<br/>') + `<br/><span style="color:#94A3B8;font-size:10px">${activeFeat} = ${p[0]?.axisValue ?? ''}</span>`
        },
      },
      legend: { show: false },
      grid: { top: 12, bottom: 36, left: 48, right: 16 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: { fontSize: 8, color: '#94A3B8', interval: 7, rotate: 30 },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 9, color: '#94A3B8', formatter: v => v + '%' },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        {
          name: '저위험(정상)',
          type: 'line',
          data: mkDensity(lowVals),
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#3B82F6', width: 2 },
          areaStyle: { color: 'rgba(59,130,246,0.12)' },
          markLine: {
            silent: false,
            symbol: 'none',
            data: [{ xAxis: medLowIdx, name: `정상 중앙값: ${fmtX(median(lowVals))}` }],
            lineStyle: { color: '#3B82F6', type: 'dashed', width: 1.5 },
            label: { show: false },
            tooltip: { show: true, formatter: p => `<b style="color:#3B82F6">정상 중앙값</b><br/>${fmtX(median(lowVals))}` },
          },
        },
        {
          name: '고위험(불량)',
          type: 'line',
          data: mkDensity(highVals),
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#EF4444', width: 2 },
          areaStyle: { color: 'rgba(239,68,68,0.12)' },
          markLine: {
            silent: false,
            symbol: 'none',
            data: [{ xAxis: medHighIdx, name: `불량 중앙값: ${fmtX(median(highVals))}` }],
            lineStyle: { color: '#EF4444', type: 'dashed', width: 1.5 },
            label: { show: false },
            tooltip: { show: true, formatter: p => `<b style="color:#EF4444">불량 중앙값</b><br/>${fmtX(median(highVals))}` },
          },
        },
      ],
    }
  }, [featDistRaw, activeFeat])

  const featScatterOption = useMemo(() => {
    if (!featDistRaw.length || !activeFeat) return null
    const data0 = [], data1 = []
    for (const r of featDistRaw) {
      const x = parseFloat(r[activeFeat])
      const y = parseFloat(r.health)
      if (!isFinite(x) || !isFinite(y)) continue
      if (parseInt(r.is_defect) === 1) data1.push([x, y])
      else data0.push([x, y])
    }
    const sample = (arr, n) => arr.length <= n ? arr
      : arr.filter((_, i) => i % Math.ceil(arr.length / n) === 0).slice(0, n)
    return {
      tooltip: { formatter: p => `${activeFeat}: ${p.data[0].toFixed(4)}<br/>불량값: ${p.data[1].toFixed(6)}` },
      legend: { data: ['정상(Y=0)', '불량(Y>0)'], top: 0, textStyle: { fontSize: 10 } },
      grid: { top: 28, bottom: 36, left: 52, right: 16 },
      xAxis: {
        type: 'value', name: activeFeat, nameTextStyle: { fontSize: 10, color: '#94A3B8' },
        axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      yAxis: {
        type: 'value', name: '불량값(health)', nameTextStyle: { fontSize: 9, color: '#94A3B8' },
        axisLabel: { fontSize: 9, color: '#94A3B8' }, splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series: [
        { name: '정상(Y=0)', type: 'scatter', data: sample(data0, 400), symbolSize: 4, itemStyle: { color: 'rgba(59,130,246,0.4)' } },
        { name: '불량(Y>0)', type: 'scatter', data: sample(data1, 300), symbolSize: 5, itemStyle: { color: 'rgba(239,68,68,0.7)' } },
      ],
    }
  }, [featDistRaw, activeFeat])

  if (!metrics) {
    return (
      <div className="mp-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>
        데이터 로딩 중…
      </div>
    )
  }

  const bestVal     = metrics.ensemble_val ?? metrics.lgbm_val ?? 0
  const beatBase    = bestVal < BASELINE_RMSE
  const improvement = (((BASELINE_RMSE - bestVal) / BASELINE_RMSE) * 100).toFixed(1)

  return (
    <div className="mp-page">

      {/* ── Row 1: RMSE KPI 2개 ── */}
      <div className="mp-kpi-row mp-kpi-row--2">
        <KpiBox
          label="앙상블 모델 검증 오차(RMSE)"
          value={bestVal.toFixed(6)}
          sub={`예측 시점 · ${FIXED_DATE}`}
        />
        <KpiBox
          label={beatBase ? '기준 대비 개선' : '기준 미달'}
          value={beatBase ? `-${improvement}%` : `+${Math.abs(parseFloat(improvement))}%`}
          sub={`기준값 ${BASELINE_RMSE} · ${beatBase ? '목표 달성 ✓' : '미달성'}`}
        />
      </div>

      {/* ── Row 2: 중요 피처 Top-5 ── */}
      <div className="mp-kpi-row mp-kpi-row--5">
        {top20Fi.slice(0, 5).map((f, i) => (
          <KpiBox
            key={f.feature}
            label={`중요 피처 ${i + 1}위`}
            value={f.feature}
            sub={`중요도 ${parseFloat(f.lgbm_gain).toFixed(1)}`}
          />
        ))}
      </div>

      {/* ── Row 2+3: 2×2 차트 그리드 ── */}
      <div className="mp-grid-2x2">

        {/* 좌상: 피처 중요도 — 박스 안 스크롤 */}
        <ChartCard title="피처 중요도 순위" scrollable>
          {fiOption
            ? <ReactECharts
                option={fiOption}
                style={{ height: chartH(top20Fi.length) }}
                onEvents={{ click: onFiClick }}
              />
            : <div className="mp-empty">feature_importance.csv 없음</div>}
        </ChartCard>

        {/* 우상: SHAP 분석 — 박스 안 스크롤 */}
        <ChartCard title="SHAP 기여도 분석" scrollable>
          {shapOption
            ? <ReactECharts
                option={shapOption}
                style={{ height: chartH(top20Shap.length) }}
                onEvents={{ click: onShapClick }}
              />
            : <div className="mp-empty">shap_bar.csv 없음</div>}
        </ChartCard>

        {/* 좌하: 고위험 vs 저위험 분포 */}
        <ChartCard title={`피처 분포 · ${activeFeat ?? ''}`}>
          {riskDistOption
            ? <ReactECharts option={riskDistOption} style={{ height: 260 }} />
            : <div className="mp-empty">dashboard_units.csv 없음</div>}
        </ChartCard>

        {/* 우하: 피처 분포 스캐터 */}
        <ChartCard title={`피처 산점도 · ${activeFeat ?? ''}`}>
          {featScatterOption
            ? <ReactECharts option={featScatterOption} style={{ height: 260 }} />
            : <div className="mp-empty">
                {featDistRaw.length === 0 ? 'feature_dist.csv 없음' : '좌측 차트에서 피처를 클릭하세요'}
              </div>}
        </ChartCard>

      </div>
    </div>
  )
}
