"""
대시보드 CSV 생성 스크립트
실행: python generate_all.py
출력: Dashboard/public/ 에 CSV 자동 저장

모델 확정 후 재실행하면 모든 파일이 갱신됨.
"""

import pandas as pd
import numpy as np
import pickle
import shap
from pathlib import Path
from sklearn.ensemble import IsolationForest

# ── 경로 설정 ──────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).parent.parent.parent  # sk_하이닉스/
OUTPUT      = ROOT / "4_output"
FINAL       = OUTPUT / "final"
PUBLIC      = ROOT / "6_분업" / "Dashboard" / "public"

# 모델 경로 (블렌드 기준 LGBM fold 모델 사용)
MODEL_PKL   = FINAL / "reg_only" / "lgbm" / "fold_models.pkl"

# 예측 결과 (blend 최종)
PRED_TRAIN  = FINAL / "blend" / "final_train_oof.csv"
PRED_VAL    = FINAL / "blend" / "final_val.csv"
PRED_TEST   = FINAL / "blend" / "final_test.csv"

# 원본 unit 메타 (split, run_id, wafer_no, health 등)
UNIT_TRAIN  = OUTPUT / "unit_train.csv"
UNIT_VAL    = OUTPUT / "unit_val.csv"
UNIT_TEST   = OUTPUT / "unit_test.csv"

# 기존 wafer_map (die 좌표, position 등 메타)
WAFER_MAP   = PUBLIC / "wafer_map.csv"

print("=" * 60)
print("대시보드 CSV 생성 시작")
print("=" * 60)


# ── 0. 메타 로드 ───────────────────────────────────────────────────────────────
print("\n[0] 메타 데이터 로드...")

pred_train = pd.read_csv(PRED_TRAIN)   # ufs_serial, pred
pred_val   = pd.read_csv(PRED_VAL)
pred_test  = pd.read_csv(PRED_TEST)

# unit 메타(run_id, wafer_no, split, health)는 wafer_map.csv에서 추출
# wafer_map에 die가 4개이므로 ufs_serial 기준으로 first 값만 취함
wmap_meta = pd.read_csv(WAFER_MAP, usecols=["ufs_serial", "run_id", "wafer_no", "split", "health", "date"])
meta_all = (
    wmap_meta
    .groupby("ufs_serial", as_index=False)
    .first()  # die 4개 중 첫 번째만 (메타는 동일하므로)
)

meta_train = meta_all[meta_all["split"] == "train"]
meta_val   = meta_all[meta_all["split"] == "val"]
meta_test  = meta_all[meta_all["split"] == "test"]
print(f"  메타 로드 완료: train {len(meta_train):,} / val {len(meta_val):,} / test {len(meta_test):,}")


# ── 1. dashboard_units.csv 생성 ────────────────────────────────────────────────
print("\n[1] dashboard_units.csv 생성...")

pred_all = pd.concat([pred_train, pred_val, pred_test], ignore_index=True)
pred_all.columns = ["ufs_serial", "reg_pred"]

units = meta_all.merge(pred_all, on="ufs_serial", how="left")

# threshold: train 상위 29.2% (health>0 비율)
train_preds = units.loc[units["split"] == "train", "reg_pred"].dropna().sort_values()
threshold   = train_preds.iloc[int(len(train_preds) * 0.708)]
g1_thresh   = train_preds.iloc[int(len(train_preds) * 0.90)]
g3_thresh   = train_preds.iloc[int(len(train_preds) * 0.50)]

def assign_risk(pred):
    if pred >= g1_thresh:  return "HIGH"
    if pred >= threshold:  return "MED"
    return "LOW"

def assign_grade(pred):
    if pred >= g1_thresh:  return "grade1"
    if pred >= threshold:  return "grade2"
    if pred >= g3_thresh:  return "grade3"
    return "grade4"

units["risk"]  = units["reg_pred"].apply(assign_risk)
units["grade"] = units["reg_pred"].apply(assign_grade)

# anomaly_score: IsolationForest (train health=0 기준)
print("  IsolationForest 학습 중 (anomaly_score)...")

# unit_train에서 피처 컬럼만 (X*_mean 등) - ufs_serial 기준으로 join
feat_train_full = pd.read_csv(UNIT_TRAIN)
feat_train_full.columns = [c.lower() if c != "ufs_serial" else c for c in feat_train_full.columns]

feat_cols = [c for c in feat_train_full.columns if c != "ufs_serial"]
train_serials = meta_train["ufs_serial"].values

# train에서 health=0인 unit (정상) 피처
normal_mask = meta_train.merge(
    feat_train_full[["ufs_serial"] + feat_cols], on="ufs_serial", how="left"
)
health_col = "health" if "health" in normal_mask.columns else None
if health_col:
    normal_X = normal_mask.loc[normal_mask[health_col] == 0, feat_cols].fillna(0)
