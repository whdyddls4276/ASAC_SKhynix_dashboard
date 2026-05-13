"""
compute_shap_report.py
서로게이트 LightGBM + TreeSHAP으로 피처 기여도 분석
→ frontend/report_data.json 의 shap_data 필드를 proper SHAP 값으로 업데이트

실행:
    cd 기업/5_agent
    python compute_shap_report.py
"""
import json
import pickle
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import shap
import lightgbm as lgb

warnings.filterwarnings("ignore")

ROOT   = Path(__file__).parent.parent
DATA   = ROOT / "0_data"
RA_DIR = ROOT / "4_output" / "residual_analysis" / "20-101-002"
OUT    = Path(__file__).parent / "frontend" / "report_data.json"

STUDY_ID = "20-101-002"
TOP_N    = 20
HIGH_THR = 0.0038
LOW_THR  = 0.002

print("=== SHAP 분석 (Surrogate LightGBM + TreeSHAP) ===")

# ── 1. 모델에서 사용한 피처 목록 로드 ─────────────────────────────────────
print("[1] 피처 목록 로드...")
with open(RA_DIR / f"reproduced_reg_models_{STUDY_ID}.pkl", "rb") as f:
    reg = pickle.load(f)

selected_cols = reg["selected_cols"]   # 616개 raw X 피처
print(f"  Raw features: {len(selected_cols)}")

# ── 2. test xs 로드 & unit 집계 ───────────────────────────────────────────
print("[2] xs_data 로드 & unit 집계 (test split)...")
xs = pd.read_csv(
    DATA / "compet_xs_data.csv",
    usecols=["ufs_serial", "split"] + selected_cols,
)
xs_test = xs[xs["split"] == "test"].copy()
print(f"  Test dies: {len(xs_test):,}")

# mean / std / min / max / median / range 집계
unit_agg = xs_test.groupby("ufs_serial")[selected_cols].agg(
    ["mean", "std", "min", "max", "median"]
)
unit_agg.columns = [f"{c}_{a}" for c, a in unit_agg.columns]
for col in selected_cols:
    unit_agg[f"{col}_range"] = unit_agg[f"{col}_max"] - unit_agg[f"{col}_min"]
unit_agg = unit_agg.reset_index()
print(f"  Unit features: {unit_agg.shape[1] - 1:,}")

# ── 3. 예측값 로드 ────────────────────────────────────────────────────────
print("[3] y_pred 로드...")
ys_test  = pd.read_csv(DATA / "compet_ys_test_data.csv")
res_test = pd.read_csv(RA_DIR / f"result_test_{STUDY_ID}.csv")
unit_pred = ys_test[["ufs_serial"]].copy()
unit_pred["y_pred"] = res_test["y_pred"].values

unit_data = unit_agg.merge(unit_pred, on="ufs_serial", how="inner")
print(f"  Units: {len(unit_data):,}  |  y_pred mean={unit_data['y_pred'].mean():.5f}")

# ── 4. 피처 선택 (res_importance 기반 TOP 500) ──────────────────────────
print("[4] 피처 선택 (res_importance 기반)...")
fi = pd.read_csv(RA_DIR / f"res_importance_{STUDY_ID}.csv")
fi_feat_cols = [f for f in fi["feature"].tolist() if f in unit_agg.columns]
top_fi_cols  = fi_feat_cols[:500] if len(fi_feat_cols) >= 50 else [
    c for c in unit_agg.columns if c != "ufs_serial"
][:500]
print(f"  Surrogate 피처: {len(top_fi_cols)}")

X_unit = unit_data[top_fi_cols].fillna(0).values
y_unit = unit_data["y_pred"].values

# ── 5. Surrogate LightGBM 학습 ───────────────────────────────────────────
print("[5] Surrogate LightGBM 학습...")
surrogate = lgb.LGBMRegressor(
    n_estimators=300,
    max_depth=5,
    num_leaves=31,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_alpha=0.1,
    reg_lambda=1.0,
    random_state=42,
    n_jobs=-1,
    verbose=-1,
)
surrogate.fit(X_unit, y_unit, feature_name=top_fi_cols)
y_surr = surrogate.predict(X_unit)
rmse = float(np.sqrt(np.mean((y_surr - y_unit) ** 2)))
ss_res = np.sum((y_surr - y_unit) ** 2)
ss_tot = np.sum((y_unit - y_unit.mean()) ** 2)
r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
print(f"  Surrogate RMSE={rmse:.6f}, R²={r2:.4f}  (높을수록 원모델 행동을 잘 설명)")

# ── 6. SHAP 계산 ─────────────────────────────────────────────────────────
print("[6] SHAP 계산 (TreeExplainer)...")
explainer = shap.TreeExplainer(surrogate)
shap_vals = explainer.shap_values(X_unit)   # (n_units, n_feats)
print(f"  SHAP array shape: {shap_vals.shape}")

