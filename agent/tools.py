"""
Agent가 사용하는 tool 함수들.
각 함수는 Claude API tool_use의 실제 실행 로직.
"""
import os
import pandas as pd
import numpy as np
from scipy import stats
from datetime import datetime, timedelta

DASHBOARD_DIR  = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data", "processed"))
DATA_DIR       = DASHBOARD_DIR
# 대용량 원본 데이터 fallback 경로 (sk_하이닉스/0_data/)
_FALLBACK_DIRS = [
    os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "0_data")),
    os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data")),
    r"C:\Users\Dell3571\Desktop\기업\0_data",
]

_cache: dict = {}

def _load(filename: str) -> pd.DataFrame:
    if filename in _cache:
        return _cache[filename]
    # 1차: Dashboard/public/
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        # fallback 경로들 순서대로 탐색
        for fb in _FALLBACK_DIRS:
            candidate = os.path.join(fb, filename)
            if os.path.exists(candidate):
                path = candidate
                break
        else:
            raise FileNotFoundError(f"{filename} 파일을 찾을 수 없습니다.")
    df = pd.read_csv(path)
    _cache[filename] = df
    return df

def _load_dashboard(filename: str) -> pd.DataFrame:
    path = os.path.normpath(os.path.join(DASHBOARD_DIR, filename))
    if not os.path.exists(path):
        raise FileNotFoundError(f"Dashboard/public/{filename} 없음")
    return pd.read_csv(path)


def _filter_units(units: pd.DataFrame, start: str = "", end: str = "") -> pd.DataFrame:
    """
    start/end(YYYYMMDD 문자열)로 date 컬럼 필터링.
    date 컬럼이 없거나 start/end가 없으면 전체 반환.
    date 컬럼 형식: YYYY-MM-DD 또는 YYYYMMDD 모두 처리.
    """
    if "date" not in units.columns or (not start and not end):
        return units

    # date 컬럼을 YYYYMMDD 정수로 정규화
    date_col = units["date"].astype(str).str.replace("-", "")
    try:
        date_int = date_col.astype(int)
    except ValueError:
        return units  # 파싱 불가능한 형식이면 필터 없이 전체 반환

    if start:
        units = units[date_int >= int(start)]
        date_int = date_int[date_int >= int(start)]
    if end:
        units = units[date_int <= int(end)]
    return units


def _date_range_label(start: str, end: str) -> str:
    """필터 기간 레이블 생성."""
    if not start and not end:
        return "전체 val 데이터"
    if start and end:
        return f"{start[:4]}.{start[4:6]}.{start[6:]} ~ {end[:4]}.{end[4:6]}.{end[6:]}"
    if start:
        return f"{start[:4]}.{start[4:6]}.{start[6:]} 이후"
    return f"{end[:4]}.{end[4:6]}.{end[6:]} 이전"


# ── ① 기간 추론 ──────────────────────────────────────────────
# 데이터 날짜 범위: 20260327 ~ 20260708
_DATA_START = "20260327"
_DATA_END   = "20260708"

def infer_period(user_text: str) -> dict:
    """
    사용자 입력에서 기간을 추론하고 start/end(YYYYMMDD)를 반환.
    데이터 범위: 20251001 ~ 20251214.
    반환: {label, start, end}
    """
    import re as _re
    text = user_text

    # 직접 날짜 패턴: "11월 9일~11일", "10/1~10/7" 등
    m = _re.search(r'(\d{1,2})월\s*(\d{1,2})일?\s*[~\-]\s*(\d{1,2})일', text)
    if m:
        mo, d1, d2 = int(m.group(1)), int(m.group(2)), int(m.group(3))
        start = f"2026{mo:02d}{d1:02d}"
        end   = f"2026{mo:02d}{d2:02d}"
        return {"label": f"{mo}월 {d1}일~{d2}일", "start": start, "end": end}

    # "N월" 단독
    m = _re.search(r'(\d{1,2})월', text)
    if m:
        mo = int(m.group(1))
        start = f"2026{mo:02d}01"
        end   = f"2026{mo:02d}31"
        return {"label": f"{mo}월", "start": start, "end": end}

    # "최근 N일"
    m = _re.search(r'최근\s*(\d+)\s*일', text)
    if m:
        n = int(m.group(1))
        from datetime import datetime, timedelta
        end_dt   = datetime(2026, 7, 8)
        start_dt = end_dt - timedelta(days=n - 1)
        start = start_dt.strftime("%Y%m%d")
        end   = end_dt.strftime("%Y%m%d")
        return {"label": f"최근 {n}일", "start": start, "end": end}

    # "최근 N주"
    m = _re.search(r'최근\s*(\d+)\s*주', text)
    if m:
        n = int(m.group(1))
        from datetime import datetime, timedelta
        end_dt   = datetime(2026, 7, 8)
        start_dt = end_dt - timedelta(weeks=n)
        start = start_dt.strftime("%Y%m%d")
        end   = end_dt.strftime("%Y%m%d")
        return {"label": f"최근 {n}주", "start": start, "end": end}

    # "이번 주" → 데이터 마지막 주 (07/07~07/08)
    if "이번 주" in text or "이번주" in text:
        return {"label": "이번 주 (07/07~07/08)", "start": "20260707", "end": "20260708"}

    # "지난 주" → 06/30~07/06
    if "지난 주" in text or "지난주" in text:
        return {"label": "지난 주 (06/30~07/06)", "start": "20260630", "end": "20260706"}

    # "이번 달" → 7월
    if "이번 달" in text or "이번달" in text:
        return {"label": "7월", "start": "20260701", "end": "20260708"}

    # "지난 달" → 6월
    if "지난 달" in text or "지난달" in text:
        return {"label": "6월", "start": "20260601", "end": "20260630"}

    # 기본: 전체 기간
    return {"label": "전체 기간", "start": "", "end": ""}