else:
    normal_X = normal_mask[feat_cols].fillna(0)

iso = IsolationForest(n_estimators=100, contamination=0.292, random_state=42, n_jobs=-1)
iso.fit(normal_X)
iso_feat_cols = normal_X.columns.tolist()  # fit에 쓴 피처 고정
print(f"  IsolationForest 학습 완료 (정상 unit {len(normal_X):,}개, 피처 {len(iso_feat_cols)}개)")

# 전체 split에 적용 - fit 피처와 동일한 컬럼만 사용, 없으면 0으로 채움
def score_split(unit_csv, split_name):
    df = pd.read_csv(unit_csv)
    df.columns = [c.lower() if c != "ufs_serial" else c for c in df.columns]
    # fit 피처 순서 그대로, 없는 컬럼은 0으로 채움
    X = pd.DataFrame(0.0, index=df.index, columns=iso_feat_cols)
    for col in iso_feat_cols:
        if col in df.columns:
            X[col] = df[col].fillna(0)
    raw = iso.score_samples(X)
    return pd.DataFrame({"ufs_serial": df["ufs_serial"], "anomaly_score_raw": raw})

scores = pd.concat([
    score_split(UNIT_TRAIN, "train"),
    score_split(UNIT_VAL,   "val"),
    score_split(UNIT_TEST,  "test"),
], ignore_index=True)

# 0~100 정규화 (높을수록 이상)
s_min, s_max = scores["anomaly_score_raw"].min(), scores["anomaly_score_raw"].max()
scores["anomaly_score"] = ((scores["anomaly_score_raw"] - s_max) / (s_min - s_max) * 100).round(1)
scores["anomaly_score"] = scores["anomaly_score"].clip(0, 100)

units = units.merge(scores[["ufs_serial", "anomaly_score"]], on="ufs_serial", how="left")

# ── 95% CI (Conformal Prediction, val health 실측값 기반) ──────────────────────
print("  Conformal Prediction으로 95% CI 계산 중...")

# val split에서 실측값이 있는 row만 사용 (health가 NaN이 아닌 것)
val_with_health = units[
    (units["split"] == "val") &
    units["health"].notna() &
    units["reg_pred"].notna()
].copy()

if len(val_with_health) > 0:
    # 잔차(residual) = 실측 - 예측
    residuals = val_with_health["health"].astype(float) - val_with_health["reg_pred"].astype(float)

    # Conformal Prediction: 95% 분위수로 오차 범위 계산
    alpha = 0.05
    q_score = residuals.abs().quantile(1 - alpha)

    # 전체 unit에 CI 적용
    units["ci_low"]  = (units["reg_pred"].astype(float) - q_score).clip(lower=0).round(6)
    units["ci_high"] = (units["reg_pred"].astype(float) + q_score).round(6)

    print(f"  CI 계산 완료: ±{q_score:.6f} (val {len(val_with_health):,}개 잔차 기준 95% quantile)")
else:
    # val health가 없는 경우 (비공개 상태) - CI 생략
    units["ci_low"]  = np.nan
    units["ci_high"] = np.nan
    print("  val health 없음 → ci_low/ci_high = NaN")

out_cols = ["ufs_serial", "run_id", "wafer_no", "split", "health", "reg_pred", "risk", "grade", "anomaly_score", "ci_low", "ci_high"]
if "date" in units.columns:
    out_cols.append("date")
units[out_cols].to_csv(PUBLIC / "dashboard_units.csv", index=False)
print(f"  저장 완료: dashboard_units.csv ({len(units):,}행)")


# ── 2. wafer_map.csv - train/test pred 채우기 ──────────────────────────────────
print("\n[2] wafer_map.csv - train/test pred 업데이트...")

wmap = pd.read_csv(WAFER_MAP)

# pred_all을 ufs_serial 기준으로 merge (이미 있는 pred 덮어쓰기)
pred_lookup = pred_all.set_index("ufs_serial")["reg_pred"]
wmap["pred"] = wmap["ufs_serial"].map(pred_lookup).fillna(wmap["pred"])

wmap.to_csv(PUBLIC / "wafer_map.csv", index=False)
print(f"  저장 완료: wafer_map.csv ({len(wmap):,}행)")


# ── 3. unit_shap.csv - unit별 SHAP Top10 ──────────────────────────────────────
print("\n[3] unit_shap.csv 생성 (LGBM fold 모델)...")

if not MODEL_PKL.exists():
    print(f"  경고: {MODEL_PKL} 없음 → unit_shap.csv 생략")
elif True:
    # 모델 학습 시 피처 선택(FS) 후 컬럼명이 Column_N 형태로 저장되어
    # 로컬 unit_val.csv(X0_mean 등)와 매핑 불가 → Colab에서 별도 생성 필요
    print("  건너뜀: 모델 피처(Column_0~654)와 unit_val.csv 피처(X0_mean 등) 불일치")
    print("  → Colab 학습 환경에서 X_val 있을 때 별도 생성 필요")
