"""
1페이지 PPTX 보고서 생성.
레이아웃: 좌(Modeling 현황) / 우(불량 Unit 분석 현황)
디자인: 흰 배경 라이트 테마
이미지박스와 텍스트박스는 완전히 분리된 독립 영역.
"""
import io
import os
from datetime import datetime, timedelta
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

from graphs import ensure_all_graphs

# ── 색상 (라이트 테마) ────────────────────────────────────────
C_HEADER   = RGBColor(0x1E, 0x3A, 0x5F)  # 헤더 진한 파랑
C_TAB      = RGBColor(0x2A, 0x4A, 0x6F)  # 섹션 탭
C_SECTION  = RGBColor(0xF0, 0xF4, 0xF8)  # 섹션 배경 (연한 회색)
C_CARD     = RGBColor(0xFF, 0xFF, 0xFF)  # 카드 흰색
C_IMGBOX   = RGBColor(0xE8, 0xF0, 0xFE)  # 이미지 플레이스홀더
C_BTN      = RGBColor(0x3B, 0x82, 0xF6)  # Position 버튼 파랑
C_WAFER    = RGBColor(0x60, 0xA5, 0xFA)  # 웨이퍼맵
C_RED      = RGBColor(0xEF, 0x44, 0x44)  # 강조 빨강
C_GREEN    = RGBColor(0x16, 0xA3, 0x4A)  # 긍정 초록
C_WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
C_TEXT     = RGBColor(0x1E, 0x29, 0x3B)  # 본문 텍스트
C_SUB      = RGBColor(0x64, 0x74, 0x8B)  # 보조 텍스트
C_BORDER   = RGBColor(0xCB, 0xD5, 0xE1)  # 테두리
C_FOOTER   = RGBColor(0xF1, 0xF5, 0xF9)  # 푸터 배경
C_SUBTEXT  = RGBColor(0xBF, 0xDB, 0xFF)  # 헤더 내 보조

W = Inches(13.33)
H = Inches(7.5)


def _new_prs():
    prs = Presentation()
    prs.slide_width  = W
    prs.slide_height = H
    return prs


def _rect(slide, x, y, w, h, fill, line_color=None, line_pt=0.5):
    shape = slide.shapes.add_shape(1, x, y, w, h)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    if line_color:
        shape.line.color.rgb = line_color
        shape.line.width = Pt(line_pt)
    else:
        shape.line.fill.background()
    return shape


def _oval(slide, x, y, w, h, fill):
    shape = slide.shapes.add_shape(9, x, y, w, h)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    return shape


def _rounded(slide, x, y, w, h, fill):
    shape = slide.shapes.add_shape(5, x, y, w, h)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    return shape


def _text(slide, txt, x, y, w, h, size=10, bold=False,
          color=None, align=PP_ALIGN.LEFT, italic=False):
    txb = slide.shapes.add_textbox(x, y, w, h)
    tf  = txb.text_frame
    tf.word_wrap = True
    p   = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = txt
    run.font.size   = Pt(size)
    run.font.bold   = bold
    run.font.italic = italic
    run.font.color.rgb = color or C_TEXT
    return txb


def _multiline(slide, lines, x, y, w, h, size=10, color=None,
               bold=False, line_spacing=1.1):
    txb = slide.shapes.add_textbox(x, y, w, h)
    tf  = txb.text_frame
    tf.word_wrap = True
    for i, line in enumerate(lines):
        p   = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        run = p.add_run()
        run.text = line
        run.font.size  = Pt(size)
        run.font.color.rgb = color or C_TEXT
        run.font.bold  = bold
    return txb


def _card(slide, x, y, w, h, lines=None, size=10, bold=False,
          title=None, title_size=10):
    """흰 카드 박스 (테두리 있음)."""
    _rect(slide, x, y, w, h, C_CARD, line_color=C_BORDER, line_pt=0.75)
    cy = y + Inches(0.08)
    if title:
        _text(slide, title, x + Inches(0.1), cy, w - Inches(0.2), Inches(0.28),
              size=title_size, bold=True, color=C_TAB)
        cy += Inches(0.28)
    if lines:
        _multiline(slide, lines,
                   x + Inches(0.1), cy,
                   w - Inches(0.2), h - (cy - y) - Inches(0.05),
                   size=size, color=C_TEXT, bold=bold)


