"""
prepare_report_data.py
보고서용 데이터를 사전 계산해서 frontend/report_data.json 으로 저장

실행:
    cd 기업/5_agent
    python prepare_report_data.py
"""
import json, sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.stdout.reconfigure(encoding="utf-8")

ROOT   = Path(__file__).parent.parent
DATA   = ROOT / "0_data"
RA_DIR = ROOT / "4_output" / "residual_analysis" / "20-101-002"
OUT    = Path(__file__).parent / "frontend" / "report_data.json"

STUDY_ID  = "20-101-002"
TOP_N     = 5
HIGH_THR  = 0.0038   # y_pred >= HIGH_THR → 고위험 (그룹 분석용)
LOW_THR   = 0.002    # y_pred <  LOW_THR  → 저위험
TRAIN_DAYS, VAL_DAYS, TEST_DAYS = 45, 15, 15

print("=== 보고서 데이터 준비 ===")

# ── 1. 예측 결과 & 레이블 로드 ─────────────────────────────────────────────
print("[1/7] 예측 결과 로드...")
ys_train = pd.read_csv(DATA / "compet_ys_train_data.csv")
ys_val   = pd.read_csv(DATA / "compet_ys_validation_data.csv")

res_train = pd.read_csv(RA_DIR / f"result_train_{STUDY_ID}.csv")
res_val   = pd.read_csv(RA_DIR / f"result_val_{STUDY_ID}.csv")
res_test  = pd.read_csv(RA_DIR / f"result_test_{STUDY_ID}.csv")
clf_imp   = pd.read_csv(RA_DIR / f"res_importance_{STUDY_ID}.csv")
corr_df   = pd.read_csv(RA_DIR / f"corr_{STUDY_ID}.csv")
clf_met   = pd.read_csv(RA_DIR / f"clf_metrics_{STUDY_ID}.csv")

# 보고서 지표용: 가상 시계열 기준 test 마지막 1일치만 사용
ys_test_data = pd.read_csv(DATA / "compet_ys_test_data.csv")

# run_id 매핑 (경량 로드: ufs_serial, run_wf_xy, split만)
xs_serial_split = pd.read_csv(
    DATA / "compet_xs_data.csv",
    usecols=["ufs_serial", "run_wf_xy", "split"],
)
xs_serial_split["run_id"] = xs_serial_split["run_wf_xy"].str.split("_").str[0]
xs_serial_split = xs_serial_split.drop_duplicates("ufs_serial")[["ufs_serial", "run_id", "split"]]

# 전체 lot → 가상 day 매핑 (assign_days와 동일 로직)
all_lots_early = sorted(xs_serial_split["run_id"].unique())
test_lots_set = set(xs_serial_split[xs_serial_split["split"] == "test"]["run_id"].unique())
test_day_map = {
    lot: (TRAIN_DAYS + VAL_DAYS + 1) + int(i * TEST_DAYS / len(all_lots_early))
    for i, lot in enumerate(all_lots_early)
    if lot in test_lots_set
}
last_test_day = max(test_day_map.values())
last_test_lots = {lot for lot, day in test_day_map.items() if day == last_test_day}
print(f"  마지막 test day={last_test_day}, lot 수={len(last_test_lots)}")

last_day_serials = set(
    xs_serial_split[
        (xs_serial_split["split"] == "test") &
        (xs_serial_split["run_id"].isin(last_test_lots))
    ]["ufs_serial"]
)
print(f"  마지막 day 유닛 수: {len(last_day_serials)}")

# y_pred, y_true를 serial 기준으로 join (순서 의존 금지)
res_test_full = ys_test_data[["ufs_serial"]].copy()
res_test_full["y_pred"] = res_test["y_pred"].values
res_test_full["y_true"] = res_test["y_true"].values

unit_base_df = res_test_full[res_test_full["ufs_serial"].isin(last_day_serials)].copy().reset_index(drop=True)
REPORT_SPLIT = "test"

# ── 2. 피처 임포턴스 ────────────────────────────────────────────────────────
print("[2/7] 피처 임포턴스 정리...")
top_feats_list = []
for _, row in clf_imp.head(TOP_N).iterrows():
    feat = row["feature"]
    base = feat.split("_")[0]
    agg  = "_".join(feat.split("_")[1:]) if "_" in feat else ""
    corr = corr_df.loc[corr_df["feature"] == feat, "corr"].values
    top_feats_list.append({
        "feature": feat, "base": base, "agg": agg,
        "importance": int(row["importance"]),
        "corr": round(float(corr[0]) if len(corr) else 0.0, 4),
    })