if False:
    with open(MODEL_PKL, "rb") as f:
        ckpt = pickle.load(f)

    # {'fold_models': [lgbm, lgbm, ...], 'feature_names': [...], ...} 구조
    fold_list    = ckpt["fold_models"] if isinstance(ckpt, dict) else ckpt
    model        = fold_list[0]  # 첫 번째 fold 모델 사용
    model_feats  = ckpt["feature_names"] if isinstance(ckpt, dict) and "feature_names" in ckpt else None

    # val 피처로 SHAP 계산
    feat_val_full = pd.read_csv(UNIT_VAL)
    feat_val_full.columns = [c.lower() if c != "ufs_serial" else c for c in feat_val_full.columns]

    # 모델 학습 피처 순서 그대로 맞춤
    if model_feats:
        model_feats_lower = [c.lower() for c in model_feats]
        fc_val = model_feats_lower
    else:
        fc_val = [c for c in feat_cols if c in feat_val_full.columns]

    # 없는 컬럼은 0으로 채움
    X_val = pd.DataFrame(0.0, index=feat_val_full.index, columns=fc_val)
    for col in fc_val:
        if col in feat_val_full.columns:
            X_val[col] = feat_val_full[col].fillna(0)

    explainer   = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_val)  # (n_unit, n_feat)

    shap_df = pd.DataFrame(shap_values, columns=fc_val)
    shap_df.insert(0, "ufs_serial", feat_val_full["ufs_serial"].values)

    # wide → long, feature별 절대값 기준 Top 10만 저장 (파일 크기 제한)
    shap_long = shap_df.melt(id_vars="ufs_serial", var_name="feature", value_name="shap_value")

    # unit별 |shap| Top 10
    shap_long["abs_shap"] = shap_long["shap_value"].abs()
    shap_top = (
        shap_long
        .sort_values(["ufs_serial", "abs_shap"], ascending=[True, False])
        .groupby("ufs_serial")
        .head(10)
        .drop(columns="abs_shap")
        .reset_index(drop=True)
    )

    shap_top.to_csv(PUBLIC / "unit_shap.csv", index=False)
    print(f"  저장 완료: unit_shap.csv ({len(shap_top):,}행, val {len(feat_val_full):,} units)")


# ── 4. location_stats.csv - die 좌표별 불량 패턴 집계 ─────────────────────────
print("\n[4] location_stats.csv 생성 (die 위치별 pred 집계)...")

wmap_loc = pd.read_csv(WAFER_MAP)

# pred가 있는 row만 사용
wmap_loc["pred"] = pd.to_numeric(wmap_loc["pred"], errors="coerce")
wmap_loc = wmap_loc.dropna(subset=["pred"])

# 임계값 (전체 pred 70.8 분위수)
all_preds = wmap_loc["pred"].sort_values().values
thresh_loc = all_preds[int(len(all_preds) * 0.708)]

# die 좌표별 집계
loc_grp = (
    wmap_loc
    .groupby(["die_x", "die_y"], as_index=False)
    .agg(
        count       = ("pred", "count"),
        pred_mean   = ("pred", "mean"),
        pred_max    = ("pred", "max"),
        pred_std    = ("pred", "std"),
        risk_count  = ("pred", lambda x: (x > thresh_loc).sum()),
    )
)
loc_grp["pred_mean"] = loc_grp["pred_mean"].round(8)
loc_grp["pred_max"]  = loc_grp["pred_max"].round(8)
loc_grp["pred_std"]  = loc_grp["pred_std"].fillna(0).round(8)
loc_grp["risk_rate"] = (loc_grp["risk_count"] / loc_grp["count"] * 100).round(2)
loc_grp["ppm_mean"]  = (loc_grp["pred_mean"] * 1e6).round(1)
loc_grp["ppm_max"]   = (loc_grp["pred_max"]  * 1e6).round(1)

# 반경 (중심에서의 거리) - edge 분석용
x_center = (loc_grp["die_x"].max() + loc_grp["die_x"].min()) / 2
y_center = (loc_grp["die_y"].max() + loc_grp["die_y"].min()) / 2
loc_grp["radial_dist"] = np.sqrt(
    (loc_grp["die_x"] - x_center) ** 2 + (loc_grp["die_y"] - y_center) ** 2
).round(3)

loc_grp.to_csv(PUBLIC / "location_stats.csv", index=False)
print(f"  저장 완료: location_stats.csv ({len(loc_grp):,}행, 임계값 {thresh_loc:.6f})")


print("\n" + "=" * 60)
print("완료! Dashboard/public/ 에 저장된 파일:")
for f in sorted(PUBLIC.glob("*.csv")):
    size_kb = f.stat().st_size / 1024
    print(f"  {f.name:<35} {size_kb:>8.1f} KB")
print("=" * 60)