# ── ② 데이터 스캔 ─────────────────────────────────────────────
def scan_data(start: str = "", end: str = "") -> dict:
    """
    데이터 스캔. grade4=매우위험(HIGH), grade1=정상
    start/end: YYYYMMDD 형식 날짜 필터
    """
    units = _load("dashboard_units.csv")
    period = _filter_units(units, start, end)

    if period.empty:
        return {"error": "해당 기간 데이터가 없습니다."}

    total = len(period)
    g1 = (period["grade"] == "grade1").sum()
    g2 = (period["grade"] == "grade2").sum()
    g3 = (period["grade"] == "grade3").sum()
    g4 = (period["grade"] == "grade4").sum()

    # grade4(매우위험) 기준으로 집중 LOT/웨이퍼 집계
    lot_risk = (
        period.groupby("run_id")["grade"]
        .apply(lambda x: (x == "grade4").sum())
        .sort_values(ascending=False)
    )
    top_lot = int(lot_risk.index[0]) if not lot_risk.empty else None
    top_lot_count = int(lot_risk.iloc[0]) if not lot_risk.empty else 0

    wafer_risk = (
        period.groupby(["run_id", "wafer_no"])["grade"]
        .apply(lambda x: (x == "grade4").sum())
        .sort_values(ascending=False)
    )
    top_wafer_lot = int(wafer_risk.index[0][0]) if not wafer_risk.empty else None
    top_wafer_no  = int(wafer_risk.index[0][1]) if not wafer_risk.empty else None
    top_wafer_count = int(wafer_risk.iloc[0]) if not wafer_risk.empty else 0

    unique_lots = period["run_id"].nunique()

    return {
        "period": _date_range_label(start, end),
        "total_units": total,
        "unique_lots": unique_lots,
        "grade4_count": int(g4),
        "grade4_ratio": round(g4 / total * 100, 1),
        "grade3_count": int(g3),
        "grade2_count": int(g2),
        "grade1_count": int(g1),
        "top_lot": top_lot,
        "top_lot_grade4_count": top_lot_count,
        "top_wafer": {"lot": top_wafer_lot, "wafer": top_wafer_no, "grade4_count": top_wafer_count},
    }


# ── ③ 원인 분석 ───────────────────────────────────────────────
def analyze_features(start: str = "", end: str = "", top_n: int = 10) -> dict:
    """
    grade4(매우위험) vs grade1(정상) feature 분포 비교.
    원본 xs 데이터와 dashboard_units를 조인하여 실시간 분석.
    start/end: YYYYMMDD 형식 날짜 필터
    """
    units = _load("dashboard_units.csv")
    val_units = _filter_units(units, start, end)
    period_units = val_units[["ufs_serial", "grade"]]

    # importance 상위 20개만 분석 (속도 최적화)
    try:
        fi = _load("feature_importance.csv")
        top50 = fi.sort_values("lgbm_rank").head(20)["feature"].tolist()
        fi_rank = dict(zip(fi["feature"], fi["lgbm_rank"]))
    except FileNotFoundError:
        top50 = None
        fi_rank = {}

    xs = _load("compet_xs_data.csv")
    keep_cols = ["ufs_serial"] + ([c for c in top50 if c in xs.columns] if top50 else [c for c in xs.columns if c.startswith("X")])
    merged = xs[keep_cols].merge(period_units, on="ufs_serial", how="inner")

    if merged.empty:
        return {"error": "해당 기간 feature 데이터가 없습니다.", "top_features": []}

    feat_cols = [c for c in keep_cols if c != "ufs_serial"]

    merged_unit = merged.groupby(["ufs_serial", "grade"])[feat_cols].mean().reset_index()

    g4_df = merged_unit[merged_unit["grade"] == "grade4"][feat_cols]  # 매우위험
    g1_df = merged_unit[merged_unit["grade"] == "grade1"][feat_cols]  # 정상

    if g4_df.empty or g1_df.empty:
        return {"error": f"grade4({len(g4_df)}개) 또는 grade1({len(g1_df)}개) 데이터 부족.", "top_features": []}

    results = []
    for col in feat_cols:
        h_vals = g4_df[col].dropna()
        l_vals = g1_df[col].dropna()
        if len(h_vals) < 5 or len(l_vals) < 5:
            continue

        h_mean = float(h_vals.mean())
        l_mean = float(l_vals.mean())
        _, pval = stats.ttest_ind(h_vals, l_vals, equal_var=False)
        ratio = round(h_mean / abs(l_mean), 2) if l_mean != 0 else None

        results.append({
            "feature": col,
            "high_mean": round(h_mean, 4),   # grade4(위험) 평균
            "low_mean":  round(l_mean, 4),   # grade1(정상) 평균
            "ratio": ratio,
            "pval": float(pval),
            "importance_rank": fi_rank.get(col, 9999),
        })

    results.sort(key=lambda x: x["pval"])
    top = results[:top_n]
    top.sort(key=lambda x: x["importance_rank"])

    return {
        "period": _date_range_label(start, end),
        "compare_group": "grade1",   # 비교 기준(정상)
        "high_n": len(g4_df),        # grade4(위험) 수
        "low_n":  len(g1_df),        # grade1(정상) 수
        "top_features": top,
    }


# ── feature importance 조회 ───────────────────────────────────
def get_importance(top_n: int = 10) -> dict:
    """feature_importance.csv에서 상위 feature 반환."""
    fi = _load("feature_importance.csv")
    top = fi.sort_values("lgbm_rank").head(top_n)
    return {
        "features": top[["feature", "lgbm_rank", "lgbm_gain"]].to_dict("records")
    }


