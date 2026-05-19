"""report.py의 html 블록을 1팀 스타일로 교체하는 패치 스크립트."""
NEW_HTML = r"""    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Malgun Gothic','Segoe UI',Arial,sans-serif;font-weight:600;background:#e7e7e7;color:#20242a;font-size:10px}}
.slide{{width:1280px;background:#fff;border:1px solid #6b7280;box-shadow:0 10px 24px rgba(31,41,55,.12);display:flex;flex-direction:column;overflow:hidden;margin:0 auto}}
.s-topbar{{display:grid;grid-template-columns:200px 1fr 200px;align-items:center;min-height:38px;padding:0 20px;border-bottom:2px solid #1e3a8a}}
.s-issue{{font-size:11px;font-weight:700;color:#334e76}}
.s-caption{{font-size:19px;font-weight:900;color:#0f172a;text-align:center}}
.conf{{background:#dc2626;color:#fff;font-size:11px;font-weight:800;padding:4px 13px;border:1px solid #b91c1c}}
.s-conf-wrap{{display:flex;justify-content:flex-end}}
.s-summary{{background:#fff7ed;border-bottom:1px solid #fed7aa;padding:5px 16px;text-align:center}}
.s-title{{font-size:20px;font-weight:900;color:#111827;line-height:1.2}}
.s-subtitle{{font-size:15px;font-weight:700;color:#1a3a5c;margin-top:2px}}
.s-body{{padding:7px 12px 7px;flex:1;min-height:0}}
.cols{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.sbox{{border:1px solid #6b7280;background:#fff}}
.shdr{{background:#f3f4f6;color:#111827;border-bottom:1px solid #6b7280;padding:5px 11px;font-size:11px;font-weight:900;position:relative}}
.shdr::before{{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:#6b7280}}
.sbdy{{padding:6px 10px}}
.kpi-cards{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:7px}}
.kpi-card{{background:#fff;border:1px solid #9ca3af;padding:6px 10px 5px 13px;position:relative;overflow:hidden}}
.kpi-card::before{{content:'';position:absolute;left:0;top:0;bottom:0;width:3px}}
.kpi-card.navy::before{{background:#1e3a8a}}.kpi-card.dark::before{{background:#374151}}.kpi-card.amber::before{{background:#b45309}}
.kpi-lbl{{font-size:9px;color:#4b5563;font-weight:800;margin-bottom:2px}}
.kpi-val{{font-size:20px;font-weight:900;line-height:1.1}}
.kpi-val.navy{{color:#1e3a8a}}.kpi-val.dark{{color:#374151}}.kpi-val.amber{{color:#b45309}}
.kpi-sub{{font-size:9px;color:#4b5563;font-weight:700;margin-top:2px}}
.inum{{font-size:11px;font-weight:900;color:#111827;margin:6px 0 3px}}
.cbox{{border:1px solid #9ca3af;background:#fff;margin-bottom:7px}}
.cbox-body{{padding:4px 6px;position:relative}}
.unit-main{{display:grid;grid-template-columns:155px 1fr;gap:7px;margin-bottom:7px}}
.wafer-box{{border:1px solid #9ca3af;background:#fff;display:flex;flex-direction:column;align-items:center;padding:5px;gap:3px}}
.wafer-box-title{{font-size:9px;font-weight:900;color:#111827;align-self:stretch;border-bottom:1px solid #d1d5db;padding-bottom:3px;margin-bottom:2px}}
.unit-tbl{{border:1px solid #9ca3af;overflow:hidden;background:#fff}}
.unit-row{{display:grid;grid-template-columns:72px 1fr;border-bottom:1px solid #d1d5db}}
.unit-row:last-child{{border-bottom:none}}
.unit-row:nth-child(even){{background:#f8fafc}}
.unit-lbl{{padding:4px 8px;font-size:10px;font-weight:900;color:#111827}}
.unit-val{{padding:4px 8px;font-size:11px;font-weight:900;font-family:Consolas,monospace;color:#111827}}
.unit-val.hot{{color:#8a1f1f;font-size:13px}}
.anom-panel{{border:1px solid #9ca3af;background:#fffef8}}
.anom-hdr{{background:#f3f4f6;border-bottom:1px solid #9ca3af;padding:4px 8px;font-size:10px;font-weight:900}}
.anom-list{{padding:4px;display:flex;flex-direction:column;gap:2px}}
.anom-card{{border:1px solid #d1d5db;background:#fff;padding:4px 6px}}
.anom-card:nth-child(even){{background:#f8fafc}}
.anom-top{{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:3px}}
.anom-name{{color:#111827;font:900 10px/1.1 Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.anom-row{{display:flex;align-items:center;gap:3px;margin-top:2px}}
.anom-lbl{{width:26px;flex-shrink:0;font-size:8px;font-weight:900;color:#60676f}}
.anom-lbl.unit{{color:#111827}}
.anom-track{{position:relative;flex:1;height:8px;background:#e8ecef}}
.anom-fill{{position:absolute;left:0;top:0;bottom:0}}
.anom-fill.normal{{background:#2f6b3f}}.anom-fill.danger{{background:#9f1d1d}}
.anom-val{{width:42px;flex-shrink:0;font:8px/1.1 Consolas,monospace;text-align:right;font-weight:800}}
.fi-panel{{border:1px solid #9ca3af;background:#fff}}
.fi-hdr{{background:#f3f4f6;border-bottom:1px solid #9ca3af;padding:4px 8px;font-size:10px;font-weight:900}}
.fi-list{{padding:3px}}
.fi-row{{display:flex;align-items:center;gap:5px;padding:3px 4px;border-bottom:1px solid #e5e7eb}}
.fi-row:last-child{{border-bottom:none}}
.fi-row:nth-child(even){{background:#f8fafc}}
.pos-panel{{border:1px solid #9ca3af;background:#fff;margin-bottom:7px}}
.pos-hdr{{background:#f3f4f6;border-bottom:1px solid #9ca3af;padding:4px 8px;font-size:10px;font-weight:900}}
.s-footer{{border-top:2px solid #4b5563;padding:4px 14px;display:flex;justify-content:space-between;font-size:9px;color:#4b5563}}
.footer-brand{{font-weight:900;color:#111827}}
.ia-target{{cursor:pointer;transition:outline .12s}}
.ia-target:hover{{outline:2px solid rgba(59,130,246,.5);outline-offset:1px}}
.ia-target.ia-selected{{outline:2px solid #3b82f6!important}}
.ia-hover-btn{{display:none;position:absolute;top:3px;right:3px;z-index:9999;background:#3b82f6;color:#fff;border:none;padding:2px 7px;font-size:9px;cursor:pointer;font-weight:700}}
.ia-target:hover .ia-hover-btn{{display:block}}
.ia-empty-slot{{border:2px dashed #9ca3af;min-height:32px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:10px;cursor:pointer;margin-top:6px}}
.ia-empty-slot:hover{{border-color:#3b82f6;background:#eff6ff;color:#3b82f6}}
#ia-drag-overlay{{display:none;position:fixed;border:1.5px dashed #3b82f6;background:rgba(59,130,246,.07);pointer-events:none;z-index:99999}}
#ia-ctx-menu{{display:none;position:fixed;z-index:999999;background:#fff;border:1px solid #9ca3af;box-shadow:0 4px 16px rgba(0,0,0,.15);min-width:150px;overflow:hidden}}
#ia-ctx-menu .ctx-item{{padding:7px 14px;font-size:11px;cursor:pointer;color:#1e293b;display:flex;align-items:center;gap:6px;font-weight:700}}
#ia-ctx-menu .ctx-item:hover{{background:#eff6ff;color:#3b82f6}}
#ia-ctx-menu .ctx-sep{{height:1px;background:#e2e8f0;margin:2px 0}}
</style>
</head>
<body>
<div class="slide">

<div class="s-topbar">
  <div class="s-issue">발행일자: {today_str}</div>
  <div class="s-caption">Field Health 불량 예측 분석 보고서</div>
  <div class="s-conf-wrap"><div class="conf">대외비</div></div>
</div>
<div class="s-summary">
  <div class="s-title">전주 대비 품질 불량 &nbsp;<span style="color:{delta_color}">{delta_str} ppm</span>&nbsp; <span style="font-size:17px;font-weight:600;color:#555">{'열화' if delta_val >= 0 else '개선'}</span></div>
  <div class="s-subtitle">원인 WT Parameter&nbsp;<span style="background:#fef3c7;color:#92400e;padding:1px 7px;font-size:15px;font-weight:800">{alert_features}</span>&nbsp;이상 → inline 참원인 도출 요청</div>
</div>

<div class="s-body">
<div class="cols">

<div>
  <div class="sbox">
    <div class="shdr">[ 모델링 결과 ]</div>
    <div class="sbdy">

      <div class="inum">1. 모델 성능</div>
      <div class="kpi-cards ia-target" data-sid="L1_kpi" data-section="모델 성능" style="position:relative">
        <button class="ia-hover-btn" onclick="iaAskSection('L1_kpi','모델 성능')">✏️</button>
        <div class="kpi-card navy">
          <div class="kpi-lbl">RMSE</div>
          <div class="kpi-val navy">{val_rmse}</div>
          <div class="kpi-sub">{model_nm}</div>
        </div>
        <div class="kpi-card dark">
          <div class="kpi-lbl">분석 유닛</div>
          <div class="kpi-val dark">{scan_total}개</div>
          <div class="kpi-sub">val 기준</div>
        </div>
        <div class="kpi-card amber">
          <div class="kpi-lbl">불량률 PPM</div>
          <div class="kpi-val amber">{_ppm_str}</div>
          <div class="kpi-sub">grade1 기준</div>
        </div>
      </div>

      <div class="inum">2. 불량 트렌드</div>
      <div class="cbox ia-target" data-sid="L2_trend" data-section="불량 트렌드" style="position:relative">
        <button class="ia-hover-btn" onclick="iaAskSection('L2_trend','불량 트렌드')">✏️</button>
        <div class="cbox-body" style="height:120px"><canvas id="c-trend"></canvas></div>
      </div>

      <div class="inum">3. Lot별 불량 개수</div>
      <div class="cbox ia-target" data-sid="L3_lot" data-section="Lot별 불량 개수" style="position:relative">
        <button class="ia-hover-btn" onclick="iaAskSection('L3_lot','Lot별 불량 개수')">✏️</button>
        <div class="cbox-body" style="height:110px"><canvas id="c-lot-defects"></canvas></div>
      </div>

      <div class="inum">4. SHAP Value Trend</div>
      <div class="cbox ia-target" data-sid="L4_shap" data-section="SHAP Value Trend" style="position:relative">
        <button class="ia-hover-btn" onclick="iaAskSection('L4_shap','SHAP Value Trend')">✏️</button>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:3px 6px 2px">
          <div style="font-size:9px;font-weight:900;color:#111827;font-family:Consolas,monospace">{shap_feat_name}</div>
          <div style="display:flex;gap:8px;font-size:8px;color:#4b5563">
            <span><i style="display:inline-block;width:7px;height:7px;background:#ef4444;border-radius:50%;margin-right:2px"></i>HIGH</span>
            <span><i style="display:inline-block;width:7px;height:7px;background:#3b82f6;border-radius:50%;margin-right:2px"></i>Normal/Med</span>
            <span><i style="display:inline-block;width:14px;height:2px;background:#111827;margin-right:2px;vertical-align:middle"></i>mean trend</span>
          </div>
        </div>
        <div class="cbox-body" style="height:145px"><canvas id="c-shap-trend"></canvas></div>
      </div>

      {left_extra}
      {commentary_html}
    </div>
  </div>
</div>

<div>
  <div class="sbox">
    <div class="shdr">[ 불량 예측 현황 ]</div>
    <div class="sbdy">

      <div class="inum">1. 불량 예측 현황 · 대표 불량 unit 기준</div>
      <div class="unit-main ia-target" data-sid="R1_unit" data-section="대표 Unit 정보" style="position:relative">
        <button class="ia-hover-btn" onclick="iaAskSection('R1_unit','대표 Unit')">✏️</button>
        <div class="wafer-box">
          <div class="wafer-box-title">불량 위치 웨이퍼맵</div>
          <div style="display:flex;align-items:center;justify-content:center">{wafer_svg}</div>
          <div style="font-size:8px;color:#4b5563;display:flex;gap:5px;align-items:center;flex-wrap:wrap">
            <span style="display:inline-block;width:8px;height:8px;background:#dff5ff;border:1px solid #b8c8d8"></span>정상
            <span style="display:inline-block;width:8px;height:8px;background:#fdba74"></span>경미
            <span style="display:inline-block;width:8px;height:8px;background:#dc2626"></span>대표
          </div>
          <div style="font-size:9px;font-weight:900;color:#111827;font-family:Consolas,monospace">{dummy_unit["serial"]}</div>
        </div>
        <div>
          <div class="unit-tbl" style="margin-bottom:5px">
            <div class="unit-row"><div class="unit-lbl">시리얼 넘버</div><div class="unit-val">{dummy_unit["serial"]}</div></div>
            <div class="unit-row"><div class="unit-lbl">LOT_ID</div><div class="unit-val">{dummy_unit["lot"]}</div></div>
            <div class="unit-row"><div class="unit-lbl">WAFER_ID</div><div class="unit-val">{dummy_unit["wafer"]}</div></div>
            <div class="unit-row"><div class="unit-lbl">예측 health</div><div class="unit-val hot">{dummy_unit["pred_health"]} (≥ 0.0020)</div></div>
            <div class="unit-row"><div class="unit-lbl">생산 일자</div><div class="unit-val">{dummy_unit["prod_date"]}</div></div>
            <div class="unit-row"><div class="unit-lbl">예측 일자</div><div class="unit-val">{dummy_unit["insp_date"]}</div></div>
          </div>
          <div class="pos-panel">
            <div class="pos-hdr">포지션별 예측 health값</div>
            <div class="unit-tbl">{pos_health_rows}</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
        <div class="anom-panel ia-target" data-sid="R2_anomaly" data-section="Anomaly Feature" style="position:relative">
          <button class="ia-hover-btn" onclick="iaAskSection('R2_anomaly','Anomaly Feature')">✏️</button>
          <div class="anom-hdr">Anomaly Feature Top {len(anomaly_stats) if anomaly_stats else 5}</div>
          <div class="anom-list">{anomaly_rows}</div>
        </div>
        <div class="fi-panel ia-target" data-sid="R2_importance" data-section="Feature Importance" style="position:relative">
          <button class="ia-hover-btn" onclick="iaAskSection('R2_importance','Feature Importance')">✏️</button>
          <div class="fi-hdr">Feature Importance</div>
          <div class="fi-list">{fi_ratio_rows}</div>
        </div>
      </div>

      {right_extra}
    </div>
  </div>
</div>

</div>
</div>

<div id="ia-drag-overlay"></div>
<div id="ia-ctx-menu">
  <div class="ctx-item" id="ctx-edit">✏️ 수정 요청</div>
  <div class="ctx-item" id="ctx-period">📅 기간 변경</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" id="ctx-explain">💬 이 데이터 설명해줘</div>
</div>

<div class="s-footer">
  <div class="footer-brand">We Do Technology | SK hynix</div>
  <span>{today_str} · {model_nm} · Val RMSE {val_rmse}</span>
  <span>Field Health Prediction Model v1.0 · Page 1 of 1</span>
</div>
</div>

<script>
Chart.defaults.font.family = "'Malgun Gothic','Segoe UI',Arial,sans-serif";
Chart.defaults.font.weight = '700';
Chart.defaults.font.size   = 9;
Chart.defaults.color       = '#202832';

// L2: 불량 트렌드 (꺾은선 + 생산량 막대)
(function(){{
  var labels    = {j_lot_labels};
  var prodData  = {j_lot_production};
  var predYield = {j_lot_pred_yield};
  var ctx = document.getElementById('c-trend'); if(!ctx) return;
  if(!labels.length){{
    labels=['02/09','02/23','03/09','03/23','04/06','04/20','05/04','05/18','06/01'];
    predYield=[720000,735000,710000,750000,740000,760000,745000,755000,750000];
    prodData=[180,200,160,210,190,195,175,205,185];
  }}
  new Chart(ctx,{{type:'bar',data:{{labels:labels,datasets:[
    {{label:'Production',data:prodData,type:'bar',backgroundColor:'rgba(148,163,184,0.35)',borderWidth:0,yAxisID:'y2',order:2}},
    {{label:'Pred ppm',data:predYield,type:'line',borderColor:'#dc2626',borderWidth:2,pointRadius:3,fill:false,tension:0.35,yAxisID:'y1',order:1}},
  ]}},options:{{responsive:true,maintainAspectRatio:false,animation:false,
    interaction:{{mode:'index',intersect:false}},
    plugins:{{legend:{{display:true,position:'top',labels:{{boxWidth:8,font:{{size:8,weight:'700'}}}}}}}},
    scales:{{
      y1:{{type:'linear',position:'left',title:{{display:true,text:'defect rate (ppm)',font:{{size:7,weight:'700'}}}},grid:{{color:'#eef0f2'}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563'}}}},
      y2:{{type:'linear',position:'right',grid:{{display:false}},ticks:{{font:{{size:7,weight:'700'}},color:'#94a3b8'}}}},
      x:{{grid:{{display:false}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563',maxRotation:30}}}}
    }}
  }}}});
}})();

// L3: Lot별 불량 개수 (막대 + 불량률 꺾은선)
(function(){{
  var labels = {j_lot_defect_labels};
  var counts = {j_lot_defect_counts};
  var rates  = {j_lot_defect_rates};
  var ctx = document.getElementById('c-lot-defects'); if(!ctx) return;
  if(!labels.length){{
    labels=['Lot 43','Lot 44','Lot 45','Lot 46','Lot 47','Lot 48','Lot 49','Lot 50','Lot 51','Lot 52','Lot 53','Lot 54','Lot 55','Lot 56'];
    counts=[2,3,1,4,2,3,2,5,3,6,280,8,4,3];
    rates=[1,2,1,2,1,2,1,3,2,3,100,4,2,2];
  }}
  var maxIdx=counts.indexOf(Math.max.apply(null,counts));
  new Chart(ctx,{{type:'bar',data:{{labels:labels,datasets:[
    {{label:'Defect count',data:counts,type:'bar',
      backgroundColor:counts.map(function(v,i){{return i===maxIdx?'#dc2626':'rgba(148,163,184,0.5)';}}) ,yAxisID:'y1',order:2}},
    {{label:'Defect rate',data:rates,type:'line',borderColor:'#111827',borderWidth:1.5,pointRadius:2,fill:false,tension:0.1,yAxisID:'y2',order:1}},
  ]}},options:{{responsive:true,maintainAspectRatio:false,animation:false,
    plugins:{{legend:{{display:true,position:'top',labels:{{boxWidth:8,font:{{size:8,weight:'700'}}}}}}}},
    scales:{{
      y1:{{type:'linear',position:'left',title:{{display:true,text:'units',font:{{size:7,weight:'700'}}}},grid:{{color:'#eef0f2'}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563'}}}},
      y2:{{type:'linear',position:'right',min:0,max:100,grid:{{display:false}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563',callback:function(v){{return v+'%';}}}}}},
      x:{{grid:{{display:false}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563',maxRotation:30}}}}
    }}
  }}}});
}})();

// L4: SHAP Value Trend
(function(){{
  var highPts   = {j_shap_high};
  var normalPts = {j_shap_normal};
  var trendX    = {j_shap_trend_x};
  var trendY    = {j_shap_trend_y};
  var ctx = document.getElementById('c-shap-trend'); if(!ctx) return;
  var ds=[
    {{label:'HIGH',data:highPts,backgroundColor:'rgba(239,68,68,0.55)',pointRadius:2.5}},
    {{label:'Normal/Med',data:normalPts,backgroundColor:'rgba(59,130,246,0.45)',pointRadius:2}},
  ];
  if(trendX.length&&trendY.length){{
    var tp=trendX.map(function(x,i){{return {{x:x,y:trendY[i]}};}});
    ds.push({{label:'mean trend',data:tp,type:'line',borderColor:'#111827',borderWidth:1.5,pointRadius:0,fill:false,tension:0.4}});
  }}
  new Chart(ctx,{{type:'scatter',data:{{datasets:ds}},options:{{responsive:true,maintainAspectRatio:false,animation:false,
    plugins:{{legend:{{display:true,position:'top',labels:{{boxWidth:7,font:{{size:8,weight:'700'}}}}}}}},
    scales:{{
      x:{{title:{{display:true,text:'normalized feature value',font:{{size:7,weight:'700'}}}},grid:{{color:'#eef0f2'}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563'}}}},
      y:{{title:{{display:true,text:'SHAP value',font:{{size:7,weight:'700'}}}},grid:{{color:'#eef0f2'}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563'}}}}
    }}
  }}}});
}})();

{custom_chart_js}

(function(){{
  function getSnap(){{
    var snap=[],pr=document.querySelector('.slide').getBoundingClientRect();
    document.querySelectorAll('[data-sid]').forEach(function(el){{
      var r=el.getBoundingClientRect();
      snap.push({{sid:el.getAttribute('data-sid'),label:el.getAttribute('data-section')||el.getAttribute('data-sid'),
        rect:{{x:Math.round(r.left-pr.left),y:Math.round(r.top-pr.top),w:Math.round(r.width),h:Math.round(r.height)}}}});
    }});return snap;
  }}
  function send(p){{window.parent.postMessage({{type:'ia_event',payload:p}},'*');}}
  window.iaAskSection=function(sid,label){{send({{action:'modify',sid:sid,label:label,layout:getSnap(),prompt:label+' 섹션을 수정하고 싶습니다.'}});}};
  window.iaClickEmptySlot=function(pos){{send({{action:'add',position:pos,layout:getSnap(),prompt:pos==='left_col'?'왼쪽 빈 공간에 섹션 추가':'오른쪽 빈 공간에 섹션 추가'}});}};
  var ctxMenu=document.getElementById('ia-ctx-menu'),_tgt=null;
  document.addEventListener('contextmenu',function(e){{
    var el=e.target.closest('[data-sid]');if(!el)return;
    e.preventDefault();_tgt=el;el.classList.add('ia-selected');
    ctxMenu.style.display='block';ctxMenu.style.left=e.clientX+'px';ctxMenu.style.top=e.clientY+'px';
  }});
  function hideCtx(){{ctxMenu.style.display='none';if(_tgt){{_tgt.classList.remove('ia-selected');_tgt=null;}}}}
  document.addEventListener('click',hideCtx);
  document.addEventListener('keydown',function(e){{if(e.key==='Escape')hideCtx();}});
  document.getElementById('ctx-edit').addEventListener('click',function(){{
    if(!_tgt)return;hideCtx();
    send({{action:'modify',sid:_tgt.getAttribute('data-sid'),label:_tgt.getAttribute('data-section')||_tgt.getAttribute('data-sid'),layout:getSnap(),prompt:(_tgt.getAttribute('data-section')||'')+' 섹션을 수정하고 싶습니다.'}});
  }});
  document.getElementById('ctx-period').addEventListener('click',function(){{
    if(!_tgt)return;hideCtx();
    send({{action:'period',sid:_tgt.getAttribute('data-sid'),label:_tgt.getAttribute('data-section')||_tgt.getAttribute('data-sid'),layout:getSnap(),prompt:(_tgt.getAttribute('data-section')||'')+' 기간을 변경하고 싶습니다.'}});
  }});
  document.getElementById('ctx-explain').addEventListener('click',function(){{
    if(!_tgt)return;hideCtx();
    send({{action:'explain',sid:_tgt.getAttribute('data-sid'),label:_tgt.getAttribute('data-section')||_tgt.getAttribute('data-sid'),layout:getSnap(),prompt:(_tgt.getAttribute('data-section')||'')+' 섹션의 데이터를 설명해주세요.'}});
  }});
  var overlay=document.getElementById('ia-drag-overlay');
  var drag={{active:false,startX:0,startY:0}};
  document.addEventListener('mousedown',function(e){{
    if(e.target.closest('#ia-ctx-menu')||e.target.closest('.ia-hover-btn')||e.target.closest('.ia-empty-slot')||e.button!==0)return;
    var onSec=e.target.closest('[data-sid]');
    if(!onSec&&!e.target.closest('.slide'))return;
    drag.active=true;drag.startX=e.clientX;drag.startY=e.clientY;
  }});
  document.addEventListener('mousemove',function(e){{
    if(!drag.active)return;
    var dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
    if(Math.abs(dx)<5&&Math.abs(dy)<5)return;
    overlay.style.display='block';
    overlay.style.left=Math.min(e.clientX,drag.startX)+'px';
    overlay.style.top=Math.min(e.clientY,drag.startY)+'px';
    overlay.style.width=Math.abs(dx)+'px';overlay.style.height=Math.abs(dy)+'px';
  }});
  document.addEventListener('mouseup',function(e){{
    if(!drag.active)return;
    overlay.style.display='none';
    var dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
    drag.active=false;
    if(Math.abs(dx)<10&&Math.abs(dy)<10)return;
    var pr=document.querySelector('.slide').getBoundingClientRect();
    var dr={{x:Math.round(Math.min(e.clientX,drag.startX)-pr.left),y:Math.round(Math.min(e.clientY,drag.startY)-pr.top),w:Math.round(Math.abs(dx)),h:Math.round(Math.abs(dy))}};
    var snap=getSnap(),hit=null;
    snap.forEach(function(s){{
      if(s.sid.includes('EMPTY'))return;
      var ix=Math.max(0,Math.min(dr.x+dr.w,s.rect.x+s.rect.w)-Math.max(dr.x,s.rect.x));
      var iy=Math.max(0,Math.min(dr.y+dr.h,s.rect.y+s.rect.h)-Math.max(dr.y,s.rect.y));
      if(dr.w*dr.h>0&&ix*iy/(dr.w*dr.h)>0.4)hit=s;
    }});
    if(hit){{send({{action:'modify',sid:hit.sid,label:hit.label,drag:dr,layout:snap,prompt:hit.label+' 섹션을 드래그 선택했습니다.'}});}}
    else{{var pos=dr.x<640?'left_col':'right_col';send({{action:'add',position:pos,drag:dr,layout:snap,prompt:(pos==='left_col'?'왼쪽':'오른쪽')+' 영역에 섹션을 추가하고 싶습니다.'}});}}
  }});
}})();
</script>
</body>
</html>"""
"""

src = open('report.py', encoding='utf-8').read()
start = src.find('    html = f"""<!DOCTYPE html>')
end   = src.find('</html>"""', start) + len('</html>"""')
assert start > 0 and end > start, f"블록 못 찾음: {start}, {end}"
src_new = src[:start] + NEW_HTML + src[end:]
open('report.py', 'w', encoding='utf-8').write(src_new)
print(f"OK: {len(src)} -> {len(src_new)} chars, {src_new.count(chr(10))} lines")
