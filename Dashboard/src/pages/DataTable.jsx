import { useState, useMemo } from 'react'
import { useCSV } from '../hooks/useCSV'
import { GRADE_COLORS, getGrade } from './Overview'
import './DataTable.css'

const PAGE_SIZE = 20

function GradeBadge({ grade }) {
  const c = GRADE_COLORS[grade] || GRADE_COLORS.grade4
  return (
    <span style={{
      fontSize: 11,
      padding: '2px 7px',
      borderRadius: 3,
      fontWeight: 600,
      fontFamily: 'DM Mono,monospace',
      background: c.bg,
      color: c.text,
    }}>
      {c.label}
    </span>
  )
}

export default function DataTablePage() {
  const { data, loading } = useCSV('/dashboard_units.csv')

  const [split, setSplit]     = useState('all')
  const [gradeFilter, setGradeFilter] = useState('all')
  const [search, setSearch]   = useState('')
  const [sortCol, setSortCol] = useState('reg_pred')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage]       = useState(1)

  // grade 계산을 위한 threshold (train 기준)
  const thresholds = useMemo(() => {
    if (!data.length) return { g1: 0, g2: 0, g3: 0 }
    const trainPreds = data
      .filter(r => r.split === 'train')
      .map(r => parseFloat(r.reg_pred))
      .filter(v => !isNaN(v))
      .sort((a, b) => a - b)
    const n = trainPreds.length
    return {
      g1: trainPreds[Math.floor(n * 0.90)] ?? 0,
      g2: trainPreds[Math.floor(n * 0.708)] ?? 0,
      g3: trainPreds[Math.floor(n * 0.50)] ?? 0,
    }
  }, [data])

  // 각 row에 grade 부여
  const dataWithGrade = useMemo(() => {
    return data.map(r => ({
      ...r,
      grade: getGrade(parseFloat(r.reg_pred) || 0, thresholds),
    }))
  }, [data, thresholds])

  // 필터 + 정렬
  const filtered = useMemo(() => {
    let rows = dataWithGrade
    if (split !== 'all')       rows = rows.filter(r => r.split === split)
    if (gradeFilter !== 'all') rows = rows.filter(r => r.grade === gradeFilter)
    if (search.trim())         rows = rows.filter(r => (r.ufs_serial || '').toLowerCase().includes(search.toLowerCase()))

    return [...rows].sort((a, b) => {
      const av = parseFloat(a[sortCol]) || 0
      const bv = parseFloat(b[sortCol]) || 0
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [dataWithGrade, split, gradeFilter, search, sortCol, sortDir])

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
    const g1 = filtered.filter(r => r.grade === 'grade1').length
    const g2 = filtered.filter(r => r.grade === 'grade2').length
    const g3 = filtered.filter(r => r.grade === 'grade3').length
    const defCnt = filtered.filter(r => parseFloat(r.health) > 0).length
    return { total: filtered.length, g1, g2, g3, defect: defCnt }
  }, [filtered])

  if (loading) {
    return <div className="dt-page" style={{ display:'flex', alignItems:'center', justifyContent:'center', color:'#94A3B8' }}>데이터 로딩 중…</div>
  }

  return (
    <div className="dt-page">
      {/* 안내 */}
      <div style={{
        padding: '8px 14px',
        background: '#FFFBEB',
        border: '1.5px solid #F59E0B',
        borderRadius: 6,
        fontSize: 13,
        color: '#92400E',
        marginBottom: 8,
      }}>
        🟡 <b>val/test의 health 컬럼은 실제 미공개</b> — 0으로 표시되는 값은 의미 없습니다. reg_pred 기준으로 위험 등급을 판단하세요.
      </div>

      {/* 요약 카드 */}
      {summary && (
        <div className="dt-summary">
          {[
            { label:'조회된 Unit',    value: summary.total.toLocaleString(), color:'#3B82F6' },
            { label:'Grade 1 (최고위험)', value: summary.g1.toLocaleString(), color: GRADE_COLORS.grade1.text },
            { label:'Grade 2',        value: summary.g2.toLocaleString(),    color: GRADE_COLORS.grade2.text },
            { label:'Grade 3',        value: summary.g3.toLocaleString(),    color: GRADE_COLORS.grade3.text },
          ].map((s, i) => (
            <div key={i} className="dt-stat" style={{ borderTop:`3px solid ${s.color}` }}>
              <div style={{ fontSize:17, fontWeight:700, fontFamily:'DM Mono,monospace', color:s.color }}>{s.value}</div>
              <div style={{ fontSize:13, color:'#64748B', marginTop:2 }}>{s.label}</div>
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
          <select className="dt-select" value={gradeFilter} onChange={e => { setGradeFilter(e.target.value); setPage(1) }}>
            <option value="all">등급: 전체</option>
            <option value="grade1">Grade 1</option>
            <option value="grade2">Grade 2</option>
            <option value="grade3">Grade 3</option>
            <option value="grade4">Grade 4</option>
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
              <th onClick={() => handleSort('reg_pred')} className="sortable">reg_pred <SortIcon col="reg_pred" /></th>
              <th onClick={() => handleSort('health')} className="sortable">health(실제) <SortIcon col="health" /></th>
              <th>등급</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i} style={{ background: r.grade === 'grade1' ? '#FFF5F5' : r.grade === 'grade2' ? '#FFFBF0' : 'transparent' }}>
                <td className="mono bold">{r.ufs_serial}</td>
                <td>
                  <span className={`split-badge split-${r.split}`}>{r.split}</span>
                </td>
                <td className="mono" style={{
                  color: r.grade === 'grade1' ? GRADE_COLORS.grade1.text
                       : r.grade === 'grade2' ? GRADE_COLORS.grade2.text
                       : r.grade === 'grade3' ? GRADE_COLORS.grade3.text
                       : '#64748B',
                  fontWeight: r.grade === 'grade1' || r.grade === 'grade2' ? 600 : 400,
                }}>
                  {parseFloat(r.reg_pred || 0).toFixed(6)}
                </td>
                <td className="mono" style={{ color: parseFloat(r.health) > 0 ? '#EF4444' : '#94A3B8' }}>
                  {r.split === 'train' ? parseFloat(r.health || 0).toFixed(6) : <span style={{ color:'#CBD5E1' }}>미공개</span>}
                </td>
                <td><GradeBadge grade={r.grade} /></td>
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
