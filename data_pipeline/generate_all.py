"""
대시보드 CSV 생성 스크립트
실행: python generate_all.py
출력: data/processed/ 에 CSV 자동 저장

모델 기준: ZIT pphp/001 (ZITboost, val RMSE 최저)
- wafer_map.csv pred    : ZIT die-level pred (포지션별 다른 값)
- dashboard_units.csv   : ZIT unit-level pred (die pred 평균)
- feature_importance.csv: ZIT lgb_mu_ gain 기준
- shap_bar.csv          : ZIT lgb_mu_ SHAP 전체 평균
- shap_beeswarm.csv     : ZIT lgb_mu_ SHAP unit별 Top20
"""

import sys
import pandas as pd
import numpy as np
import pickle
import shap
from pathlib import Path
from sklearn.ensemble import IsolationForest
import shutil

# ZITboost 모듈 경로 추가
ROOT = Path(__file__).parent.parent.parent  # sk_하이닉스/
sys.path.insert(0, str(ROOT / "3_modeling"))
sys.path.insert(0, str(ROOT))

OUTPUT  = ROOT / "4_output"
ZIT_RUN = ROOT / "5_분석시스템" / "data" / "raw"
PUBLIC  = ROOT / "5_분석시스템" / "data" / "processed"

XS_PATH    = ROOT / "0_data" / "compet_xs_data.csv"
UNIT_TRAIN = OUTPUT / "unit_train.csv"
UNIT_VAL   = OUTPUT / "unit_val.csv"
UNIT_TEST  = OUTPUT / "unit_test.csv"
WAFER_MAP  = PUBLIC / "wafer_map.csv"

print("=" * 60)
print("대시보드 CSV 생성 시작 (ZIT pphp/001 기준)")
print("=" * 60)


# ── 0. ZIT 예측 로드 ───────────────────────────────────────────────────────────
print("\n[0] ZIT 예측 로드...")

oof_die  = pd.read_csv(ZIT_RUN / "oof_die.csv")   # train die-level
val_die  = pd.read_csv(ZIT_RUN / "val_die.csv")   # val   die-level
test_die = pd.read_csv(ZIT_RUN / "test_die.csv")  # test  die-level

oof_unit  = pd.read_csv(ZIT_RUN / "oof_unit.csv")   # train unit-level
val_unit  = pd.read_csv(ZIT_RUN / "val_unit.csv")   # val   unit-level
test_unit = pd.read_csv(ZIT_RUN / "test_unit.csv")  # test  unit-level

# split 태그
oof_die["split"]  = "train"
val_die["split"]  = "val"
test_die["split"] = "test"
oof_unit["split"]  = "train"
val_unit["split"]  = "val"
test_unit["split"] = "test"

all_die  = pd.concat([oof_die, val_die, test_die],   ignore_index=True)
all_unit = pd.concat([oof_unit, val_unit, test_unit], ignore_index=True)

print(f"  die  전체: {len(all_die):,}행  |  unit 전체: {len(all_unit):,}행")


# ── 0b. wafer_map 메타(run_id, wafer_no, die_x, die_y, health, date) 로드 ────
print("\n[0b] wafer_map 메타 로드...")

wmap_meta = pd.read_csv(WAFER_MAP)
# unit 메타 (die 4개 중 첫 번째 - run_id, wafer_no, split, health, date 동일)
unit_meta = (
    wmap_meta
    .groupby("ufs_serial", as_index=False)
    .first()[["ufs_serial", "run_id", "wafer_no", "split", "health", "date"]]
)

meta_train = unit_meta[unit_meta["split"] == "train"]
meta_val   = unit_meta[unit_meta["split"] == "val"]
meta_test  = unit_meta[unit_meta["split"] == "test"]
print(f"  메타: train {len(meta_train):,} / val {len(meta_val):,} / test {len(meta_test):,}")


# ── 1. dashboard_units.csv ─────────────────────────────────────────────────────
print("\n[1] dashboard_units.csv 생성...")

units = unit_meta.merge(
    all_unit[["ufs_serial", "split", "pred"]].rename(columns={"pred": "reg_pred"}),
    on=["ufs_serial", "split"], how="left"
)

