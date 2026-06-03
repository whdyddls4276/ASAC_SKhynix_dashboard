"""
SHAP 재계산 - dashboard_v3 경로 기준
"""
import sys
import pandas as pd
import numpy as np
import pickle
import json
from pathlib import Path

# ZITboost 모듈 경로
sys.path.insert(0, str(Path('C:/Users/Dell3571/Desktop/ASAC_SKhynix/3_modeling')))
sys.path.insert(0, str(Path('C:/Users/Dell3571/Desktop/ASAC_SKhynix')))

RAW     = Path('C:/Users/Dell3571/Desktop/dashboard_v3/data/raw')
PUBLIC  = Path('C:/Users/Dell3571/Desktop/dashboard_v3/data/processed')
XS_PATH = Path('C:/Users/Dell3571/Desktop/ASAC_SKhynix/0_data/compet_xs_data.csv')

print("=" * 60)
print("SHAP 재계산 시작 (train + val + test 전체)")
print("=" * 60)

# 0. 모델 로드
print("\n[0] fold_models.pkl 로드...")
with open(RAW / "fold_models.pkl", "rb") as f:
    ckpt = pickle.load(f)

feat_names  = ckpt["feature_names"]
fold_models = ckpt["fold_models"]
print(f"  피처: {len(feat_names)}개  |  fold: {len(fold_models)}개")

# 1. die 데이터 로드
print("\n[1] die 데이터 로드...")
oof_die  = pd.read_csv(RAW / "oof_die.csv");  oof_die["split"]  = "train"
val_die  = pd.read_csv(RAW / "val_die.csv");  val_die["split"]  = "val"
test_die = pd.read_csv(RAW / "test_die.csv"); test_die["split"] = "test"
all_die  = pd.concat([oof_die, val_die, test_die], ignore_index=True)
print(f"  전체 die: {len(all_die):,}행")

# 2. xs 피처 로드
print("\n[2] xs 피처 로드...")
xs_cols_in_file = set(pd.read_csv(XS_PATH, nrows=0).columns)

missing_feats = [f for f in feat_names if f.endswith("_missing")]
missing_base  = [f.replace("_missing", "") for f in missing_feats]
feat_in_xs    = [f for f in feat_names if f in xs_cols_in_file and not f.endswith("_missing")]
feat_in_meta  = [f for f in feat_names if f not in xs_cols_in_file and not f.endswith("_missing")]
print(f"  xs 피처: {len(feat_in_xs)}개 | 메타: {feat_in_meta} | missing: {len(missing_feats)}개")

extra_for_missing = [c for c in missing_base if c in xs_cols_in_file and c not in feat_in_xs]
xs_all = pd.read_csv(XS_PATH, usecols=["ufs_serial", "run_wf_xy"] + feat_in_xs + extra_for_missing)

if feat_in_meta:
    parts = xs_all["run_wf_xy"].str.split("_")
    if "die_x" in feat_in_meta:
        xs_all["die_x"] = parts.str[-2].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
    if "die_y" in feat_in_meta:
        xs_all["die_y"] = parts.str[-1].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
xs_all = xs_all.drop(columns="run_wf_xy")

for base, miss_col in zip(missing_base, missing_feats):
    if base in xs_all.columns:
        xs_all[miss_col] = xs_all[base].isna().astype(int)
    else:
        xs_all[miss_col] = 0

cols_to_drop = [c for c in extra_for_missing if c not in feat_names]
xs_all = xs_all.drop(columns=cols_to_drop, errors="ignore")

xs_merged = all_die[["ufs_serial", "split"]].merge(xs_all, on="ufs_serial", how="left")
X_all_df  = xs_merged[feat_names].copy()
X_all     = X_all_df.fillna(0).values
serials   = xs_merged["ufs_serial"].values
print(f"  X_all shape: {X_all.shape}")

# 3. SHAP 계산
import shap
print("\n[3] SHAP 계산 (fold 평균)...")
BATCH    = 2000
n        = len(X_all)
shap_sum = np.zeros((n, len(feat_names)))

