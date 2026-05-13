"""
Agent가 사용하는 tool 함수들.
각 함수는 Claude API tool_use의 실제 실행 로직.
"""
import os
import pandas as pd
import numpy as np
from scipy import stats
from datetime import datetime, timedelta

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

def _load(filename: str) -> pd.DataFrame:
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"{filename} 파일을 data/ 폴더에 넣어주세요.")
    return pd.read_csv(path)


# ── ① 기간 추론 ──────────────────────────────────────────────
def infer_period(user_text: str) -> dict:
    """
    사용자 입력에서 기간 레이블만 추론 (날짜 데이터 없으므로 레이블만 반환).
    반환: { label: "이번 주" }
    """
    text = user_text.lower()
    if "이번 주" in text or "이번주" in text:
        label = "이번 주"
    elif "지난 주" in text or "지난주" in text:
        label = "지난 주"
    elif "이번 달" in text or "이번달" in text:
        label = "이번 달"
    else:
        label = "전체 기간"

    return {"label": label}


# ── ② 데이터 스캔 ─────────────────────────────────────────────
def scan_data(start: str = "", end: str = "") -> dict:
    """
    val 데이터 스캔 (날짜 필터 없이 전체 val 사용).
    반환: lot/unit 수, HIGH 비율, 가장 위험한 lot/wafer
    """
    units = _load("dashboard_units.csv")

    period = units[units["split"] == "val"]

    if period.empty:
        return {"error": "val 데이터가 없습니다."}

    total = len(period)
    high = (period["risk"] == "HIGH").sum()
    med = (period["risk"] == "MED").sum()
    low = (period["risk"] == "LOW").sum()

    lot_risk = (
        period.groupby("run_id")["risk"]
        .apply(lambda x: (x == "HIGH").sum())
        .sort_values(ascending=False)
    )
    top_lot = int(lot_risk.index[0]) if not lot_risk.empty else None
    top_lot_count = int(lot_risk.iloc[0]) if not lot_risk.empty else 0

    wafer_risk = (
        period.groupby(["run_id", "wafer_no"])["risk"]
        .apply(lambda x: (x == "HIGH").sum())
        .sort_values(ascending=False)
    )
    top_wafer_lot = int(wafer_risk.index[0][0]) if not wafer_risk.empty else None
    top_wafer_no = int(wafer_risk.index[0][1]) if not wafer_risk.empty else None
    top_wafer_count = int(wafer_risk.iloc[0]) if not wafer_risk.empty else 0

    unique_lots = period["run_id"].nunique()

    return {
        "period": "전체 val 데이터",
        "total_units": total,
        "unique_lots": unique_lots,
        "high_count": int(high),
        "high_ratio": round(high / total * 100, 1),
        "med_count": int(med),
        "low_count": int(low),
        "top_lot": top_lot,
        "top_lot_high_count": top_lot_count,
        "top_wafer": {"lot": top_wafer_lot, "wafer": top_wafer_no, "high_count": top_wafer_count},
    }


# ── ③ 원인 분석 ───────────────────────────────────────────────
def analyze_features(start: str = "", end: str = "", top_n: int = 10) -> dict:
    """
    해당 기간 HIGH vs LOW feature 분포 비교.
    원본 xs 데이터와 dashboard_units를 조인하여 실시간 분석.
    반환: 유의미하게 다른 feature 목록 (배율 포함)
    """
    units = _load("dashboard_units.csv")
    period_units = units[units["split"] == "val"][["ufs_serial", "risk"]]

    xs = _load("compet_xs_data.csv")
    merged = xs.merge(period_units, on="ufs_serial", how="inner")

    if merged.empty:
        return {"error": "해당 기간 feature 데이터가 없습니다."}

    feat_cols = [c for c in xs.columns if c.startswith("X")]
    high_df = merged[merged["risk"] == "HIGH"][feat_cols]

    # LOW 없으면 MED를 비교 그룹으로 사용
    low_df = merged[merged["risk"] == "LOW"][feat_cols]
    compare_group = "LOW"
    if low_df.empty:
        low_df = merged[merged["risk"] == "MED"][feat_cols]
        compare_group = "MED"

    if high_df.empty or low_df.empty:
        return {"error": "HIGH 또는 비교 그룹 데이터가 부족합니다."}

    # feature importance 순위 조회
    try:
        fi = _load("feature_importance.csv")
        fi_rank = dict(zip(fi["feature"], fi["lgbm_rank"]))
    except FileNotFoundError:
        fi_rank = {}

    results = []
    for col in feat_cols:
        h_vals = high_df[col].dropna()
        l_vals = low_df[col].dropna()
        if len(h_vals) < 5 or len(l_vals) < 5:
            continue

        h_mean = float(h_vals.mean())
        l_mean = float(l_vals.mean())

        # t-test로 유의성 검정
        _, pval = stats.ttest_ind(h_vals, l_vals, equal_var=False)

        if l_mean != 0:
            ratio = round(h_mean / abs(l_mean), 2)
        else:
            ratio = None

        results.append({
            "feature": col,
            "high_mean": round(h_mean, 4),
            "low_mean": round(l_mean, 4),
            "ratio": ratio,
            "pval": float(pval),
            "importance_rank": fi_rank.get(col, 9999),
        })

    # p-value 기준 정렬 후 top_n
    results.sort(key=lambda x: x["pval"])
    top = results[:top_n]

    # importance rank 기준 재정렬 (표시용)
    top.sort(key=lambda x: x["importance_rank"])

    return {
        "period": "전체 val 데이터",
        "compare_group": compare_group,
        "high_n": len(high_df),
        "low_n": len(low_df),
        "top_features": top,
    }


# ── feature importance 조회 ───────────────────────────────────
def get_importance(top_n: int = 50) -> dict:
    """feature_importance.csv에서 상위 feature 반환."""
    fi = _load("feature_importance.csv")
    top = fi.sort_values("lgbm_rank").head(top_n)
    return {
        "features": top[["feature", "lgbm_rank", "lgbm_gain"]].to_dict("records")
    }


# ── LOT 트렌드 데이터 조회 (Chart.js용) ──────────────────────
def get_lot_trend_data(top_n: int = 20) -> dict:
    """
    LOT별 HIGH/MED/LOW unit 수 반환 (Chart.js 바 차트용).
    """
    units = _load("dashboard_units.csv")
    val   = units[units["split"] == "val"]

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