# threshold: 전체(train+val+test) pred IQR 기반
# grade1 = 정상        : pred < Q2
# grade2 = 조심        : Q2 <= pred < Q3
# grade3 = 위험        : Q3 <= pred < Q3 + 1.5*IQR
# grade4 = 매우위험    : pred >= Q3 + 1.5*IQR
all_preds = units["reg_pred"].dropna()
q1 = all_preds.quantile(0.25)
q2 = all_preds.quantile(0.50)            # Q2 (중앙값)
q3 = all_preds.quantile(0.75)            # Q3
iqr = q3 - q1                           # IQR = Q3 - Q1
upper_fence = q3 + 1.5 * iqr            # Q3 + 1.5*IQR (이상치 경계)
threshold = q3                           # 대표 임계값 = Q3

print(f"  Q1={q1:.6f} | Q2={q2:.6f} | Q3={q3:.6f} | IQR={iqr:.6f} | upper_fence={upper_fence:.6f}")

def assign_risk(pred):
    if pred >= upper_fence: return "HIGH"
    if pred >= q3:          return "MED"
    return "LOW"

def assign_grade(pred):
    if pred >= upper_fence: return "grade4"   # 매우위험
    if pred >= q3:          return "grade3"   # 위험
    if pred >= q2:          return "grade2"   # 조심
    return "grade1"                           # 정상

units["risk"]  = units["reg_pred"].apply(assign_risk)
units["grade"] = units["reg_pred"].apply(assign_grade)

# anomaly_score: IsolationForest (train health=0 기준, unit 집계 피처)
print("  IsolationForest 학습 중 (anomaly_score)...")
feat_train_full = pd.read_csv(UNIT_TRAIN)
feat_train_full.columns = [c.lower() if c != "ufs_serial" else c for c in feat_train_full.columns]
feat_cols = [c for c in feat_train_full.columns if c != "ufs_serial"]

normal_mask = meta_train.merge(feat_train_full[["ufs_serial"] + feat_cols], on="ufs_serial", how="left")
if "health" in normal_mask.columns:
    normal_X = normal_mask.loc[normal_mask["health"] == 0, feat_cols].fillna(0)
else:
    normal_X = normal_mask[feat_cols].fillna(0)

iso = IsolationForest(n_estimators=100, contamination=0.292, random_state=42, n_jobs=-1)
iso.fit(normal_X)
iso_feat_cols = normal_X.columns.tolist()
print(f"  IsolationForest 완료 (정상 unit {len(normal_X):,}개, 피처 {len(iso_feat_cols)}개)")

def score_split(unit_csv):
    df = pd.read_csv(unit_csv)
    df.columns = [c.lower() if c != "ufs_serial" else c for c in df.columns]
    X = pd.DataFrame(0.0, index=df.index, columns=iso_feat_cols)
    for col in iso_feat_cols:
        if col in df.columns:
            X[col] = df[col].fillna(0)
    raw = iso.score_samples(X)
    return pd.DataFrame({"ufs_serial": df["ufs_serial"], "anomaly_score_raw": raw})

scores = pd.concat([
    score_split(UNIT_TRAIN),
    score_split(UNIT_VAL),
    score_split(UNIT_TEST),
], ignore_index=True)

s_min, s_max = scores["anomaly_score_raw"].min(), scores["anomaly_score_raw"].max()
scores["anomaly_score"] = ((scores["anomaly_score_raw"] - s_max) / (s_min - s_max) * 100).round(1).clip(0, 100)
units = units.merge(scores[["ufs_serial", "anomaly_score"]], on="ufs_serial", how="left")

# Conformal Prediction 95% CI
print("  Conformal Prediction 95% CI 계산 중...")
val_with_health = units[(units["split"] == "val") & units["health"].notna() & units["reg_pred"].notna()].copy()
if len(val_with_health) > 0:
    residuals = val_with_health["health"].astype(float) - val_with_health["reg_pred"].astype(float)
    q_score = residuals.abs().quantile(0.95)
    units["ci_low"]  = (units["reg_pred"].astype(float) - q_score).clip(lower=0).round(6)
    units["ci_high"] = (units["reg_pred"].astype(float) + q_score).round(6)
    print(f"  CI 완료: ±{q_score:.6f}")
else:
    units["ci_low"]  = np.nan
    units["ci_high"] = np.nan
    print("  val health 없음 → CI NaN")

out_cols = ["ufs_serial", "run_id", "wafer_no", "split", "health", "reg_pred",
            "risk", "grade", "anomaly_score", "ci_low", "ci_high"]
if "date" in units.columns:
    out_cols.append("date")
units[out_cols].to_csv(PUBLIC / "dashboard_units.csv", index=False)
print(f"  저장 완료: dashboard_units.csv ({len(units):,}행)")