for fold_i, fold_model in enumerate(fold_models):
    mu_model = fold_model.lgb_mu_
    print(f"  fold {fold_i+1}/{len(fold_models)} 계산 중...")
    explainer = shap.TreeExplainer(mu_model)
    batches   = []
    for i in range(0, n, BATCH):
        sv = explainer.shap_values(X_all[i:i+BATCH])
        batches.append(sv)
    shap_sum += np.vstack(batches)
    print(f"  fold {fold_i+1} 완료")

shap_values = shap_sum / len(fold_models)
print(f"  SHAP 완료: {shap_values.shape}")

# 4. shap_bar.csv
print("\n[4] shap_bar.csv 생성...")
mean_abs   = np.abs(shap_values).mean(axis=0)
mean_shap  = shap_values.mean(axis=0)
rank_order = np.argsort(mean_abs)[::-1]

shap_bar = pd.DataFrame({
    "feature":       [feat_names[i] for i in rank_order],
    "mean_abs_shap": mean_abs[rank_order],
    "mean_shap":     mean_shap[rank_order],
    "rank":          np.arange(1, len(feat_names) + 1),
})
shap_bar.to_csv(PUBLIC / "shap_bar.csv", index=False)
print(f"  저장 완료: {len(shap_bar)}개 피처, Top5: {shap_bar['feature'].head(5).tolist()}")

# 5. shap_beeswarm.csv (unit별 top20)
print("\n[5] shap_beeswarm.csv 생성...")
TOP_SHAP       = 20
top_feat_idx   = rank_order[:TOP_SHAP]
top_feat_names = [feat_names[i] for i in top_feat_idx]

shap_top20      = shap_values[:, top_feat_idx]
feat_vals_top20 = X_all_df[top_feat_names].values

shap_df = pd.DataFrame(shap_top20, columns=top_feat_names)
shap_df["ufs_serial"] = serials
feat_df = pd.DataFrame(feat_vals_top20, columns=[f"fv_{c}" for c in top_feat_names])
feat_df["ufs_serial"] = serials

shap_unit = shap_df.groupby("ufs_serial")[top_feat_names].mean()
feat_unit = feat_df.groupby("ufs_serial")[[f"fv_{c}" for c in top_feat_names]].mean()

beeswarm_rows = []
for rank_i, feat in enumerate(top_feat_names):
    sv_col    = shap_unit[feat]
    fv_col    = feat_unit[f"fv_{feat}"]
    fv_min    = fv_col.min(skipna=True)
    fv_max    = fv_col.max(skipna=True)
    feat_norm = ((fv_col - fv_min) / (fv_max - fv_min + 1e-12)).round(4).fillna(0)
    beeswarm_rows.append(pd.DataFrame({
        "ufs_serial": sv_col.index,
        "feature":    feat,
        "shap_value": sv_col.values,
        "feat_norm":  feat_norm.values,
        "rank":       rank_i,
    }))

shap_beeswarm = pd.concat(beeswarm_rows, ignore_index=True)
shap_beeswarm.to_csv(PUBLIC / "shap_beeswarm.csv", index=False)
total_units = shap_beeswarm["ufs_serial"].nunique()
print(f"  저장 완료: {len(shap_beeswarm):,}행, {total_units:,} unit")

# 6. shap_unit.json 생성 (unit별 non-zero top10, 프론트용)
print("\n[6] shap_unit.json 생성...")
result = {}
for serial, grp in shap_beeswarm.groupby("ufs_serial"):
    nonzero = grp[grp["shap_value"] != 0].copy()
    if nonzero.empty:
        continue
    nonzero["magnitude"] = nonzero["shap_value"].abs()
    top10 = nonzero.nlargest(10, "magnitude")[["feature", "shap_value"]]
    result[serial] = [
        {"feature": r["feature"], "shap_value": round(float(r["shap_value"]), 8)}
        for _, r in top10.iterrows()
    ]

import json
with open(PUBLIC / "shap_unit.json", "w") as f:
    json.dump(result, f, separators=(",", ":"))

import os
size = os.path.getsize(PUBLIC / "shap_unit.json")
print(f"  저장 완료: {size/1024/1024:.1f} MB, {len(result):,} unit")

print("\n" + "=" * 60)
print("완료!")
print("=" * 60)