# ── 7. TOP N 피처 선택 ───────────────────────────────────────────────────
print(f"[7] TOP {TOP_N} 피처 선택...")
mean_abs_shap = np.abs(shap_vals).mean(axis=0)
top_idx  = np.argsort(mean_abs_shap)[::-1][:TOP_N]
top_cols = [top_fi_cols[i] for i in top_idx]
print(f"  TOP {TOP_N}: {top_cols[:5]} ...")

# ── 8. 그룹별 SHAP 통계 ──────────────────────────────────────────────────
print("[8] 그룹별 SHAP 통계 계산...")
high_mask = unit_data["y_pred"].values >= HIGH_THR
low_mask  = unit_data["y_pred"].values <  LOW_THR
print(f"  HIGH: {high_mask.sum()}  LOW: {low_mask.sum()}  MID: {(~high_mask & ~low_mask).sum()}")

shap_data_proper = []
for rank, (col, idx) in enumerate(zip(top_cols, top_idx)):
    sv         = shap_vals[:, idx]
    feat_vals  = X_unit[:, idx]
    mabs       = float(mean_abs_shap[idx])
    high_mean  = float(sv[high_mask].mean())  if high_mask.sum() > 0 else 0.0
    low_mean   = float(sv[low_mask].mean())   if low_mask.sum()  > 0 else 0.0
    high_med   = float(np.median(sv[high_mask])) if high_mask.sum() > 0 else 0.0
    low_med    = float(np.median(sv[low_mask]))  if low_mask.sum()  > 0 else 0.0

    # effect_norm: (고위험 평균SHAP - 저위험 평균SHAP) / mean_abs_shap → 부호 방향 지시자
    eff_norm = round((high_mean - low_mean) / (mabs + 1e-12), 4) if mabs > 0 else 0.0

    parts = col.rsplit("_", 1)
    base_name = parts[0]
    agg_name  = parts[1] if len(parts) == 2 else ""

    shap_data_proper.append({
        "feature":          col,
        "base":             base_name,
        "agg":              agg_name,
        "rank":             rank + 1,
        "mean_abs_shap":    round(mabs, 8),
        "high_mean_shap":   round(high_mean, 8),
        "low_mean_shap":    round(low_mean, 8),
        "high_median_shap": round(high_med, 8),
        "low_median_shap":  round(low_med, 8),
        "high_feat_median": round(float(np.median(feat_vals[high_mask])), 6) if high_mask.sum() > 0 else 0.0,
        "low_feat_median":  round(float(np.median(feat_vals[low_mask])),  6) if low_mask.sum()  > 0 else 0.0,
        "effect_norm":      eff_norm,
        # backward compat: importance / corr (dummy 값)
        "importance":       round(mabs * 1e6, 1),
        "high_med":         round(float(np.median(feat_vals[high_mask])), 6) if high_mask.sum() > 0 else 0.0,
        "low_med":          round(float(np.median(feat_vals[low_mask])),  6) if low_mask.sum()  > 0 else 0.0,
        "global_std":       round(float(feat_vals.std()), 6),
    })

# ── 9. report_data.json 업데이트 ─────────────────────────────────────────
print("[9] report_data.json 업데이트...")
with open(OUT, "r", encoding="utf-8") as f:
    report_data = json.load(f)

report_data["shap_data"] = shap_data_proper
report_data["shap_meta"] = {
    "method":         "surrogate_lgbm_treeshap",
    "description":    "서로게이트 LightGBM (unit-level 집계피처 → y_pred) 학습 후 TreeSHAP",
    "surrogate_r2":   round(r2, 4),
    "surrogate_rmse": round(rmse, 6),
    "n_units":        int(len(unit_data)),
    "n_feats_used":   int(len(top_fi_cols)),
    "top_n":          TOP_N,
    "high_thr":       HIGH_THR,
    "low_thr":        LOW_THR,
    "n_high":         int(high_mask.sum()),
    "n_low":          int(low_mask.sum()),
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(report_data, f, ensure_ascii=False, indent=2)

print(f"\n완료!  report_data.json → shap_data {len(shap_data_proper)}개 피처 업데이트")
print(f"  Surrogate R²={r2:.4f}  HIGH={high_mask.sum()}  LOW={low_mask.sum()}")
print()
print(f"  {'RANK':<4} {'FEATURE':<20} {'mean|SHAP|':>12} {'HIGH_mean':>12} {'LOW_mean':>12}  DIR")
for item in shap_data_proper[:10]:
    d = "↑ 위험 UP" if item["effect_norm"] > 0 else "↓ 위험 DOWN"
    print(f"  {item['rank']:<4} {item['feature']:<20} {item['mean_abs_shap']:>12.6f} "
          f"{item['high_mean_shap']:>12.6f} {item['low_mean_shap']:>12.6f}  {d}")