# ── 2. wafer_map.csv - ZIT die-level pred 교체 ────────────────────────────────
print("\n[2] wafer_map.csv - ZIT die-level pred 교체...")

wmap = pd.read_csv(WAFER_MAP)

# run_wf_xy 기준으로 ZIT die pred 매핑 (ufs_serial + position 키로 매핑)
die_pred_lookup = all_die.set_index(["ufs_serial", "position"])["pred"]
wmap["pred"] = wmap.apply(
    lambda r: die_pred_lookup.get((r["ufs_serial"], r["position"]), np.nan),
    axis=1
)

# 매핑 안 된 row 확인
n_missing = wmap["pred"].isna().sum()
if n_missing > 0:
    print(f"  경고: {n_missing:,}개 die pred 매핑 실패 → 기존 값 유지")
    orig = pd.read_csv(WAFER_MAP)
    wmap["pred"] = wmap["pred"].fillna(orig["pred"])

wmap.to_csv(PUBLIC / "wafer_map.csv", index=False)
print(f"  저장 완료: wafer_map.csv ({len(wmap):,}행, 포지션별 pred 분화)")


# ── 3. feature_importance.csv - ZIT lgb_mu_ gain ──────────────────────────────
print("\n[3] feature_importance.csv - ZIT lgb_mu_ gain...")

with open(ZIT_RUN / "fold_models.pkl", "rb") as f:
    ckpt = pickle.load(f)

feat_names = ckpt["feature_names"]
fold_models = ckpt["fold_models"]  # ZITboostRegressor list

# fold별 lgb_mu_ gain 평균
gain_sum = np.zeros(len(feat_names))
for fold_model in fold_models:
    gain_sum += fold_model.lgb_mu_.booster_.feature_importance(importance_type="gain")
gain_mean = gain_sum / len(fold_models)

fi_df = pd.DataFrame({
    "feature":   feat_names,
    "lgbm_gain": gain_mean,
})
fi_df = fi_df.sort_values("lgbm_gain", ascending=False).reset_index(drop=True)
fi_df["lgbm_rank"] = fi_df.index + 1

fi_df.to_csv(PUBLIC / "feature_importance.csv", index=False)
print(f"  저장 완료: feature_importance.csv ({len(fi_df)}개 피처)")
print(f"  Top5: {fi_df['feature'].head(5).tolist()}")


# ── 4. shap_bar.csv & shap_beeswarm.csv - ZIT lgb_mu_ SHAP ───────────────────
print("\n[4] SHAP 계산 (ZIT lgb_mu_, val die 기준)...")

# val xs 로드 (die_x/die_y는 xs에 없으므로 run_wf_xy에서 파싱)
print("  xs val 로드 중...")
xs_cols_in_file = set(pd.read_csv(XS_PATH, nrows=0).columns)
feat_names_xs = [f for f in feat_names if f in xs_cols_in_file]   # xs에 있는 것만
feat_names_meta = [f for f in feat_names if f not in xs_cols_in_file]  # die_x, die_y 등

# xs에는 val split이 없으므로 val_die의 ufs_serial로 직접 필터링
val_serials_set = set(val_die["ufs_serial"].unique())
xs_val = pd.read_csv(XS_PATH, usecols=["ufs_serial", "run_wf_xy"] + feat_names_xs)
xs_val = xs_val[xs_val["ufs_serial"].isin(val_serials_set)]

# die_x, die_y 파싱 (run_wf_xy = "run_wafer_x_y", e.g. "0000000_25_24_25")
if "die_x" in feat_names_meta or "die_y" in feat_names_meta:
    parts = xs_val["run_wf_xy"].str.split("_")
    xs_val["die_x"] = parts.str[-2].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
    xs_val["die_y"] = parts.str[-1].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
xs_val = xs_val.drop(columns="run_wf_xy")

# val_die와 ufs_serial 순서 맞추기 (position은 xs_val에도 있으므로 val_die에서 drop)
val_serials_ordered = val_die[["ufs_serial"]].copy()
xs_val_merged = val_serials_ordered.merge(xs_val, on="ufs_serial", how="left")

X_val_df = xs_val_merged[feat_names].copy()
X_val = X_val_df.fillna(0).values
serials_val = xs_val_merged["ufs_serial"].values
print(f"  X_val shape: {X_val.shape}")

# 전체 fold lgb_mu_ SHAP 평균 계산
BATCH = 1000
n = len(X_val)
shap_sum = np.zeros((n, len(feat_names)))

