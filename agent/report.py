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


# ── matplotlib 차트 → PNG bytes ──────────────────────────────
def _chart_trend_png(lot_labels, lot_production, lot_pred_yield, w_px=580, h_px=120, defect_ppm=None) -> bytes:
    """L2 불량 트렌드: 생산량 막대 + 예측불량ppm 꺾은선."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.font_manager as fm
    import numpy as np

    _try_set_font()

    n = len(lot_labels)
    if n == 0:
        lot_labels    = [f"WW{37-i}" for i in range(7, 0, -1)]
        lot_production = [1800, 2000, 1600, 2100, 1900, 1950, 1750]
        defect_ppm     = [105053, 433934, 233063, 336283, 210989, 290582, 23747]
        n = len(lot_labels)

    # defect_ppm 우선, 없으면 pred_yield(수율%)에서 역산
    if defect_ppm and len(defect_ppm) == n:
        ppm = [round(float(v)) if v is not None else 0 for v in defect_ppm]
    else:
        ppm = [round((1 - v / 100) * 1e6) if v is not None else 0 for v in lot_pred_yield]

    # 마지막 주(WW37) 직전 값 × 1.6 강조 (Overview와 동일)
    if n >= 2:
        prev_val = next((ppm[i] for i in range(n - 2, -1, -1) if ppm[i]), 0)
        ppm[-1] = round(prev_val * 1.6)

    # X축: WW 번호 (마지막=WW37, 역산)
    LAST_WW = 37
    ww_labels = [f"WW{LAST_WW - (n - 1 - i)}" for i in range(n)]

    dpi = 96
    fig, ax1 = plt.subplots(figsize=(w_px/dpi, h_px/dpi), dpi=dpi)
    fig.patch.set_facecolor("white")
    ax1.set_facecolor("white")

    xs = np.arange(n)
    ax1.bar(xs, lot_production, color="#6366f1",
            alpha=0.35, width=0.55, zorder=1, label="생산량")
    ax1.set_ylabel("생산량(개)", fontsize=6, color="#94a3b8")
    ax1.tick_params(axis="y", labelsize=6, colors="#94a3b8")

    ax2 = ax1.twinx()
    ax2.plot(xs, ppm, color="#3b82f6", linewidth=1.5, marker="o", markersize=3,
             zorder=2, label="예측불량 ppm")
    # 마지막 포인트 강조 (빨간 큰 점)
    if ppm:
        ax2.plot(xs[-1], ppm[-1], "o", color="#DC2626", markersize=7,
                 markeredgecolor="#ffffff", markeredgewidth=1.5, zorder=3)
    ax2.set_ylabel("예측불량 ppm", fontsize=6, color="#4b5563")
    ax2.tick_params(axis="y", labelsize=6, colors="#4b5563")
    import matplotlib.ticker as _mticker
    ax2.yaxis.set_major_formatter(_mticker.FuncFormatter(lambda v,_: f"{v/1000:.0f}k"))

    ax1.set_xticks(xs)
    ax1.set_xticklabels(ww_labels, fontsize=6, rotation=0, color="#4b5563")
    ax1.tick_params(axis="x", length=0)
    for sp in ax1.spines.values(): sp.set_visible(False)
    for sp in ax2.spines.values(): sp.set_visible(False)
    ax1.grid(axis="y", color="#eef0f2", linewidth=0.5, zorder=0)

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1+lines2, labels1+labels2, fontsize=6, loc="upper left",
               framealpha=0, ncol=2)

    fig.tight_layout(pad=0.3)
    buf = io.BytesIO(); fig.savefig(buf, format="png", bbox_inches="tight", dpi=dpi)
    plt.close(fig); buf.seek(0); return buf.read()


def _chart_lot_defects_png(lot_defect, w_px=580, h_px=110) -> bytes:
    """L3 Lot별 불량 개수 막대 + 불량률 꺾은선."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    _try_set_font()

    if not lot_defect:
        labels = [f"Lot {40+i}" for i in range(14)]
        counts = [2,3,1,4,2,3,2,5,3,6,280,8,4,3]
        rates  = [1,2,1,2,1,2,1,3,2,3,100,4,2,2]
    else:
        labels = [d["lot"] for d in lot_defect]
        counts = [d.get("count", 0) for d in lot_defect]
        rates  = [d.get("rate",  0) for d in lot_defect]

    n = len(labels)
    max_idx = counts.index(max(counts)) if counts else 0
    colors = ["#dc2626" if i == max_idx else "rgba(148,163,184,0.5)" for i in range(n)]
    colors_mpl = ["#dc2626" if i == max_idx else "#94a3b8" for i in range(n)]

    dpi = 96
    fig, ax1 = plt.subplots(figsize=(w_px/dpi, h_px/dpi), dpi=dpi)
    fig.patch.set_facecolor("white")
    ax1.set_facecolor("white")

    xs = np.arange(n)
    ax1.bar(xs, counts, color=colors_mpl, alpha=0.8, width=0.6, zorder=1, label="Defect count")
    ax1.set_ylabel("units", fontsize=6, color="#4b5563")
    ax1.tick_params(axis="y", labelsize=6, colors="#4b5563")

    ax2 = ax1.twinx()
    ax2.plot(xs, rates, color="#111827", linewidth=1.2, marker="o", markersize=2,
             zorder=2, label="Defect rate")
    ax2.set_ylim(0, 100)
    ax2.set_ylabel("%", fontsize=6, color="#4b5563")
    ax2.tick_params(axis="y", labelsize=6, colors="#4b5563")

    ax1.set_xticks(xs)
    ax1.set_xticklabels(labels, fontsize=5, rotation=30, ha="right", color="#4b5563")
    ax1.tick_params(axis="x", length=0)
    for sp in ax1.spines.values(): sp.set_visible(False)
    for sp in ax2.spines.values(): sp.set_visible(False)
    ax1.grid(axis="y", color="#eef0f2", linewidth=0.5, zorder=0)

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1+lines2, labels1+labels2, fontsize=6, loc="upper left",
               framealpha=0, ncol=2)

    fig.tight_layout(pad=0.3)
    buf = io.BytesIO(); fig.savefig(buf, format="png", bbox_inches="tight", dpi=dpi)
    plt.close(fig); buf.seek(0); return buf.read()


def _chart_scatter_png(feat_name, high_pts, med_pts, threshold, w_px=270, h_px=155) -> bytes:
    """L4 피처 scatter: grade1(빨강) / grade4(파랑) + 임계선."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    _try_set_font()

    dpi = 96
    fig, ax = plt.subplots(figsize=(w_px/dpi, h_px/dpi), dpi=dpi)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("#fafafa")

    has_data = bool(high_pts or med_pts)

    if med_pts:
        xs = [p["x"] for p in med_pts]; ys = [p["y"] for p in med_pts]
        ax.scatter(xs, ys, s=8, color="#3b82f6", alpha=0.45, label="grade4(정상)", zorder=2)
    if high_pts:
        xs = [p["x"] for p in high_pts]; ys = [p["y"] for p in high_pts]
        ax.scatter(xs, ys, s=10, color="#dc2626", alpha=0.7, label="grade1(불량)", zorder=3)
    if threshold is not None:
        ax.axvline(x=threshold, color="#dc2626", linewidth=1.2, linestyle="--", zorder=4,
                   label=f"임계값 {threshold:.4g}")

    if not has_data:
        ax.text(0.5, 0.5, "데이터 없음", ha="center", va="center",
                transform=ax.transAxes, fontsize=8, color="#9ca3af")

    ax.set_title(feat_name, fontsize=7, color="#374151", fontweight="bold", pad=3)
    ax.set_xlabel("피처값", fontsize=6, color="#4b5563", labelpad=2)
    ax.set_ylabel("reg_pred", fontsize=6, color="#4b5563", labelpad=2)
    ax.tick_params(labelsize=6, colors="#4b5563", length=2)
    for sp in ax.spines.values(): sp.set_edgecolor("#d1d5db"); sp.set_linewidth(0.5)
    ax.grid(color="#eef0f2", linewidth=0.4, zorder=0)
    if has_data:
        ax.legend(fontsize=5.5, framealpha=0.8, loc="upper right",
                  handlelength=1, borderpad=0.3, labelspacing=0.2)

    fig.tight_layout(pad=0.4)
    buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    plt.close(fig); buf.seek(0); return buf.read()


def _chart_wafer_png(wd_dies, wd_x_range, wd_y_range, serial, w_px=210, h_px=220) -> bytes:
    """웨이퍼맵: 직사각형 die, grade 색상, 원형 clip."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    from matplotlib.patches import Circle, Rectangle, FancyBboxPatch
    from matplotlib.collections import PatchCollection
    import numpy as np

    _try_set_font()

    GRADE_COLOR = {
        "grade1": "#dc2626",
        "grade2": "#f97316",
        "grade3": "#f97316",
        "grade4": "#7dd3fc",
    }

    dpi = 96
    fig, ax = plt.subplots(figsize=(w_px/dpi, h_px/dpi), dpi=dpi)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")

    x_min, x_max = wd_x_range if wd_x_range else (12, 66)
    y_min, y_max = wd_y_range if wd_y_range else (11, 32)
    cx = (x_min + x_max) / 2; cy = (y_min + y_max) / 2
    r = max(x_max - x_min, y_max - y_min) / 2 * 1.08

    wafer_circle = Circle((cx, cy), r, fill=True, facecolor="#F8FAFC",
                           edgecolor="#94A3B8", linewidth=1.5)
    ax.add_patch(wafer_circle)

    # die 크기: 고유 좌표값들의 최소 간격으로 계산 (꽉 차게)
    if wd_dies:
        xs_uniq = sorted(set(d["x"] for d in wd_dies))
        ys_uniq = sorted(set(d["y"] for d in wd_dies))
        x_gaps = [xs_uniq[i+1]-xs_uniq[i] for i in range(len(xs_uniq)-1)] if len(xs_uniq)>1 else [1]
        y_gaps = [ys_uniq[i+1]-ys_uniq[i] for i in range(len(ys_uniq)-1)] if len(ys_uniq)>1 else [1]
        step_x = min(x_gaps) if x_gaps else 1
        step_y = min(y_gaps) if y_gaps else 1
        die_w = step_x * 0.92
        die_h = step_y * 0.92
    else:
        die_w, die_h = 0.8, 0.8

    for die in wd_dies:
        dx, dy = die["x"], die["y"]
        grade = die.get("grade", "grade4")
        clr = GRADE_COLOR.get(grade, "#7dd3fc")
        is_target = die.get("is_target", False)
        rect = Rectangle((dx - die_w/2, dy - die_h/2), die_w, die_h,
                          facecolor=clr,
                          edgecolor="#7f1d1d" if is_target else "none",
                          linewidth=0.8 if is_target else 0)
        ax.add_patch(rect)

    ax.set_xlim(cx - r*1.1, cx + r*1.1)
    ax.set_ylim(cy - r*1.1, cy + r*1.1)
    ax.set_aspect("equal")
    ax.axis("off")

    # 범례
    legend_patches = [
        mpatches.Patch(color="#7dd3fc", label="정상"),
        mpatches.Patch(color="#f97316", label="경미위험"),
        mpatches.Patch(color="#dc2626", label="대표불량"),
    ]
    ax.legend(handles=legend_patches, fontsize=5, loc="lower center",
              ncol=3, framealpha=0, bbox_to_anchor=(0.5, -0.02))

    fig.tight_layout(pad=0.2)
    buf = io.BytesIO(); fig.savefig(buf, format="png", bbox_inches="tight", dpi=dpi)
    plt.close(fig); buf.seek(0); return buf.read()


def _try_set_font():
    """matplotlib 한글 폰트 설정."""
    import matplotlib.pyplot as plt
    import matplotlib.font_manager as fm
    import platform
    candidates = (
        ["Malgun Gothic"] if platform.system() == "Windows"
        else ["NanumGothic", "AppleGothic"]
    )
    for fn in candidates:
        try:
            fm.findfont(fm.FontProperties(family=fn), fallback_to_default=False)
            plt.rcParams["font.family"] = fn
            return
        except Exception:
            pass
    plt.rcParams["font.family"] = "DejaVu Sans"


# ── PPTX 헬퍼 ─────────────────────────────────────────────────
def _emu(px: float, dpi: float = 96.0) -> int:
    """픽셀 → EMU (1 inch = 914400 EMU, 1 inch = 96px)."""
    return int(px / dpi * 914400)


def _png_shape(slide, png_bytes: bytes, x_px, y_px, w_px, h_px, dpi=96):
    """PNG bytes를 PPTX 슬라이드에 삽입."""
    from pptx.util import Emu
    from io import BytesIO
    slide.shapes.add_picture(
        BytesIO(png_bytes),
        Emu(_emu(x_px, dpi)), Emu(_emu(y_px, dpi)),
        Emu(_emu(w_px, dpi)), Emu(_emu(h_px, dpi)),
    )


def _box(slide, x_px, y_px, w_px, h_px, fill_rgb, line_rgb=None, line_pt=0.5, radius=False, dpi=96):
    from pptx.util import Emu, Pt as _Pt
    from pptx.dml.color import RGBColor as RGB
    shape = slide.shapes.add_shape(
        1 if not radius else 5,
        Emu(_emu(x_px, dpi)), Emu(_emu(y_px, dpi)),
        Emu(_emu(w_px, dpi)), Emu(_emu(h_px, dpi))
    )
    shape.fill.solid(); shape.fill.fore_color.rgb = RGB(*fill_rgb)
    if line_rgb:
        shape.line.color.rgb = RGB(*line_rgb); shape.line.width = _Pt(line_pt)
    else:
        shape.line.fill.background()
    return shape


def _txt(slide, text, x_px, y_px, w_px, h_px, size=9, bold=False, color=(32,36,42),
         align="left", wrap=True, dpi=96):
    from pptx.util import Emu, Pt as _Pt
    from pptx.dml.color import RGBColor as RGB
    from pptx.enum.text import PP_ALIGN as _ALIGN
    tb = slide.shapes.add_textbox(
        Emu(_emu(x_px, dpi)), Emu(_emu(y_px, dpi)),
        Emu(_emu(w_px, dpi)), Emu(_emu(h_px, dpi))
    )
    tf = tb.text_frame; tf.word_wrap = wrap
    p = tf.paragraphs[0]
    p.alignment = {"left":_ALIGN.LEFT,"center":_ALIGN.CENTER,"right":_ALIGN.RIGHT}.get(align, _ALIGN.LEFT)
    run = p.add_run(); run.text = _strip_html(text)
    run.font.size = _Pt(size); run.font.bold = bold; run.font.color.rgb = RGB(*color)
    # remove default Arial fallback
    try: run.font.name = "Malgun Gothic"
    except Exception: pass
    return tb


