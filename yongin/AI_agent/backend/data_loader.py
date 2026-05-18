"""
data_loader.py
잔차분석 결과 데이터 로드 유틸리티
"""
import os
import pickle
import numpy as np
import pandas as pd

STUDY_ID = "20-101-002"
BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "Dashboard", STUDY_ID)


def _path(name: str) -> str:
    return os.path.join(BASE_DIR, name.format(s=STUDY_ID))


def load_weights() -> dict:
    with open(_path("weights_{s}.pkl"), "rb") as f:
        return pickle.load(f)


def load_proba_test() -> pd.DataFrame:
    return pd.read_csv(_path("proba_test_{s}.csv"))


def load_result_val() -> pd.DataFrame:
    return pd.read_csv(_path("result_val_{s}.csv"))


def load_result_test() -> pd.DataFrame:
    return pd.read_csv(_path("result_test_{s}.csv"))


def load_clf_metrics() -> pd.DataFrame:
    return pd.read_csv(_path("clf_metrics_{s}.csv"))


def load_res_importance() -> pd.DataFrame:
    return pd.read_csv(_path("res_importance_{s}.csv"))


def load_corr() -> pd.DataFrame:
    return pd.read_csv(_path("corr_{s}.csv"))


def get_performance_summary() -> dict:
    """성능 요약 통계 반환"""
    val_df = load_result_val()
    test_df = load_result_test()
    clf_df = load_clf_metrics()

    val_rmse = float(np.sqrt(np.mean(val_df["diff"] ** 2)))
    test_rmse = float(np.sqrt(np.mean(test_df["diff"] ** 2)))

    # zero vs nonzero RMSE
    val_zero = val_df[val_df["y_true"] == 0]
    val_nz = val_df[val_df["y_true"] > 0]
    zero_rmse = float(np.sqrt(np.mean(val_zero["diff"] ** 2))) if len(val_zero) else 0.0
    nz_rmse = float(np.sqrt(np.mean(val_nz["diff"] ** 2))) if len(val_nz) else 0.0

    clf_val = clf_df[clf_df["split"] == "Val"].iloc[0]

    return {
        "study_id": STUDY_ID,
        "val_rmse": val_rmse,
        "test_rmse": test_rmse,
        "zero_rmse": zero_rmse,
        "nonzero_rmse": nz_rmse,
        "clf_recall": float(clf_val["recall"]),
        "clf_precision": float(clf_val["precision"]),
        "clf_f1": float(clf_val["f1"]),
        "fn_rmse": float(clf_val["fn_rmse"]),
        "fp_rmse": float(clf_val["fp_rmse"]),
        "n_val": len(val_df),
        "n_zero": len(val_zero),
        "n_nonzero": len(val_nz),
    }


def get_risk_distribution() -> dict:
    """clf_proba 기반 위험도 분포"""
    proba_df = load_proba_test()
    clf_proba = proba_df["clf_proba"].values

    low = int((clf_proba < 0.2).sum())
    medium = int(((clf_proba >= 0.2) & (clf_proba < 0.4)).sum())
    high = int((clf_proba >= 0.4).sum())
    total = len(clf_proba)

    return {
        "total": total,
        "low_risk": low,
        "medium_risk": medium,
        "high_risk": high,
        "low_pct": round(low / total * 100, 1),
        "medium_pct": round(medium / total * 100, 1),
        "high_pct": round(high / total * 100, 1),
        "mean_proba": float(clf_proba.mean()),
        "p90_proba": float(np.percentile(clf_proba, 90)),
        "p95_proba": float(np.percentile(clf_proba, 95)),
    }


def get_top_features(n: int = 15) -> list[dict]:
    """잔차 예측에 중요한 상위 피처 반환"""
    imp_df = load_res_importance()
    top = imp_df.head(n)

    # corr_df와 합치기
    corr_df = load_corr()
    corr_map = dict(zip(corr_df["feature"], corr_df["corr"]))

    results = []
    for _, row in top.iterrows():
        feat = row["feature"]
        base_feat = feat.split("_")[0]  # X178 from X178_mean
        agg = "_".join(feat.split("_")[1:]) if "_" in feat else ""
        results.append({
            "feature": feat,
            "base_feature": base_feat,
            "aggregation": agg,
            "importance": int(row["importance"]),
            "corr_with_residual": round(corr_map.get(feat, 0.0), 4),
        })
    return results


def get_clf_proba_series() -> np.ndarray:
    return load_proba_test()["clf_proba"].values


def get_prediction_series() -> tuple[np.ndarray, np.ndarray]:
    df = load_result_val()
    return df["y_true"].values, df["y_pred"].values