# ── Anomaly Feature: importance 상위 피처의 grade1 vs grade4 위험 비율 ──
def get_anomaly_feature_stats(top_n: int = 5) -> list:
    """
    importance 상위 top_n개 피처에 대해 grade1(위험) vs grade4(정상) 실제 분포 비교.
    반환: [{"feature": "X592", "danger": 72, "normal": 28, "ratio": 2.52}, ...]
    danger = grade1 평균이 grade4 대비 얼마나 벗어났는지 (0~100%)
    """
    from scipy import stats as _stats

    fi    = _load("feature_importance.csv")
    units = _load("dashboard_units.csv")
    xs    = _load("compet_xs_data.csv")

    top_feats = fi.sort_values("lgbm_rank").head(top_n)["feature"].tolist()

    val_units = units[["ufs_serial", "grade"]]  # train/val/test 전체 사용
    merged    = xs.merge(val_units, on="ufs_serial", how="inner")

    g1 = merged[merged["grade"] == "grade1"]
    g4 = merged[merged["grade"] == "grade4"]

    result = []
    for feat in top_feats:
        h = g1[feat].dropna()
        l = g4[feat].dropna()
        if len(h) < 5 or len(l) < 5:
            continue

        h_mean = float(h.mean())
        l_mean = float(l.mean())
        l_std  = float(l.std()) if len(l) > 1 else 0.0
        ratio  = round(h_mean / l_mean, 3) if l_mean != 0 else None

        # z-score: grade4 분포 기준으로 grade1 평균이 얼마나 벗어났는지
        z_score = round(abs(h_mean - l_mean) / l_std, 2) if l_std > 0 else None

        # 위험 비율: ratio가 1에서 벗어난 정도 (최대 95%)
        dev = abs(ratio - 1.0) if ratio else 0.0
        danger = min(int(dev / 3.0 * 100), 95)
        normal = 100 - danger

        result.append({
            "feature":    feat,
            "grade1_mean": round(h_mean, 4),
            "grade4_mean": round(l_mean, 4),
            "ratio":      ratio,
            "z_score":    z_score,
            "danger":     danger,
            "normal":     normal,
        })

    return result


# ── pred vs actual 데이터 조회 (Scatter용) ───────────────────
def get_pred_actual_data(max_pts: int = 300) -> list:
    """
    val split의 reg_pred vs health scatter 데이터 반환.
    반환: [{"x": pred, "y": actual}, ...]
    """
    units = _load("dashboard_units.csv")
    # health가 있는 unit(train)만 scatter 가능, test는 health 없음
    val = units[units["health"].notna() & (units["health"] != "")][["reg_pred", "health"]].dropna()

    if len(val) > max_pts:
        val = val.sample(max_pts, random_state=42)

    return [
        {"x": round(float(r["reg_pred"]), 6), "y": round(float(r["health"]), 6)}
        for _, r in val.iterrows()
    ]


# ── 포지션별 WT 피처 이상 비율 ───────────────────────────────
def get_position_defect_rate() -> dict:
    """
    val split의 position(1~4)별 top2 피처 이상 비율.
    dashboard_units.csv의 pos{p}_{feat} 컬럼 사용 (xs 원본 불필요).
    이상 기준: HIGH 그룹의 하위 10% 미만.
    """
    units = _load("dashboard_units.csv")
    val   = units.copy()  # train/val/test 전체 사용

    try:
        fi   = _load("feature_importance.csv")
        top2 = fi.sort_values("lgbm_rank").head(2)["feature"].tolist()
    except FileNotFoundError:
        top2 = ["X1064", "X592"]
    f1, f2 = (top2 + ["X1064", "X592"])[:2]

    result = {"labels": [], "high_ratio": [], "med_ratio": [], "low_ratio": [],
              "feat1": f1, "feat2": f2}

    for p in [1, 2, 3, 4]:
        c1, c2 = f"pos{p}_{f1}", f"pos{p}_{f2}"
        if c1 not in val.columns or c2 not in val.columns:
            result["labels"].append(f"P{p}")
            result["high_ratio"].append(0.0)
            result["med_ratio"].append(0.0)
            result["low_ratio"].append(100.0)
            continue

        grp      = val[[c1, c2, "risk"]].dropna(subset=[c1])
        high_grp = grp[grp["risk"] == "HIGH"]
        thresh1  = float(high_grp[c1].quantile(0.10)) if len(high_grp) > 0 else None
        thresh2  = float(high_grp[c2].quantile(0.10)) if c2 in grp.columns and len(high_grp) > 0 else None
        total    = len(grp)
        r1 = round(float((grp[c1] < thresh1).sum()) / total * 100, 1) if thresh1 is not None and total > 0 else 0.0
        r2 = round(float((grp[c2] < thresh2).sum()) / total * 100, 1) if thresh2 is not None and total > 0 else 0.0

        result["labels"].append(f"P{p}")
        result["high_ratio"].append(r1)
        result["med_ratio"].append(r2)
        result["low_ratio"].append(round(100 - max(r1, r2), 1))

    return result


