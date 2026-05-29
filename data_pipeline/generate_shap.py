"""
SHAP 재계산 스크립트 (단독 실행)
- shap_bar.csv   : 전체 평균 SHAP (모델 분석 페이지용)
- shap_beeswarm.csv : unit별 실제 SHAP × Top20 피처 (모델 분석 beeswarm + 드릴다운 unit SHAP)

대상: train + val + test 전체 (드릴다운 전 split 커버)
모델: ZITboost fold_models.pkl (lgb_mu_ 기준)

실행: python generate_shap.py
"""

import sys
import pandas as pd
import numpy as np
import pickle
import shap
import shutil
from pathlib import Path

ROOT    = Path(__file__).parent.parent.parent  # sk_하이닉스/
sys.path.insert(0, str(ROOT / "3_modeling"))
sys.path.insert(0, str(ROOT))

ZIT_RUN = ROOT / "5_분석시스템" / "data" / "raw"
PUBLIC  = ROOT / "5_분석시스템" / "data" / "processed"
DIST    = ROOT / "5_분석시스템" / "dashboard" / "dist"
XS_PATH = ROOT / "0_data" / "compet_xs_data.csv"

print("=" * 60)
print("SHAP 재계산 시작 (train + val + test 전체)")
print("=" * 60)

# ── 0. 모델 로드 ──────────────────────────────────────────
print("\n[0] fold_models.pkl 로드...")
with open(ZIT_RUN / "fold_models.pkl", "rb") as f:
    ckpt = pickle.load(f)

feat_names  = ckpt["feature_names"]   # 534개
fold_models = ckpt["fold_models"]     # 5 folds
print(f"  피처: {len(feat_names)}개  |  fold: {len(fold_models)}개")

# ── 1. 전체 die 데이터 로드 ───────────────────────────────
print("\n[1] die 데이터 로드 (train + val + test)...")
oof_die  = pd.read_csv(ZIT_RUN / "oof_die.csv");  oof_die["split"]  = "train"
val_die  = pd.read_csv(ZIT_RUN / "val_die.csv");  val_die["split"]  = "val"
test_die = pd.read_csv(ZIT_RUN / "test_die.csv"); test_die["split"] = "test"
all_die  = pd.concat([oof_die, val_die, test_die], ignore_index=True)
print(f"  전체 die: {len(all_die):,}행")

# ── 2. xs 피처 로드 및 정렬 ──────────────────────────────
print("\n[2] xs 피처 로드 및 feat_names 정렬...")
xs_cols_in_file = set(pd.read_csv(XS_PATH, nrows=0).columns)

# _missing 인디케이터 피처 분리
missing_feats = [f for f in feat_names if f.endswith("_missing")]
missing_base  = [f.replace("_missing", "") for f in missing_feats]
feat_in_xs   = [f for f in feat_names if f in xs_cols_in_file and not f.endswith("_missing")]
feat_in_meta = [f for f in feat_names if f not in xs_cols_in_file and not f.endswith("_missing")]
print(f"  xs 피처: {len(feat_in_xs)}개  |  메타 피처: {len(feat_in_meta)}개 {feat_in_meta}  |  missing 피처: {len(missing_feats)}개")

extra_for_missing = [c for c in missing_base if c in xs_cols_in_file and c not in feat_in_xs]
xs_all = pd.read_csv(XS_PATH, usecols=["ufs_serial", "run_wf_xy"] + feat_in_xs + extra_for_missing)

# die_x, die_y 파싱
if feat_in_meta:
    parts = xs_all["run_wf_xy"].str.split("_")
    if "die_x" in feat_in_meta:
        xs_all["die_x"] = parts.str[-2].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
    if "die_y" in feat_in_meta:
        xs_all["die_y"] = parts.str[-1].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
xs_all = xs_all.drop(columns="run_wf_xy")

# _missing 인디케이터 생성
for base, miss_col in zip(missing_base, missing_feats):
    if base in xs_all.columns:
        xs_all[miss_col] = xs_all[base].isna().astype(int)
    else:
        xs_all[miss_col] = 0

cols_to_drop = [c for c in extra_for_missing if c not in feat_names]
xs_all = xs_all.drop(columns=cols_to_drop, errors="ignore")

# all_die 순서 기준으로 merge
xs_merged = all_die[["ufs_serial", "split"]].merge(xs_all, on="ufs_serial", how="left")
X_all_df  = xs_merged[feat_names].copy()          # NaN 유지 (feat_norm 계산용)
X_all     = X_all_df.fillna(0).values             # SHAP 계산용
serials   = xs_merged["ufs_serial"].values
splits    = xs_merged["split"].values
print(f"  X_all shape: {X_all.shape}")