importance_all = [
    {"feature": r["feature"], "importance": int(r["importance"])}
    for _, r in clf_imp.head(15).iterrows()
]

# ── 3. xs 로드 (top feature 컬럼) ──────────────────────────────────────────
print("[3/7] xs 로드...")
base_cols = list({f["base"] for f in top_feats_list})
xs = pd.read_csv(
    DATA / "compet_xs_data.csv",
    usecols=["ufs_serial", "run_wf_xy", "position", "split"] + base_cols,
)
xs["run_id"] = xs["run_wf_xy"].str.split("_").str[0]
xs_rep = xs[(xs["split"] == REPORT_SPLIT) & (xs["ufs_serial"].isin(last_day_serials))].copy()   # test 마지막 day
xy_parts = xs_rep["run_wf_xy"].str.split("_", expand=True)
xs_rep["die_x"] = xy_parts[2].astype(int)
xs_rep["die_y"] = xy_parts[3].astype(int)

# ── 4. 유닛 레벨 집계 ──────────────────────────────────────────────────────
print(f"[4/7] 유닛 레벨 집계 ({REPORT_SPLIT})...")
agg_dict = {c: ["mean", "std", "min", "max"] for c in base_cols}
agg_dict.update({"die_x": ["mean"], "die_y": ["mean"], "run_id": ["first"]})
unit_agg = xs_rep.groupby("ufs_serial").agg(agg_dict).reset_index()
unit_agg.columns = ["ufs_serial"] + [f"{c}_{s}" for c, s in unit_agg.columns[1:]]

pos_dfs = {}
for pos in [1, 2, 3, 4]:
    sub = xs_rep[xs_rep["position"] == pos][["ufs_serial"] + base_cols]
    sub = sub.rename(columns={c: f"{c}_pos{pos}" for c in base_cols})
    pos_dfs[pos] = sub
pos_merged = pos_dfs[1]
for pos in [2, 3, 4]:
    pos_merged = pos_merged.merge(pos_dfs[pos], on="ufs_serial", how="left")

unit = unit_base_df.merge(unit_agg, on="ufs_serial", how="left")
unit = unit.merge(pos_merged, on="ufs_serial", how="left")
unit["run_id_val"] = unit["run_id_first"].fillna("unknown")

# ── 5. 고위험/저위험 그룹 통계 ─────────────────────────────────────────────
print("[5/7] 그룹 통계 계산...")
y_pred_all = unit["y_pred"]
pred_std   = float(y_pred_all.std())

high_mask = unit["y_pred"] >= HIGH_THR
low_mask  = unit["y_pred"] <  LOW_THR
# 마지막 day 데이터가 전부 저위험이면 상대 분위수로 fallback
if high_mask.sum() == 0:
    high_thr_rel = float(y_pred_all.quantile(0.70))
    high_mask = unit["y_pred"] >= high_thr_rel
    print(f"  고위험 유닛 없음 → 상위 30% 기준 사용 (thr={high_thr_rel:.6f})")
if low_mask.sum() == 0:
    low_thr_rel = float(y_pred_all.quantile(0.30))
    low_mask = unit["y_pred"] < low_thr_rel
    print(f"  저위험 유닛 없음 → 하위 30% 기준 사용 (thr={low_thr_rel:.6f})")

def pct_list(series, pcts=(0, 10, 25, 50, 75, 90, 100)):
    arr = series.dropna().values
    if len(arr) == 0:
        return [0.0] * len(pcts)
    return [round(float(np.percentile(arr, p)), 5) for p in pcts]

feature_comparison = []
shap_data = []

