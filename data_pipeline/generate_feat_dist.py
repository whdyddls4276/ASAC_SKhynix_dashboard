"""
feature_dist.csv & feature_violin.json 생성 스크립트
- feature_dist.csv : FI/SHAP 상위 피처의 unit별 피처값 + health + is_defect + grade
- feature_violin.json: FI/SHAP 상위 피처별 일별 분포 (KDE)

실행: python generate_feat_dist.py
"""

import sys
import json
import csv
import numpy as np
import pandas as pd
from pathlib import Path
from scipy.stats import gaussian_kde

ROOT    = Path(__file__).parent.parent.parent
PUBLIC  = ROOT / "5_분析시스템" / "data" / "processed"
XS_PATH = ROOT / "0_data" / "compet_xs_data.csv"

print("=" * 60)
print("feature_dist.csv & feature_violin.json 생성")
print("=" * 60)

# ── 0. 필요 피처 목록 결정 (FI+SHAP 상위 30 합집합) ──────
print("\n[0] 피처 목록 결정...")
fi_df   = pd.read_csv(PUBLIC / "feature_importance.csv")
shap_df = pd.read_csv(PUBLIC / "shap_bar.csv")

top_fi   = fi_df["feature"].head(30).tolist()
top_shap = shap_df["feature"].head(30).tolist()
# die_x, die_y 제외 (분포 차트 의미 없음)
EXCLUDE = {"die_x", "die_y"}
target_feats = [f for f in dict.fromkeys(top_fi + top_shap) if f not in EXCLUDE]
print(f"  대상 피처: {len(target_feats)}개")
print(f"  {target_feats}")

# ── 1. xs 피처 로드 ────────────────────────────────────────
print("\n[1] xs 피처 로드...")
xs_feats_in_file = set(pd.read_csv(XS_PATH, nrows=0).columns)
load_feats = [f for f in target_feats if f in xs_feats_in_file]
missing_feats = [f for f in target_feats if f not in xs_feats_in_file]
print(f"  xs에서 로드: {len(load_feats)}개  |  없는 피처: {missing_feats}")

xs = pd.read_csv(XS_PATH, usecols=["ufs_serial", "run_wf_xy"] + load_feats)

# die_x, die_y가 필요한 경우 파싱 (EXCLUDE라 실제론 해당 없음)
if "die_x" in target_feats or "die_y" in target_feats:
    parts = xs["run_wf_xy"].str.split("_")
    xs["die_x"] = parts.str[-2].apply(pd.to_numeric, errors="coerce").astype("Int64")
    xs["die_y"] = parts.str[-1].apply(pd.to_numeric, errors="coerce").astype("Int64")
xs = xs.drop(columns=["run_wf_xy"])

# unit별 피처 평균 (die 4개 → unit 1개)
xs_unit = xs.groupby("ufs_serial")[load_feats].mean().reset_index()
print(f"  xs unit 수: {len(xs_unit):,}")

# ── 2. dashboard_units.csv 메타 합치기 ────────────────────
print("\n[2] 메타 합치기...")
units = pd.read_csv(PUBLIC / "dashboard_units.csv",
                    usecols=["ufs_serial", "health", "grade", "date"])
units["is_defect"] = (units["grade"].isin(["grade3", "grade4"])).astype(int)

merged = units.merge(xs_unit, on="ufs_serial", how="inner")
print(f"  merge 결과: {len(merged):,}행")

# ── 3. feature_dist.csv 저장 ─────────────────────────────
print("\n[3] feature_dist.csv 저장...")
out_cols = ["ufs_serial"] + load_feats + ["health", "is_defect"]
dist_out = merged[out_cols].copy()
dist_out.to_csv(PUBLIC / "feature_dist.csv", index=False)
print(f"  저장: feature_dist.csv ({len(dist_out):,}행 × {len(out_cols)}컬럼)")

# ── 4. feature_violin.json 생성 ───────────────────────────
print("\n[4] feature_violin.json 생성...")
# 날짜별 KDE + 통계량
merged["date"] = merged["date"].astype(str)
dates = sorted(merged["date"].unique())
print(f"  날짜 수: {len(dates)}개  ({dates[:3]}...{dates[-2:]})")

KDE_POINTS = 60  # KDE 평가 포인트 수
MIN_SAMPLE = 5   # 날짜별 최소 샘플 수

violin_rows = []
for feat in load_feats:
    col_data = merged[["date", feat]].dropna(subset=[feat])
    if len(col_data) < MIN_SAMPLE:
        continue
    for date in dates:
        sub = col_data[col_data["date"] == date][feat].dropna()
        if len(sub) < MIN_SAMPLE:
            continue
        vals = sub.values.astype(float)
        vmin, vmax = vals.min(), vals.max()
        if vmax - vmin < 1e-10:
            continue  # 분산 없으면 skip
        try:
            kde = gaussian_kde(vals, bw_method="scott")
            y_pts = np.linspace(vmin, vmax, KDE_POINTS)
            dens  = kde(y_pts)
            dens  = (dens / dens.max()).round(4)  # 최대값 1로 정규화
            kde_list = [[round(float(y), 6), round(float(d), 4)] for y, d in zip(y_pts, dens)]
        except Exception:
            continue

        violin_rows.append({
            "feature": feat,
            "date":    date,
            "kde":     kde_list,
            "q1":      round(float(np.percentile(vals, 25)), 6),
            "median":  round(float(np.median(vals)), 6),
            "q3":      round(float(np.percentile(vals, 75)), 6),
            "mean":    round(float(vals.mean()), 6),
        })

print(f"  violin 레코드: {len(violin_rows)}개 (피처×날짜)")
feat_count = len(set(r["feature"] for r in violin_rows))
print(f"  커버된 피처 수: {feat_count}개")

with open(PUBLIC / "feature_violin.json", "w", encoding="utf-8") as f:
    json.dump(violin_rows, f, ensure_ascii=False, separators=(",", ":"))

size_kb = (PUBLIC / "feature_violin.json").stat().st_size / 1024
print(f"  저장: feature_violin.json ({size_kb:.0f} KB)")

print("\n" + "=" * 60)
print("완료!")
for fname in ["feature_dist.csv", "feature_violin.json"]:
    p = PUBLIC / fname
    print(f"  {fname}: {p.stat().st_size / 1024:.0f} KB")
print("=" * 60)