# ── 3. SHAP 계산 (fold 평균) ──────────────────────────────
print("\n[3] SHAP 계산 (fold 평균, 전체 die)...")
BATCH    = 2000
n        = len(X_all)
shap_sum = np.zeros((n, len(feat_names)))

for fold_i, fold_model in enumerate(fold_models):
    mu_model = fold_model.lgb_mu_
    print(f"  fold {fold_i+1}/{len(fold_models)} TreeExplainer 계산 중...")
    explainer = shap.TreeExplainer(mu_model)
    batches   = []
    for i in range(0, n, BATCH):
        sv = explainer.shap_values(X_all[i:i+BATCH])
        batches.append(sv)
    shap_sum += np.vstack(batches)

shap_values = shap_sum / len(fold_models)
print(f"  SHAP 완료: {shap_values.shape}")

# ── 4. shap_bar.csv (전체 평균, 피처 순위) ────────────────
print("\n[4] shap_bar.csv 생성...")
mean_abs  = np.abs(shap_values).mean(axis=0)
mean_shap = shap_values.mean(axis=0)
rank_order = np.argsort(mean_abs)[::-1]

shap_bar = pd.DataFrame({
    "feature":       [feat_names[i] for i in rank_order],
    "mean_abs_shap": mean_abs[rank_order],
    "mean_shap":     mean_shap[rank_order],
    "rank":          np.arange(1, len(feat_names) + 1),
})
shap_bar.to_csv(PUBLIC / "shap_bar.csv", index=False)
print(f"  저장: shap_bar.csv ({len(shap_bar)}개 피처)")
print(f"  Top5: {shap_bar['feature'].head(5).tolist()}")

# ── 5. shap_beeswarm.csv (unit별 Top20, train+val+test) ──
print("\n[5] shap_beeswarm.csv 생성 (unit별 Top20)...")
TOP_SHAP       = 20
top_feat_idx   = rank_order[:TOP_SHAP]
top_feat_names = [feat_names[i] for i in top_feat_idx]

shap_top20     = shap_values[:, top_feat_idx]        # (n_die, 20)
feat_vals_top20 = X_all_df[top_feat_names].values    # NaN 유지

# die → unit 평균
shap_df = pd.DataFrame(shap_top20, columns=top_feat_names)
shap_df["ufs_serial"] = serials
feat_df = pd.DataFrame(feat_vals_top20, columns=[f"fv_{c}" for c in top_feat_names])
feat_df["ufs_serial"] = serials

shap_unit = shap_df.groupby("ufs_serial")[top_feat_names].mean()
feat_unit = feat_df.groupby("ufs_serial")[[f"fv_{c}" for c in top_feat_names]].mean()

# feat_norm: 전체 unit 기준 0~1 min-max 정규화
beeswarm_rows = []
for rank_i, feat in enumerate(top_feat_names):
    sv_col  = shap_unit[feat]
    fv_col  = feat_unit[f"fv_{feat}"]
    fv_min  = fv_col.min(skipna=True)
    fv_max  = fv_col.max(skipna=True)
    feat_norm = ((fv_col - fv_min) / (fv_max - fv_min + 1e-12)).round(4).fillna(0)
    beeswarm_rows.append(pd.DataFrame({
        "ufs_serial": sv_col.index,
        "feature":    feat,
        "shap_value": sv_col.values,
        "feat_norm":  feat_norm.values,
        "rank":       rank_i,
    }))

shap_beeswarm = pd.concat(beeswarm_rows, ignore_index=True)

# 검증 출력
for feat in top_feat_names[:3]:
    rows = shap_beeswarm[shap_beeswarm["feature"] == feat]
    sv_unique = rows["shap_value"].nunique()
    fn_min    = rows["feat_norm"].min()
    fn_max    = rows["feat_norm"].max()
    print(f"  {feat}: shap unique={sv_unique}, feat_norm [{fn_min:.3f}, {fn_max:.3f}]")

shap_beeswarm.to_csv(PUBLIC / "shap_beeswarm.csv", index=False)
total_units = shap_beeswarm["ufs_serial"].nunique()
print(f"  저장: shap_beeswarm.csv ({len(shap_beeswarm):,}행, {total_units:,} unit × Top{TOP_SHAP})")

# ── 6. dist/ 동기화 ───────────────────────────────────────
print("\n[6] dist/ 동기화...")
for fname in ["shap_bar.csv", "shap_beeswarm.csv"]:
    src, dst = PUBLIC / fname, DIST / fname
    if dst.exists():
        shutil.copy2(src, dst)
        print(f"  복사: {fname}")

print("\n" + "=" * 60)
print("완료!")
print("=" * 60)
