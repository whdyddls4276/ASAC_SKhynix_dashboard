import { useRef, useState, useEffect, useCallback } from 'react'
import './ReportModal.css'

const API_URL = 'http://localhost:8000'

// HTML 보고서에 주입할 클릭+드래그 감지 스크립트
const INJECT_SCRIPT = `
<script>
(function() {
  var overlays = [];   // 선택된 박스 하이라이트 (여러 개 가능)
  var dragBox  = null;
  var selectMode = false;
  var dragStart  = null;
  var hoverEl    = null;

  // ── 유틸 ──────────────────────────────────────────────────
  function getLabel(el) {
    if (el.dataset && el.dataset.section) return el.dataset.section;
    var tag = el.tagName.toLowerCase();
    if (tag === 'canvas') return '차트 영역';
    if (tag === 'table')  return '표 영역';
    var txt = (el.innerText || el.textContent || '').trim().substring(0, 40);
    return txt || '선택된 영역';
  }

  function clearAll() {
    overlays.forEach(function(o) { o.remove(); });
    overlays = [];
    if (dragBox) { dragBox.remove(); dragBox = null; }
    dragStart = null;
  }

  // 단일 요소에 파란 테두리 오버레이
  function addHighlight(el) {
    var rect = el.getBoundingClientRect();
    var o = document.createElement('div');
    o.style.cssText = [
      'position:fixed','pointer-events:none','z-index:9999','box-sizing:border-box',
      'border:2px solid #3B82F6','background:rgba(59,130,246,0.08)','border-radius:4px',
      'transition:all .1s',
      'top:'   + rect.top    + 'px',
      'left:'  + rect.left   + 'px',
      'width:' + rect.width  + 'px',
      'height:'+ rect.height + 'px',
    ].join(';');
    document.body.appendChild(o);
    overlays.push(o);
  }

  // data-section 있는 가장 가까운 조상 찾기
  function findSection(target) {
    var cur = target;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.section) return cur;
      cur = cur.parentElement;
    }
    // fallback: canvas > table
    cur = target;
    while (cur && cur !== document.body) {
      if (['canvas','table'].includes(cur.tagName.toLowerCase())) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // ── 부모 메시지 ───────────────────────────────────────────
  window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.type === 'SET_SELECT_MODE') {
      selectMode = e.data.value;
      if (!selectMode) clearAll();
      document.body.style.cursor = selectMode ? 'crosshair' : '';
    }
    if (e.data.type === 'CLEAR_SELECT') clearAll();
  });

  // ── 클릭 선택 (8px 미만 이동) ─────────────────────────────
  document.addEventListener('click', function(e) {
    if (!selectMode || dragStart) return;
    e.stopPropagation(); e.preventDefault();
    var el = findSection(e.target);
    if (!el) return;
    clearAll();
    addHighlight(el);
    window.parent.postMessage({
      type: 'SECTION_SELECTED', label: getLabel(el), mode: 'click'
    }, '*');
  }, true);

  // ── 드래그 시작 ───────────────────────────────────────────
  document.addEventListener('mousedown', function(e) {
    if (!selectMode) return;
    e.preventDefault();
    dragStart = { x: e.clientX, y: e.clientY };
    dragBox = document.createElement('div');
    dragBox.style.cssText = [
      'position:fixed','pointer-events:none','z-index:10000','box-sizing:border-box',
      'border:2px dashed #F59E0B','background:rgba(245,158,11,0.07)','border-radius:3px',
      'top:' + e.clientY + 'px','left:' + e.clientX + 'px','width:0','height:0',
    ].join(';');
    document.body.appendChild(dragBox);
  });

  // ── 드래그 중 ─────────────────────────────────────────────
  document.addEventListener('mousemove', function(e) {
    if (!selectMode || !dragStart || !dragBox) return;
    var x = Math.min(e.clientX, dragStart.x);
    var y = Math.min(e.clientY, dragStart.y);
    var w = Math.abs(e.clientX - dragStart.x);
    var h = Math.abs(e.clientY - dragStart.y);
    dragBox.style.left = x+'px'; dragBox.style.top  = y+'px';
    dragBox.style.width= w+'px'; dragBox.style.height=h+'px';
  });

  // ── 드래그 끝 ─────────────────────────────────────────────
  document.addEventListener('mouseup', function(e) {
    if (!selectMode || !dragStart) return;
    var dx = Math.abs(e.clientX - dragStart.x);
    var dy = Math.abs(e.clientY - dragStart.y);

    // 8px 미만 → 클릭으로 위임, dragStart만 초기화
    if (dx < 8 && dy < 8) {
      if (dragBox) { dragBox.remove(); dragBox = null; }
      dragStart = null;
      return;
    }

    if (dragBox) { dragBox.remove(); dragBox = null; }

    var x1 = Math.min(e.clientX, dragStart.x);
    var y1 = Math.min(e.clientY, dragStart.y);
    var x2 = x1 + dx, y2 = y1 + dy;
    dragStart = null;

    // 드래그 범위와 겹치는 data-section 요소 수집
    var allSections = document.querySelectorAll('[data-section]');
    var hitEls = [];
    allSections.forEach(function(el) {
      var r = el.getBoundingClientRect();
      if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) {
        // 자식이 이미 포함된 경우 부모 중복 제거
        var isChild = hitEls.some(function(h) { return h.contains(el); });
        var hasChild = hitEls.some(function(h) { return el.contains(h); });
        if (!isChild) {
          if (hasChild) {
            hitEls = hitEls.filter(function(h) { return !el.contains(h); });
          }
          hitEls.push(el);
        }
      }
    });

    clearAll();

    if (hitEls.length > 0) {
      // 박스 선택: 각각 하이라이트
      hitEls.forEach(function(el) { addHighlight(el); });
      var labels = hitEls.map(function(el) { return getLabel(el); }).join(', ');
      window.parent.postMessage({
        type: 'SECTION_SELECTED', label: labels, mode: 'drag', count: hitEls.length
      }, '*');
    } else {
      // 빈 여백 선택
      var o = document.createElement('div');
      o.style.cssText = [
        'position:fixed','pointer-events:none','z-index:9999','box-sizing:border-box',
        'border:2px dashed #A855F7','background:rgba(168,85,247,0.06)','border-radius:4px',
        'top:'+y1+'px','left:'+x1+'px','width:'+dx+'px','height:'+dy+'px',
      ].join(';');
      document.body.appendChild(o);
      overlays.push(o);
      window.parent.postMessage({
        type: 'SECTION_SELECTED', label: '빈 영역', mode: 'empty'
      }, '*');
    }
  });

  // ── 호버 효과 ─────────────────────────────────────────────
  document.addEventListener('mouseover', function(e) {
    if (!selectMode || dragStart) return;
    if (hoverEl) hoverEl.style.outline = '';
    hoverEl = findSection(e.target);
    if (hoverEl) hoverEl.style.outline = '1px dashed #93C5FD';
  });
  document.addEventListener('mouseout', function(e) {
    if (hoverEl) { hoverEl.style.outline = ''; hoverEl = null; }
  });
})();
</script>
`