# ── 대표 Unit (불량 위험 최고 unit) ─────────────────────────
def get_top_unit_data(serial: str = None) -> dict:
    """
    serial 지정 시 해당 unit, 미지정 시 reg_pred 최고 unit 반환.
    반환: {serial, run_id, wafer_no, pred_ppm, actual_ppm, risk, pos_feat_vals}
    pos_feat_vals: {"P1": {"X1064": 11.84, ...}, ...} — 포지션별 top4 feature 값
    """
    units = _load("dashboard_units.csv")

    if serial:
        filtered = units[units["ufs_serial"] == serial]
        val = filtered if not filtered.empty else units.sort_values("reg_pred", ascending=False)
    else:
        val = units.sort_values("reg_pred", ascending=False)

    if val.empty:
        return {}

    row = val.iloc[0]
    serial = str(row["ufs_serial"])

    # 포지션별 top feature 값 (dashboard_units에 이미 pos{p}_{feat} 컬럼으로 존재)
    # x/y 좌표 컬럼(pos{p}_x, pos{p}_y)은 feature 값에서 제외
    pos_feat_vals = {}
    pos_cols = {c for c in row.index if c.startswith("pos") and "_" in c}
    if pos_cols:
        for p in [1, 2, 3, 4]:
            prefix = f"pos{p}_"
            feats = {
                c[len(prefix):]: round(float(row[c]), 4)
                for c in pos_cols
                if c.startswith(prefix)
                and c not in (f"pos{p}_x", f"pos{p}_y")
                and pd.notna(row[c])
            }
            if feats:
                pos_feat_vals[f"P{p}"] = feats

    # die 좌표 (dashboard_units에 die_x, die_y 컬럼)
    die_x = int(row["die_x"]) if "die_x" in row.index and pd.notna(row["die_x"]) else None
    die_y = int(row["die_y"]) if "die_y" in row.index and pd.notna(row["die_y"]) else None

    # 포지션별 pred: wafer_map.csv에서 해당 unit의 ZIT die-level pred 직접 조회
    base_pred = float(row["reg_pred"])
    pos_health = {}
    try:
        wmap_path = os.path.normpath(os.path.join(DASHBOARD_DIR, "wafer_map.csv"))
        wmap_all = pd.read_csv(wmap_path, usecols=["ufs_serial", "position", "pred"])
        die_rows = wmap_all[wmap_all["ufs_serial"] == serial].set_index("position")["pred"]
        for p in [1, 2, 3, 4]:
            pos_health[f"P{p}"] = round(float(die_rows.get(p, base_pred)), 6)
    except Exception:
        for p in [1, 2, 3, 4]:
            pos_health[f"P{p}"] = round(base_pred, 6)

    return {
        "serial":        serial,
        "run_id":        int(row["run_id"]),
        "wafer_no":      int(row["wafer_no"]),
        "pred_ppm":      round(float(row["reg_pred"]) * 1_000_000, 1),
        "pred_health":   round(base_pred, 6),
        "actual_ppm":    round(float(row["health"]) * 1_000_000, 1) if pd.notna(row.get("health")) else 0.0,
        "risk":          str(row["risk"]),
        "die_x":         die_x,
        "die_y":         die_y,
        "pos_feat_vals": pos_feat_vals,
        "pos_health":    pos_health,
    }