for fold_i, fold_model in enumerate(fold_models):
    mu_model = fold_model.lgb_mu_
    print(f"  TreeExplainer fold {fold_i+1}/{len(fold_models)} 계산 중...")
    explainer = shap.TreeExplainer(mu_model)
    fold_batches = []
    for i in range(0, n, BATCH):
        sv = explainer.shap_values(X_val[i:i+BATCH])
        fold_batches.append(sv)
    shap_sum += np.vstack(fold_batches)

shap_values = shap_sum / len(fold_models)  # fold 평균
print(f"  SHAP 완료: {shap_values.shape}")

# shap_bar.csv: 피처별 mean_abs_shap, mean_shap
mean_abs = np.abs(shap_values).mean(axis=0)
mean_shap = shap_values.mean(axis=0)
rank_order = np.argsort(mean_abs)[::-1]

shap_bar = pd.DataFrame({
    "feature":       [feat_names[i] for i in rank_order],
    "mean_abs_shap": mean_abs[rank_order],
    "mean_shap":     mean_shap[rank_order],
    "rank":          np.arange(1, len(feat_names) + 1),
})
shap_bar.to_csv(PUBLIC / "shap_bar.csv", index=False)
print(f"  저장 완료: shap_bar.csv ({len(shap_bar)}행)")

# shap_beeswarm.csv: unit별 Top20 피처 SHAP (val die → unit 평균)
TOP_SHAP = 20
top_feat_idx = rank_order[:TOP_SHAP]
top_feat_names = [feat_names[i] for i in top_feat_idx]

shap_top20 = shap_values[:, top_feat_idx]                           # (n_die, 20)
feat_vals_top20 = X_val_df[top_feat_names].values                   # NaN 유지 (min-max 계산용)

# die → unit 평균 (ufs_serial 기준)
shap_df = pd.DataFrame(shap_top20, columns=top_feat_names)
shap_df["ufs_serial"] = serials_val
feat_df = pd.DataFrame(feat_vals_top20, columns=[f"fv_{c}" for c in top_feat_names])
feat_df["ufs_serial"] = serials_val

shap_unit = shap_df.groupby("ufs_serial")[top_feat_names].mean()
feat_unit = feat_df.groupby("ufs_serial")[[f"fv_{c}" for c in top_feat_names]].mean()

# feat_norm: 피처값을 0~1 min-max 정규화 (NaN 무시)
beeswarm_rows = []
for rank_i, feat in enumerate(top_feat_names):
    sv_col = shap_unit[feat]
    fv_col = feat_unit[f"fv_{feat}"]
    fv_min, fv_max = fv_col.min(skipna=True), fv_col.max(skipna=True)
    feat_norm = ((fv_col - fv_min) / (fv_max - fv_min + 1e-12)).round(4).fillna(0)
    tmp = pd.DataFrame({
        "ufs_serial": sv_col.index,
        "feature":    feat,
        "shap_value": sv_col.values,
        "feat_norm":  feat_norm.values,
        "rank":       rank_i,
    })
    beeswarm_rows.append(tmp)

shap_beeswarm = pd.concat(beeswarm_rows, ignore_index=True)
shap_beeswarm.to_csv(PUBLIC / "shap_beeswarm.csv", index=False)
print(f"  저장 완료: shap_beeswarm.csv ({len(shap_beeswarm):,}행, Top{TOP_SHAP} 피처 × val unit)")


# ── 5. location_stats.csv - 업데이트된 wafer_map 기반 재집계 ──────────────────
print("\n[5] location_stats.csv 재집계...")

wmap_loc = pd.read_csv(PUBLIC / "wafer_map.csv")
wmap_loc["pred"] = pd.to_numeric(wmap_loc["pred"], errors="coerce")
wmap_loc = wmap_loc.dropna(subset=["pred"])

thresh_loc = q3  # unit과 동일한 Q3 기준 사용

loc_grp = (
    wmap_loc
    .groupby(["die_x", "die_y"], as_index=False)
    .agg(
        count      = ("pred", "count"),
        pred_mean  = ("pred", "mean"),
        pred_max   = ("pred", "max"),
        pred_std   = ("pred", "std"),
        risk_count = ("pred", lambda x: (x > thresh_loc).sum()),
    )
)
loc_grp["pred_mean"] = loc_grp["pred_mean"].round(8)
loc_grp["pred_max"]  = loc_grp["pred_max"].round(8)
loc_grp["pred_std"]  = loc_grp["pred_std"].fillna(0).round(8)
loc_grp["risk_rate"] = (loc_grp["risk_count"] / loc_grp["count"] * 100).round(2)
loc_grp["ppm_mean"]  = (loc_grp["pred_mean"] * 1e6).round(1)
loc_grp["ppm_max"]   = (loc_grp["pred_max"]  * 1e6).round(1)