def _imgbox(slide, x, y, w, h, label, img_path=None):
    """
    이미지 플레이스홀더 또는 실제 이미지 삽입.
    img_path가 있으면 실제 이미지, 없으면 빈 박스.
    """
    if img_path and os.path.exists(img_path):
        slide.shapes.add_picture(img_path, x, y, w, h)
        # 테두리용 투명 rect 덮기
        border = slide.shapes.add_shape(1, x, y, w, h)
        border.fill.background()
        border.line.color.rgb = C_BORDER
        border.line.width = Pt(0.75)
    else:
        _rect(slide, x, y, w, h, C_IMGBOX, line_color=C_BORDER, line_pt=0.75)
        _text(slide, label,
              x, y + h // 2 - Inches(0.18), w, Inches(0.36),
              size=9, color=C_SUB, align=PP_ALIGN.CENTER, italic=True)


# ── 메인 빌드 ─────────────────────────────────────────────────
def build_pptx(report_data: dict) -> bytes:
    """
    report_data:
    {
      "meta":       {"title", "period", "model", "val_rmse", "test_rmse"},
      "scan":       scan_data() 반환값,
      "importance": get_importance() 반환값,
      "analysis":   analyze_features() 반환값,
      "actions":    [...]
    }
    """
    # 그래프 이미지 준비 (캐시 or 신규 생성)
    graphs = ensure_all_graphs(report_data)

    prs   = _new_prs()
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    meta         = report_data.get("meta", {})
    scan         = report_data.get("scan", {})
    importance   = report_data.get("importance", {})
    analysis     = report_data.get("analysis", {})
    features     = importance.get("features", [])
    top_features = analysis.get("top_features", [])
    compare_grp  = analysis.get("compare_group", "MED")

    val_rmse  = meta.get("val_rmse",  "0.005736")
    test_rmse = meta.get("test_rmse", "0.008427")
    model_nm  = meta.get("model",     "Two-Stage Model")
    today     = datetime.now()
    today_str = today.strftime("%Y년 %m월 %d일")
    pred_str  = (today + timedelta(days=60)).strftime("%Y년 %m월 %d일")

    scan_total = scan.get("total_units", "-")
    scan_high  = scan.get("high_count",  "-")
    scan_ratio = scan.get("high_ratio",  "-")
    top_lot    = scan.get("top_lot",     "-")
    top_wafer  = scan.get("top_wafer",   {})

    # ── 전체 배경 (흰색) ──────────────────────────────────────
    _rect(slide, 0, 0, W, H, C_WHITE)

    # ── 헤더 ──────────────────────────────────────────────────
    HDR_H = Inches(0.50)
    _rect(slide, 0, 0, W, HDR_H, C_HEADER)
    title_txt = meta.get("title", "Field Health 불량 예측 분석 보고서")
    _text(slide, title_txt,
          Inches(0.3), Inches(0.07), Inches(10.5), Inches(0.38),
          size=20, bold=True, color=C_WHITE)
    # 대외비 뱃지
    _rect(slide, Inches(12.45), Inches(0.10), Inches(0.65), Inches(0.30), C_RED)
    _text(slide, "대외비",
          Inches(12.46), Inches(0.11), Inches(0.63), Inches(0.28),
          size=9, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)

    # ── 부제목 ────────────────────────────────────────────────
    SUB_Y = HDR_H
    SUB_H = Inches(0.48)
    _rect(slide, 0, SUB_Y, W, SUB_H, RGBColor(0xEF, 0xF6, 0xFF))
    sub1 = f"예측 불량 비율 임계값 y_pred ≥ 0.003412  (train 실제 불량률 29.2% 기준 역산)  ·  Val RMSE {val_rmse}"
    sub2 = f"{model_nm}  ·  Val RMSE {val_rmse}  ·  Test RMSE {test_rmse}  ·  상위 5개 피처 SHAP 분석 및 공정 개선 방안 수립"
    _text(slide, sub1,
          Inches(0.3), SUB_Y + Inches(0.03), Inches(13), Inches(0.22),
          size=10, bold=True, color=C_RED, align=PP_ALIGN.CENTER)
    _text(slide, sub2,
          Inches(0.3), SUB_Y + Inches(0.25), Inches(13), Inches(0.2),
          size=9, color=C_TAB, align=PP_ALIGN.CENTER)

    # ── 섹션 탭 헤더 ──────────────────────────────────────────
    TAB_Y = SUB_Y + SUB_H
    TAB_H = Inches(0.34)
    GAP   = Inches(0.18)
    COL_L = Inches(0.15)
    COL_W = Inches(6.25)
    COL_R = COL_L + COL_W + GAP
    COL_RW = W - COL_R - Inches(0.15)

    _rect(slide, COL_L, TAB_Y, COL_W, TAB_H, C_TAB)
    _text(slide, "[ Modeling 현황 ]",
          COL_L, TAB_Y + Inches(0.04), COL_W, TAB_H - Inches(0.04),
          size=12, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)

    _rect(slide, COL_R, TAB_Y, COL_RW, TAB_H, C_TAB)
    _text(slide, "[ 불량 Unit 분석 현황 ]",
          COL_R, TAB_Y + Inches(0.04), COL_RW, TAB_H - Inches(0.04),
          size=12, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)

    # ── 섹션 배경 ─────────────────────────────────────────────
    BODY_Y = TAB_Y + TAB_H
    BODY_H = H - BODY_Y - Inches(0.32)

    _rect(slide, COL_L, BODY_Y, COL_W, BODY_H, C_SECTION,
          line_color=C_BORDER, line_pt=0.75)
    _rect(slide, COL_R, BODY_Y, COL_RW, BODY_H, C_SECTION,
          line_color=C_BORDER, line_pt=0.75)

    # ══════════════════════════════════════════════════════════
    # 왼쪽 컬럼: Modeling 현황
    # ══════════════════════════════════════════════════════════
    LX = COL_L + Inches(0.12)
    LW = COL_W - Inches(0.24)
    cy = BODY_Y + Inches(0.12)

    # L1. 분석시점 / 예측시점 ── 텍스트 카드
    L1_H = Inches(0.40)
    _card(slide, LX, cy, LW, L1_H,
          lines=[f"분석시점 : {today_str}     |     예측시점 : {pred_str}     |     총 Unit: {scan_total}개   HIGH 위험: {scan_high}건 ({scan_ratio}%)"],
          size=9)
    cy += L1_H + Inches(0.08)

    # L2. 모델링 결과 ── 텍스트 카드
    L2_H = Inches(0.40)
    _card(slide, LX, cy, LW, L2_H,
          lines=[f"모델링 결과 :  {model_nm}   |   Val RMSE: {val_rmse}   |   Test RMSE: {test_rmse}   |   집중 LOT: {top_lot}"],
          size=9)
    cy += L2_H + Inches(0.08)

    # L3. SHAP Value Trend Graph ── 이미지 박스 (텍스트와 완전 분리)
    L3_H = Inches(2.10)
    _imgbox(slide, LX, cy, LW, L3_H,
            "SHAP Value Trend Graph",
            img_path=graphs.get("shap_trend"))
    cy += L3_H + Inches(0.08)

    # L4. SHAP분석 관련 결과 ── 텍스트 카드 (이미지박스와 분리)
    L4_H = Inches(0.95)
    shap_lines = [f"SHAP분석 결과  (HIGH vs {compare_grp})"]
    for f in top_features[:4]:
        fname   = f.get("feature", "")
        h_mean  = f.get("high_mean", 0)
        l_mean  = f.get("low_mean",  0)
        ratio   = f.get("ratio")
        pval    = f.get("pval", 1)
        r_str   = f"{ratio:.2f}x" if ratio else "-"
        shap_lines.append(
            f"  {fname}:  HIGH {h_mean:.4f}  vs  {compare_grp} {l_mean:.4f}  ({r_str}, p={pval:.4f})"
        )
    _card(slide, LX, cy, LW, L4_H, lines=shap_lines, size=9)
    cy += L4_H + Inches(0.08)

    # L5. Model RMSE ── 텍스트 카드
    L5_H = Inches(0.38)
    _card(slide, LX, cy, LW, L5_H,
          lines=[f"Model RMSE  :  Val {val_rmse}   |   Test {test_rmse}"],
          size=10, bold=True)

    # ══════════════════════════════════════════════════════════
    # 오른쪽 컬럼: 불량 Unit 분석 현황
    # ══════════════════════════════════════════════════════════
    RX  = COL_R + Inches(0.12)
    RW  = COL_RW - Inches(0.24)
    ry  = BODY_Y + Inches(0.12)

    # R1. 대형 이미지박스 (LOT 불량 트렌드) ── 이미지 박스
    R1_H = Inches(1.80)
    _imgbox(slide, RX, ry, RW, R1_H,
            "LOT 불량 트렌드 그래프",
            img_path=graphs.get("lot_trend"))
    ry += R1_H + Inches(0.10)

    # R2. Position 버튼(4개) + 웨이퍼맵 원형 + 피처임포턴스 이미지박스
    R2_H = Inches(1.95)

    # Position 버튼 4개 (세로)
    BTN_W   = Inches(1.0)
    BTN_H   = Inches(0.40)
    BTN_GAP = Inches(0.07)
    for i in range(4):
        by = ry + i * (BTN_H + BTN_GAP)
        _rounded(slide, RX, by, BTN_W, BTN_H, C_BTN)
        _text(slide, f"Position {i+1}",
              RX, by + Inches(0.07), BTN_W, BTN_H - Inches(0.07),
              size=9, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)

    # 웨이퍼맵 원형
    WAFER_D = Inches(1.55)
    WX = RX + BTN_W + Inches(0.15)
    WY = ry + (R2_H - WAFER_D) / 2
    _oval(slide, WX, WY, WAFER_D, WAFER_D, C_WAFER)
    _text(slide, "웨이퍼맵",
          WX, WY + WAFER_D / 2 - Inches(0.18), WAFER_D, Inches(0.36),
          size=10, bold=True, color=C_WHITE, align=PP_ALIGN.CENTER)

    # 피처임포턴스 이미지박스 (이미지 박스, 텍스트와 완전 분리)
    FI_X = WX + WAFER_D + Inches(0.15)
    FI_W = RX + RW - FI_X
    _imgbox(slide, FI_X, ry, FI_W, R2_H,
            "피처 임포턴스\n(정상 vs 불량)",
            img_path=graphs.get("feature_dist"))

    ry += R2_H + Inches(0.10)

    # R3. X1056, X567 분석 요청 ── 텍스트 카드 (이미지박스와 완전 분리)
    R3_H = BODY_Y + BODY_H - ry - Inches(0.05)
    wafer_str = (f"LOT {top_wafer.get('lot', '-')} - WF {top_wafer.get('wafer', '-')}"
                 f"  (HIGH {top_wafer.get('high_count', '-')}건)")
    _card(slide, RX, ry, RW, R3_H,
          lines=[
              "X1056, X567 para 불량 분석 요청",
              f"  집중 LOT: {top_lot}   |   집중 웨이퍼: {wafer_str}",
              "  → inline 참원인 분석 요청  (PI 엔지니어 확인 필요)",
          ],
          size=9)

    # ── 푸터 ──────────────────────────────────────────────────
    FTR_Y = H - Inches(0.32)
    _rect(slide, 0, FTR_Y, W, Inches(0.32), C_FOOTER,
          line_color=C_BORDER, line_pt=0.5)
    _text(slide,
          f"{today_str}  ·  {model_nm}  ·  불량 임계값 y_pred ≥ 0.003412",
          Inches(0.2), FTR_Y + Inches(0.05), Inches(5.5), Inches(0.24),
          size=8, color=C_SUB)
    _text(slide,
          "Field Health Prediction Model v1.0  ·  WT Quality Analysis  ·  Page 1 of 1",
          Inches(4.5), FTR_Y + Inches(0.05), Inches(5), Inches(0.24),
          size=8, color=C_SUB, align=PP_ALIGN.CENTER)
    _text(slide,
          "We Do Technology  |  SK hynix",
          Inches(10.5), FTR_Y + Inches(0.05), Inches(2.6), Inches(0.24),
          size=8, color=C_SUB, align=PP_ALIGN.RIGHT)

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf.read()


