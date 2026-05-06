import { useState, useMemo } from 'react'
import { useCSV } from '../hooks/useCSV'
import './DataTable.css'

const PAGE_SIZE = 20

function RiskBadge({ level }) {
  const map = { HIGH:['#FEF2F2','#EF4444'], MED:['#FFF7ED','#F97316'], LOW:['#F0FDF4','#22C55E'] }
  const [bg, color] = map[level] || map.LOW
  return <span style={{ fontSize:9, padding:'2px 7px', borderRadius:3, fontWeight:600, fontFamily:'DM Mono,monospace', background:bg, color }}>{level}</span>
}

export default function DataTablePage() {
  const { data, loading } = useCSV('/dashboard_units.csv')

  const [split, setSplit]     = useState('all')
  const [risk, setRisk]       = useState('all')
  const [search, setSearch]   = useState('')
  const [sortCol, setSortCol] = useState('clf_proba')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage]       = useState(1)

  // 컬럼 정보 추출
  const featureCols = useMemo(() => {
    if (!data.length) return []
    return Object.keys(data[0]).filter(k =>
      !['ufs_serial','split','date','health','clf_proba','risk'].includes(k)
    )
  }, [data])

  // 필터 + 정렬
  const filtered = useMemo(() => {
    let rows = data
    if (split !== 'all')  rows = rows.filter(r => r.split === split)
    if (risk  !== 'all')  rows = rows.filter(r => r.risk  === risk)
    if (search.trim())    rows = rows.filter(r => (r.ufs_serial || '').toLowerCase().includes(search.toLowerCase()))

    return [...rows].sort((a, b) => {
      const av = parseFloat(a[sortCol]) || 0
      const bv = parseFloat(b[sortCol]) || 0
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [data, split, risk, search, sortCol, sortDir])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function SortIcon({ col }) {
    if (sortCol !== col) return <span style={{ color:'#CBD5E1', marginLeft:3 }}>⇅</span>
    return <span style={{ color:'#3B82F6', marginLeft:3 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  // 요약 통계
  const summary = useMemo(() => {
    if (!filtered.length) return null
    const highCnt = filtered.filter(r => r.risk === 'HIGH').length
    const medCnt  = filtered.filter(r => r.risk === 'MED').length
    const defCnt  = filtered.filter(r => parseFloat(r.health) > 0).length
    return { total: filtered.length, high: highCnt, med: medCnt, defect: defCnt }
  }, [filtered])

  if (loading) {
    return <div className="dt-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8' }}>데이터 로딩 중…</div>
  }

  return (
    <div className="dt-page">
      {/* 데이터 연결 상태 안내 */}
      <div style={{
        padding: '8px 14px',
        background: '#FFFBEB',
        border: '1.5px solid #F59E0B',
        borderRadius: 6,
        fontSize: 11,
        color: '#92400E',
        marginBottom: 8,
      }}>
        🟡 <b>val/test의 health 컬럼은 실제 미공개</b> — 0으로 표시되는 값은 의미 없습니다. clf_proba 기준으로 위험 판단하세요.
        &nbsp;|&nbsp; <b>날짜(date) 컬럼</b>은 dashboard_units.csv에 없으면 "—"로 표시됩니다.
      </div>
      {/* 요약 카드 */}
      {summary && (
        <div className="dt-summary">
          {[
            { label:'조회된 Unit', value:summary.total.toLocaleString(), color:'#3B82F6' },
            { label:'HIGH 위험',   value:summary.high.toLocaleString(),  color:'#EF4444' },
            { label:'MED 위험',    value:summary.med.toLocaleString(),   color:'#F97316' },
            { label:'실불량(health>0)', value:summary.defect.toLocaleString(), color:'#8B5CF6' },
          ].map((s, i) => (
            <div key={i} className="dt-stat" style={{ borderTop:`3px solid ${s.color}` }}>
              <div style={{ fontSize:20, fontWeight:700, fontFamily:'DM Mono,monospace', color:s.color }}>{s.value}</div>
              <div style={{ fontSize:11, color:'#64748B', marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 필터 바 */}
      <div className="dt-filterbar">
        <input
          className="dt-search"
          placeholder="Unit ID 검색…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <div className="dt-filters">
          <select className="dt-select" value={split} onChange={e => { setSplit(e.target.value); setPage(1) }}>
            <option value="all">Split: 전체</option>
            <option value="train">Train</option>
            <option value="val">Val</option>
            <option value="test">Test</option>
          </select>
          <select className="dt-select" value={risk} onChange={e => { setRisk(e.target.value); setPage(1) }}>
            <option value="all">위험: 전체</option>
            <option value="HIGH">HIGH</option>
            <option value="MED">MED</option>
            <option value="LOW">LOW</option>
          </select>
        </div>
        <div className="dt-count">{filtered.length.toLocaleString()}건</div>
      </div>

      {/* 테이블 */}
      <div className="dt-table-wrap">
        <table className="dt-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('ufs_serial')} className="sortable">Unit ID <SortIcon col="ufs_serial" /></th>
              <th>Split</th>
              <th onClick={() => handleSort('clf_proba')} className="sortable">clf_proba <SortIcon col="clf_proba" /></th>
              <th onClick={() => handleSort('reg_pred')} className="sortable">reg_pred <SortIcon col="reg_pred" /></th>
              <th onClick={() => handleSort('health')} className="sortable">health(실제) <SortIcon col="health" /></th>
              <th>위험</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i} className={r.risk === 'HIGH' ? 'row-high' : r.risk === 'MED' ? 'row-med' : ''}>
                <td className="mono bold">{r.ufs_serial}</td>
                <td>
                  <span className={`split-badge split-${r.split}`}>{r.split}</span>
                </td>
                <td className="mono" style={{ color: parseFloat(r.clf_proba) >= 0.5 ? '#EF4444' : parseFloat(r.clf_proba) >= 0.35 ? '#F97316' : '#22C55E', fontWeight:600 }}>
                  {parseFloat(r.clf_proba || 0).toFixed(4)}
                </td>
                <td className="mono" style={{ color: parseFloat(r.reg_pred) > 0.005 ? '#EF4444' : parseFloat(r.reg_pred) > 0.002 ? '#F97316' : '#64748B', fontWeight: parseFloat(r.reg_pred) > 0.005 ? 600 : 400 }}>
                  {parseFloat(r.reg_pred || 0).toFixed(6)}
                </td>
                <td className="mono" style={{ color: parseFloat(r.health) > 0 ? '#EF4444' : '#94A3B8' }}>
                  {r.split === 'train' ? parseFloat(r.health || 0).toFixed(6) : <span style={{ color:'#CBD5E1' }}>미공개</span>}
                </td>
                <td><RiskBadge level={r.risk} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="dt-pagination">
        <button className="dt-pgbtn" onClick={() => setPage(1)} disabled={page === 1}>«</button>
        <button className="dt-pgbtn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>‹</button>
        {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
          const start = Math.max(1, Math.min(page - 3, totalPages - 6))
          const p = start + i
          return (
            <button key={p} className={`dt-pgbtn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
          )
        })}
        <button className="dt-pgbtn" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}>›</button>
        <button className="dt-pgbtn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button>
        <span className="dt-pginfo">{page} / {totalPages} 페이지</span>
      </div>
    </div>
  )
}