x_center = (loc_grp["die_x"].max() + loc_grp["die_x"].min()) / 2
y_center = (loc_grp["die_y"].max() + loc_grp["die_y"].min()) / 2
loc_grp["radial_dist"] = np.sqrt(
    (loc_grp["die_x"] - x_center) ** 2 + (loc_grp["die_y"] - y_center) ** 2
).round(3)

loc_grp.to_csv(PUBLIC / "location_stats.csv", index=False)
print(f"  저장 완료: location_stats.csv ({len(loc_grp):,}행)")


# ── 6. wafer_map_lots/ 재생성 ─────────────────────────────────────────────────
print("\n[6] wafer_map_lots/ 재생성 (ZIT die pred 적용)...")

LOTS_PUB  = PUBLIC / "wafer_map_lots"
LOTS_DIST = PUBLIC.parent / "dist" / "wafer_map_lots"

# 전체 wafer_map에서 die_pred_lookup 재사용 (이미 all_die 메모리에 있음)
# ZIT pred 조회 테이블: all_die 기준 ufs_serial+position 고유값만 사용
# (wafer_map.csv는 동일 unit이 여러 행으로 중복되어 있어 merge 시 카르테시안 곱 발생)
pred_ref = all_die[["ufs_serial", "position", "pred"]].drop_duplicates(subset=["ufs_serial", "position"])

lot_files = sorted(LOTS_PUB.glob("lot_*.csv"))
print(f"  lot 파일 수: {len(lot_files)}개")

for lot_path in lot_files:
    lot_df = pd.read_csv(lot_path)
    lot_df = lot_df.drop_duplicates(subset=["ufs_serial", "position", "die_x", "die_y"])
    lot_df = lot_df.drop(columns=["pred", "clf_proba"], errors="ignore")
    lot_df = lot_df.merge(pred_ref, on=["ufs_serial", "position"], how="left")
    lot_df.to_csv(lot_path, index=False)
    dist_lot = LOTS_DIST / lot_path.name
    if dist_lot.exists():
        shutil.copy2(lot_path, dist_lot)

print(f"  완료: {len(lot_files)}개 lot 파일 업데이트 (public + dist)")


# ── 7. wafer_scale.json 재생성 (전체 die pred 기준) ─────────────────────────
print("\n[7] wafer_scale.json 재생성...")
import json

wmap_all = pd.read_csv(PUBLIC / "wafer_map.csv")
all_die_preds = pd.to_numeric(wmap_all["pred"], errors="coerce").dropna().sort_values().values

_q1  = all_die_preds[int(len(all_die_preds) * 0.25)]
_q3  = all_die_preds[int(len(all_die_preds) * 0.75)]

wafer_scale = {
    "threshold": float(_q3),
    "pred_min":  float(all_die_preds[0]),
    "pred_max":  float(all_die_preds[-1]),
    "grid_x_range": int(wmap_all["die_x"].max() - wmap_all["die_x"].min() + 1),
    "grid_y_range": int(wmap_all["die_y"].max() - wmap_all["die_y"].min() + 1),
}
with open(PUBLIC / "wafer_scale.json", "w") as f:
    json.dump(wafer_scale, f)
print(f"  저장 완료: threshold={_q3:.8f} (전체 die pred Q3)")


# ── dist/ 동기화 (대시보드 정적 빌드용) ──────────────────────────────────────
DIST = PUBLIC.parent / "dist"
SYNC_FILES = [
    "wafer_map.csv", "dashboard_units.csv", "feature_importance.csv",
    "shap_bar.csv", "shap_beeswarm.csv", "location_stats.csv", "wafer_scale.json",
]
print("\n[dist 동기화]")
for fname in SYNC_FILES:
    src, dst = PUBLIC / fname, DIST / fname
    if src.exists() and dst.exists():
        shutil.copy2(src, dst)
        print(f"  복사: {fname}")

print("\n" + "=" * 60)
print("완료! Dashboard/public/ 에 저장된 파일:")
for f in sorted(PUBLIC.glob("*.csv")):
    size_kb = f.stat().st_size / 1024
    print(f"  {f.name:<35} {size_kb:>8.1f} KB")
print("=" * 60)