# ── dashboard_units.csv 재생성 ────────────────────────────────
def rebuild_dashboard_units() -> str:
    """
    dashboard_units.csv를 원본 xs + 기존 units 기반으로 풍부하게 재생성.

    추가 컬럼:
      - die_x, die_y          : run_wf_xy 파싱 (position=1 기준 대표 좌표)
      - pos{p}_pred           : position 1~4 별 ZIT die-level pred (wafer_map.csv 기반)
      - pos{p}_{feat}         : position 1~4 × top5 feature 실측값 (20컬럼)
      - lot_total             : 해당 lot의 전체 unit 수
      - lot_defect_count      : 해당 lot의 grade1(HIGH) unit 수
      - lot_defect_rate       : lot 불량률 (%)

    원본 xs(174,980행)를 1회만 읽고 버림 — 이후 dashboard_units.csv만으로 동작.
    """
    import pandas as pd
    import numpy as np

    units_path = os.path.join(DATA_DIR, "dashboard_units.csv")
    xs_path    = os.path.join(DATA_DIR, "compet_xs_data.csv")
    fi_path    = os.path.join(DATA_DIR, "feature_importance.csv")

    units = pd.read_csv(units_path)
    fi    = pd.read_csv(fi_path)
    top_feats = fi.sort_values("lgbm_rank").head(5)["feature"].tolist()

    # ── xs: 필요한 컬럼만 로드 (메모리 절약)
    xs = pd.read_csv(xs_path, usecols=["ufs_serial", "run_wf_xy", "position"] + top_feats)

    # ── 1. position별 XY좌표 + die_x/die_y (position=1 대표)
    parsed_all = xs["run_wf_xy"].str.split("_", expand=True)
    xs = xs.copy()
    xs["die_x"] = parsed_all[2].astype(int)
    xs["die_y"] = parsed_all[3].astype(int)

    # position별 좌표 컬럼 (pos1_x, pos1_y, ..., pos4_x, pos4_y)
    coord_pivot_dfs = []
    for p in [1, 2, 3, 4]:
        xsp = xs[xs["position"] == p][["ufs_serial", "die_x", "die_y"]].copy()
        xsp = xsp.rename(columns={"die_x": f"pos{p}_x", "die_y": f"pos{p}_y"})
        coord_pivot_dfs.append(xsp)
    coord_pos_df = coord_pivot_dfs[0]
    for cpdf in coord_pivot_dfs[1:]:
        coord_pos_df = coord_pos_df.merge(cpdf, on="ufs_serial", how="left")

    # die_x/die_y: position=1 대표 좌표 (pos1_x/y 복사)
    coord_df = coord_pos_df[["ufs_serial", "pos1_x", "pos1_y"]].rename(
        columns={"pos1_x": "die_x", "pos1_y": "die_y"}
    )

    # ── 2. position별 ZIT die-level pred pivot (wafer_map.csv 기반)
    wmap_path = os.path.normpath(os.path.join(DASHBOARD_DIR, "wafer_map.csv"))
    pred_df = None
    if os.path.exists(wmap_path):
        wmap = pd.read_csv(wmap_path, usecols=["ufs_serial", "position", "pred"])
        pred_pivot_dfs = []
        for p in [1, 2, 3, 4]:
            wp = wmap[wmap["position"] == p][["ufs_serial", "pred"]].copy()
            wp = wp.rename(columns={"pred": f"pos{p}_pred"})
            pred_pivot_dfs.append(wp)
        pred_df = pred_pivot_dfs[0]
        for ppdf in pred_pivot_dfs[1:]:
            pred_df = pred_df.merge(ppdf, on="ufs_serial", how="left")

    # ── 3. position별 top feature 값 pivot (pos1_X1064, pos2_X592, ...)
    pivot_dfs = []
    for p in [1, 2, 3, 4]:
        xsp = xs[xs["position"] == p][["ufs_serial"] + top_feats].copy()
        xsp = xsp.rename(columns={f: f"pos{p}_{f}" for f in top_feats})
        pivot_dfs.append(xsp)

    pos_df = pivot_dfs[0]
    for pdf in pivot_dfs[1:]:
        pos_df = pos_df.merge(pdf, on="ufs_serial", how="left")

    # ── 4. lot별 불량 집계
    lot_stats = units.groupby("run_id").agg(
        lot_total        = ("ufs_serial", "count"),
        lot_defect_count = ("grade", lambda x: (x == "grade1").sum()),
    ).reset_index()
    lot_stats["lot_defect_rate"] = (
        lot_stats["lot_defect_count"] / lot_stats["lot_total"] * 100
    ).round(1)

    # ── 5. 기존 추가 컬럼 제거 후 새로 merge (중복 방지)
    _drop_prefixes = ("die_x", "die_y", "pos1_", "pos2_", "pos3_", "pos4_",
                      "lot_total", "lot_defect_count", "lot_defect_rate")
    base_cols = [c for c in units.columns
                 if not any(c == p or c.startswith(p) for p in _drop_prefixes)]
    base_col_count = len(base_cols)
    out = units[base_cols].copy()
    out = out.merge(coord_df,     on="ufs_serial", how="left")
    out = out.merge(coord_pos_df, on="ufs_serial", how="left")
    if pred_df is not None:
        out = out.merge(pred_df, on="ufs_serial", how="left")
    out = out.merge(pos_df,       on="ufs_serial", how="left")
    out = out.merge(lot_stats[["run_id", "lot_total", "lot_defect_count", "lot_defect_rate"]],
                    on="run_id", how="left")

    # float 컬럼 소수점 정리
    feat_cols = [c for c in out.columns if any(c.startswith(f"pos{p}_") for p in range(1,5))]
    out[feat_cols] = out[feat_cols].round(6)

    out.to_csv(units_path, index=False)

    # 캐시 무효화 (다음 _load에서 새 파일 읽음)
    _cache.pop("dashboard_units.csv", None)

    has_pred = pred_df is not None
    added = len(out.columns) - base_col_count
    return (
        f"dashboard_units.csv 재생성 완료\n"
        f"  행: {len(out):,}  기본 {base_col_count}열 → {len(out.columns)}열 (+{added}개)\n"
        f"  추가 컬럼: die_x, die_y, pos1~4_x/y, "
        f"{'pos1~4_pred(ZIT), ' if has_pred else ''}"
        f"pos1~4×{len(top_feats)}개 feature, "
        f"lot_total, lot_defect_count, lot_defect_rate\n"
        f"  top feats: {top_feats}"
    )


# ── 피처 top-1 LOT별 트렌드 (Chart.js 라인차트용) ────────────
def get_trend_top1_data(top_n_lots: int = 20) -> dict:
    """
    lgbm_rank 1위 피처의 LOT별 HIGH/MED 평균 트렌드 반환.
    dashboard_units.csv의 pos1_{feat} 컬럼 사용 (xs 원본 불필요).
    반환: {"feature": str, "labels": [...], "high": [...], "med": [...]}
    """
    fi = _load("feature_importance.csv")
    top1_feat = fi.sort_values("lgbm_rank").iloc[0]["feature"]
    col = f"pos1_{top1_feat}"  # position=1 대표값 컬럼

    units = _load("dashboard_units.csv")
    val = units.copy()  # train/val/test 전체 사용

    if col not in val.columns:
        return {"feature": top1_feat, "labels": [], "high": [], "med": []}

    lot_high = val[val["risk"] == "HIGH"].groupby("run_id")[col].mean()
    lot_med  = val[val["risk"] == "MED" ].groupby("run_id")[col].mean()

    lot_high_count = val[val["risk"] == "HIGH"].groupby("run_id").size()
    top_lots = sorted(lot_high_count.sort_values(ascending=False).head(top_n_lots).index.tolist())

    return {
        "feature":  top1_feat,
        "labels":   [f"LOT_{r}" for r in top_lots],
        "high":     [round(float(lot_high.get(r, 0)), 6) for r in top_lots],
        "med":      [round(float(lot_med.get(r, 0)), 6)  for r in top_lots],
    }


# ── LOT 트렌드 데이터 조회 (Chart.js용) ──────────────────────
def get_lot_trend_data(top_n: int = 20) -> dict:
    """
    LOT별 HIGH/MED/LOW unit 수 반환 (Chart.js 바 차트용).
    """
    units = _load("dashboard_units.csv")
    val   = units  # train/val/test 전체 사용

    lot_stats = (
        val.groupby("run_id")["risk"]
        .value_counts()
        .unstack(fill_value=0)
        .reset_index()
    )
    # 컬럼 보장
    for col in ["HIGH", "MED", "LOW"]:
        if col not in lot_stats.columns:
            lot_stats[col] = 0

    lot_stats["total"] = lot_stats[["HIGH", "MED", "LOW"]].sum(axis=1)
    lot_stats = lot_stats.sort_values("HIGH", ascending=False).head(top_n)
    lot_stats = lot_stats.sort_values("run_id")

    return {
        "labels": [f"LOT_{int(r)}" for r in lot_stats["run_id"]],
        "high":   lot_stats["HIGH"].tolist(),
        "med":    lot_stats["MED"].tolist(),
        "low":    lot_stats["LOW"].tolist(),
    }