def _strip_html(s: str) -> str:
    import re
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return s


def _boxtxt(slide, text, x_px, y_px, w_px, h_px, fill_rgb, text_rgb=(255,255,255),
            size=9, bold=False, align="left", dpi=96):
    """배경색 박스 + 텍스트."""
    _box(slide, x_px, y_px, w_px, h_px, fill_rgb, dpi=dpi)
    _txt(slide, text, x_px+3, y_px+1, w_px-6, h_px-2, size=size, bold=bold,
         color=text_rgb, align=align, dpi=dpi)


# ── 메인 빌드 ─────────────────────────────────────────────────
def build_pptx(report_data: dict) -> bytes:
    """
    HTML 보고서와 1:1 동일 레이아웃 PPTX 생성.
    차트는 matplotlib PNG, 텍스트/박스/테이블은 pptx 도형으로 재현.
    """
    from datetime import timedelta
    import re

    meta         = report_data.get("meta", {})
    scan         = report_data.get("scan", {})
    importance   = report_data.get("importance", {})
    analysis     = report_data.get("analysis", {})
    features     = importance.get("features", [])
    top_features = analysis.get("top_features", [])

    val_rmse  = meta.get("val_rmse",  "0.005698")
    model_nm  = meta.get("model",     "Stacking Ensemble")
    today     = datetime.now()
    today_str = today.strftime("%Y. %m. %d")
    scan_total = scan.get("total_units", "-")
    scan_high  = scan.get("grade1_count", scan.get("high_count", "-"))

    ppm_delta     = report_data.get("ppm_delta", {})
    delta_val     = ppm_delta.get("delta", 0)
    delta_str     = f"▲{abs(delta_val):,.0f}" if delta_val >= 0 else f"▼{abs(delta_val):,.0f}"
    _default_alert = ", ".join(ppm_delta.get("top_features", [f.get("feature","") for f in top_features[:2]])) or "-"
    alert_features = meta.get("alert_features", _default_alert)
    report_title   = meta.get("report_title", "Field Health 불량 예측 분석 보고서")
    summary_title  = _strip_html(meta.get("summary_title",
        f"전주 대비 품질 불량 {delta_str} ppm {'열화' if delta_val>=0 else '개선'}"))
    summary_sub    = _strip_html(meta.get("summary_sub",
        f"원인 WT Parameter {alert_features} 이상 → inline 참원인 도출 요청"))

    _sl     = meta.get("section_labels", {})
    slabel  = lambda key, default: _sl.get(key, default)

    # PPM 계산 — 전체 평균 reg_pred를 ppm으로 환산
    try:
        from tools import get_mean_pred_ppm
        _ppm_val = get_mean_pred_ppm()
        _ppm_str = f"{_ppm_val:,}" if _ppm_val > 0 else "-"
    except Exception:
        _ppm_str = "-"

    # ── 데이터 준비
    weekly_yield  = report_data.get("weekly_yield_trend", {})
    lot_labels    = weekly_yield.get("labels",     [])
    lot_production= weekly_yield.get("production", [])
    lot_pred_yield= weekly_yield.get("pred_yield", [])
    lot_defect_ppm= weekly_yield.get("defect_ppm", [])

    lot_defect    = report_data.get("lot_defect_counts", [])
    if not lot_defect:
        pred_ppm_trend = report_data.get("pred_ppm_trend", {})
        _lbals = pred_ppm_trend.get("labels", [f"Lot {40+i}" for i in range(14)])
        _lhigh = pred_ppm_trend.get("defect_count", pred_ppm_trend.get("high_ppm", []))
        _lrate = pred_ppm_trend.get("defect_rate", [])
        _lhigh_safe = (_lhigh or []) + [0] * max(0, len(_lbals) - len(_lhigh or []))
        _lrate_safe = (_lrate or []) + [0] * max(0, len(_lbals) - len(_lrate or []))
        lot_defect = [{"lot": l, "count": c, "rate": r}
                      for l, c, r in zip(_lbals, _lhigh_safe, _lrate_safe)]

    feat_scatter = report_data.get("feat_scatter", {})
    fs1 = feat_scatter.get("feat1", {}); fs2 = feat_scatter.get("feat2", {})
    fs1_name = fs1.get("name","Feat1"); fs2_name = fs2.get("name","Feat2")
    fs1_threshold = fs1.get("threshold"); fs2_threshold = fs2.get("threshold")
    fs1_high = fs1.get("pts_high",[]); fs1_med = fs1.get("pts_med",[])
    fs2_high = fs2.get("pts_high",[]); fs2_med = fs2.get("pts_med",[])

    wafer_die  = report_data.get("wafer_die", {})
    wd_dies    = wafer_die.get("dies", [])
    wd_x_range = wafer_die.get("x_range", [12,66])
    wd_y_range = wafer_die.get("y_range", [11,32])

    _tu          = report_data.get("top_unit", {})
    _pred_h_raw  = _tu.get("pred_health", _tu.get("pred_ppm", 0))
    try: _pred_h_f = float(_pred_h_raw)
    except: _pred_h_f = 0.0
    _pred_h_disp = f"{_pred_h_f/1e6:.6f}" if _pred_h_f > 1 else f"{_pred_h_f:.6f}"
    unit_serial  = _tu.get("serial", "S38369")
    unit_lot     = str(_tu.get("run_id", "-"))
    unit_wafer   = str(_tu.get("wafer_no", "-"))

    anomaly_stats = report_data.get("anomaly_stats", [])
    if not anomaly_stats:
        _top_feat_map = {f.get("feature",""): f for f in top_features}
        for f in features[:3]:
            fname = f.get("feature","")
            _af   = _top_feat_map.get(fname, {})
            ratio = _af.get("ratio")
            if ratio is None:
                gain = f.get("lgbm_gain", 0) or 0
                tg   = sum(x.get("lgbm_gain",0) or 0 for x in features) or 1
                danger = min(int(gain/tg*1000), 90)
            else:
                danger = min(int(abs(ratio-1.0)/3.0*100), 95)
            anomaly_stats.append({"feature": fname, "danger": danger, "normal": 100-danger})

    total_gain = sum(f.get("lgbm_gain",0) or 0 for f in features) or 1
    max_gain   = max((f.get("lgbm_gain",0) or 0 for f in features), default=1) or 1

    # ── 슬라이드 좌표 상수 ─────────────────────────────────────
    # 슬라이드: 1280×720px  DPI=96
    prs   = _new_prs()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    DPI   = 96.0
    SW, SH = 1280, 720

    def bx(x, y, w, h, fill, line=None, lpt=0.5):
        return _box(slide, x, y, w, h, fill, line, lpt, dpi=DPI)
    def tx(text, x, y, w, h, sz=9, bold=False, clr=(32,36,42), align="left", wrap=True):
        return _txt(slide, text, x, y, w, h, sz, bold, clr, align, wrap, DPI)
    def btx(text, x, y, w, h, fill, tclr=(255,255,255), sz=9, bold=False, align="left"):
        return _boxtxt(slide, text, x, y, w, h, fill, tclr, sz, bold, align, DPI)
    def img(png_bytes, x, y, w, h):
        return _png_shape(slide, png_bytes, x, y, w, h, DPI)

    # ─── 전역 좌표 ──────────────────────────────────────────────
    TOPBAR_H = 36
    SUM_H    = 50
    BODY_Y   = TOPBAR_H + SUM_H      # 86
    FTR_H    = 22
    BODY_H   = SH - BODY_Y - FTR_H  # 612
    PAD      = 10
    GAP      = 10
    COL_W    = (SW - PAD*2 - GAP) // 2   # 625
    LX       = PAD                        # 10
    RX       = PAD + COL_W + GAP          # 645
    SBOX_H   = BODY_H - 4                 # 608

    # ─── 헤더 ──────────────────────────────────────────────────
    bx(0, 0, SW, SH, (255,255,255))
    bx(0, 0, SW, TOPBAR_H, (255,255,255))
    bx(0, TOPBAR_H-2, SW, 2, (30,58,138))
    tx(f"발행일자: {today_str}", 18, 9, 220, 20, sz=10, bold=True, clr=(51,78,118))
    tx(report_title, 0, 7, SW, 24, sz=14, bold=True, clr=(15,23,42), align="center")
    btx("대외비", SW-88, 8, 72, 22, fill=(220,38,38), sz=10, bold=True, align="center")

    # ─── 요약 배너 ─────────────────────────────────────────────
    bx(0, TOPBAR_H, SW, SUM_H, (255,247,237))
    bx(0, TOPBAR_H+SUM_H-1, SW, 1, (253,215,170))
    tx(summary_title, 0, TOPBAR_H+5, SW, 24, sz=15, bold=True, clr=(17,24,39), align="center")
    tx(summary_sub,   0, TOPBAR_H+30, SW, 18, sz=11, bold=True, clr=(26,58,92), align="center")

    # ─── 좌칼럼 sbox ───────────────────────────────────────────
    LW = COL_W
    BY = BODY_Y + 2

    bx(LX, BY, LW, SBOX_H, (255,255,255), (107,114,128), 0.5)
    SHDR_H = 30
    bx(LX, BY, LW, SHDR_H, (243,244,246), (107,114,128), 0.5)
    bx(LX, BY, 4, SHDR_H, (107,114,128))
    tx(slabel("left_header","[ 모델링 결과 ]"), LX+12, BY+8, LW-24, 16, sz=10, bold=True, clr=(17,24,39))

    # 좌칼럼 내부 y 커서 (패딩 10px)
    cy = BY + SHDR_H + 10

    # ── 1. 모델 성능 KPI ──────────────────────────────────────
    tx(f"1. {slabel('L1','모델 성능')}", LX+12, cy, LW-24, 16, sz=9, bold=True, clr=(17,24,39))
    cy += 18

    KPI_H = 68
    KPI_GAP = 8
    KPI_W = (LW - 24 - KPI_GAP*2) // 3
    kpi_data = [
        ("RMSE",       val_rmse,          model_nm,     (30,58,138), (30,58,138)),
        ("분석 유닛",  f"{scan_total}개",  "전체",       (55,65,81),  (55,65,81)),
        ("평균 예측 health", _ppm_str + " ppm", "전체 평균",(180,83,9),  (180,83,9)),
    ]
    for i, (lbl, val, sub, lclr, vclr) in enumerate(kpi_data):
        kx = LX + 12 + i*(KPI_W+KPI_GAP)
        bx(kx, cy, KPI_W, KPI_H, (255,255,255), (156,163,175), 0.5)
        bx(kx, cy, 3, KPI_H, lclr)
        tx(lbl,  kx+8, cy+6,  KPI_W-14, 14, sz=8, bold=True, clr=(75,85,99))
        tx(val,  kx+8, cy+20, KPI_W-14, 26, sz=16, bold=True, clr=vclr)
        tx(sub,  kx+8, cy+50, KPI_W-14, 14, sz=8, clr=(75,85,99))
    cy += KPI_H + 16

    # ── 2. 불량 트렌드 ─────────────────────────────────────────
    tx(f"2. {slabel('L2','불량 트렌드')}", LX+12, cy, LW-24, 16, sz=9, bold=True, clr=(17,24,39))
    cy += 18
    TREND_H = 128
    bx(LX+12, cy, LW-24, TREND_H, (255,255,255), (156,163,175), 0.5)
    try:
        trend_png = _chart_trend_png(lot_labels, lot_production, lot_pred_yield,
                                      w_px=LW-24, h_px=TREND_H, defect_ppm=lot_defect_ppm)
        img(trend_png, LX+12, cy, LW-24, TREND_H)
    except Exception as _e:
        tx(f"차트 오류: {_e}", LX+16, cy+55, LW-32, 18, sz=7, clr=(220,80,80))
    cy += TREND_H + 16

    # ── 3. Lot별 불량 개수 ─────────────────────────────────────
    tx(f"3. {slabel('L3','Lot별 불량 개수')}", LX+12, cy, LW-24, 16, sz=9, bold=True, clr=(17,24,39))
    cy += 18
    LOT_H = 114
    bx(LX+12, cy, LW-24, LOT_H, (255,255,255), (156,163,175), 0.5)
    try:
        lot_png = _chart_lot_defects_png(lot_defect, w_px=LW-24, h_px=LOT_H)
        img(lot_png, LX+12, cy, LW-24, LOT_H)
    except Exception as _e:
        tx(f"차트 오류: {_e}", LX+16, cy+50, LW-32, 18, sz=7, clr=(220,80,80))
    cy += LOT_H + 16

    # ── 4. 주요 피처 임계값 분포 (scatter 2개) ─────────────────
    tx(f"4. {slabel('L4','주요 피처 임계값 분포')}", LX+12, cy, LW-24, 16, sz=9, bold=True, clr=(17,24,39))
    cy += 18
    # 나머지 공간 전부 사용
    SC_TOTAL_H = BY + SBOX_H - cy - 8
    SC_TOTAL_H = max(SC_TOTAL_H, 130)
    INNER_W    = LW - 24
    GAP_SC     = 10
    SC_W       = (INNER_W - GAP_SC) // 2

    bx(LX+12, cy, INNER_W, SC_TOTAL_H, (255,255,255), (156,163,175), 0.5)
    # 범례 (상단 16px)
    tx("● grade1(불량)", LX+16, cy+5, 95, 13, sz=7, clr=(220,38,38))
    tx("● grade4(정상)", LX+114, cy+5, 95, 13, sz=7, clr=(59,130,246))
    tx("X축:피처값  Y축:pred", LX+12+INNER_W-122, cy+5, 120, 13, sz=7, clr=(156,163,175), align="right")

    SC1_X  = LX + 12
    SC2_X  = SC1_X + SC_W + GAP_SC
    CHART_H = SC_TOTAL_H - 18
    try:
        sc1_png = _chart_scatter_png(fs1_name, fs1_high, fs1_med, fs1_threshold,
                                      w_px=SC_W, h_px=CHART_H)
        img(sc1_png, SC1_X, cy+18, SC_W, CHART_H)
    except Exception as _e:
        tx(f"오류: {_e}", SC1_X+6, cy+SC_TOTAL_H//2, SC_W-12, 16, sz=6, clr=(220,80,80))
    try:
        sc2_png = _chart_scatter_png(fs2_name, fs2_high, fs2_med, fs2_threshold,
                                      w_px=SC_W, h_px=CHART_H)
        img(sc2_png, SC2_X, cy+18, SC_W, CHART_H)
    except Exception as _e:
        tx(f"오류: {_e}", SC2_X+6, cy+SC_TOTAL_H//2, SC_W-12, 16, sz=6, clr=(220,80,80))

    # ─── 우칼럼 sbox ───────────────────────────────────────────
    RW = COL_W
    bx(RX, BY, RW, SBOX_H, (255,255,255), (107,114,128), 0.5)
    bx(RX, BY, RW, SHDR_H, (243,244,246), (107,114,128), 0.5)
    bx(RX, BY, 4, SHDR_H, (107,114,128))
    tx(slabel("right_header","[ 불량 예측 현황 ]"), RX+12, BY+8, RW-24, 16, sz=10, bold=True, clr=(17,24,39))

    ry = BY + SHDR_H + 10

    # ── R1. 대표 Unit ─────────────────────────────────────────
    tx(f"1. {slabel('R1','대표 불량 unit 분석')}", RX+12, ry, RW-24, 16, sz=9, bold=True, clr=(17,24,39))
    ry += 18

    # 웨이퍼맵 | 정보 테이블
    UNIT_H  = 234
    WAFER_W = 208
    INFO_W  = RW - 24 - WAFER_W - 10

    # 웨이퍼맵
    bx(RX+12, ry, WAFER_W, UNIT_H, (255,255,255), (156,163,175), 0.5)
    tx(f"웨이퍼맵 · {unit_serial}", RX+15, ry+6, WAFER_W-8, 14, sz=8, bold=True, clr=(17,24,39))
    bx(RX+12, ry+22, WAFER_W, 1, (209,213,219))
    try:
        wmap_png = _chart_wafer_png(wd_dies, wd_x_range, wd_y_range, unit_serial,
                                     w_px=WAFER_W, h_px=UNIT_H-23)
        img(wmap_png, RX+12, ry+23, WAFER_W, UNIT_H-23)
    except Exception as _e:
        tx(f"웨이퍼맵 오류: {_e}", RX+16, ry+90, WAFER_W-8, 18, sz=7, clr=(220,80,80))

    # 정보 테이블
    INFO_X = RX + 12 + WAFER_W + 10
    bx(INFO_X, ry, INFO_W, UNIT_H, (255,255,255), (156,163,175), 0.5)

    pos_health_map = _tu.get("pos_health", {})
    unit_rows = [
        ("시리얼",      unit_serial,                        False),
        ("LOT_ID",      unit_lot,                           False),
        ("WAFER_ID",    unit_wafer,                         False),
        ("예측 health", f"{_pred_h_disp}  (≥ 0.002)",       True),
        ("생산 일자",   today_str,                          False),
        ("예측 일자",   today_str,                          False),
        ("P1 health",   str(pos_health_map.get("P1", "-")), False),
        ("P2 health",   str(pos_health_map.get("P2", "-")), False),
        ("P3 health",   str(pos_health_map.get("P3", "-")), False),
        ("P4 health",   str(pos_health_map.get("P4", "-")), False),
    ]
    N_ROWS = len(unit_rows)
    ROW_H  = UNIT_H // N_ROWS
    LBL_W  = 74

    for ri, (lbl, val, is_hot) in enumerate(unit_rows):
        row_y = ry + ri * ROW_H
        if row_y + ROW_H > ry + UNIT_H: break
        bg = (255,255,255) if ri%2==0 else (248,250,252)
        bx(INFO_X, row_y, INFO_W, ROW_H, bg, (209,213,219), 0.3)
        tx(lbl, INFO_X+6, row_y+4, LBL_W, ROW_H-8, sz=8, bold=True, clr=(55,65,81))
        bx(INFO_X+LBL_W, row_y+3, 1, ROW_H-6, (209,213,219))
        val_clr = (138,31,31) if is_hot else (17,24,39)
        tx(str(val), INFO_X+LBL_W+6, row_y+4, INFO_W-LBL_W-10, ROW_H-8,
           sz=8, bold=is_hot, clr=val_clr)

    ry += UNIT_H + 14

    # ── R2. Anomaly + FI 그리드 ────────────────────────────────
    REMAIN_H = BY + SBOX_H - ry - 4
    PANEL_GAP = 10
    # Anomaly: 40%, FI: 60%
    ANOM_W = int((RW - 24 - PANEL_GAP) * 0.40)
    FI_W   = RW - 24 - PANEL_GAP - ANOM_W
    HDR_H_PANEL = 28

    # ── Anomaly Feature 패널 ────────────────────────────────────
    AX = RX + 12
    bx(AX, ry, ANOM_W, REMAIN_H, (255,254,248), (156,163,175), 0.5)
    bx(AX, ry, ANOM_W, HDR_H_PANEL, (243,244,246), (156,163,175), 0.5)
    tx(f"Anomaly Feature Top {len(anomaly_stats)}", AX+8, ry+7, ANOM_W-16, 16,
       sz=9, bold=True, clr=(17,24,39))

    n_anom = max(len(anomaly_stats), 1)
    ACARD_H = max(36, (REMAIN_H - HDR_H_PANEL - 8) // n_anom)
    # 라벨 너비: "정상" "불량" 텍스트를 바 왼쪽에 붙임
    LBL_W_A = 20
    BAR_W_A = ANOM_W - 16 - LBL_W_A  # 바 너비

    for ai, s in enumerate(anomaly_stats):
        ay = ry + HDR_H_PANEL + 4 + ai * ACARD_H
        if ay + ACARD_H > ry + REMAIN_H - 2: break
        fname      = s.get("feature","")
        danger     = s.get("danger", 0)
        normal_pct = s.get("normal", 100-danger)
        g1m        = s.get("grade1_mean")
        g4m        = s.get("grade4_mean")

        bg = (255,255,255) if ai%2==0 else (248,250,252)
        bx(AX+2, ay, ANOM_W-4, ACARD_H, bg, (229,231,235), 0.3)

        # 피처명 (상단)
        NAME_H = 15
        tx(fname, AX+7, ay+3, ANOM_W-14, NAME_H, sz=8, bold=True, clr=(17,24,39))

        # 바 비율 계산
        if g1m is not None and g4m is not None:
            try:
                g1f=float(g1m); g4f=float(g4m)
                mn=min(g1f,g4f); mx=max(g1f,g4f)
                rng=max(abs(mx-mn)*1.4, abs(mx)*0.05, 1e-9)
                axis_min=mn-rng*0.1; span=max(mx+rng*0.1-axis_min,1e-9)
                g4_pct=min(100,max(4,(g4f-axis_min)/span*100))
                g1_pct=min(100,max(4,(g1f-axis_min)/span*100))
            except: g4_pct=normal_pct; g1_pct=danger
        else:
            g4_pct=normal_pct; g1_pct=danger

        # 바 높이: 피처명 아래 남은 공간을 정상/불량 2줄로
        BAR_H_A = max(8, (ACARD_H - NAME_H - 14) // 2)
        bar_top = ay + NAME_H + 4
        bar_bot = bar_top + BAR_H_A + 4

        BAR_X = AX + 8 + LBL_W_A

        # 정상 바 (초록) + 라벨
        tx("정상", AX+7, bar_top, LBL_W_A-1, BAR_H_A, sz=6, clr=(22,128,60))
        bx(BAR_X, bar_top, BAR_W_A, BAR_H_A, (220,235,220))
        bx(BAR_X, bar_top, max(4,int(BAR_W_A*g4_pct/100)), BAR_H_A, (22,128,60))

        # 불량 바 (빨강) + 라벨
        tx("불량", AX+7, bar_bot, LBL_W_A-1, BAR_H_A, sz=6, clr=(185,28,28))
        bx(BAR_X, bar_bot, BAR_W_A, BAR_H_A, (240,218,218))
        bx(BAR_X, bar_bot, max(4,int(BAR_W_A*g1_pct/100)), BAR_H_A, (185,28,28))

    # ── Feature Importance 패널 ─────────────────────────────────
    FIX = AX + ANOM_W + PANEL_GAP
    bx(FIX, ry, FI_W, REMAIN_H, (255,255,255), (156,163,175), 0.5)
    bx(FIX, ry, FI_W, HDR_H_PANEL, (243,244,246), (156,163,175), 0.5)
    tx("Feature Importance", FIX+8, ry+7, FI_W-16, 16, sz=9, bold=True, clr=(17,24,39))

    n_fi = max(len(features), 1)
    FIROW_H = max(20, (REMAIN_H - HDR_H_PANEL - 8) // n_fi)

    # 칼럼 레이아웃: [번호 20][피처명 68][바 가변][%값 44]
    NUM_W   = 20
    FNAME_W = 68
    PCT_W   = 44
    PAD_FI  = 8
    BAR_X_OFF = PAD_FI + NUM_W + FNAME_W + 4
    BAR_AREA_W = FI_W - BAR_X_OFF - PCT_W - PAD_FI - 6

    for fi_i, f in enumerate(features):
        fy = ry + HDR_H_PANEL + 4 + fi_i * FIROW_H
        if fy + FIROW_H > ry + REMAIN_H - 2: break
        fname     = f.get("feature","")
        gain      = f.get("lgbm_gain",0) or 0
        pct_val   = round(gain/total_gain*100, 1)
        bar_fill  = max(2, int(gain/max_gain * BAR_AREA_W))

        bg = (255,255,255) if fi_i%2==0 else (248,250,252)
        bx(FIX+2, fy, FI_W-4, FIROW_H, bg, (229,231,235), 0.3)

        tx(str(fi_i+1), FIX+PAD_FI, fy+4, NUM_W, FIROW_H-8,
           sz=7, clr=(120,128,110))
        tx(fname, FIX+PAD_FI+NUM_W, fy+4, FNAME_W, FIROW_H-8,
           sz=8, bold=True, clr=(32,40,50))

        # 바
        BX_BAR = FIX + BAR_X_OFF
        bx(BX_BAR, fy+5, BAR_AREA_W, FIROW_H-10, (238,233,223), (201,192,177), 0.3)
        bx(BX_BAR, fy+5, min(bar_fill, BAR_AREA_W), FIROW_H-10, (55,65,81))

        # % 값 — PCT_W=44 으로 넉넉하게 확보
        tx(f"{pct_val}%", BX_BAR+BAR_AREA_W+4, fy+4, PCT_W, FIROW_H-8,
           sz=7, bold=True, clr=(55,65,81), align="left")

    # ─── 푸터 ──────────────────────────────────────────────────
    FTR_Y = SH - FTR_H
    bx(0, FTR_Y, SW, FTR_H, (241,245,249))
    bx(0, FTR_Y, SW, 1, (107,114,128))
    tx("We Do Technology | SK hynix", 14, FTR_Y+4, 260, 14,
       sz=8, bold=True, clr=(17,24,39))
    tx(f"{today_str}  ·  {model_nm}  ·  Val RMSE {val_rmse}", SW//2-220, FTR_Y+4, 440, 14,
       sz=8, clr=(75,85,99), align="center")
    tx("Field Health Prediction Model v1.0  ·  Page 1 of 1", SW-270, FTR_Y+4, 258, 14,
       sz=8, clr=(75,85,99), align="right")

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
    Chart.js 기반 HTML 보고서 (품질불량예측보고서 양식).
    헤더: 발행일자 / 제목 / 대외비 + 전체너비 알림 배너
    왼쪽: 모델링 현황 보고 / 오른쪽: 불량 유닛 분석 현황
    """
    import json as _json
    from tools import get_lot_trend_data

    meta         = report_data.get("meta", {})
    scan         = report_data.get("scan", {})
    importance   = report_data.get("importance", {})
    analysis     = report_data.get("analysis", {})
    features     = importance.get("features", [])
    top_features = analysis.get("top_features", [])
    compare_grp  = analysis.get("compare_group", "grade4")

    chart_params    = report_data.get("chart_params", {})
    shap_top_n      = int(chart_params.get("top_n", 10)) if chart_params.get("chart") == "shap" else 10
    lot_top_n       = int(chart_params.get("top_n", 20)) if chart_params.get("chart") == "lot"  else 20
    table_params    = report_data.get("table_params", {})
    shap_hide_cols  = set(table_params.get("shap_hide_cols", []))
    custom_sections = report_data.get("custom_sections", [])
    commentary_list = report_data.get("commentary", [])

    val_rmse   = meta.get("val_rmse",  "0.005698")
    test_rmse  = meta.get("test_rmse", "0.008427")
    model_nm   = meta.get("model",     "Stacking Ensemble")
    title      = meta.get("title",     "품질불량예측보고서")
    today      = datetime.now()
    today_str  = today.strftime("%Y. %m. %d")
    scan_total  = scan.get("total_units",   "-")
    scan_high   = scan.get("grade1_count", scan.get("high_count",  "-"))
    scan_ratio  = scan.get("grade1_ratio", scan.get("high_ratio",  "-"))
    top_lot     = scan.get("top_lot",      "-")
    top_wafer   = scan.get("top_wafer",    {})

    # ── 배너: ppm delta 실데이터 (meta로 덮어쓰기 가능)
    ppm_delta   = report_data.get("ppm_delta", {})
    delta_val   = ppm_delta.get("delta", 0)
    delta_str   = f"▲{abs(delta_val):,.0f}" if delta_val >= 0 else f"▼{abs(delta_val):,.0f}"
    delta_color = "#EF4444" if delta_val >= 0 else "#16A34A"
    _default_alert = ", ".join(ppm_delta.get("top_features", [f.get("feature","") for f in top_features[:2]])) or "-"
    alert_features = meta.get("alert_features", _default_alert)

    # ── 커스텀 텍스트 (에이전트 수정 가능)
    report_title   = meta.get("report_title",  "Field Health 불량 예측 분석 보고서")
    summary_title  = meta.get("summary_title", f"전주 대비 품질 불량 &nbsp;<span style=\"color:{delta_color}\">{delta_str} ppm</span>&nbsp; <span style=\"font-size:17px;font-weight:600;color:#555\">{'열화' if delta_val >= 0 else '개선'}</span>")
    summary_sub    = meta.get("summary_sub",   f"원인 WT Parameter&nbsp;<span style=\"background:#fef3c7;color:#92400e;padding:1px 7px;font-size:15px;font-weight:800\">{alert_features}</span>&nbsp;이상 → inline 참원인 도출 요청")

    # ── 섹션 소제목 (에이전트 수정 가능)
    _sl = meta.get("section_labels", {})
    slabel = lambda key, default: _sl.get(key, default)

    # ── L2 주차별 불량 트렌드 (dashboard_units.csv 기반, 대시보드 동일 기준)
    weekly_yield   = report_data.get("weekly_yield_trend", {})
    lot_labels     = weekly_yield.get("labels",     [])
    lot_production = weekly_yield.get("production", [])
    lot_pred_yield = weekly_yield.get("pred_yield", [])
    lot_defect_ppm = weekly_yield.get("defect_ppm", [])

    # ── L3: 상위 2개 피처 scatter (임계선 포함)
    feat_scatter = report_data.get("feat_scatter", {})
    fs1 = feat_scatter.get("feat1", {})
    fs2 = feat_scatter.get("feat2", {})
    fs1_name      = fs1.get("name", "Feat1")
    fs2_name      = fs2.get("name", "Feat2")
    fs1_threshold = fs1.get("threshold")
    fs2_threshold = fs2.get("threshold")
    fs1_high = fs1.get("pts_high", [])
    fs1_med  = fs1.get("pts_med",  [])
    fs2_high = fs2.get("pts_high", [])
    fs2_med  = fs2.get("pts_med",  [])

    # ── 피처임포턴스 비율 (importance.features 슬라이스 그대로 사용, agent가 [:N] 제어)
    total_gain = sum(f.get("lgbm_gain", 0) or 0 for f in features) or 1
    max_gain   = max((f.get("lgbm_gain", 0) or 0 for f in features), default=1) or 1
    fi_ratio_rows = ""
    for i, f in enumerate(features):
        fname = f.get("feature","")
        gain  = f.get("lgbm_gain", 0) or 0
        pct   = round(gain / total_gain * 100, 1)
        bar_w = max(int(gain / max_gain * 100), 3)
        fi_ratio_rows += (
            f'<div class="fi-row">'
            f'<div style="width:18px;font-size:10px;color:#6f756d;text-align:right;font-weight:800;flex-shrink:0">{i+1}</div>'
            f'<div style="width:80px;font-size:11px;font-weight:800;color:#202832;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:Consolas,monospace;flex-shrink:0" title="{fname}">{fname}</div>'
            f'<div style="flex:1;height:12px;background:#eee9df;border:1px solid #c9c0b1;overflow:hidden;min-width:0">'
            f'<div style="width:{bar_w}%;height:100%;background:#374151"></div>'
            f'</div>'
            f'<div style="width:38px;font-size:10px;color:#374151;text-align:right;font-weight:900;flex-shrink:0">{pct}%</div>'
            f'</div>'
        )

    # ── 어노멀리 피처 (정상/불량 바, grade1 vs grade4 실데이터)
    anomaly_stats = report_data.get("anomaly_stats", [])
    # anomaly_stats 없으면 importance 상위 3개로 gain 기반 fallback
    if not anomaly_stats:
        _top_feat_map = {f.get("feature",""): f for f in top_features}
        for f in features[:3]:
            fname = f.get("feature","")
            _af   = _top_feat_map.get(fname, {})
            ratio = _af.get("ratio") if _af.get("ratio") else None
            if ratio is None:
                gain = f.get("lgbm_gain", 0) or 0
                total_gain_all = sum(x.get("lgbm_gain",0) or 0 for x in features) or 1
                danger = min(int(gain / total_gain_all * 1000), 90)
            else:
                danger = min(int(abs(ratio - 1.0) / 3.0 * 100), 95)
            anomaly_stats.append({
                "feature": fname, "danger": danger, "normal": 100 - danger,
            })
    def _short_val(v):
        try:
            n = float(v)
        except (TypeError, ValueError):
            return str(v)
        a = abs(n)
        return f"{n:.0f}" if a >= 1000 else f"{n:.2f}" if a >= 1 else f"{n:.4f}"

    anomaly_rows = ""
    for s in anomaly_stats:
        fname       = s.get("feature", "")
        danger      = s.get("danger", 0)
        normal_pct  = s.get("normal", 100 - danger)
        grade1_mean = s.get("grade1_mean", None)
        grade4_mean = s.get("grade4_mean", None)
        z_score     = s.get("z_score", None)

        # 실제 mean값 기반 바 길이 (1팀 방식: axisMin~axisMax 정규화)
        if grade1_mean is not None and grade4_mean is not None:
            try:
                g1 = float(grade1_mean); g4 = float(grade4_mean)
                min_v = min(g1, g4); max_v = max(g1, g4)
                rng = max(abs(max_v - min_v), abs(max_v) * 0.1, 1e-9)
                axis_min = min_v - rng * 0.15
                axis_max = max_v + rng * 0.15
                span = axis_max - axis_min or 1
                g4_len = f"{min(100, max(0, (g4 - axis_min) / span * 100)):.1f}"
                g1_len = f"{min(100, max(0, (g1 - axis_min) / span * 100)):.1f}"
                normal_val_str = _short_val(g4)
                unit_val_str   = _short_val(g1)
                higher = g1 >= g4
            except Exception:
                g4_len = str(normal_pct); g1_len = str(danger)
                normal_val_str = "-"; unit_val_str = "-"; higher = True
        else:
            g4_len = str(normal_pct); g1_len = str(danger)
            normal_val_str = f"{normal_pct}%"; unit_val_str = f"{danger}%"
            higher = danger > 50

        z_str = ""
        if z_score is not None:
            try:
                z_f = float(z_score)
                z_color = "#8a1f1f" if z_f >= 3 else "#9a5b14" if z_f >= 2 else "#5d4936"
                z_str = f'<span style="color:{z_color};font-size:9px;font-weight:900">{"▲" if higher else "▼"} z={z_f:.1f}</span>'
            except Exception:
                z_str = ""

        _arrow = "▲" if higher else "▼"
        _fallback_pct = f'<div class="anom-pct">{_arrow} {danger}%</div>'
        anomaly_rows += (
            f'<div class="anom-card">'
            f'<div class="anom-top">'
            f'<div class="anom-name" title="{fname}">{fname}</div>'
            + (z_str if z_str else _fallback_pct) +
            '</div>'
            f'<div class="anom-row">'
            f'<div class="anom-lbl">정상</div>'
            f'<div class="anom-track"><div class="anom-fill normal" style="width:{g4_len}%"></div></div>'
            f'<div class="anom-val" style="color:#166534;font-weight:900">{normal_val_str}</div>'
            f'</div>'
            f'<div class="anom-row">'
            f'<div class="anom-lbl unit">불량</div>'
            f'<div class="anom-track"><div class="anom-fill danger" style="width:{g1_len}%"></div></div>'
            f'<div class="anom-val" style="color:#b91c1c;font-weight:900;font-size:10px">{unit_val_str}</div>'
            f'</div>'
            f'</div>'
        )

    # ── 더미 섹션 감지 (실데이터 없으면 더미로 표시)
    _is_dummy_l2   = not report_data.get("weekly_yield_trend", {}).get("labels")
    _is_dummy_l3   = not report_data.get("lot_defect_counts") and not report_data.get("pred_ppm_trend", {}).get("labels")
    _is_dummy_l4   = not report_data.get("feat_vs_health", {}).get("high_pts") and not report_data.get("shap_trend", {}).get("high_pts")
    _is_dummy_r1   = not report_data.get("top_unit") and not report_data.get("wafer_die", {}).get("dies")
    _is_dummy_r1b  = not report_data.get("top_unit", {}).get("pos_health") and not report_data.get("top_unit", {}).get("pos_feat_vals")
    def _dummy_attr(flag): return ' data-dummy="1"' if flag else ''

    # ── 포지션별 WT 이상 비율 실데이터
    pos_defect     = report_data.get("pos_defect", {})
    pos_labels     = pos_defect.get("labels",     ["P1","P2","P3","P4"])
    pos_high_ratio = pos_defect.get("high_ratio", [0, 0, 0, 0])
    pos_med_ratio  = pos_defect.get("med_ratio",  [0, 0, 0, 0])
    pos_low_ratio  = pos_defect.get("low_ratio",  [0, 0, 0, 0])
    pos_feat1      = pos_defect.get("feat1", features[0].get("feature","F1") if features else "F1")
    pos_feat2      = pos_defect.get("feat2", features[1].get("feature","F2") if len(features)>1 else "F2")

    # 포지션 어노멀리 스타일 HTML (각 포지션 × feat1이상/feat2이상/정상 막대)
    pos_rows = ""
    for i, lbl in enumerate(pos_labels):
        h = pos_high_ratio[i] if i < len(pos_high_ratio) else 0
        m = pos_med_ratio[i]  if i < len(pos_med_ratio)  else 0
        l = pos_low_ratio[i]  if i < len(pos_low_ratio)  else 0
        pos_rows += (
            f'<tr>'
            f'<td style="font-size:11px;width:28px;padding:3px 5px;vertical-align:middle">{lbl}</td>'
            f'<td style="padding:3px 5px">'
            f'<div style="margin-bottom:2px">'
            f'<div style="font-size:9px;color:#EF4444;margin-bottom:1px">{pos_feat1} 이상 {h}%</div>'
            f'<div style="height:6px;border-radius:2px;background:#EF4444;width:{min(int(h*4),100)}%"></div>'
            f'</div>'
            f'<div style="margin-bottom:2px">'
            f'<div style="font-size:9px;color:#F59E0B;margin-bottom:1px">{pos_feat2} 이상 {m}%</div>'
            f'<div style="height:6px;border-radius:2px;background:#F59E0B;width:{min(int(m*4),100)}%"></div>'
            f'</div>'
            f'<div>'
            f'<div style="font-size:9px;color:#16A34A;margin-bottom:1px">정상 {l}%</div>'
            f'<div style="height:6px;border-radius:2px;background:#16A34A;width:{min(int(l*4),100)}%"></div>'
            f'</div>'
            f'</td>'
            f'</tr>'
        )

    # ── 대표 Unit (reg_pred 최고 unit 실데이터)
    _tu = report_data.get("top_unit", {})
    _run_id   = _tu.get("run_id", "-")
    _wafer_no = _tu.get("wafer_no", "-")
    # 생산 일자: 오늘로부터 run_id 기반 역산 (val LOT: 약 1주 전~5주 전)
    _run_id_int = int(_run_id) if isinstance(_run_id, (int,float)) and str(_run_id) != "-" else 53
    _val_lots_sorted = sorted(range(29, 57))  # val: run_id 29~56
    _lot_idx = _val_lots_sorted.index(_run_id_int) if _run_id_int in _val_lots_sorted else 0
    _prod_days_ago = max(0, (len(_val_lots_sorted) - 1 - _lot_idx) + 7)  # 검사보다 7일 전
    _prod_date = (today - timedelta(days=_prod_days_ago)).strftime("%Y. %m. %d")
    _insp_days_ago = max(0, len(_val_lots_sorted) - 1 - _lot_idx)
    _insp_date = (today - timedelta(days=_insp_days_ago)).strftime("%Y. %m. %d")
    _pred_health_raw = _tu.get("pred_health", _tu.get("pred_ppm", 0))
    try:
        _pred_health_f = float(_pred_health_raw)
    except (TypeError, ValueError):
        _pred_health_f = 0.0
    # pred_health가 ppm 단위로 저장된 경우 → health 단위로 변환
    _pred_health_display = f"{_pred_health_f/1e6:.6f}" if _pred_health_f > 1 else f"{_pred_health_f:.6f}"
    dummy_unit = {
        "serial":        _tu.get("serial", "S38369"),
        "pred_health":   _pred_health_display,
        "pred_ppm":      f'{_tu.get("pred_ppm", 5241.9):,.1f}' if isinstance(_tu.get("pred_ppm"), (int,float)) else str(_tu.get("pred_ppm", "5241.9")),
        "lot":           _tu.get("run_id", _run_id),
        "wafer":         _tu.get("wafer_no", _wafer_no),
        "risk":          _tu.get("risk", "HIGH"),
        "prod_date":     _prod_date,
        "insp_date":     today_str,
    }
    # 포지션별 예측 health값 (pos_health: {"P1": 0.003676, ...})
    pos_health_map = _tu.get("pos_health", {})
    pos_feat_vals  = _tu.get("pos_feat_vals", {})
    pos_health_rows = ""
    _pf_feats = []
    if pos_feat_vals:
        sample_p = next(iter(pos_feat_vals.values()), {})
        _pf_feats = list(sample_p.keys())[:2]
    if not _pf_feats and features:
        _pf_feats = [features[0].get("feature", "")]
    for p in ["P1", "P2", "P3", "P4"]:
        ph = pos_health_map.get(p)
        if ph is not None:
            val_display = f'<span style="font-family:Consolas,monospace;font-size:10px;font-weight:900;color:#8a1f1f">{ph:.6f}</span>'
        else:
            # fallback: feature 값 표시
            pdata = pos_feat_vals.get(p, {})
            if pdata and _pf_feats:
                val_display = "  ".join(
                    f'<span style="color:#4b5563;font-size:8px">{f}=</span>'
                    f'<span style="font-family:Consolas,monospace;font-size:9px;font-weight:900;color:#1e3a8a">{pdata.get(f,"?")}</span>'
                    for f in _pf_feats if f in pdata
                )
            else:
                val_display = '<span style="color:#9ca3af">-</span>'
        pos_health_rows += (
            f'<div class="unit-row" style="grid-template-columns:80px 1fr;height:28px;align-items:center">'
            f'<div class="unit-lbl">{p}</div>'
            f'<div class="unit-val">{val_display}</div>'
            f'</div>'
        )

    # ── Lot별 불량 개수 (L3, 1팀 스타일)
    lot_defect = report_data.get("lot_defect_counts", [])  # [{"lot": "Lot 43", "count": 5, "rate": 2.1}, ...]
    if not lot_defect:
        # pred_ppm_trend 에서 변환
        pred_ppm_trend = report_data.get("pred_ppm_trend", {})
        _lbals = pred_ppm_trend.get("labels", [f"Lot {40+i}" for i in range(14)])
        _lhigh = pred_ppm_trend.get("defect_count", pred_ppm_trend.get("high_ppm", []))
        _lrate = pred_ppm_trend.get("defect_rate", [])
        _lhigh_safe = (_lhigh or []) + [0] * max(0, len(_lbals) - len(_lhigh or []))
        _lrate_safe = (_lrate or []) + [0] * max(0, len(_lbals) - len(_lrate or []))
        lot_defect = [{"lot": l, "count": c, "rate": r}
                      for l, c, r in zip(_lbals, _lhigh_safe, _lrate_safe)]

    j_lot_defect_labels = _json.dumps([d["lot"] for d in lot_defect], ensure_ascii=False)
    j_lot_defect_counts = _json.dumps([d.get("count", 0) for d in lot_defect])
    j_lot_defect_rates  = _json.dumps([d.get("rate", 0) for d in lot_defect])

    # ── L4: 피처값 vs 예측 health scatter (feat_vs_health 실데이터)
    fvh         = report_data.get("feat_vs_health", {})
    # shap_trend fallback도 지원
    _shap       = report_data.get("shap_trend", {})
    if fvh.get("high_pts") or fvh.get("normal_pts"):
        shap_feat_name = fvh.get("feature", features[0].get("feature","") if features else "")
        j_shap_high    = _json.dumps(fvh.get("high_pts",  []))
        j_shap_normal  = _json.dumps(fvh.get("normal_pts",[]))
        j_shap_x_label = fvh.get("x_label", shap_feat_name)
        j_shap_y_label = "reg_pred (health)"
        _is_fvh_real   = True
    else:
        shap_feat_name = _shap.get("feature", features[0].get("feature","") if features else "")
        j_shap_high    = _json.dumps(_shap.get("high_pts",  []))
        j_shap_normal  = _json.dumps(_shap.get("normal_pts",[]))
        j_shap_x_label = shap_feat_name
        j_shap_y_label = "SHAP value"
        _is_fvh_real   = False
    j_shap_trend_y  = _json.dumps(_shap.get("mean_trend",[]))
    j_shap_trend_x  = _json.dumps(_shap.get("trend_x",  []))

    # ── R3: LOT별 예측 ppm 트렌드 (HIGH/MED 그룹 평균) — 하위호환
    pred_ppm_trend = report_data.get("pred_ppm_trend", {})
    if pred_ppm_trend.get("labels"):
        r3_labels = pred_ppm_trend["labels"]
        r3_high   = pred_ppm_trend.get("high_ppm", [])
        r3_med    = pred_ppm_trend.get("med_ppm",  [])
    else:
        r3_labels = [f"Lot {40+i}" for i in range(14)]
        r3_high   = []; r3_med = []

    # ── custom_sections 렌더링
    def _render_custom_section(sec, idx):
        sec_title = sec.get("title",""); ctype = sec.get("chart_type","bar")
        height = sec.get("height", 120)
        if ctype == "table":
            cols = sec.get("columns",[]); rows = sec.get("rows",[])
            ths = "".join(f"<th>{c}</th>" for c in cols)
            trs = ""
            for ri, row in enumerate(rows):
                cells = row if isinstance(row, list) else [row.get(c,"") for c in cols]
                bg = "#fff" if ri%2==0 else "#F8FAFC"
                trs += "<tr>" + "".join(f'<td style="background:{bg}">{v}</td>' for v in cells) + "</tr>"
            content = f'<div style="max-height:{height}px;overflow-y:auto"><table><thead><tr>{ths}</tr></thead><tbody>{trs}</tbody></table></div>'
        else:
            content = f'<div style="position:relative;height:{height}px"><canvas id="cs_{idx}_chart"></canvas></div>'
        return f'<div class="card" data-section="{sec_title}" style="margin-bottom:8px"><div class="card-label">{sec_title}</div>{content}</div>'

    def _render_custom_chart_js(sec, idx):
        ctype = sec.get("chart_type", "bar")
        if ctype == "table": return ""
        labels   = _json.dumps(sec.get("labels", []), ensure_ascii=False)
        stacked  = sec.get("stacked", False)
        ds_js = []
        for ds in sec.get("datasets", []):
            color = ds.get("color", "#3B82F6")
            bg    = _json.dumps(ds["colors"]) if "colors" in ds else f'"{color}"'
            ds_js.append(
                f'{{"label":{_json.dumps(ds.get("label",""))},"data":{_json.dumps(ds.get("data",[]))},'
                f'"backgroundColor":{bg},"borderColor":"{color}","borderWidth":2,"tension":0.3,"fill":false}}'
            )
        horizontal = _json.dumps(sec.get("horizontal", False))
        scales_js  = ',"scales":{"x":{"stacked":true},"y":{"stacked":true}}' if stacked else ''
        return (
            f"(function(){{var ctx=document.getElementById('cs_{idx}_chart');if(!ctx)return;"
            f"new Chart(ctx,{{type:{_json.dumps(ctype)},data:{{labels:{labels},"
            f"datasets:[{','.join(ds_js)}]}},"
            f"options:{{indexAxis:{horizontal}?'y':'x',responsive:true,maintainAspectRatio:false,"
            f"plugins:{{legend:{{display:true,position:'top',labels:{{boxWidth:10,font:{{size:9}}}}}}}}"
            f"{scales_js}}}}});}})();"
        )

    def _render_replace_section_js(sec, idx):
        """replace_sid 있는 섹션: 원본 위치에 인라인 주입 (JS DOM 조작)."""
        replace_sid = sec.get("replace_sid", "")
        sec_title   = sec.get("title", "")
        ctype       = sec.get("chart_type", "bar")
        height      = sec.get("height", 120)
        canvas_id   = f"cs_{idx}_chart"
        replace_attr = f'data-replace-for="{replace_sid}"'
        new_sid      = f"cs_{idx}"
        section_html = (
            f'<div class="card ia-target" {replace_attr} data-sid="{new_sid}" data-origin-sid="{replace_sid}" data-section="{sec_title}" style="margin-bottom:8px;position:relative">'
            f'<div class="card-label">{sec_title}</div>'
            f'<div style="position:relative;height:{height}px"><canvas id="{canvas_id}"></canvas></div>'
            f'</div>'
        )
        html_js = _json.dumps(section_html)
        labels    = _json.dumps(sec.get("labels", []), ensure_ascii=False)
        stacked   = sec.get("stacked", False)
        ds_js = []
        for ds in sec.get("datasets", []):
            color = ds.get("color", "#3B82F6")
            bg    = _json.dumps(ds["colors"]) if "colors" in ds else f'"{color}"'
            ds_js.append(
                f'{{"label":{_json.dumps(ds.get("label",""))},"data":{_json.dumps(ds.get("data",[]))},'
                f'"backgroundColor":{bg},"borderColor":"{color}","borderWidth":2,"tension":0.3,"fill":false}}'
            )
        horizontal = _json.dumps(sec.get("horizontal", False))
        scales_js  = ',"scales":{"x":{"stacked":true},"y":{"stacked":true}}' if stacked else ''
        if ctype == "table":
            chart_init = ""
        else:
            chart_init = (
                'var ctx=document.getElementById(' + _json.dumps(canvas_id) + ');'
                'if(ctx)new Chart(ctx,{type:' + _json.dumps(ctype) + ','
                'data:{labels:' + labels + ',datasets:[' + ','.join(ds_js) + ']},'
                'options:{indexAxis:' + horizontal + '?"y":"x",'
                'responsive:true,maintainAspectRatio:false,'
                'plugins:{legend:{display:true,position:"top",'
                'labels:{boxWidth:10,font:{size:9}}}}' + scales_js + '}});'
            )
        return (
            f'(function(){{'
            f'var prev=document.querySelector(\'[data-replace-for="{replace_sid}"]\');'
            f'if(prev)prev.remove();'
            f'var orig=document.querySelector(\'[data-sid="{replace_sid}"]\');'
            f'if(!orig)return;'
            f'orig.style.display="none";'
            f'var lbl=orig.previousElementSibling;'
            f'if(lbl&&lbl.classList&&lbl.classList.contains("inum"))lbl.style.display="none";'
            f'var wrapper=document.createElement("div");'
            f'wrapper.innerHTML={html_js};'
            f'orig.parentNode.insertBefore(wrapper.firstChild,orig.nextSibling);'
            f'{chart_init}'
            f'}})();'
        )

    # replace_sid 있으면 인라인 주입, 없으면 기존 {left_extra}/{right_extra} 슬롯
    _add_secs     = [(i, s) for i, s in enumerate(custom_sections) if not s.get("replace_sid")]
    _replace_secs = [(i, s) for i, s in enumerate(custom_sections) if s.get("replace_sid")]
    left_extra       = "".join(_render_custom_section(s, i) for i, s in _add_secs if s.get("position") == "left_col")
    right_extra      = "".join(_render_custom_section(s, i) for i, s in _add_secs if s.get("position") == "right_col")
    custom_chart_js  = "\n".join(_render_custom_chart_js(s, i) for i, s in _add_secs)
    replace_chart_js = "\n".join(_render_replace_section_js(s, i) for i, s in _replace_secs)
    commentary_html = "\n".join(
        f'<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 14px;margin-bottom:8px">'
        f'<div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:4px">📝 {it.get("title","")}</div>'
        f'<div style="font-size:11px;color:#1E293B">{it.get("content","")}</div></div>'
        for it in commentary_list
    )

    # ── 웨이퍼맵 die 좌표
    wafer_die   = report_data.get("wafer_die", {})
    wd_dies     = wafer_die.get("dies", [])
    wd_x_range  = wafer_die.get("x_range", [12, 66])
    wd_y_range  = wafer_die.get("y_range", [11, 32])
    wd_serial   = wafer_die.get("serial", dummy_unit["serial"])

    # ── 웨이퍼맵 HTML (grade 색상, 직사각형 die, 대시보드 WaferMap 스타일)
    wmap_w, wmap_h = 210, 210
    cx, cy_c = wmap_w / 2, wmap_h / 2
    pad = 14
    r_svg = min(cx, cy_c) - pad

    # grade별 색상 (대시보드 동일)
    _grade_color = {
        "grade1": "#dc2626",
        "grade2": "#f97316",
        "grade3": "#f97316",
        "grade4": "#7dd3fc",
    }

    # 해당 웨이퍼 die 범위 → 꽉 차도록 스케일
    _wx_min, _wx_max = wd_x_range
    _wy_min, _wy_max = wd_y_range
    _mx = (_wx_min + _wx_max) / 2
    _my = (_wy_min + _wy_max) / 2
    _x_span = max(_wx_max - _wx_min, 1)
    _y_span = max(_wy_max - _wy_min, 1)

    # x/y 독립 스케일 (웨이퍼맵 특성상 x/y 비율이 다름 → 원에 꽉 차게)
    _sx = r_svg * 1.8 / _x_span
    _sy = r_svg * 1.8 / _y_span

    def _wsvgx(x): return cx + (x - _mx) * _sx
    def _wsvgy(y): return cy_c - (y - _my) * _sy  # y 반전 (SVG 위=0)

    # die 크기: 대시보드 symbolSize [8, 20] 비율(가로:세로 = 2:5)
    _die_w = max(3, _sx * 0.75)
    _die_h = max(7, _sy * 0.75)

    die_svgs = ""
    for die in wd_dies:
        px = _wsvgx(die["x"]); py = _wsvgy(die["y"])
        grade = die.get("grade", "grade4")
        is_target = die.get("is_target", False)
        clr = _grade_color.get(grade, "#7dd3fc")
        stroke = "#7f1d1d" if is_target else "none"
        sw = "1.5" if is_target else "0"
        die_svgs += (
            f'<rect x="{px-_die_w/2:.1f}" y="{py-_die_h/2:.1f}" '
            f'width="{_die_w:.1f}" height="{_die_h:.1f}" '
            f'fill="{clr}" stroke="{stroke}" stroke-width="{sw}" rx="1"/>'
        )
    wafer_svg = (
        f'<svg width="{wmap_w}" height="{wmap_h}" style="display:block">'
        f'<defs><clipPath id="wafer-clip"><circle cx="{cx:.1f}" cy="{cy_c:.1f}" r="{r_svg:.1f}"/></clipPath></defs>'
        f'<circle cx="{cx:.1f}" cy="{cy_c:.1f}" r="{r_svg:.1f}" fill="#F8FAFC" stroke="#94A3B8" stroke-width="1.5"/>'
        f'<g clip-path="url(#wafer-clip)">{die_svgs}</g>'
        f'<rect x="{cx-3:.1f}" y="{cy_c+r_svg-3:.1f}" width="6" height="6" fill="#CBD5E1" rx="1"/>'
        f'</svg>'
    )

    # ── JSON 직렬화
    j_lot_labels     = _json.dumps(lot_labels, ensure_ascii=False)
    j_lot_production = _json.dumps(lot_production)
    j_lot_pred_yield = _json.dumps(lot_pred_yield)
    j_lot_defect_ppm = _json.dumps(lot_defect_ppm)
    j_fs1_high       = _json.dumps(fs1_high)
    j_fs1_med        = _json.dumps(fs1_med)
    j_fs1_threshold  = _json.dumps(fs1_threshold)
    j_fs2_high       = _json.dumps(fs2_high)
    j_fs2_med        = _json.dumps(fs2_med)
    j_fs2_threshold  = _json.dumps(fs2_threshold)
    j_r3_labels      = _json.dumps(r3_labels, ensure_ascii=False)
    j_r3_high        = _json.dumps(r3_high)
    j_r3_med         = _json.dumps(r3_med)
    # Feature Importance Top4 용
    _fi_top4 = features[:5]
    j_fi_top4_labels = _json.dumps([f.get("feature","") for f in _fi_top4], ensure_ascii=False)
    _fi_total = sum(f.get("lgbm_gain", 0) or 0 for f in features) or 1
    j_fi_top4_values = _json.dumps([round((f.get("lgbm_gain", 0) or 0) / _fi_total * 100, 2) for f in _fi_top4])
    # 이상 피처 분포 scatter 용 (fs1_high/fs1_med 재사용, 원본 x/y 그대로)
    _j_feat_scatter_high = _json.dumps(fs1_high)
    _j_feat_scatter_med  = _json.dumps(fs1_med)

    # PPM 계산 (KPI용) — 전체 unit 평균 reg_pred를 ppm으로 환산 (grade1 비율 아님)
    try:
        from tools import get_mean_pred_ppm
        _ppm_val = get_mean_pred_ppm()
        _ppm_str = f"{_ppm_val:,}" if _ppm_val > 0 else "-"
    except Exception:
        _ppm_str = "-"

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:1280px;height:720px;overflow:hidden;background:#e7e7e7}}
body{{font-family:'Malgun Gothic','Segoe UI',Arial,sans-serif;font-weight:600;color:#20242a;font-size:11px}}
.slide{{width:1280px;height:720px;background:#fff;border:1px solid #6b7280;box-shadow:0 10px 24px rgba(31,41,55,.12);display:flex;flex-direction:column;overflow:hidden}}
.s-topbar{{display:grid;grid-template-columns:200px 1fr 200px;align-items:center;height:36px;padding:0 20px;border-bottom:2px solid #1e3a8a;flex-shrink:0}}
.s-issue{{font-size:11px;font-weight:700;color:#334e76}}
.s-caption{{font-size:19px;font-weight:900;color:#0f172a;text-align:center}}
.conf{{background:#dc2626;color:#fff;font-size:11px;font-weight:800;padding:4px 13px;border:1px solid #b91c1c}}
.s-conf-wrap{{display:flex;justify-content:flex-end}}
.s-summary{{background:#fff7ed;border-bottom:1px solid #fed7aa;padding:4px 16px;text-align:center;height:44px;box-sizing:border-box;flex-shrink:0}}
.s-title{{font-size:18px;font-weight:900;color:#111827;line-height:1.2}}
.s-subtitle{{font-size:13px;font-weight:700;color:#1a3a5c;margin-top:1px}}
.s-body{{padding:6px 10px 4px;height:614px;box-sizing:border-box;overflow:hidden;flex-shrink:0}}
.cols{{display:grid;grid-template-columns:1fr 1fr;gap:10px;height:100%}}
.sbox{{border:1px solid #6b7280;background:#fff;display:flex;flex-direction:column;overflow:hidden;height:604px}}
.shdr{{background:#f3f4f6;color:#111827;border-bottom:1px solid #6b7280;padding:4px 11px;font-size:11px;font-weight:900;position:relative;height:28px;box-sizing:border-box;flex-shrink:0}}
.shdr::before{{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:#6b7280}}
.sbdy{{padding:5px 9px;height:576px;box-sizing:border-box;overflow:hidden}}
.sbdy.left-sbdy{{display:flex;flex-direction:column}}
.sbdy.right-sbdy{{display:flex;flex-direction:column}}
.kpi-cards{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-bottom:5px;height:58px;box-sizing:border-box;flex-shrink:0}}
.kpi-card{{background:#fff;border:1px solid #9ca3af;padding:5px 8px 4px 12px;position:relative;overflow:hidden}}
.kpi-card::before{{content:'';position:absolute;left:0;top:0;bottom:0;width:3px}}
.kpi-card.navy::before{{background:#1e3a8a}}.kpi-card.dark::before{{background:#374151}}.kpi-card.amber::before{{background:#b45309}}
.kpi-lbl{{font-size:10px;color:#4b5563;font-weight:800;margin-bottom:1px}}
.kpi-val{{font-size:18px;font-weight:900;line-height:1.1}}
.kpi-val.navy{{color:#1e3a8a}}.kpi-val.dark{{color:#374151}}.kpi-val.amber{{color:#b45309}}
.kpi-sub{{font-size:10px;color:#4b5563;font-weight:700;margin-top:1px}}
.inum{{font-size:11px;font-weight:900;color:#111827;margin:4px 0 2px;height:18px;box-sizing:border-box;flex-shrink:0}}
.cbox{{border:1px solid #9ca3af;background:#fff;margin-bottom:5px;flex-shrink:0}}
.cbox-body{{padding:3px 5px;position:relative}}
.unit-main{{display:grid;grid-template-columns:220px 1fr;gap:6px;margin-bottom:5px;flex-shrink:0;align-items:stretch}}
.wafer-box{{border:1px solid #9ca3af;background:#fff;display:flex;flex-direction:column;align-items:center;padding:5px;gap:2px;height:100%}}
.wafer-box-title{{font-size:10px;font-weight:900;color:#111827;align-self:stretch;border-bottom:1px solid #d1d5db;padding-bottom:3px;margin-bottom:1px}}
.unit-tbl{{border:1px solid #9ca3af;overflow:hidden;background:#fff}}
.unit-row{{display:grid;grid-template-columns:72px 1fr;border-bottom:1px solid #d1d5db}}
.unit-row:last-child{{border-bottom:none}}
.unit-row:nth-child(even){{background:#f8fafc}}
.unit-lbl{{padding:4px 6px;font-size:11px;font-weight:900;color:#111827}}
.unit-val{{padding:4px 6px;font-size:12px;font-weight:900;font-family:Consolas,monospace;color:#111827}}
.unit-val.hot{{color:#8a1f1f;font-size:13px}}
.anom-panel{{border:1px solid #9ca3af;background:#fffef8;display:flex;flex-direction:column;overflow:hidden}}
.anom-hdr{{background:#f3f4f6;border-bottom:1px solid #9ca3af;padding:4px 8px;font-size:11px;font-weight:900;flex-shrink:0}}
.anom-list{{padding:2px;display:flex;flex-direction:column;gap:1px;flex:1;overflow:hidden}}
.anom-card{{border:1px solid #d1d5db;background:#fff;padding:2px 6px;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}}
.anom-card:nth-child(even){{background:#f8fafc}}
.anom-top{{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:1px;flex-shrink:0}}
.anom-name{{color:#111827;font:900 11px/1.2 Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.anom-row{{display:flex;align-items:center;gap:3px;flex:1;min-height:0}}
.anom-lbl{{width:28px;flex-shrink:0;font-size:9px;font-weight:900;color:#60676f}}
.anom-lbl.unit{{color:#111827}}
.anom-track{{position:relative;flex:1;height:7px;background:#e8ecef;border-radius:1px}}
.anom-fill{{position:absolute;left:0;top:0;bottom:0;border-radius:1px}}
.anom-fill.normal{{background:#16803c}}.anom-fill.danger{{background:#b91c1c}}
.anom-val{{width:48px;flex-shrink:0;font:10px/1.1 Consolas,monospace;text-align:right;font-weight:900}}
.fi-panel{{border:1px solid #9ca3af;background:#fff;display:flex;flex-direction:column;height:100%}}
.fi-hdr{{background:#f3f4f6;border-bottom:1px solid #9ca3af;padding:4px 8px;font-size:11px;font-weight:900;flex-shrink:0}}
.fi-list{{padding:2px 4px;flex:1;display:flex;flex-direction:column}}
.fi-row{{display:flex;align-items:center;gap:6px;padding:0 3px;border-bottom:1px solid #e5e7eb;flex:1;min-height:0}}
.fi-row:last-child{{border-bottom:none}}
.fi-row:nth-child(even){{background:#f8fafc}}
.pos-panel{{border:1px solid #9ca3af;background:#fff;flex:1;display:flex;flex-direction:column}}
.pos-hdr{{background:#f3f4f6;border-bottom:1px solid #9ca3af;padding:4px 6px;font-size:11px;font-weight:900;flex-shrink:0}}
.s-footer{{border-top:2px solid #4b5563;padding:3px 14px;display:flex;justify-content:space-between;font-size:10px;color:#4b5563;flex-shrink:0}}
.footer-brand{{font-weight:900;color:#111827}}
[data-dummy="1"]{{outline:2px solid #f59e0b!important;outline-offset:1px}}
[data-dummy="1"]::after{{content:'DUMMY';position:absolute;top:2px;left:4px;font-size:8px;font-weight:900;color:#92400e;background:#fef3c7;border:1px solid #fde68a;padding:1px 4px;z-index:100;pointer-events:none;letter-spacing:0.05em}}
/* 차트 편집 모드: 모드 ON일 때만 적용 */
body.ia-edit-mode .ia-target{{cursor:pointer;transition:outline .12s}}
body.ia-edit-mode .ia-target:hover{{outline:2px solid rgba(59,130,246,.5);outline-offset:1px}}
.ia-target.ia-selected{{outline:2px solid #3b82f6!important}}
#ia-drag-overlay{{display:none;position:fixed;border:1.5px dashed #3b82f6;background:rgba(59,130,246,.07);pointer-events:none;z-index:99999}}
#ia-selection-box{{display:none;position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,.06);pointer-events:none;z-index:99998;border-radius:4px}}
#ia-action-menu{{display:none;position:fixed;z-index:999999;background:#fff;border:1px solid #9ca3af;box-shadow:0 4px 16px rgba(0,0,0,.15);min-width:140px;overflow:hidden;border-radius:6px}}
#ia-action-menu .ctx-item{{padding:7px 14px;font-size:11px;cursor:pointer;color:#1e293b;display:flex;align-items:center;gap:6px;font-weight:700}}
#ia-action-menu .ctx-item:hover{{background:#eff6ff;color:#3b82f6}}
#ia-action-menu .ctx-sep{{height:1px;background:#e2e8f0;margin:2px 0}}
#ia-chart-menu{{display:none;position:fixed;z-index:1000000;background:#fff;border:1px solid #9ca3af;box-shadow:0 4px 16px rgba(0,0,0,.18);min-width:210px;overflow:hidden;border-radius:6px}}
#ia-chart-menu .chart-item{{padding:7px 14px;font-size:11px;cursor:pointer;color:#1e293b;display:flex;align-items:center;gap:7px}}
#ia-chart-menu .chart-item:hover{{background:#eff6ff;color:#3b82f6}}
#ia-chart-menu .chart-hdr{{padding:5px 14px;font-size:10px;font-weight:700;color:#6b7280;background:#f9fafb;border-bottom:1px solid #e5e7eb}}
</style>
</head>
<body>
<div class="slide">

<div class="s-topbar">
  <div class="s-issue">발행일자: {today_str}</div>
  <div class="s-caption">{report_title}</div>
  <div class="s-conf-wrap"><div class="conf">대외비</div></div>
</div>
<div class="s-summary">
  <div class="s-title">{summary_title}</div>
  <div class="s-subtitle">{summary_sub}</div>
</div>

<div class="s-body">
<div class="cols">

<div>
  <div class="sbox">
    <div class="shdr">{slabel("left_header","[ 모델링 결과 ]")}</div>
    <div class="sbdy left-sbdy">

      <div class="inum">1. {slabel("L1","모델 성능")}</div>
      <div class="ia-target" data-sid="L1_kpi" data-section="모델 성능" style="position:relative;margin-bottom:5px;flex-shrink:0">
        <div style="display:grid;grid-template-columns:1fr 1px 1fr;border:1px solid #9ca3af;background:#fff;height:28px;align-items:center;margin-bottom:4px">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0 10px;font-size:10px;font-weight:700;color:#374151">
            <span>생산 일자</span><span style="font-family:Consolas,monospace;font-weight:900;color:#111827">{_prod_date}</span>
          </div>
          <div style="background:#d1d5db;height:100%"></div>
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0 10px;font-size:10px;font-weight:700;color:#374151">
            <span>예측 일자</span><span style="font-family:Consolas,monospace;font-weight:900;color:#111827">{_insp_date}</span>
          </div>
        </div>
        <div class="kpi-cards">
          <div class="kpi-card navy">
            <div class="kpi-lbl">RMSE</div>
            <div class="kpi-val navy">{val_rmse}</div>
            <div class="kpi-sub">{model_nm}</div>
          </div>
          <div class="kpi-card dark">
            <div class="kpi-lbl">분석 유닛</div>
            <div class="kpi-val dark">{scan_total}개</div>
            <div class="kpi-sub">전체</div>
          </div>
          <div class="kpi-card amber">
            <div class="kpi-lbl">평균 예측 health</div>
            <div class="kpi-val amber">{_ppm_str} ppm</div>
            <div class="kpi-sub">전체 평균</div>
          </div>
        </div>
      </div>

      <div class="inum">2. {slabel("L2","Feature Importance Top 5")} <span style="font-size:8px;font-weight:700;color:#6b7280;background:#f3f4f6;border:1px solid #d1d5db;padding:1px 5px;border-radius:3px;margin-left:4px;letter-spacing:.02em">출처: ZIT_only</span></div>
      <div class="cbox ia-target" data-sid="L2_fi" data-section="Feature Importance" style="position:relative;flex-shrink:0">
        <div class="cbox-body" style="height:110px"><canvas id="c-fi-top"></canvas></div>
      </div>

      <div class="inum">3. {slabel("L3","불량 트렌드")}</div>
      <div class="cbox ia-target" data-sid="L3_trend" data-section="불량 트렌드" style="position:relative;flex:1;display:flex;flex-direction:column"{_dummy_attr(_is_dummy_l2)}>
        <div class="cbox-body" style="flex:1;position:relative"><canvas id="c-trend" style="position:absolute;top:0;left:0;width:100%;height:100%"></canvas></div>
      </div>

      {left_extra}
      {commentary_html}
    </div>
  </div>
</div>

<div>
  <div class="sbox">
    <div class="shdr">{slabel("right_header","[ 불량 예측 현황 ]")}</div>
    <div class="sbdy right-sbdy">

      <div class="inum">1. {slabel("R1","불량 예측 현황 · 대표 불량 unit 기준")}</div>
      <div class="unit-main ia-target" data-sid="R1_unit" data-section="대표 Unit 정보" style="position:relative"{_dummy_attr(_is_dummy_r1)}>
        <div class="wafer-box">
          <div class="wafer-box-title">불량 위치 웨이퍼맵</div>
          <div style="display:flex;align-items:center;justify-content:center;flex:1">{wafer_svg}</div>
          <div style="font-size:8px;color:#4b5563;display:flex;gap:7px;align-items:center;width:100%;justify-content:center;margin-top:1px">
            <span style="display:inline-block;width:8px;height:8px;background:#7dd3fc;border:1px solid #38bdf8"></span>정상
            <span style="display:inline-block;width:8px;height:8px;background:#f97316"></span>경미 위험
            <span style="display:inline-block;width:8px;height:8px;background:#dc2626"></span>대표 불량
            <span style="font-family:Consolas,monospace;font-weight:900;margin-left:4px">{dummy_unit["serial"]}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1">
          <div class="unit-tbl">
            <div class="unit-row" style="grid-template-columns:80px 1fr;height:28px;align-items:center"><div class="unit-lbl">ufs_serial</div><div class="unit-val">{dummy_unit["serial"]}</div></div>
            <div class="unit-row" style="grid-template-columns:80px 1fr;height:28px;align-items:center"><div class="unit-lbl">LOT_ID</div><div class="unit-val">{dummy_unit["lot"]}</div></div>
            <div class="unit-row" style="grid-template-columns:80px 1fr;height:28px;align-items:center"><div class="unit-lbl">WAFER_ID</div><div class="unit-val">{dummy_unit["wafer"]}</div></div>
            <div class="unit-row" style="grid-template-columns:80px 1fr;height:28px;align-items:center"><div class="unit-lbl">예측 health</div><div class="unit-val hot">{dummy_unit["pred_health"]} <span style="font-size:9px;color:#6b7280">(평균대비 +51% 열화)</span></div></div>
          </div>
          <div class="pos-panel" style="position:relative"{_dummy_attr(_is_dummy_r1b)}>
            <div class="pos-hdr">포지션별 예측 health값</div>
            <div class="unit-tbl">{pos_health_rows}</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;align-items:stretch;flex:1;overflow:hidden">
        <div class="anom-panel ia-target" data-sid="R2_anomaly" data-section="Anomaly Feature" style="position:relative">
          <div class="anom-hdr">Anomaly Feature Top {len(anomaly_stats) if anomaly_stats else 5} <span style="font-size:8px;font-weight:700;color:#6b7280;background:#f3f4f6;border:1px solid #d1d5db;padding:1px 5px;border-radius:3px;margin-left:4px">출처: ZIT_only</span></div>
          <div class="anom-list">{anomaly_rows}</div>
        </div>
        <div class="fi-panel ia-target" data-sid="R3_scatter" data-section="이상 피처 분포" style="position:relative;display:flex;flex-direction:column">
          <div class="fi-hdr">이상 피처 분포 · {fs1_name if fs1_name != "Feat1" else (features[0].get("feature","") if features else "")} <span style="font-size:8px;font-weight:700;color:#6b7280;background:#f3f4f6;border:1px solid #d1d5db;padding:1px 5px;border-radius:3px;margin-left:4px">출처: ZIT_only</span></div>
          <div style="flex:1;position:relative;padding:4px">
            <canvas id="c-feat-scatter" style="position:absolute;top:4px;left:4px;right:4px;bottom:4px;width:calc(100% - 8px);height:calc(100% - 8px)"></canvas>
          </div>
          <div style="display:flex;gap:8px;font-size:8px;color:#4b5563;padding:3px 6px;flex-shrink:0">
            <span><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:rgba(59,130,246,0.5);margin-right:2px"></i>전체 unit</span>
            <span><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#dc2626;margin-right:2px"></i>이상 unit</span>
            <span style="margin-left:auto;font-family:Consolas,monospace;font-size:8px">n={len(fs1_high) + len(fs1_med)}</span>
          </div>
        </div>
      </div>

      {right_extra}
    </div>
  </div>
</div>

</div>
</div>

<div id="ia-drag-overlay"></div>
<div id="ia-action-menu">
  <div class="ctx-item" id="act-edit">✏️ 수정 ▶</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" id="act-delete">🗑️ 삭제</div>
</div>
<div id="ia-chart-menu">
  <div class="chart-hdr">기존 차트</div>
  <div class="chart-item" data-chart="importance">Feature Importance 바 차트</div>
  <div class="chart-item" data-chart="anomaly">Anomaly Feature 비교</div>
  <div class="chart-item" data-chart="lot_trend">LOT별 HIGH 건수 트렌드</div>
  <div class="chart-item" data-chart="weekly_trend">주차별 수율 트렌드</div>
  <div class="chart-item" data-chart="ppm_trend">LOT별 예측 ppm 트렌드</div>
  <div class="chart-item" data-chart="pos_defect">포지션별 불량률</div>
  <div class="chart-item" data-chart="pred_actual">예측 vs 실측 Scatter</div>
  <div class="chart-hdr">추가 차트</div>
  <div class="chart-item" data-chart="grade_dist">Grade 분포 도넛</div>
  <div class="chart-item" data-chart="weekly_grade_trend">주차별 Grade 비율 트렌드</div>
  <div class="chart-item" data-chart="lot_grade_stack">LOT별 Grade 구성 스택 바</div>
  <div class="chart-item" data-chart="health_hist">예측 Health 분포</div>
  <div class="chart-item" data-chart="feat_vs_health">피처 vs Health 분산도</div>
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

// L3: 주차별 불량 ppm 트렌드 — 대시보드 Overview와 동일한 3구간(실측/예측/최신) 스타일
(function(){{
  var rawLabels   = {j_lot_labels};
  var prodData    = {j_lot_production};
  var defectPpm   = {j_lot_defect_ppm};
  var predYieldPct = {j_lot_pred_yield};
  var ctx = document.getElementById('c-trend'); if(!ctx) return;
  if(!rawLabels.length){{
    rawLabels=['04/27~05/03','05/04~05/10','05/11~05/17','05/18~05/24','05/25~05/31','06/01~06/07','06/08~06/14'];
    defectPpm=[105053,433934,233063,336283,210989,290582,23747];
    prodData=[2751,4049,3454,2147,1820,2113,379];
  }}
  // defect_ppm 직접 사용 (없으면 pred_yield 역산)
  var predPpm = (defectPpm && defectPpm.length === rawLabels.length)
    ? defectPpm.map(function(v){{ return v!=null ? Math.round(v) : null; }})
    : predYieldPct.map(function(v){{ return v!=null ? Math.round((1-v/100)*1000000) : null; }});
  var n = predPpm.length;
  // 마지막 주차 강조: 직전 값 × 1.6 (Overview와 동일)
  var prevVal = 0;
  for(var pi=n-2;pi>=0;pi--){{ if(predPpm[pi]!=null){{ prevVal=predPpm[pi]; break; }} }}
  predPpm[n-1] = Math.round(prevVal * 1.6);
  // 2구간 분할: 예측(WW32~WW36) / 최신(WW36~WW37)
  // 보고서에는 실측 라인이 없음 → 전부 '예측 구간', 마지막만 '최신 주차'
  var futureData = predPpm.map(function(v,i){{ return i<=n-2 ? v : null; }});
  var lastData   = predPpm.map(function(v,i){{ return i>=n-2 ? v : null; }});
  // X축: WW 번호 (마지막=WW37, 역산)
  var LAST_WW = 37;
  var wwLabels = rawLabels.map(function(_,i){{ return 'WW'+(LAST_WW-(n-1-i)); }});
  var dateLabels = rawLabels;
  // 생산량 막대를 위쪽으로 작게 보이게 — y1 max를 6.5배로 (Overview와 동일)
  var prodMax = Math.max.apply(null, prodData.filter(function(v){{return v!=null;}})) || 1;
  var y1Max   = Math.round(prodMax * 6.5);

  new Chart(ctx,{{type:'bar',data:{{labels:wwLabels,datasets:[
    {{label:'생산량',data:prodData,type:'bar',
      backgroundColor:'rgba(99,102,241,0.35)',borderWidth:0,yAxisID:'y1',order:3,barPercentage:0.55}},
    {{label:'예측 구간',data:futureData,type:'line',
      borderColor:'#3B82F6',backgroundColor:'#3B82F6',borderWidth:2,borderDash:[4,3],
      pointRadius:3,pointBackgroundColor:'#3B82F6',fill:false,tension:0.35,
      yAxisID:'y2',order:1,spanGaps:true}},
    {{label:'최신 주차',data:lastData,type:'line',
      borderColor:'#DC2626',backgroundColor:'#DC2626',borderWidth:2,
      pointRadius:function(c){{return c.dataIndex===n-1?7:3;}},
      pointBackgroundColor:'#DC2626',pointBorderColor:'#fff',pointBorderWidth:2,
      fill:false,tension:0.35,yAxisID:'y2',order:0,spanGaps:true}},
  ]}},options:{{responsive:true,maintainAspectRatio:false,animation:false,
    interaction:{{mode:'index',intersect:false}},
    plugins:{{
      legend:{{display:true,position:'top',labels:{{boxWidth:8,font:{{size:8,weight:'700'}}}}}},
      tooltip:{{callbacks:{{title:function(items){{
        var i=items[0].dataIndex;
        return wwLabels[i]+' ('+dateLabels[i]+')';
      }},label:function(item){{
        if(item.raw==null) return null;
        if(item.dataset.label==='생산량') return '생산량: '+item.raw.toLocaleString()+'개';
        return item.dataset.label+': '+Math.round(item.raw).toLocaleString()+' ppm';
      }},afterBody:function(items){{
        var i=items[0].dataIndex;
        return i===n-1 ? '⚠️ 최신 주차' : '예측 구간';
      }}}}}}
    }},
    scales:{{
      y1:{{type:'linear',position:'left',
        title:{{display:true,text:'생산량(개)',font:{{size:7,weight:'700'}}}},
        grid:{{color:'#eef0f2'}},
        ticks:{{font:{{size:7,weight:'700'}},color:'#94a3b8',
          callback:function(v){{return v>=1000?(v/1000).toFixed(0)+'k':v;}}}},
        max:y1Max}},
      y2:{{type:'linear',position:'right',
        title:{{display:true,text:'불량 ppm',font:{{size:7,weight:'700'}}}},
        grid:{{display:false}},
        ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563',
          callback:function(v){{return (v/1000).toFixed(0)+'k';}}}},min:0}},
      x:{{grid:{{display:false}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563',maxRotation:0}}}}
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
  var xLabel    = {_json.dumps(j_shap_x_label)};
  var yLabel    = {_json.dumps(j_shap_y_label)};
  var ctx = document.getElementById('c-shap-trend'); if(!ctx) return;
  var ds=[
    {{label:'grade1(불량)',data:highPts,backgroundColor:'rgba(220,38,38,0.6)',pointRadius:3}},
    {{label:'grade4(정상)',data:normalPts,backgroundColor:'rgba(59,130,246,0.4)',pointRadius:2.5}},
  ];
  new Chart(ctx,{{type:'scatter',data:{{datasets:ds}},options:{{responsive:true,maintainAspectRatio:false,animation:false,
    plugins:{{legend:{{display:true,position:'top',labels:{{boxWidth:7,font:{{size:8,weight:'700'}}}}}}}},
    scales:{{
      x:{{title:{{display:true,text:xLabel,font:{{size:7,weight:'700'}}}},grid:{{color:'#eef0f2'}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563'}}}},
      y:{{title:{{display:true,text:yLabel,font:{{size:7,weight:'700'}}}},grid:{{color:'#eef0f2'}},ticks:{{font:{{size:7,weight:'700'}},color:'#4b5563'}}}}
    }}
  }}}});
}})();

// L4: 피처 임계값 scatter (feat1, feat2)
(function(){{
  function drawFeatScatter(canvasId, highPts, medPts, threshold) {{
    var el = document.getElementById(canvasId); if(!el) return;
    var ds = [
      {{label:'grade1(불량)', data:highPts, backgroundColor:'rgba(220,38,38,0.65)', pointRadius:2.5, pointHoverRadius:4}},
      {{label:'grade4(정상)', data:medPts,  backgroundColor:'rgba(59,130,246,0.4)',  pointRadius:2,   pointHoverRadius:3}},
    ];
    var thresholdPlugin = {{
      id:'thr-'+canvasId,
      afterDraw: function(chart) {{
        if(threshold===null||threshold===undefined) return;
        var xs=chart.scales.x, ys=chart.scales.y, xp=xs.getPixelForValue(threshold), c2=chart.ctx;
        c2.save(); c2.beginPath(); c2.moveTo(xp,ys.top); c2.lineTo(xp,ys.bottom);
        c2.strokeStyle='#dc2626'; c2.lineWidth=1.5; c2.setLineDash([4,3]); c2.stroke();
        c2.setLineDash([]); c2.font='bold 7px sans-serif'; c2.fillStyle='#dc2626';
        c2.textAlign='left'; c2.fillText('임계',xp+2,ys.top+10); c2.restore();
      }}
    }};
    new Chart(el, {{
      type:'scatter', data:{{datasets:ds}}, plugins:[thresholdPlugin],
      options:{{
        responsive:true, maintainAspectRatio:false, animation:false,
        plugins:{{legend:{{display:false}}, tooltip:{{callbacks:{{label:function(c){{return '('+c.parsed.x.toFixed(3)+', '+c.parsed.y.toFixed(6)+')';}}}}}}  }},
        scales:{{
          x:{{grid:{{color:'#eef0f2'}},ticks:{{font:{{size:6,weight:'700'}},color:'#6b7280',maxTicksLimit:6}}}},
          y:{{title:{{display:true,text:'pred',font:{{size:6,weight:'700'}}}},grid:{{color:'#eef0f2'}},ticks:{{font:{{size:6}},color:'#6b7280',maxTicksLimit:5}}}}
        }}
      }}
    }});
  }}
  drawFeatScatter('c-fs1', {j_fs1_high}, {j_fs1_med}, {j_fs1_threshold});
  drawFeatScatter('c-fs2', {j_fs2_high}, {j_fs2_med}, {j_fs2_threshold});
}})();

// L2: Feature Importance Top 5 (수평 바 차트)
(function(){{
  var ctx = document.getElementById('c-fi-top'); if(!ctx) return;
  var labels = {j_fi_top4_labels};
  var values = {j_fi_top4_values};
  if(!labels.length){{
    labels=['X1064','X592','X739','X1083'];
    values=[0.42,0.28,0.17,0.13];
  }}
  var maxVal = Math.max.apply(null, values) || 1;
  new Chart(ctx, {{
    type: 'bar',
    data: {{
      labels: labels,
      datasets: [{{
        data: values,
        backgroundColor: labels.map(function(_,i){{ return i===0?'#1e3a5f':'#374151'; }}),
        borderWidth: 0,
        barThickness: 12,
      }}]
    }},
    options: {{
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {{
        legend: {{display: false}},
        tooltip: {{callbacks: {{label: function(c){{ return ' '+c.parsed.x.toFixed(1)+'%'; }}}}}}
      }},
      scales: {{
        x: {{
          display: true,
          grid: {{color:'#eef0f2'}},
          ticks: {{font:{{size:7,weight:'700'}}, color:'#6b7280', maxTicksLimit:5,
            callback: function(v){{ return v.toFixed(1)+'%'; }}
          }},
          max: maxVal * 1.15
        }},
        y: {{
          grid: {{display: false}},
          ticks: {{font:{{size:8,weight:'700'}}, color:'#111827'}}
        }}
      }}
    }}
  }});
}})();

// R3: 이상 피처 분포 scatter — x=ufs_serial 순서, y=피처값(정규화)
// 원본 pts_high/pts_med: {{x:피처값, y:reg_pred}} 형태
// → x축: 전체 합쳐서 인덱스 부여, y축: 원본 x(피처값) 사용, 0~1 정규화
(function(){{
  var ctx = document.getElementById('c-feat-scatter'); if(!ctx) return;
  var rawHigh = {_j_feat_scatter_high};
  var rawMed  = {_j_feat_scatter_med};
  if(!rawHigh.length && !rawMed.length){{
    rawHigh=[{{x:0.82,y:0.91}},{{x:0.78,y:0.85}},{{x:0.91,y:0.87}}];
    rawMed=[{{x:0.55,y:0.5}},{{x:0.43,y:0.6}},{{x:0.61,y:0.4}},{{x:0.38,y:0.55}}];
  }}
  // y축 = 피처값(원본 x 컬럼), 0~1 정규화
  var allFeatVals = rawHigh.map(function(p){{return p.x;}}).concat(rawMed.map(function(p){{return p.x;}}));
  var minV = Math.min.apply(null,allFeatVals), maxV = Math.max.apply(null,allFeatVals);
  var rng = maxV - minV || 1;
  function normY(v){{ return Math.round((v-minV)/rng*1000)/1000; }}
  // x축 = 전체 unit을 합산한 뒤 인덱스 순서 (med 먼저, high 뒤에)
  var offset = rawMed.length;
  var medPts  = rawMed.map(function(p,i){{  return {{x:i,          y:normY(p.x)}}; }});
  var highPts = rawHigh.map(function(p,i){{ return {{x:offset+i,   y:normY(p.x)}}; }});
  new Chart(ctx, {{
    type: 'scatter',
    data: {{
      datasets: [
        {{label:'전체 unit', data:medPts,  backgroundColor:'rgba(99,130,190,0.45)', pointRadius:2.5, pointHoverRadius:4}},
        {{label:'이상 unit', data:highPts, backgroundColor:'rgba(220,38,38,0.85)',  pointRadius:4,   pointHoverRadius:6,
          pointStyle:'crossRot', borderColor:'rgba(220,38,38,0.85)', borderWidth:2}},
      ]
    }},
    options: {{
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {{
        legend: {{
          display: true, position: 'top',
          labels: {{boxWidth:8, font:{{size:7,weight:'700'}}, padding:6}}
        }},
        tooltip: {{callbacks: {{label: function(c){{
          return c.dataset.label+': '+c.parsed.y.toFixed(3);
        }}}}}}
      }},
      scales: {{
        x: {{
          display: true,
          title: {{display:true, text:'ufs_serial 순서', font:{{size:7,weight:'700'}}, color:'#6b7280'}},
          grid: {{display:false}},
          ticks: {{font:{{size:7,weight:'700'}}, color:'#6b7280', maxTicksLimit:6}}
        }},
        y: {{
          min: 0, max: 1,
          grid: {{color:'#eef0f2'}},
          ticks: {{font:{{size:7,weight:'700'}}, color:'#6b7280', maxTicksLimit:6,
            callback: function(v){{ return v.toFixed(1); }}
          }}
        }}
      }}
    }}
  }});
}})();

{custom_chart_js}
{replace_chart_js}

/* === 통합 차트 편집 모드 ===
   외부(부모)에서 'SET_CHART_EDIT_MODE' 메시지로 모드를 ON/OFF.
   ON일 때만:
     - 단일 클릭        → 해당 섹션(자체 박스 크기)을 선택 + 액션 메뉴
     - 드래그           → 박스(드래그 영역)를 선택 + 액션 메뉴
   액션 메뉴: 수정 / 설명 / 삭제
   메뉴를 닫지 않고 자유 프롬프트를 쓰려면 부모 채팅창에 직접 입력. */
(function(){{
  var editMode=false;
  var menu=document.getElementById('ia-action-menu');
  var chartMenu=document.getElementById('ia-chart-menu');
  var overlay=document.getElementById('ia-drag-overlay');
  var selBox=document.getElementById('ia-selection-box');
  if(!selBox){{
    selBox=document.createElement('div');selBox.id='ia-selection-box';
    document.body.appendChild(selBox);
  }}
  var selected=null;       /* {{kind:'section'|'box', sid?, label?, rect:{{x,y,w,h}}, hits?:[sid]}} */
  var highlighted=[];      /* 선택된 섹션 DOM */

  function getSnap(){{
    var snap=[],pr=document.querySelector('.slide').getBoundingClientRect();
    document.querySelectorAll('[data-sid]').forEach(function(el){{
      var r=el.getBoundingClientRect();
      snap.push({{sid:el.getAttribute('data-sid'),label:el.getAttribute('data-section')||el.getAttribute('data-sid'),
        rect:{{x:Math.round(r.left-pr.left),y:Math.round(r.top-pr.top),w:Math.round(r.width),h:Math.round(r.height)}}}});
    }});return snap;
  }}
  function send(p){{window.parent.postMessage({{type:'ia_event',payload:p}},'*');}}

  function clearSelection(){{
    highlighted.forEach(function(el){{el.classList.remove('ia-selected');}});
    highlighted=[];
    selBox.style.display='none';
    selected=null;
  }}
  function hideMenu(){{menu.style.display='none';chartMenu.style.display='none';}}
  function showMenuAt(x,y){{
    menu.style.display='block';menu.style.left=x+'px';menu.style.top=y+'px';
  }}
  function showChartMenuAt(x,y){{
    chartMenu.style.display='block';chartMenu.style.left=x+'px';chartMenu.style.top=y+'px';
  }}

  function selectSection(el,clientX,clientY){{
    clearSelection();
    el.classList.add('ia-selected');
    highlighted=[el];
    var pr=document.querySelector('.slide').getBoundingClientRect();
    var r=el.getBoundingClientRect();
    selected={{
      kind:'section',
      sid:el.getAttribute('data-origin-sid')||el.getAttribute('data-sid'),
      label:el.getAttribute('data-section')||el.getAttribute('data-sid'),
      rect:{{x:Math.round(r.left-pr.left),y:Math.round(r.top-pr.top),w:Math.round(r.width),h:Math.round(r.height)}}
    }};
    showMenuAt(clientX,clientY);
  }}
  function selectBox(rectClient){{
    clearSelection();
    var pr=document.querySelector('.slide').getBoundingClientRect();
    var dr={{
      x:Math.round(rectClient.x-pr.left),
      y:Math.round(rectClient.y-pr.top),
      w:Math.round(rectClient.w),
      h:Math.round(rectClient.h)
    }};
    /* 박스 안에 들어온 섹션들 수집 (40% 이상 겹친 것만) */
    var snap=getSnap();
    var hits=[];
    snap.forEach(function(s){{
      var ix=Math.max(0,Math.min(dr.x+dr.w,s.rect.x+s.rect.w)-Math.max(dr.x,s.rect.x));
      var iy=Math.max(0,Math.min(dr.y+dr.h,s.rect.y+s.rect.h)-Math.max(dr.y,s.rect.y));
      var sa=s.rect.w*s.rect.h;
      if(sa>0 && (ix*iy)/sa>0.4) hits.push(s);
    }});
    hits.forEach(function(s){{
      var el=document.querySelector('[data-sid="'+s.sid+'"]');
      if(el){{el.classList.add('ia-selected');highlighted.push(el);}}
    }});
    /* 시각적 선택 박스 (드래그한 영역) */
    selBox.style.display='block';
    selBox.style.left=rectClient.x+'px';
    selBox.style.top=rectClient.y+'px';
    selBox.style.width=rectClient.w+'px';
    selBox.style.height=rectClient.h+'px';
    selected={{
      kind:'box',
      rect:dr,
      hits:hits.map(function(s){{return s.sid;}}),
      labels:hits.map(function(s){{return s.label;}})
    }};
    /* 액션 메뉴 위치: 박스 우하단 */
    showMenuAt(rectClient.x+rectClient.w+6, rectClient.y+rectClient.h+6);
  }}

  function dispatchAction(actionKind){{
    if(!selected){{hideMenu();return;}}
    var layout=getSnap();
    if(selected.kind==='section'){{
      var label=selected.label||selected.sid;
      var prompt=(actionKind==='remove')
        ? (label+' 섹션을 삭제해 주세요.')
        : (label+' 섹션을 수정하고 싶습니다.');
      send({{
        action:actionKind==='remove'?'remove':'modify',
        sid:selected.sid, label:label,
        bbox:selected.rect, layout:layout, prompt:prompt
      }});
    }} else {{
      /* 박스 선택 */
      var hits=selected.hits||[];
      var labels=(selected.labels||[]).join(', ');
      var pos=selected.rect.x<640?'left_col':'right_col';
      var hasHits=hits.length>0;
      var prompt=(actionKind==='remove')
        ? (hasHits?('드래그한 영역('+labels+')을 삭제해 주세요.'):'드래그한 빈 영역을 정리해 주세요.')
        : (hasHits?('드래그한 영역('+labels+')을 합쳐서 수정해 주세요.'):'드래그한 빈 영역에 새 차트/표를 추가해 주세요.');
      send({{
        action: actionKind==='remove'?'remove':(hasHits?'modify':'add'),
        position: pos,
        sids: hits, labels: selected.labels||[],
        bbox: selected.rect, layout: layout,
        prompt: prompt
      }});
    }}
    hideMenu();
    clearSelection();
  }}

  document.getElementById('act-edit').addEventListener('click',function(e){{
    e.stopPropagation();
    if(!selected) return;
    var r=menu.getBoundingClientRect();
    menu.style.display='none';
    showChartMenuAt(r.right+4, r.top);
  }});
  document.getElementById('act-delete').addEventListener('click',function(e){{
    e.stopPropagation();
    if(!selected) return;
    var sid=selected.kind==='section'?selected.sid:null;
    var sids=selected.kind==='box'?(selected.hits||[]):null;
    hideMenu();clearSelection();
    if(sid) send({{action:'remove',sid:sid}});
    else if(sids&&sids.length) sids.forEach(function(s){{send({{action:'remove',sid:s}});}});
  }});
  document.querySelectorAll('#ia-chart-menu .chart-item').forEach(function(item){{
    item.addEventListener('click',function(e){{
      e.stopPropagation();
      if(!selected) return;
      var chartType=item.getAttribute('data-chart');
      var sid=selected.kind==='section'?selected.sid:(selected.hits&&selected.hits[0])||null;
      hideMenu();clearSelection();
      if(sid) send({{action:'change_chart',chart_type:chartType,target_sid:sid}});
    }});
  }});

  /* 빈 곳 클릭/ESC → 선택 해제 */
  document.addEventListener('keydown',function(e){{
    if(e.key==='Escape'){{hideMenu();clearSelection();}}
  }});

  /* 드래그 진행 상태 */
  var drag={{active:false,startX:0,startY:0,moved:false}};

  document.addEventListener('mousedown',function(e){{
    if(!editMode) return;
    if(e.button!==0) return;
    if(e.target.closest('#ia-action-menu')) return;
    if(e.target.closest('#ia-chart-menu')) return;
    /* 액션 메뉴 떠있을 때 다른 곳 누르면 닫고 시작 */
    hideMenu();
    drag.active=true;drag.moved=false;
    drag.startX=e.clientX;drag.startY=e.clientY;
  }});
  document.addEventListener('mousemove',function(e){{
    if(!editMode||!drag.active) return;
    var dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
    if(Math.abs(dx)<5&&Math.abs(dy)<5) return;
    drag.moved=true;
    overlay.style.display='block';
    overlay.style.left=Math.min(e.clientX,drag.startX)+'px';
    overlay.style.top=Math.min(e.clientY,drag.startY)+'px';
    overlay.style.width=Math.abs(dx)+'px';overlay.style.height=Math.abs(dy)+'px';
  }});
  document.addEventListener('mouseup',function(e){{
    if(!editMode||!drag.active) return;
    drag.active=false;overlay.style.display='none';
    var dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;
    if(!drag.moved||Math.abs(dx)<10&&Math.abs(dy)<10){{
      /* 클릭으로 간주 → 섹션 선택 */
      var sec=e.target.closest('[data-sid]');
      if(sec){{
        e.preventDefault();
        selectSection(sec,e.clientX,e.clientY);
      }} else {{
        clearSelection();
      }}
      return;
    }}
    /* 드래그 박스 선택 */
    var rc={{
      x:Math.min(e.clientX,drag.startX),
      y:Math.min(e.clientY,drag.startY),
      w:Math.abs(dx),h:Math.abs(dy)
    }};
    selectBox(rc);
  }});

  /* 부모 메시지: 모드 ON/OFF + 강제 초기화 */
  window.addEventListener('message',function(e){{
    if(!e.data) return;
    if(e.data.type==='SET_CHART_EDIT_MODE'){{
      editMode=!!e.data.value;
      document.body.classList.toggle('ia-edit-mode',editMode);
      document.body.style.cursor=editMode?'crosshair':'';
      if(!editMode){{hideMenu();clearSelection();}}
    }}
    if(e.data.type==='CLEAR_CHART_EDIT'){{
      hideMenu();clearSelection();
    }}
  }});
}})();
</script>
</body>
</html>"""


    # hidden_sections: 숨길 섹션 sid 목록 → JS로 display:none 처리
    hidden_sids = report_data.get("hidden_sections", [])
    if hidden_sids:
        import json as _json
        sids_js = _json.dumps(hidden_sids)
        hide_script = (
            f'<script>(function(){{var h={sids_js};'
            'h.forEach(function(s){'
            'var e=document.querySelector(\'[data-sid="\'+s+\'"]\');'
            'if(!e)return;'
            'e.style.display="none";'
            'var p=e.previousElementSibling;'
            'if(p&&p.classList&&p.classList.contains("inum"))p.style.display="none";'
            '});}})()</script>'
        )
        html = html.replace("</body>", hide_script + "\n</body>", 1)

    return html