def markdown_to_pptx(markdown: str) -> bytes:
    """하위 호환용."""
    return build_pptx({
        "meta": {"title": "Field Health 불량 예측 분석 보고서"},
        "scan": {}, "importance": {}, "analysis": {}, "actions": [],
    })


def build_html(report_data: dict) -> str:
    """
    Chart.js 기반 HTML 보고서 (미리보기 작업본).
    데이터를 JSON으로 embed → 브라우저가 Chart.js로 직접 렌더링.
    수정 완료 후 PPT 버튼으로 PPTX 출력.
    """
    import json as _json
    from tools import get_lot_trend_data

    meta         = report_data.get("meta", {})
    scan         = report_data.get("scan", {})
    importance   = report_data.get("importance", {})
    analysis     = report_data.get("analysis", {})
    features     = importance.get("features", [])
    top_features = analysis.get("top_features", [])
    compare_grp  = analysis.get("compare_group", "MED")

    # 차트 수정 파라미터 (UPDATE_CHART 명령에서 전달)
    chart_params = report_data.get("chart_params", {})
    shap_top_n   = int(chart_params.get("top_n", 15)) if chart_params.get("chart") == "shap" else 15
    lot_top_n    = int(chart_params.get("top_n", 20)) if chart_params.get("chart") == "lot"  else 20
    dist_top_n   = int(chart_params.get("top_n", 5))  if chart_params.get("chart") == "dist" else 5

    val_rmse  = meta.get("val_rmse",  "0.005736")
    test_rmse = meta.get("test_rmse", "0.008427")
    model_nm  = meta.get("model",     "Two-Stage Model")
    title     = meta.get("title",     "Field Health 불량 예측 분석 보고서")
    today     = datetime.now()
    today_str = today.strftime("%Y년 %m월 %d일")
    pred_str  = (today + timedelta(days=60)).strftime("%Y년 %m월 %d일")

    scan_total = scan.get("total_units", "-")
    scan_high  = scan.get("high_count",  "-")
    scan_ratio = scan.get("high_ratio",  "-")
    top_lot    = scan.get("top_lot",     "-")
    top_wafer  = scan.get("top_wafer",   {})
    wafer_str  = (f"LOT {top_wafer.get('lot','-')} - WF {top_wafer.get('wafer','-')}"
                  f" (HIGH {top_wafer.get('high_count','-')}건)")

    # ── Chart.js 데이터 준비 ────────────────────────────────────

    # SHAP / Feature Importance 차트 (수평 막대)
    shap_labels = [f.get("feature", "") for f in features[:shap_top_n]]
    shap_gains  = [f.get("lgbm_gain", 0) or 0 for f in features[:shap_top_n]]
    # 내림차순
    paired = sorted(zip(shap_gains, shap_labels), reverse=True)
    shap_gains  = [p[0] for p in paired]
    shap_labels = [p[1] for p in paired]
    max_gain = max(shap_gains, default=1) or 1
    shap_colors = ["#EF4444" if g == max_gain else "#3B82F6" for g in shap_gains]

    # LOT 불량 트렌드 차트
    try:
        lot_data = get_lot_trend_data(top_n=lot_top_n)
    except Exception:
        lot_data = {"labels": [], "high": [], "med": [], "low": []}

    # 피처 분포 비교 (HIGH vs compare_grp) — 상위 N개 feature, 평균값 비교 막대
    dist_labels = [f.get("feature", "") for f in top_features[:dist_top_n]]
    dist_high   = [f.get("high_mean", 0) or 0 for f in top_features[:dist_top_n]]
    dist_low    = [f.get("low_mean",  0) or 0 for f in top_features[:dist_top_n]]

    # JSON 직렬화
    j_shap_labels  = _json.dumps(shap_labels,  ensure_ascii=False)
    j_shap_gains   = _json.dumps(shap_gains)
    j_shap_colors  = _json.dumps(shap_colors)
    j_lot_labels   = _json.dumps(lot_data["labels"], ensure_ascii=False)
    j_lot_high     = _json.dumps(lot_data["high"])
    j_lot_med      = _json.dumps(lot_data["med"])
    j_lot_low      = _json.dumps(lot_data["low"])
    j_dist_labels  = _json.dumps(dist_labels, ensure_ascii=False)
    j_dist_high    = _json.dumps(dist_high)
    j_dist_low     = _json.dumps(dist_low)

    # SHAP 분석 결과 테이블 행
    shap_rows = ""
    for f in top_features[:5]:
        fname  = f.get("feature", "")
        h_mean = f.get("high_mean", 0)
        l_mean = f.get("low_mean",  0)
        ratio  = f.get("ratio")
        pval   = f.get("pval", 1)
        r_str  = f"{ratio:.2f}x" if ratio else "-"
        shap_rows += f"""
        <tr>
          <td><strong>{fname}</strong></td>
          <td>{h_mean:.4f}</td>
          <td>{l_mean:.4f}</td>
          <td style="color:#EF4444;font-weight:600">{r_str}</td>
          <td>{pval:.4f}</td>
        </tr>"""

    # 피처 임포턴스 테이블 행
    fi_rows = ""
    for i, f in enumerate(features[:10]):
        fname = f.get("feature", "")
        gain  = f.get("lgbm_gain", 0) or 0
        pct   = int(gain / max_gain * 100)
        fi_rows += f"""
        <tr>
          <td style="color:#64748B;font-size:11px">{i+1}</td>
          <td><strong>{fname}</strong></td>
          <td>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:{pct}%;max-width:120px;height:10px;
                          background:#3B82F6;border-radius:3px;min-width:4px"></div>
              <span style="font-size:11px;color:#64748B">{gain:.0f}</span>
            </div>
          </td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
          background:#F1F5F9; color:#1E293B; font-size:12px; }}
  .page {{
    width:1200px; margin:0 auto; background:#fff;
    box-shadow:0 4px 24px rgba(0,0,0,.12);
  }}
  .hdr {{
    background:#1E3A5F; padding:12px 20px;
    display:flex; align-items:center; justify-content:space-between;
  }}
  .hdr-title {{ color:#fff; font-size:20px; font-weight:700; }}
  .badge-secret {{
    background:#EF4444; color:#fff; font-size:10px; font-weight:700;
    padding:4px 10px; border-radius:5px;
  }}
  .sub {{
    background:#EFF6FF; padding:8px 20px; text-align:center;
    border-bottom:1px solid #BFDBFE;
  }}
  .sub-main {{ color:#EF4444; font-weight:700; font-size:11px; }}
  .sub-detail {{ color:#1E3A5F; font-size:10px; margin-top:3px; }}
  .tabs {{
    display:grid; grid-template-columns:1fr 1fr; gap:6px;
    padding:8px 12px; background:#F8FAFC;
    border-bottom:1px solid #E2E8F0;
  }}
  .tab {{
    background:#2A4A6F; color:#fff; text-align:center;
    padding:6px; border-radius:6px; font-size:12px; font-weight:700;
  }}
  .body {{
    display:grid; grid-template-columns:1fr 1fr; gap:10px;
    padding:10px 12px;
  }}
  .card {{
    background:#fff; border:1px solid #CBD5E1; border-radius:7px;
    padding:10px 12px; margin-bottom:8px;
  }}
  .card-label {{
    font-size:10px; color:#64748B; margin-bottom:6px; font-weight:600;
  }}
  .card-value {{ font-size:12px; color:#1E293B; line-height:1.6; }}
  .chart-box {{
    background:#F8FAFC; border:1px solid #CBD5E1; border-radius:7px;
    overflow:hidden; margin-bottom:8px;
  }}
  .chart-box-label {{
    font-size:10px; color:#64748B; padding:5px 10px;
    border-bottom:1px solid #E2E8F0; background:#F8FAFC;
    font-weight:600;
  }}
  .chart-box-content {{ padding:8px; position:relative; }}
  table {{ width:100%; border-collapse:collapse; font-size:11px; }}
  th {{
    background:#1E3A5F; color:#fff; padding:6px 8px;
    text-align:left; font-weight:600;
  }}
  td {{ padding:5px 8px; border-bottom:1px solid #E2E8F0; }}
  tr:nth-child(even) td {{ background:#F8FAFC; }}
  .pos-grid {{
    display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-bottom:8px;
  }}
  .pos-btn {{
    background:#3B82F6; color:#fff; text-align:center;
    padding:7px 4px; border-radius:6px; font-size:11px; font-weight:600;
    cursor:pointer;
  }}
  .wafer-circle {{
    width:76px; height:76px; border-radius:50%;
    background:#60A5FA; display:flex; align-items:center; justify-content:center;
    color:#fff; font-size:11px; font-weight:700; margin:0 auto;
  }}
  .ftr {{
    background:#F1F5F9; border-top:1px solid #E2E8F0;
    padding:8px 20px; display:flex; justify-content:space-between;
    font-size:10px; color:#64748B;
  }}
</style>
</head>
<body>
<div class="page">

  <!-- 헤더 -->
  <div class="hdr">
    <span class="hdr-title">{title}</span>
    <span class="badge-secret">대외비</span>
  </div>

  <!-- 부제목 -->
  <div class="sub">
    <div class="sub-main">예측 불량 비율 임계값 y_pred ≥ 0.003412 (train 실제 불량률 29.2% 기준 역산) · Val RMSE {val_rmse}</div>
    <div class="sub-detail">{model_nm} · Val RMSE {val_rmse} · Test RMSE {test_rmse} · 상위 5개 피처 SHAP 분석 및 공정 개선 방안 수립</div>
  </div>

  <!-- 섹션 탭 -->
  <div class="tabs">
    <div class="tab">[ Modeling 현황 ]</div>
    <div class="tab">[ 불량 Unit 분석 현황 ]</div>
  </div>

  <!-- 본문 2컬럼 -->
  <div class="body">

    <!-- ── 왼쪽: Modeling 현황 ── -->
    <div>

      <!-- L1: 분석시점/예측시점 -->
      <div class="card" data-section="분석시점/예측시점">
        <div class="card-value">
          분석시점 : {today_str} &nbsp;|&nbsp; 예측시점 : {pred_str}
          &nbsp;|&nbsp; 총 Unit: {scan_total}개 &nbsp; HIGH 위험: {scan_high}건 ({scan_ratio}%)
        </div>
      </div>

      <!-- L2: 모델링 결과 -->
      <div class="card" data-section="모델링 결과">
        <div class="card-label">모델링 결과</div>
        <div class="card-value">
          {model_nm} &nbsp;|&nbsp; Val RMSE: <strong style="color:#16A34A">{val_rmse}</strong>
          &nbsp;|&nbsp; Test RMSE: {test_rmse} &nbsp;|&nbsp; 집중 LOT: {top_lot}
        </div>
      </div>

      <!-- L3: SHAP Value Trend Graph (Chart.js 수평 막대) -->
      <div class="chart-box" data-section="SHAP Value Trend Graph">
        <div class="chart-box-label">SHAP Value Trend Graph (Feature Importance)</div>
        <div class="chart-box-content" style="height:220px">
          <canvas id="shapChart"></canvas>
        </div>
      </div>

      <!-- L4: SHAP분석 결과 텍스트 테이블 (차트와 완전 분리) -->
      <div class="card" data-section="SHAP분석 결과">
        <div class="card-label">SHAP분석 결과 (HIGH vs {compare_grp})</div>
        <table>
          <thead>
            <tr>
              <th>Feature</th><th>HIGH 평균</th><th>{compare_grp} 평균</th>
              <th>배율</th><th>p-value</th>
            </tr>
          </thead>
          <tbody>{shap_rows}</tbody>
        </table>
      </div>

      <!-- L5: Model RMSE -->
      <div class="card" data-section="Model RMSE">
        <div class="card-label">Model RMSE</div>
        <div class="card-value" style="font-size:14px;font-weight:700;color:#1E3A5F">
          Val {val_rmse} &nbsp;|&nbsp; Test {test_rmse}
        </div>
      </div>

    </div>

    <!-- ── 오른쪽: 불량 Unit 분석 현황 ── -->
    <div>

      <!-- R1: LOT 불량 트렌드 (Chart.js 스택 막대) -->
      <div class="chart-box" data-section="LOT 불량 트렌드">
        <div class="chart-box-label">LOT 불량 트렌드 그래프 (Val 데이터 기준)</div>
        <div class="chart-box-content" style="height:195px">
          <canvas id="lotChart"></canvas>
        </div>
      </div>

      <!-- R2: Position 버튼 + 웨이퍼맵 + 피처 분포 차트 -->
      <div style="display:grid;grid-template-columns:auto 1fr 1.4fr;gap:8px;margin-bottom:8px"
           data-section="Position/웨이퍼맵/피처분포">

        <!-- Position 버튼 4개 -->
        <div class="pos-grid" style="width:110px">
          <div class="pos-btn">Position 1</div>
          <div class="pos-btn">Position 2</div>
          <div class="pos-btn">Position 3</div>
          <div class="pos-btn">Position 4</div>
        </div>

        <!-- 웨이퍼맵 -->
        <div style="display:flex;align-items:center;justify-content:center">
          <div class="wafer-circle">웨이퍼맵</div>
        </div>

        <!-- 피처 분포 비교 차트 (Chart.js) -->
        <div class="chart-box" style="margin-bottom:0" data-section="피처 분포 (HIGH vs {compare_grp})">
          <div class="chart-box-label">피처 분포 (HIGH vs {compare_grp})</div>
          <div class="chart-box-content" style="height:95px">
            <canvas id="distChart"></canvas>
          </div>
        </div>

      </div>

      <!-- R3: 피처 임포턴스 테이블 -->
      <div class="card" data-section="피처 임포턴스">
        <div class="card-label">피처 임포턴스 Top 10 (정상 vs 불량 그룹 분포차이)</div>
        <table>
          <thead>
            <tr><th>#</th><th>Feature</th><th>Gain</th></tr>
          </thead>
          <tbody>{fi_rows}</tbody>
        </table>
      </div>

      <!-- R4: 분석 요청 텍스트 -->
      <div class="card" data-section="X1056/X567 분석 요청">
        <div class="card-label">X1056, X567 para 불량 분석 요청</div>
        <div class="card-value">
          집중 LOT: {top_lot} &nbsp;|&nbsp; 집중 웨이퍼: {wafer_str}<br>
          → inline 참원인 분석 요청 (PI 엔지니어 확인 필요)
        </div>
      </div>

    </div>
  </div><!-- /body -->

  <!-- 푸터 -->
  <div class="ftr">
    <span>{today_str} · {model_nm} · 불량 임계값 y_pred ≥ 0.003412</span>
    <span>Field Health Prediction Model v1.0 · WT Quality Analysis · Page 1 of 1</span>
    <span>We Do Technology | SK hynix</span>
  </div>

</div>

<script>
// ── 공통 옵션 ─────────────────────────────────────────────────
Chart.defaults.font.family = "'Malgun Gothic','Apple SD Gothic Neo',sans-serif";
Chart.defaults.font.size   = 11;
Chart.defaults.color       = '#1E293B';

// ── 1. SHAP Value Trend (수평 막대) ────────────────────────────
(function() {{
  var labels = {j_shap_labels};
  var gains  = {j_shap_gains};
  var colors = {j_shap_colors};
  if (!labels.length) return;
  var ctx = document.getElementById('shapChart');
  if (!ctx) return;
  new Chart(ctx, {{
    type: 'bar',
    data: {{
      labels: labels,
      datasets: [{{
        label: 'SHAP Gain',
        data: gains,
        backgroundColor: colors,
        borderRadius: 3,
        barPercentage: 0.7,
      }}]
    }},
    options: {{
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {{
        legend: {{ display: false }},
        tooltip: {{
          callbacks: {{
            label: function(c) {{ return ' Gain: ' + c.raw.toFixed(0); }}
          }}
        }}
      }},
      scales: {{
        x: {{
          grid: {{ color: '#E5E7EB', lineWidth: 0.7 }},
          ticks: {{ color: '#64748B', font: {{ size: 10 }} }}
        }},
        y: {{
          grid: {{ display: false }},
          ticks: {{ color: '#1E293B', font: {{ size: 10 }} }}
        }}
      }}
    }}
  }});
}})();

// ── 2. LOT 불량 트렌드 (스택 막대) ────────────────────────────
(function() {{
  var labels = {j_lot_labels};
  var high   = {j_lot_high};
  var med    = {j_lot_med};
  var low    = {j_lot_low};
  if (!labels.length) return;
  var ctx = document.getElementById('lotChart');
  if (!ctx) return;
  new Chart(ctx, {{
    type: 'bar',
    data: {{
      labels: labels,
      datasets: [
        {{ label: 'HIGH', data: high, backgroundColor: '#EF4444', borderRadius: 2 }},
        {{ label: 'MED',  data: med,  backgroundColor: '#3B82F6', borderRadius: 2 }},
        {{ label: 'LOW',  data: low,  backgroundColor: '#86EFAC', borderRadius: 2 }},
      ]
    }},
    options: {{
      responsive: true,
      maintainAspectRatio: false,
      plugins: {{
        legend: {{
          display: true,
          position: 'top',
          labels: {{ boxWidth: 12, padding: 8, font: {{ size: 10 }} }}
        }}
      }},
      scales: {{
        x: {{
          stacked: true,
          grid: {{ display: false }},
          ticks: {{ color: '#64748B', font: {{ size: 9 }}, maxRotation: 40 }}
        }},
        y: {{
          stacked: true,
          grid: {{ color: '#E5E7EB', lineWidth: 0.7 }},
          ticks: {{ color: '#64748B', font: {{ size: 10 }} }}
        }}
      }}
    }}
  }});
}})();

// ── 3. 피처 분포 비교 (HIGH vs {compare_grp}) ─────────────────
(function() {{
  var labels = {j_dist_labels};
  var high   = {j_dist_high};
  var low    = {j_dist_low};
  if (!labels.length) return;
  var ctx = document.getElementById('distChart');
  if (!ctx) return;
  new Chart(ctx, {{
    type: 'bar',
    data: {{
      labels: labels,
      datasets: [
        {{ label: 'HIGH', data: high, backgroundColor: 'rgba(239,68,68,0.8)',  borderRadius: 3 }},
        {{ label: '{compare_grp}', data: low, backgroundColor: 'rgba(59,130,246,0.8)', borderRadius: 3 }},
      ]
    }},
    options: {{
      responsive: true,
      maintainAspectRatio: false,
      plugins: {{
        legend: {{
          display: true,
          position: 'top',
          labels: {{ boxWidth: 10, padding: 6, font: {{ size: 9 }} }}
        }}
      }},
      scales: {{
        x: {{
          grid: {{ display: false }},
          ticks: {{ color: '#64748B', font: {{ size: 9 }} }}
        }},
        y: {{
          grid: {{ color: '#E5E7EB', lineWidth: 0.7 }},
          ticks: {{ color: '#64748B', font: {{ size: 9 }} }}
        }}
      }}
    }}
  }});
}})();
</script>
</body>
</html>"""

    return html