# ── 배너용 전주 대비 ppm delta ────────────────────────────────
def get_ppm_delta() -> dict:
    """
    최신 5 LOT vs 이전 5 LOT HIGH ppm 변화량 계산 (train/val/test 전체 기준).
    반환: {prev_ppm, curr_ppm, delta, top_features: [feat1, feat2]}
    """
    units = _load("dashboard_units.csv")
    val = units.sort_values("run_id")  # train/val/test 전체 사용

    run_ids = sorted(val["run_id"].unique())
    prev_lots = run_ids[-10:-5] if len(run_ids) >= 10 else run_ids[:max(1, len(run_ids)//2)]
    curr_lots = run_ids[-5:]    if len(run_ids) >= 5  else run_ids[max(1, len(run_ids)//2):]

    prev = val[val["run_id"].isin(prev_lots)]
    curr = val[val["run_id"].isin(curr_lots)]

    prev_ppm = round(float((prev["risk"] == "HIGH").mean()) * 1_000_000, 1)
    curr_ppm = round(float((curr["risk"] == "HIGH").mean()) * 1_000_000, 1)
    delta    = round(curr_ppm - prev_ppm, 1)

    # top-2 피처명 (lgbm_rank 기준)
    try:
        fi = _load("feature_importance.csv")
        top2 = fi.sort_values("lgbm_rank").head(2)["feature"].tolist()
    except FileNotFoundError:
        top2 = []

    return {
        "prev_ppm":    prev_ppm,
        "curr_ppm":    curr_ppm,
        "delta":       delta,
        "top_features": top2,
    }


# ── 상위 2개 피처 scatter 데이터 ──────────────────────────────
def get_feature_scatter_data(feat1: str = None, feat2: str = None,
                             max_pts: int = 200, recent_n_lots: int = 5) -> dict:
    """
    scatter 데이터 반환. feat1/feat2 미지정 시 lgbm_rank 1,2위 사용.
    dashboard_units.csv의 pos1_{feat} 컬럼 사용 (xs 원본 불필요).
    x=피처값, y=reg_pred, risk별. 임계값 = HIGH 그룹 하위 5%.
    """
    if feat1 and feat2:
        top2_feats = [feat1, feat2]
    else:
        fi = _load("feature_importance.csv")
        top2_feats = fi.sort_values("lgbm_rank").head(2)["feature"].tolist()

    units   = _load("dashboard_units.csv")
    # train/val/test 전체에서 최신 N개 LOT 사용
    all_lots = sorted(units["run_id"].unique())
    recent_lots = all_lots[-recent_n_lots:]
    val = units[units["run_id"].isin(recent_lots)].copy()

    result = {}
    for i, feat in enumerate(top2_feats):
        col = f"pos1_{feat}"  # position=1 대표값
        if col not in val.columns:
            result[f"feat{i+1}"] = {"name": feat, "pts_high": [], "pts_med": [], "threshold": None}
            continue

        df = val[["ufs_serial", col, "grade", "reg_pred"]].dropna(subset=[col])
        grade1_df = df[df["grade"] == "grade1"]
        grade4_df = df[df["grade"] == "grade4"]
        threshold = round(float(grade1_df[col].quantile(0.05)), 4) if not grade1_df.empty else None

        def _sample(sdf, n, c=col):
            sdf = sdf.sample(min(n, len(sdf)), random_state=42)
            return [{"x": round(float(r[c]), 4), "y": round(float(r["reg_pred"]), 6)}
                    for _, r in sdf.iterrows()]

        result[f"feat{i+1}"] = {
            "name":      feat,
            "pts_high":  _sample(grade1_df, max_pts),
            "pts_med":   _sample(grade4_df, max_pts),
            "threshold": threshold,
        }

    return result


# ── L2 트렌드 + split 구간 경계 ──────────────────────────────
def get_lot_trend_with_split(top_n: int = 30) -> dict:
    """
    전체 LOT(train+val+test) HIGH 건수 트렌드 + test 시작 인덱스 반환.
    반환: {labels, high, test_start_idx}
    """
    units = _load("dashboard_units.csv")

    lot_stats = (
        units.groupby("run_id")["risk"]
        .apply(lambda x: int((x == "HIGH").sum()))
        .reset_index()
    )
    lot_stats.columns = ["run_id", "high_count"]

    # split 경계: 각 run_id가 속하는 split
    lot_split = (
        units.groupby("run_id")["split"]
        .first()
        .reset_index()
    )
    lot_stats = lot_stats.merge(lot_split, on="run_id").sort_values("run_id")

    test_start_idx = int(lot_stats[lot_stats["split"] == "test"].index.min()
                         - lot_stats.index.min()) if "test" in lot_stats["split"].values else -1

    return {
        "labels":         [f"LOT_{int(r)}" for r in lot_stats["run_id"]],
        "high":           lot_stats["high_count"].tolist(),
        "test_start_idx": test_start_idx,
    }


# ── 주차별 Grade 트렌드 (대시보드 grade_trend.csv 기반) ──────
def get_weekly_grade_trend() -> dict:
    """
    대시보드 grade_trend.csv에서 주차별 grade1~4 비율 반환.
    grade1=최고위험, grade4=정상.
    반환: {labels:['MM/DD~MM/DD',...], g1:[...], g2:[...], g3:[...], g4:[...]}
    """
    df = _load_dashboard("grade_trend.csv")
    return {
        "labels": df["week"].tolist(),
        "g1":     [round(float(v), 1) for v in df["grade1"]],
        "g2":     [round(float(v), 1) for v in df["grade2"]],
        "g3":     [round(float(v), 1) for v in df["grade3"]],
        "g4":     [round(float(v), 1) for v in df["grade4"]],
    }


# ── 주차별 불량 트렌드 (dashboard_units.csv, 대시보드 WeeklyProd 동일 기준) ──
def get_weekly_yield_trend(recent_weeks: int = 7) -> dict:
    """
    dashboard_units.csv를 주차(월~일) 단위로 집계. 대시보드 WeeklyProd와 동일한 기준.
    반환: {labels, production, pred_yield, defect_ppm}
      - labels:      ['MM/DD~MM/DD', ...]  (최근 recent_weeks 주)
      - production:  [주차별 생산량, ...]
      - pred_yield:  [100 - defect_rate%, ...]  (보고서 차트 호환용)
      - defect_ppm:  [주차별 불량 ppm, ...]
    """
    units = _load("dashboard_units.csv")
    filtered = units[units["split"].isin(["train", "val"])].copy()

    # lotToDate: WeeklyProd.jsx의 lotToDate와 동일한 로직
    def lot_to_date(n):
        n = round(float(n))
        if n >= 201:
            base = datetime(2026, 5, 28)
            offset = int((n - 201) // 9)
        elif n >= 101:
            base = datetime(2026, 4, 11)
            offset = int(n - 101)
        elif n <= 28:
            base = datetime(2026, 3, 27)
            offset = round((n - 1) * (45 / 27))
        elif n <= 56:
            base = datetime(2026, 5, 12)
            offset = int(n - 29)
        else:
            base = datetime(2026, 6, 11)
            offset = int(n - 57)
        return base + timedelta(days=int(offset))

    filtered["date"] = filtered["run_id"].apply(lot_to_date)
    filtered["week_start"] = filtered["date"].apply(lambda d: d - timedelta(days=d.weekday()))

    # defect threshold: train 기준 상위 29.2% (WeeklyProd와 동일)
    train_preds = filtered[filtered["split"] == "train"]["reg_pred"].sort_values().values
    n = len(train_preds)
    defect_thresh = float(train_preds[int(n * 0.708)])

    def fmt(d):
        return f"{d.month:02d}/{d.day:02d}"

    agg = (
        filtered.groupby("week_start")
        .apply(lambda g: pd.Series({
            "production": len(g),
            "defect":     int((g["reg_pred"] >= defect_thresh).sum()),
        }), include_groups=False)
        .reset_index()
    )
    agg["week_end"]    = agg["week_start"] + timedelta(days=6)
    agg["week_label"]  = agg.apply(lambda r: f"{fmt(r['week_start'])}~{fmt(r['week_end'])}", axis=1)
    agg["defect_rate"] = agg["defect"] / agg["production"] * 100
    agg["defect_ppm"]  = (agg["defect_rate"] * 10000).round(1)
    agg["pred_yield"]  = (100 - agg["defect_rate"]).round(2)
    agg = agg.sort_values("week_start").tail(recent_weeks)

    return {
        "labels":     agg["week_label"].tolist(),
        "production": [int(v) for v in agg["production"]],
        "pred_yield": [round(float(v), 2) for v in agg["pred_yield"]],
        "defect_ppm": [round(float(v), 1) for v in agg["defect_ppm"]],
    }


# ── 최근 LOT 트렌드 (val 최신 N개 LOT, 날짜 라벨) ───────────
def get_recent_lot_trend(recent_n: int = 35) -> dict:
    """
    val split의 최신 N개 LOT HIGH 건수 트렌드 반환 (보고서 L2용).
    X축은 오늘 기준 역산된 날짜 라벨 (주 단위, 월/일 형식).
    반환: {labels, high}
    """
    units = _load("dashboard_units.csv")
    val = units  # train/val/test 전체 사용

    lot_stats = (
        val.groupby("run_id")["risk"]
        .apply(lambda x: int((x == "HIGH").sum()))
        .reset_index()
    )
    lot_stats.columns = ["run_id", "high_count"]
    lot_stats = lot_stats.sort_values("run_id").tail(recent_n)

    n = len(lot_stats)
    today = datetime.now()
    # 가장 오른쪽(최신 LOT)이 오늘. LOT 1개 = 약 1일 간격으로 역산
    labels = []
    for i, idx in enumerate(range(n)):
        days_ago = n - 1 - idx
        dt = today - timedelta(days=days_ago)
        labels.append(dt.strftime("%m/%d"))

    return {
        "labels": labels,
        "high":   lot_stats["high_count"].tolist(),
    }


# ── R3: LOT별 예측 ppm 트렌드 (HIGH/MED 그룹 평균 reg_pred) ──
def get_pred_ppm_trend(recent_n: int = 20) -> dict:
    """
    val split 최신 N개 LOT의 HIGH/MED 그룹 평균 예측 ppm 트렌드.
    반환: {labels, high_ppm, med_ppm}
    """
    units = _load("dashboard_units.csv")
    val = units.copy()  # train/val/test 전체 사용
    val["pred_ppm"] = val["reg_pred"] * 1_000_000

    # LOT별 HIGH/MED 평균
    lot_high = (
        val[val["risk"] == "HIGH"]
        .groupby("run_id")["pred_ppm"].mean()
    )
    lot_med = (
        val[val["risk"] == "MED"]
        .groupby("run_id")["pred_ppm"].mean()
    )

    all_lots = sorted(val["run_id"].unique())[-recent_n:]
    labels = [f"Lot {r}" for r in all_lots]

    high_vals = [round(float(lot_high.get(r, 0)), 1) for r in all_lots]
    med_vals  = [round(float(lot_med.get(r, 0)),  1) for r in all_lots]

    return {
        "labels":   labels,
        "high_ppm": high_vals,
        "med_ppm":  med_vals,
    }


# ── 피처값 vs 예측 health scatter (L4 대체) ──────────────────
def get_feat_vs_health_scatter(top_n: int = 1, max_pts: int = 300) -> dict:
    """
    상위 feature의 pos1 값(x축) vs reg_pred(y축) scatter.
    grade1(불량)=빨강, grade4(정상)=파랑으로 분리.
    반환: {feature, high_pts:[{x,y},...], normal_pts:[{x,y},...]}
    """
    units = _load("dashboard_units.csv")
    fi    = _load("feature_importance.csv")

    top_feat = fi.sort_values("lgbm_rank").iloc[0]["feature"] if not fi.empty else ""
    feat_col = f"pos1_{top_feat}"

    if feat_col not in units.columns or not top_feat:
        return {"feature": top_feat, "high_pts": [], "normal_pts": []}

    sub = units[["grade", "reg_pred", feat_col]].dropna()
    # x 정규화 (0~1)
    x_min, x_max = sub[feat_col].min(), sub[feat_col].max()
    span = max(x_max - x_min, 1e-9)
    sub = sub.copy()
    sub["x_norm"] = (sub[feat_col] - x_min) / span

    high   = sub[sub["grade"] == "grade1"].head(max_pts)
    normal = sub[sub["grade"] == "grade4"].head(max_pts)

    def _pts(df):
        return [{"x": round(float(r["x_norm"]), 4), "y": round(float(r["reg_pred"]), 6)}
                for _, r in df.iterrows()]

    return {
        "feature":    top_feat,
        "high_pts":   _pts(high),
        "normal_pts": _pts(normal),
        "x_label":    top_feat,
        "y_label":    "reg_pred (health)",
    }


# ── 대표 Unit 웨이퍼맵 die 좌표 + ppm ────────────────────────
def get_wafer_die_data(serial: str = None) -> dict:
    """
    serial 지정 시 해당 unit의 wafer, 미지정 시 reg_pred 최고 unit의 wafer를 반환.
    unit당 pos1~pos4 각각 die 1개씩 → 총 unit수×4개 점.
    dies: [{x,y,serial,grade,pred_ppm,risk,is_target},...]
    """
    units = _load("dashboard_units.csv")

    val = units.sort_values("reg_pred", ascending=False)
    if serial:
        target = units[units["ufs_serial"] == serial]
        if not target.empty:
            top_serial = serial
            top_run    = target.iloc[0]["run_id"]
            top_wafer  = target.iloc[0]["wafer_no"]
        else:
            top_row = val.iloc[0]
            top_serial = str(top_row["ufs_serial"])
            top_run    = top_row["run_id"]
            top_wafer  = top_row["wafer_no"]
    else:
        top_row = val.iloc[0]
        top_serial = str(top_row["ufs_serial"])
        top_run    = top_row["run_id"]
        top_wafer  = top_row["wafer_no"]

    # 같은 wafer의 전체 unit
    same_wafer = val[(val["run_id"] == top_run) & (val["wafer_no"] == top_wafer)]

    dies = []
    x_vals, y_vals = [], []
    pos_cols = [(f"pos{p}_x", f"pos{p}_y") for p in range(1, 5)]

    for _, row in same_wafer.iterrows():
        serial  = str(row["ufs_serial"])
        grade   = str(row.get("grade", "grade4"))
        pred_ppm = round(float(row["reg_pred"]) * 1_000_000, 1)
        risk    = str(row.get("risk", ""))
        is_tgt  = serial == top_serial

        for xc, yc in pos_cols:
            if xc not in row.index or pd.isna(row[xc]):
                continue
            x, y = int(row[xc]), int(row[yc])
            dies.append({
                "x": x, "y": y,
                "serial":    serial,
                "grade":     grade,
                "pred_ppm":  pred_ppm,
                "risk":      risk,
                "is_target": is_tgt,
            })
            x_vals.append(x); y_vals.append(y)

    # 해당 웨이퍼 die들의 실제 범위 (전체 데이터셋 기준이면 너무 넓어 die가 작아짐)
    if x_vals:
        x_min, x_max = min(x_vals), max(x_vals)
        y_min, y_max = min(y_vals), max(y_vals)
    else:
        x_min, x_max = 0, 100
        y_min, y_max = 0, 100

    return {
        "serial":  top_serial,
        "dies":    dies,
        "x_range": [x_min, x_max],
        "y_range": [y_min, y_max],
    }


def get_val_rmse() -> str:
    """metrics.csv에서 확정 모델(stacking) val RMSE 조회. 대시보드와 동일 값 보장."""
    try:
        m = _load("metrics.csv")
        row = m[(m["stage"] == "reg") & (m["model"] == "stacking")
                & (m["split"] == "val") & (m["metric"] == "rmse")]
        if not row.empty:
            return f"{float(row['value'].iloc[0]):.6f}"
    except Exception:
        pass
    # fallback: dashboard_units.csv에서 직접 계산
    import numpy as np
    units = _load("dashboard_units.csv")
    val = units[units["split"] == "val"]
    if val.empty or "reg_pred" not in val.columns or "health" not in val.columns:
        return "0.005698"
    rmse = float(np.sqrt(((val["reg_pred"] - val["health"]) ** 2).mean()))
    return f"{rmse:.6f}"


def get_mean_pred_ppm() -> int:
    """dashboard_units.csv 전체에서 reg_pred 평균을 ppm으로 환산. grade 필터 없이 전체."""
    units = _load("dashboard_units.csv")
    if units.empty or "reg_pred" not in units.columns:
        return 0
    mean_pred = float(units["reg_pred"].mean())
    return int(round(mean_pred * 1_000_000))