for feat_info in top_feats_list:
    base, agg = feat_info["base"], feat_info["agg"]
    col = f"{base}_{agg}"
    if col not in unit.columns:
        col = f"{base}_mean"
    if col not in unit.columns:
        continue

    high_vals = unit.loc[high_mask, col]
    low_vals  = unit.loc[low_mask,  col]
    all_vals  = unit[col]

    q25, q75 = float(low_vals.quantile(0.25)), float(low_vals.quantile(0.75))
    iqr = q75 - q25
    normal_lo = round(q25 - 1.5 * iqr, 5)
    normal_hi = round(q75 + 1.5 * iqr, 5)

    pos_compare = []
    for pos in [1, 2, 3, 4]:
        pc = f"{base}_pos{pos}"
        if pc in unit.columns:
            pos_compare.append({
                "position": pos,
                "high_mean": round(float(unit.loc[high_mask, pc].mean()), 5),
                "low_mean":  round(float(unit.loc[low_mask,  pc].mean()), 5),
            })

    feat_corr_ypred = float(all_vals.corr(y_pred_all))
    feat_std = float(all_vals.std())
    beta = feat_corr_ypred * pred_std / (feat_std + 1e-10)

    normal_median = float(low_vals.median())
    high_current  = float(high_vals.median())
    delta_feat    = normal_median - high_current
    delta_pred    = beta * delta_feat

    sample_idx  = unit.index[high_mask][:100]
    sim_preds   = np.clip(unit.loc[sample_idx, "y_pred"].values + delta_pred, 0, None)

    # SHAP-style effect (normalized median diff)
    global_std  = float(all_vals.std()) or 1e-10
    effect_norm = (high_current - normal_median) / global_std

    feature_comparison.append({
        "feature":    feat_info["feature"],
        "base": base, "agg": agg,
        "importance": feat_info["importance"],
        "corr":       feat_info["corr"],
        "corr_ypred": round(feat_corr_ypred, 4),
        "effect_norm": round(effect_norm, 4),
        "high_box":  pct_list(high_vals),
        "low_box":   pct_list(low_vals),
        "all_box":   pct_list(all_vals),
        "normal_lo": normal_lo, "normal_hi": normal_hi,
        "normal_median": round(normal_median, 5),
        "high_median":   round(high_current, 5),
        "pos_compare": pos_compare,
        "sim": {
            "delta_feat":         round(delta_feat, 5),
            "delta_pred":         round(float(delta_pred), 6),
            "current_pred_median": round(float(unit.loc[high_mask, "y_pred"].median()), 6),
            "new_pred_est":        round(float(np.clip(
                float(unit.loc[high_mask, "y_pred"].median()) + delta_pred, 0, None)), 6),
            "current_pred_dist":  [round(float(x), 6) for x in unit.loc[sample_idx, "y_pred"].values[:50]],
            "simulated_pred_dist":[round(float(x), 6) for x in sim_preds[:50]],
        },
    })

    shap_data.append({
        "feature": feat_info["feature"],
        "importance": feat_info["importance"],
        "effect_norm": round(effect_norm, 4),
        "high_med":   round(high_current, 5),
        "low_med":    round(normal_median, 5),
        "global_std": round(global_std, 5),
    })

# ── 6. 트렌드 데이터 (가상 75일: train 45 + val 15 + test 15) ────────────────
print("[6/7] 트렌드 생성 (lot → 가상 날짜)...")

xs_all = pd.read_csv(DATA / "compet_xs_data.csv", usecols=["ufs_serial", "run_wf_xy", "split"])
xs_all["run_id"] = xs_all["run_wf_xy"].str.split("_").str[0]
xs_units = xs_all.drop_duplicates("ufs_serial")[["ufs_serial", "run_id", "split"]]

ys_test_file = DATA / "compet_ys_test_data.csv"

def make_split_df(ys_df, result_df, split_name, include_true=True):
    df = ys_df[["ufs_serial"]].copy()
    df["y_pred"] = result_df["y_pred"].values
    df["y_true"] = ys_df["health"].values if include_true else np.nan
    df = df.merge(xs_units[xs_units["split"] == split_name][["ufs_serial", "run_id"]],
                  on="ufs_serial", how="left")
    return df

train_df = make_split_df(ys_train, res_train, "train",      include_true=True)
val_df2  = make_split_df(ys_val,   res_val,   "validation", include_true=False)
if ys_test_file.exists():
    ys_test = pd.read_csv(ys_test_file)
    test_df = make_split_df(ys_test, res_test, "test", include_true=False)
else:
    test_df = None

lots = sorted(xs_all["run_id"].unique())

# 복합 개선 delta (NaN 안전 처리)
raw_deltas = [f["sim"]["delta_pred"] for f in feature_comparison]
combined_delta = sum(d for d in raw_deltas if not np.isnan(d))
print(f"  복합 개선 delta_pred ({len(feature_comparison)}개 피처 합산): {combined_delta:.6f}")