export default function ReportModal({ markdown: html, reportData, toolCache, onClose, apiUrl }) {
  const [selectMode, setSelectMode]     = useState(false)
  const [selectedSection, setSelected] = useState(null)
  const [messages, setMessages]         = useState([
    { role: 'bot', text: '보고서에 대해 질문하거나 수정을 요청해 보세요.\n예) "SHAP 상위 피처를 설명해줘", "개선 방안을 X552_range로 바꿔줘"' }
  ])
  const [input, setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [currentHtml, setCurrentHtml] = useState(html)
  const [currentReportData, setCurrentReportData] = useState(reportData || {})

  const iframeRef         = useRef(null)
  const bottomRef         = useRef(null)
  const historyRef        = useRef([])
  const prevBlobRef       = useRef(null)
  const initialLoad       = useRef(true)
  const currentHtmlRef    = useRef(currentHtml)
  const currentReportRef  = useRef(currentReportData)
  const [blobUrl, setBlobUrl] = useState(null)

  // ref를 항상 최신 state로 동기화
  useEffect(() => { currentHtmlRef.current = currentHtml }, [currentHtml])
  useEffect(() => { currentReportRef.current = currentReportData }, [currentReportData])

  function _inject(rawHtml) {
    return rawHtml.includes('</body>')
      ? rawHtml.replace('</body>', INJECT_SCRIPT + '</body>')
      : rawHtml + INJECT_SCRIPT
  }

  // 최초 로드: blob URL로 iframe src 세팅
  useEffect(() => {
    if (!currentHtml) return
    const newUrl = URL.createObjectURL(
      new Blob([_inject(currentHtml)], { type: 'text/html;charset=utf-8' })
    )
    if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current)
    prevBlobRef.current = newUrl
    setBlobUrl(newUrl)
    initialLoad.current = true   // 다음 update는 write() 방식으로
    return () => { URL.revokeObjectURL(newUrl) }
  }, [])   // 마운트 시 1회만

  // 이후 수정: src 교체 없이 document.write()로 덮어쓰기 → 스크롤 위치 유지
  useEffect(() => {
    if (initialLoad.current) { initialLoad.current = false; return }
    const iframe = iframeRef.current
    if (!iframe) return
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) return
    const scrollY = iframe.contentWindow?.scrollY || 0
    doc.open()
    doc.write(_inject(currentHtml))
    doc.close()
    // Chart.js 렌더링 완료 후 스크롤 복원 (rAF 2중첩 + 100ms 보험)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        iframe.contentWindow?.scrollTo(0, scrollY)
        if (selectMode) {
          iframe.contentWindow?.postMessage({ type: 'SET_SELECT_MODE', value: true }, '*')
        }
      })
    })
    const t = setTimeout(() => {
      iframe.contentWindow?.scrollTo(0, scrollY)
    }, 120)
    return () => clearTimeout(t)
  }, [currentHtml])

  // iframe → 부모: 영역 선택 이벤트 수신 (기존 SECTION_SELECTED + 신규 ia_event)
  useEffect(() => {
    function onMessage(e) {
      // ── 기존: 선택 모드 드래그/클릭 ──────────────────────
      if (e.data?.type === 'SECTION_SELECTED') {
        const { label, mode, count } = e.data
        setSelected(label)
        if (mode === 'empty') {
          setInput(prev => prev || '이 빈 영역에 ')
        } else {
          setInput(prev => prev || `[${label}] `)
        }
        return
      }

      // ── 신규: ia_event (드래그·우클릭·hover 버튼) ────────
      if (e.data?.type === 'ia_event') {
        const payload = e.data.payload
        if (!payload) return
        setSelected(payload.label || payload.sid || '선택됨')

        // /report/interact 엔드포인트로 SSE 요청 전송
        sendInteract(payload)
        return
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])   // dep [] 고정 — 최신 state는 ref로 참조

  // ── /report/interact 전송 (ia_event 처리) ──────────────────
  async function sendInteract(payload) {
    if (loading) return
    setLoading(true)
    const userMsg = payload.prompt || `[${payload.label}] 수정 요청`
    addMsg('user', userMsg)
    historyRef.current.push({ role: 'user', content: userMsg })

    try {
      const res = await fetch(`${apiUrl || API_URL}/report/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          history: historyRef.current.slice(0, -1),
          tool_cache: toolCache || {},
          current_report_data: currentReportRef.current,
        }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let botText = ''
      let buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          let event
          try { event = JSON.parse(raw) } catch { continue }

          if (event.type === 'text') {
            botText += event.content
            setMessages(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'bot' && last?.streaming) {
                next[next.length - 1] = { ...last, text: botText }
              } else {
                next.push({ role: 'bot', text: botText, streaming: true })
              }
              return next
            })
          }
          if (event.type === 'report_ready' && event.html) {
            setCurrentHtml(event.html)
            if (event.report_data) setCurrentReportData(event.report_data)
          }
          if (event.type === 'confirm' && event.buttons) {
            setMessages(prev => [...prev, { role: 'bot', text: botText, buttons: event.buttons }])
            botText = ''
          }
          if (event.type === 'done') setLoading(false)
          if (event.type === 'error') {
            addMsg('bot', `⚠️ ${event.message}`)
            setLoading(false)
          }
        }
      }
      setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m))
      if (botText) historyRef.current.push({ role: 'assistant', content: botText })
    } catch {
      addMsg('bot', '⚠️ 서버 연결에 실패했습니다.')
      setLoading(false)
    }
  }

  // 선택 모드 토글 → iframe에 전달
  function toggleSelectMode() {
    const next = !selectMode
    setSelectMode(next)
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'SET_SELECT_MODE', value: next }, '*'
    )
    if (!next) setSelected(null)
  }

  function clearSelect() {
    setSelectMode(false)
    setSelected(null)
    iframeRef.current?.contentWindow?.postMessage({ type: 'CLEAR_SELECT' }, '*')
    iframeRef.current?.contentWindow?.postMessage({ type: 'SET_SELECT_MODE', value: false }, '*')
  }

  // 스크롤 bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function addMsg(role, text) {
    setMessages(prev => [...prev, { role, text }])
  }

  async function send() {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    clearSelect()
    addMsg('user', msg)
    historyRef.current.push({ role: 'user', content: msg })
    setLoading(true)

    try {
      const res = await fetch(`${apiUrl || API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          history: historyRef.current.slice(0, -1),
          tool_cache: toolCache || {},
          context: 'report_edit',
          current_html: currentHtml,
          current_report_data: currentReportData,
        }),
      })

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let botText = ''
      let buffer  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          let event
          try { event = JSON.parse(raw) } catch { continue }

          if (event.type === 'text') {
            botText += event.content
            setMessages(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'bot' && last?.streaming) {
                next[next.length - 1] = { ...last, text: botText }
              } else {
                next.push({ role: 'bot', text: botText, streaming: true })
              }
              return next
            })
          }

          // 수정된 HTML이 보고서로 내려오면 미리보기 갱신
          if (event.type === 'report_ready' && event.html) {
            setCurrentHtml(event.html)
            if (event.report_data) setCurrentReportData(event.report_data)
          }

          if (event.type === 'done') setLoading(false)
          if (event.type === 'error') {
            addMsg('bot', `⚠️ ${event.message}`)
            setLoading(false)
          }
        }
      }

      setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m))
      if (botText) historyRef.current.push({ role: 'assistant', content: botText })
    } catch {
      addMsg('bot', '⚠️ 서버 연결에 실패했습니다.')
      setLoading(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function downloadHtml() {
    const blob = new Blob([currentHtml], { type: 'text/html;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = '품질불량개선조치보고서.html'; a.click()
    URL.revokeObjectURL(url)
  }

  async function downloadPptx() {
    const res = await fetch(`${apiUrl || API_URL}/report/pptx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_data: reportData || {}, filename: '품질불량개선조치보고서.pptx' }),
    })
    if (!res.ok) { alert('PPTX 생성 실패'); return }
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = '품질불량개선조치보고서.pptx'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rm-overlay" onClick={onClose}>
      <div className="rm-container" onClick={e => e.stopPropagation()}>

        {/* 상단 툴바 */}
        <div className="rm-toolbar">
          <span className="rm-toolbar-title">📄 Field Health 보고서 미리보기</span>
          <div className="rm-toolbar-actions">
            <button
              className={`rm-tool-btn ${selectMode ? 'active' : ''}`}
              onClick={toggleSelectMode}
              title="영역을 클릭해서 선택"
            >
              ✏️ 영역선택
            </button>
            <button className="rm-tool-btn" onClick={clearSelect} title="선택 초기화">
              🔄 초기화
            </button>
            <button className="rm-tool-btn ppt" onClick={downloadPptx}>
              📊 PPT
            </button>
            <button className="rm-tool-btn html" onClick={downloadHtml}>
              ⬇️ HTML
            </button>
            <button className="rm-tool-btn close" onClick={onClose}>
              ✕ 닫기
            </button>
          </div>
        </div>

        {/* 선택된 영역 알림 */}
        {selectedSection && (
          <div className="rm-selection-bar">
            <span>📌 선택됨: <strong>{selectedSection}</strong></span>
            <span className="rm-selection-hint">→ 우측 채팅에 수정 요청을 입력하세요</span>
          </div>
        )}

        {/* 본문: 좌(미리보기) + 우(챗봇) */}
        <div className="rm-body">

          {/* 좌: HTML 미리보기 */}
          <div className={`rm-preview ${selectMode ? 'select-mode' : ''}`}>
            {blobUrl && (
              <iframe
                ref={iframeRef}
                src={blobUrl}
                title="보고서 미리보기"
                className="rm-iframe"
              />
            )}
          </div>

          {/* 우: AI 수정 어시스턴트 */}
          <div className="rm-chat">
            <div className="rm-chat-header">
              <span>🤖 AI 수정 어시스턴트</span>
            </div>

            <div className="rm-chat-messages">
              {messages.map((m, i) => (
                <div key={i} className={`rm-msg ${m.role}`}>
                  {m.role === 'bot' && <div className="rm-avatar">AI</div>}
                  <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                    <div className={`rm-bubble ${m.streaming ? 'streaming' : ''}`}>
                      {m.text}
                    </div>
                    {m.buttons && m.buttons.length > 0 && (
                      <div style={{display:'flex',flexWrap:'wrap',gap:'6px',paddingLeft:'4px'}}>
                        {m.buttons.map((btn, bi) => (
                          <button key={bi}
                            style={{background:'#EFF6FF',border:'1px solid #93C5FD',borderRadius:'6px',
                                    padding:'4px 10px',fontSize:'11px',cursor:'pointer',color:'#1D4ED8'}}
                            onClick={() => { setInput(btn); }}
                          >{btn}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="rm-msg bot">
                  <div className="rm-avatar">AI</div>
                  <div className="rm-bubble">
                    <span className="rm-typing"><span/><span/><span/></span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="rm-chat-input">
              <textarea
                className="rm-input"
                placeholder={selectMode
                  ? '영역을 선택하면 자동으로 입력됩니다...'
                  : '질문하거나 수정을 요청하세요...'}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                rows={2}
                disabled={loading}
              />
              <button className="rm-send" onClick={send} disabled={loading}>
                전송
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
