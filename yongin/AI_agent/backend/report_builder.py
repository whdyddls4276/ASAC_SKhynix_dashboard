"""
report_builder.py
Dashboard public/ CSV → report_data 구조 빌더
feature_comparison(boxplot)만 원본 X 데이터가 없으므로 static JSON 유지
"""
import os
import json
import numpy as np
import pandas as pd

_BACKEND_DIR  = os.path.dirname(__file__)
_PUBLIC_DIR   = os.path.join(_BACKEND_DIR, "..", "..", "Dashboard", "public")
_STATIC_JSON  = os.path.join(_BACKEND_DIR, "..", "frontend", "report_data.json")


def _pub(name: str) -> str:
    return os.path.join(_PUBLIC_DIR, name)


def _load_static() -> dict:
    with open(_STATIC_JSON, encoding="utf-8") as f:
        return json.load(f)


def build_report_data() -> dict:
    """Dashboard public CSV에서 실시간 report_data 생성. 실패 시 static JSON fallback."""
    try:
        static = _load_static()

        # ── 1. dashboard_units.csv ─────────────────────────────
        units = pd.read_csv(_pub("dashboard_units.csv"))
        train = units[units["split"] == "train"]
        val   = units[units["split"] == "val"]

        # defect threshold: train 70.8th percentile
        train_preds = np.sort(train["reg_pred"].values)
        defect_thr  = float(train_preds[int(len(train_preds) * 0.708)])

        val = val.copy()
        val["is_defect"]      = val["health"] > 0
        val["is_pred_defect"] = val["reg_pred"] >= defect_thr

        fp = val[val["is_pred_defect"] & ~val["is_defect"]]
        fn = val[~val["is_pred_defect"] &  val["is_defect"]]
        tp = val[val["is_pred_defect"] &  val["is_defect"]]

        val_rmse = float(np.sqrt(np.mean((val["health"].values - val["reg_pred"].values) ** 2)))
        fp_rmse  = float(np.sqrt(np.mean(fp["reg_pred"].values ** 2))) if len(fp) else 0.0
        fn_diff  = fn["health"].values - fn["reg_pred"].values
        fn_rmse  = float(np.sqrt(np.mean(fn_diff ** 2))) if len(fn) else 0.0

        # high_thr: val 상위 10%
        high_thr = float(np.percentile(val["reg_pred"].values, 90))
        n_high   = int((val["reg_pred"] >= high_thr).sum())
        n_low    = int(~val["is_pred_defect"].sum())

        # lot 수 → train/val/test days
        train_days = int(train["run_id"].nunique())
        val_days   = int(val["run_id"].nunique())
        test_units = units[units["split"] == "test"]
        test_days  = int(test_units["run_id"].nunique()) if len(test_units) else 15

        # ── 2. metrics.csv ─────────────────────────────────────
        metrics = pd.read_csv(_pub("metrics.csv"))

        def get_m(stage, model, split, metric):
            r = metrics[
                (metrics["stage"]  == stage)  &
                (metrics["model"]  == model)  &
                (metrics["split"]  == split)  &
                (metrics["metric"] == metric)
            ]
            return float(r["value"].iloc[0]) if len(r) else 0.0

        clf_recall    = get_m("clf", "soft_vote", "val", "recall")
        clf_precision = get_m("clf", "soft_vote", "val", "precision")

        # test RMSE: ensemble val이 없으면 lgbm test
        test_rmse = get_m("reg", "ensemble", "val", "rmse")
        for _mdl in ["lgbm", "et", "enet"]:
            t = get_m("reg", _mdl, "test", "rmse")
            if t > 0:
                test_rmse = t
                break

        perf = {
            **static.get("perf", {}),   # sim 관련 etc 기타 필드 보존
            "study_id":        "20-101-002",
            "report_split":    "val",
            "val_rmse":        val_rmse,
            "test_rmse":       test_rmse,
            "clf_recall":      clf_recall,
            "clf_precision":   clf_precision,
            "fn_rmse":         fn_rmse,
            "fp_rmse":         fp_rmse,
            "fn_count":        int(len(fn)),
            "tp_count":        int(len(tp)),
            "n_val":           int(len(val)),
            "n_high":          n_high,
            "n_low":           n_low,
            "n_nonzero":       int(val["is_defect"].sum()),
            "n_high_tp":       int((tp["reg_pred"] >= high_thr).sum()),
            "precision_pred":  float(len(tp) / (len(tp) + len(fp))) if (len(tp) + len(fp)) > 0 else 0.0,
            "high_thr":        round(high_thr, 6),
            "low_thr":         round(defect_thr * 0.6, 6),
            "pred_defect_thr": round(defect_thr, 6),
            "true_defect_rate": float(val["is_defect"].mean()),
            "pred_mean":       float(val["reg_pred"].mean()),
            "pred_p90":        float(np.percentile(val["reg_pred"], 90)),
            "train_days":      train_days,
            "val_days":        val_days,
            "test_days":       test_days,
            "last_test_day":   train_days + val_days + test_days,
        }

        # ── 3. shap_data (shap_data.csv) ──────────────────────
        shap_detail = pd.read_csv(_pub("shap_data.csv"))
        shap_detail = shap_detail.sort_values("lgbm_gain", ascending=False).head(20).reset_index(drop=True)

        # shap_bar.csv: mean_abs_shap per feature (Column_xxx naming — optional join)
        try:
            shap_bar = pd.read_csv(_pub("shap_bar.csv"))
            shap_bar_map = dict(zip(shap_bar["feature"].astype(str), shap_bar["mean_abs_shap"]))
        except Exception:
            shap_bar_map = {}

        max_gain = float(shap_detail["lgbm_gain"].max()) or 1.0
        shap_data_out = []
        for rank, (_, row) in enumerate(shap_detail.iterrows(), start=1):
            feat = str(row["feature"])
            parts = feat.split("_")
            base  = parts[0]
            agg   = "_".join(parts[1:]) if len(parts) > 1 else ""
            effect = float(row.get("effect_norm", 0))
            shap_data_out.append({
                "feature":       feat,
                "base":          base,
                "agg":           agg,
                "rank":          rank,
                "mean_abs_shap": round(float(row["lgbm_gain"]) / max_gain * 0.001, 6),
                "effect_norm":   round(effect, 4),
                "importance":    round(float(row["lgbm_gain"]), 1),
                "high_med":      round(float(row.get("high_median", 0)), 4),
                "low_med":       round(float(row.get("med_median", 0)), 4),
            })

        # ── 4. importance_all (feature_importance.csv) ─────────
        try:
            fi = pd.read_csv(_pub("feature_importance.csv"))
            fi = fi.sort_values("lgbm_gain", ascending=False).head(15)
            importance_all = [
                {"feature": str(r["feature"]), "importance": round(float(r["lgbm_gain"]), 1)}
                for _, r in fi.iterrows()
            ]
        except Exception:
            importance_all = [
                {"feature": s["feature"], "importance": s["importance"]}
                for s in shap_data_out[:15]
            ]

        # ── 5. trend_data (trend_data.csv) ─────────────────────
        trend_csv = pd.read_csv(_pub("trend_data.csv"))
        train_end = pd.Timestamp("2026-05-11")
        val_end   = pd.Timestamp("2026-06-10")

        trend_data_out = []
        for day_idx, (_, row) in enumerate(trend_csv.iterrows(), start=1):
            date_str = ""
            try:
                dt = pd.Timestamp(str(row["date"]))
                date_str = dt.strftime("%Y-%m-%d")
                if dt <= train_end:
                    split = "train"
                elif dt <= val_end:
                    split = "val"
                else:
                    split = "test"
            except Exception:
                split = "train"

            y_pred = row.get("y_pred", None)
            y_true = row.get("y_true", None)
            pred_r = round(float(y_pred), 2) if y_pred not in (None, "", "nan", float("nan")) and str(y_pred) != "nan" else None
            true_r = round(float(y_true), 2) if y_true not in (None, "", "nan", float("nan")) and str(y_true) != "nan" else None

            trend_data_out.append({
                "day":           day_idx,
                "date":          date_str,
                "pred_rate":     pred_r,
                "true_rate":     true_r,
                "sim_pred_rate": None,
                "split":         split,
                "n":             0,
            })

        # ── 6. wafer_risk (dashboard_units.csv val, grouped) ───
        val_grp = (
            val.groupby(["run_id", "wafer_no"])
            .agg(
                pred_rate=("is_pred_defect", lambda x: round(float(x.mean() * 100), 1)),
                true_rate=("is_defect",      lambda x: round(float(x.mean() * 100), 1)),
                n=("ufs_serial", "count"),
            )
            .reset_index()
            .sort_values("pred_rate", ascending=False)
            .head(40)
        )
        wafer_risk_out = [
            {
                "id":        f"{int(r['run_id'])}-{int(r['wafer_no'])}",
                "lot":       str(int(r["run_id"])),
                "wafer":     str(int(r["wafer_no"])),
                "pred_rate": float(r["pred_rate"]),
                "true_rate": float(r["true_rate"]),
                "n":         int(r["n"]),
            }
            for _, r in val_grp.iterrows()
        ]

        # ── 7. shap_meta ───────────────────────────────────────
        shap_meta = {
            **static.get("shap_meta", {}),
            "n_units":     int(len(val)),
            "n_feats_used": int(len(shap_detail)),
            "top_n":       20,
            "high_thr":    round(high_thr, 6),
            "low_thr":     round(defect_thr, 6),
            "n_high":      n_high,
            "n_low":       n_low,
        }

        return {
            **static,                            # scatter_data 등 기타 필드 유지
            "perf":               perf,
            "shap_data":          shap_data_out,
            "importance_all":     importance_all,
            "trend_data":         trend_data_out,
            "wafer_risk":         wafer_risk_out,
            "shap_meta":          shap_meta,
            "feature_comparison": static.get("feature_comparison", []),  # boxplot은 static 유지
        }

    except Exception as exc:
        import traceback
        print(f"[report_builder] Error: {exc}")
        traceback.print_exc()
        return _load_static()