# 불량 기준 threshold: train 실제 불량률에 맞게 역산
true_defect_rate = float((ys_train["health"] > 0).mean())
PRED_DEFECT_THR  = float(np.percentile(res_train["y_pred"], 100 * (1 - true_defect_rate)))
print(f"  PRED_DEFECT_THR (train 불량률 {true_defect_rate*100:.1f}% 기준): {PRED_DEFECT_THR:.6f}")

def assign_days(df, split_name, day_start, n_days, lots):
    day_map = {lot: day_start + int(i * n_days / len(lots))
               for i, lot in enumerate(lots)}
    rows = []
    for lot in lots:
        day = day_map[lot]
        lot_data = df[df["run_id"] == lot] if df is not None else pd.DataFrame()
        if len(lot_data) == 0:
            continue
        pred_rate = float((lot_data["y_pred"] >= PRED_DEFECT_THR).mean() * 100)
        if split_name == "train":
            true_rate     = float((lot_data["y_true"] > 0).mean() * 100)
            sim_pred_rate = None
        else:
            true_rate = None
            adj = np.clip(lot_data["y_pred"].values + combined_delta, 0, None)
            sim_pred_rate = float((adj >= PRED_DEFECT_THR).mean() * 100)
        rows.append({
            "day":           day,
            "pred_rate":     round(pred_rate, 2),
            "true_rate":     round(true_rate, 2) if true_rate is not None else None,
            "sim_pred_rate": round(sim_pred_rate, 2) if sim_pred_rate is not None else None,
            "split":         split_name,
            "n":             len(lot_data),
        })
    return rows

trend_rows = (
    assign_days(train_df, "train",      1,               TRAIN_DAYS, lots) +
    assign_days(val_df2,  "validation", TRAIN_DAYS + 1,  VAL_DAYS,   lots) +
    (assign_days(test_df, "test", TRAIN_DAYS + VAL_DAYS + 1, TEST_DAYS, lots)
     if test_df is not None else [])
)

day_agg = defaultdict(lambda: {
    "pr": 0.0, "tr": 0.0, "sr": 0.0,
    "n": 0, "split": "", "has_true": False, "has_sim": False,
})
for row in trend_rows:
    d = row["day"]
    day_agg[d]["pr"]   += row["pred_rate"] * row["n"]
    day_agg[d]["n"]    += row["n"]
    day_agg[d]["split"] = row["split"]
    if row["true_rate"] is not None:
        day_agg[d]["tr"]      += row["true_rate"] * row["n"]
        day_agg[d]["has_true"] = True
    if row["sim_pred_rate"] is not None:
        day_agg[d]["sr"]     += row["sim_pred_rate"] * row["n"]
        day_agg[d]["has_sim"] = True

trend_data = sorted([
    {
        "day":           day,
        "pred_rate":     round(agg["pr"] / agg["n"], 2),
        "true_rate":     round(agg["tr"] / agg["n"], 2) if agg["has_true"] else None,
        "sim_pred_rate": round(agg["sr"] / agg["n"], 2) if agg["has_sim"] else None,
        "split":         agg["split"],
        "n":             agg["n"],
    }
    for day, agg in day_agg.items()
], key=lambda x: x["day"])

print(f"  트렌드: {len(trend_data)}개 포인트 (train:{sum(1 for d in trend_data if d['split']=='train')}"
      f" val:{sum(1 for d in trend_data if d['split']=='validation')}"
      f" test:{sum(1 for d in trend_data if d['split']=='test')})")

# ── 7. Wafer별 위험률 & scatter & 성능 요약 ──────────────────────────────────
print("[7/7] Wafer 위험률 & Scatter & 성능 요약...")

# lot-wafer별 불량 위험률 (test 기준)
xs_rep_wafer = xs_rep.groupby("ufs_serial").agg(
    run_id=("run_id",    "first"),
    wafer_no=("run_wf_xy", lambda x: x.iloc[0].split("_")[1]),
).reset_index()
wafer_unit = unit_base_df.merge(xs_rep_wafer, on="ufs_serial", how="left")
wafer_risk = []
for (run_id, wafer_no), grp in wafer_unit.groupby(["run_id", "wafer_no"]):
    pred_rate = float((grp["y_pred"] >= PRED_DEFECT_THR).mean() * 100)
    true_rate = float((grp["y_true"] > 0).mean() * 100)
    wafer_risk.append({
        "id":        f"{run_id}-{wafer_no}",
        "lot":       run_id,
        "wafer":     wafer_no,
        "pred_rate": round(pred_rate, 1),
        "true_rate": round(true_rate, 1),
        "n":         len(grp),
    })
