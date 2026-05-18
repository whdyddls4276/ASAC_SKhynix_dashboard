"""
make_shap_csv.py
SHAP-style 분석 CSV 생성 (대시보드용)
- shap_data.csv  : 피처별 고위험/저위험 effect_norm (방향 포함)
- dist_data.csv  : 피처별 그룹 분포 통계 (박스플롯용)

결과물 → Dashboard/public/ 에 복사
"""
import os
import numpy as np
import pandas as pd

# ── 경로 설정 ──────────────────────────────────────────────────────────────
XS_PATH      = r"C:\Users\Dell3571\Desktop\기업\0_data\compet_xs_data.csv"
UNITS_PATH   = r"C:\Users\Dell3571\Desktop\ASAC_SKhynix\6_분업\sk-dashboard\Dashboard\public\dashboard_units.csv"
FI_PATH      = r"C:\Users\Dell3571\Desktop\ASAC_SKhynix\6_분업\sk-dashboard\Dashboard\public\feature_importance.csv"
DASH_PUBLIC  = r"C:\Users\Dell3571\Desktop\ASAC_SKhynix\6_분업\sk-dashboard\Dashboard\public"

TOP_N = 20  # 분석할 상위 피처 수

# ── 1. 상위 피처 목록 ────────────────────────────────────────────────────
print("[1] 피처 임포턴스 로드...")
fi = pd.read_csv(FI_PATH)
# xs_data에 없는 비피처 컬럼 제외 (clf_proba_mean 등)
xs_cols = set(pd.read_csv(XS_PATH, nrows=0).columns)
fi_filtered = fi[fi["feature"].isin(xs_cols)]
top_feats = fi_filtered.nlargest(TOP_N, "lgbm_gain")["feature"].tolist()
print(f"    상위 {TOP_N}개: {top_feats[:5]} ...")

# ── 2. 원본 xs_data 로드 (필요한 컬럼만) ──────────────────────────────────
print("[2] xs_data 로드 (test split만)...")
usecols = ["ufs_serial", "split"] + top_feats
xs = pd.read_csv(XS_PATH, usecols=usecols)
xs_test = xs[xs["split"] == "test"].drop(columns="split")
print(f"    test die 수: {len(xs_test):,}")

# ── 3. die → unit 집계 (mean, std, median) ────────────────────────────────
print("[3] die→unit 집계...")
agg_mean   = xs_test.groupby("ufs_serial")[top_feats].mean()
agg_std    = xs_test.groupby("ufs_serial")[top_feats].std().fillna(0)
agg_median = xs_test.groupby("ufs_serial")[top_feats].median()

agg_mean.columns   = [f"{c}_mean"   for c in top_feats]
agg_std.columns    = [f"{c}_std"    for c in top_feats]
agg_median.columns = [f"{c}_median" for c in top_feats]

unit_feats = pd.concat([agg_mean, agg_std, agg_median], axis=1).reset_index()
print(f"    unit 수: {len(unit_feats):,}")

# ── 4. risk 라벨 합치기 ───────────────────────────────────────────────────
print("[4] risk 라벨 합치기...")
units = pd.read_csv(UNITS_PATH)[["ufs_serial", "risk"]]
merged = unit_feats.merge(units, on="ufs_serial", how="inner")
print(f"    HIGH: {(merged['risk']=='HIGH').sum():,}  MED: {(merged['risk']=='MED').sum():,}")

# ── 5. shap_data.csv 생성 ─────────────────────────────────────────────────
print("[5] shap_data.csv 생성...")
shap_rows = []
for feat in top_feats:
    col = f"{feat}_mean"
    high_vals = merged[merged["risk"] == "HIGH"][col].dropna()
    med_vals  = merged[merged["risk"] == "MED"][col].dropna()
    all_vals  = merged[col].dropna()

    global_std  = float(all_vals.std()) or 1e-10
    effect_norm = float((high_vals.median() - med_vals.median()) / global_std)

    feat_row = fi[fi["feature"] == feat].iloc[0]
    shap_rows.append({
        "feature":    feat,
        "effect_norm": round(effect_norm, 4),
        "lgbm_gain":  float(feat_row["lgbm_gain"]),
        "lgbm_rank":  int(feat_row["lgbm_rank"]) if not pd.isna(feat_row["lgbm_rank"]) else 999,
        "high_median": round(float(high_vals.median()), 6),
        "med_median":  round(float(med_vals.median()),  6),
    })

shap_df = pd.DataFrame(shap_rows).sort_values("lgbm_gain", ascending=False)
shap_out = os.path.join(DASH_PUBLIC, "shap_data.csv")
shap_df.to_csv(shap_out, index=False)
print(f"    저장: {shap_out}")
print(shap_df[["feature","effect_norm","lgbm_gain"]].to_string(index=False))

# ── 6. dist_data.csv 생성 (박스플롯용) ────────────────────────────────────
print("\n[6] dist_data.csv 생성...")
dist_rows = []
for feat in top_feats:
    col = f"{feat}_mean"
    for group in ["HIGH", "MED"]:
        vals = merged[merged["risk"] == group][col].dropna()
        dist_rows.append({
            "feature": feat,
            "group":   group,
            "mean":    round(float(vals.mean()),          6),
            "std":     round(float(vals.std()),           6),
            "q10":     round(float(vals.quantile(0.10)),  6),
            "q25":     round(float(vals.quantile(0.25)),  6),
            "median":  round(float(vals.median()),        6),
            "q75":     round(float(vals.quantile(0.75)),  6),
            "q90":     round(float(vals.quantile(0.90)),  6),
            "count":   int(vals.count()),
        })

dist_df = pd.DataFrame(dist_rows)
dist_out = os.path.join(DASH_PUBLIC, "dist_data.csv")
dist_df.to_csv(dist_out, index=False)
print(f"    저장: {dist_out}")
print(f"    행 수: {len(dist_df)} ({TOP_N} 피처 × 2 그룹)")

print("\n완료! Dashboard/public/ 에 shap_data.csv, dist_data.csv 생성됨.")