# lot번호-wafer번호 순 정렬
wafer_risk.sort(key=lambda x: (x["lot"], x["wafer"]))
print(f"  Wafer 수: {len(wafer_risk)}개, 최고 위험 {max(w['pred_rate'] for w in wafer_risk):.1f}%")

hi_sample = unit[high_mask][["die_x_mean", "die_y_mean", "y_pred"]].dropna().head(300)
lo_sample = unit[low_mask ][["die_x_mean", "die_y_mean", "y_pred"]].dropna().head(300)
scatter_data = (
    [{"x": round(float(r["die_x_mean"]),1), "y": round(float(r["die_y_mean"]),1),
      "p": round(float(r["y_pred"]),5), "g": "high"} for _, r in hi_sample.iterrows()] +
    [{"x": round(float(r["die_x_mean"]),1), "y": round(float(r["die_y_mean"]),1),
      "p": round(float(r["y_pred"]),5), "g": "low"}  for _, r in lo_sample.iterrows()]
)

val_rmse  = float(np.sqrt(np.mean(res_val["diff"] ** 2)))
test_rmse = float(np.sqrt(np.mean(res_test["diff"] ** 2)))
clf_val   = clf_met[clf_met["split"] == "Val"].iloc[0]

# 절대 임계값 기준 실제 불량 예측 카운트 (fallback high_mask와 무관)
abs_high_mask = unit["y_pred"] >= PRED_DEFECT_THR
n_high_tp = int((unit.loc[abs_high_mask, "y_true"] > 0).sum())
n_high    = int(abs_high_mask.sum())

n_nonzero_test = int((unit["y_true"] > 0).sum())

perf = {
    "study_id":        STUDY_ID,
    "report_split":    REPORT_SPLIT,
    "val_rmse":        round(val_rmse, 6),
    "test_rmse":       round(test_rmse, 6),
    "clf_recall":      round(float(clf_val["recall"]), 4),
    "clf_precision":   round(float(clf_val["precision"]), 4),
    "fn_rmse":         round(float(clf_val["fn_rmse"]), 6),
    "fp_rmse":         round(float(clf_val["fp_rmse"]), 6),
    "fn_count":        int(clf_val["FN"]),
    "tp_count":        int(clf_val["TP"]),
    "n_val":           len(unit),
    "n_high":          n_high,
    "n_low":           int(low_mask.sum()),
    "n_nonzero":       n_nonzero_test,
    "n_high_tp":       n_high_tp,
    "precision_pred":  round(n_high_tp / max(n_high, 1), 4),
    "high_thr":        HIGH_THR,
    "low_thr":         LOW_THR,
    "pred_defect_thr":  round(PRED_DEFECT_THR, 6),
    "true_defect_rate": round(true_defect_rate, 4),
    "pred_mean":        round(float(y_pred_all.mean()), 6),
    "pred_p90":         round(float(y_pred_all.quantile(0.9)), 6),
    "train_days":       TRAIN_DAYS,
    "val_days":         VAL_DAYS,
    "test_days":        TEST_DAYS,
    "last_test_day":    int(last_test_day),
}

# ── 저장 ──────────────────────────────────────────────────────────────────────
report_data = {
    "perf":               perf,
    "importance_all":     importance_all,
    "feature_comparison": feature_comparison,
    "shap_data":          shap_data,
    "scatter_data":       scatter_data,
    "trend_data":         trend_data,
    "wafer_risk":         wafer_risk,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(report_data, f, ensure_ascii=False, indent=2)

print(f"\n저장 완료: {OUT} ({OUT.stat().st_size//1024} KB)")
print(f"  기준 split: {REPORT_SPLIT}  |  유닛 수: {len(unit)}")
print(f"  불량 비율(y_pred≥{PRED_DEFECT_THR:.6f}): {n_high}개 ({n_high/len(unit)*100:.1f}%)  |  실제 불량(y_true>0): {n_nonzero_test}개 ({n_nonzero_test/len(unit)*100:.1f}%)")
print(f"  트렌드 포인트: {len(trend_data)}개  |  Scatter: {len(scatter_data)}개")
