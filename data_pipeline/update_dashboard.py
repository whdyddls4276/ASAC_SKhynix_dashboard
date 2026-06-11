"""
원터치 대시보드/보고서 데이터 업데이트 (dashboard_fin 전용)

새 모델 run 디렉터리 하나만 주면 processed 재생성 → public 복사 → val RMSE 갱신까지 자동.
경로는 전부 dashboard_fin 으로 고정 (v3 등 오염 원천 차단).

사용법:
    python update_dashboard.py <run_dir>            # 전체 실행
    python update_dashboard.py <run_dir> --check     # 입력/의존성만 검증 (쓰기 없음)

  <run_dir> : best/ 를 포함한 모델 run 폴더
              예) C:/Users/Dell3571/Downloads/run_0605_194155_3-.../run_0605_194155_3

선택 환경변수(기본값 있음):
    XS_PATH        원본 피처 csv (기본: ASAC_SKhynix/0_data/compet_xs_data.csv)
    MODEL_MODULES  fold_models.pkl unpickle용 모듈 경로 (기본: ASAC_SKhynix/3_modeling, ASAC_SKhynix)
"""
import os, sys, json, pickle, shutil, subprocess
import pandas as pd
import numpy as np
from pathlib import Path

# Windows 콘솔(cp949)에서 ✔/✅ 등 유니코드 출력 안전화
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ── 고정 경로 (dashboard_fin) ─────────────────────────────────
FIN_ROOT = Path(__file__).resolve().parent.parent          # dashboard_fin/
PROC     = FIN_ROOT / "data" / "processed"
PUBLIC   = FIN_ROOT / "Dashboard" / "public"
PIPE     = FIN_ROOT / "data_pipeline"

XS_PATH = Path(os.environ.get(
    "XS_PATH", "C:/Users/Dell3571/Desktop/ASAC_SKhynix/0_data/compet_xs_data.csv"))
MODEL_MODULES = os.environ.get(
    "MODEL_MODULES",
    "C:/Users/Dell3571/Desktop/ASAC_SKhynix/3_modeling;C:/Users/Dell3571/Desktop/ASAC_SKhynix")

# 프론트가 public 에서 읽는 모델-의존 파일 (복사 대상)
PUBLIC_FILES = [
    "dashboard_units.csv", "wafer_map.csv", "wafer_scale.json", "location_stats.csv",
    "feature_importance.csv", "shap_bar.csv", "shap_beeswarm.csv", "shap_unit.json",
    "feature_dist.csv", "dashboard_lot_patterns.csv", "dashboard_lot_pattern_maps.json",
    "dashboard_lot_summary.csv", "metrics.csv", "outlier_wafer.json", "outlier_wafers.json",
]


def log(msg): print(msg, flush=True)
def hr():     log("=" * 64)


# ════════════════════════════════════════════════════════════════
#  사전 검증
# ════════════════════════════════════════════════════════════════
def preflight(run_dir: Path):
    best = run_dir / "best"
    problems = []
    if not best.is_dir():
        problems.append(f"best/ 폴더 없음: {best}")
    need = ["oof_die.csv", "oof_unit.csv", "val_die.csv", "val_unit.csv",
            "test_die.csv", "test_unit.csv", "fold_models.pkl", "summary_record.json"]
    for f in need:
        if not (best / f).exists():
            problems.append(f"필수 파일 없음: best/{f}")
    if not (PROC / "wafer_map.csv").exists():
        problems.append(f"기존 메타 없음: {PROC/'wafer_map.csv'} (fin processed 가 있어야 함)")
    if not XS_PATH.exists():
        problems.append(f"원본 피처 csv 없음: {XS_PATH} (XS_PATH 환경변수로 지정 가능)")
    for p in MODEL_MODULES.split(";"):
        if p and not Path(p).exists():
            problems.append(f"모델 모듈 경로 없음: {p} (MODEL_MODULES 로 지정 가능)")
    return best, problems


# ════════════════════════════════════════════════════════════════
#  1. 모델 데이터 (units / wafer_map / FI / location / scale / lots)
# ════════════════════════════════════════════════════════════════
def gen_model_data(best: Path):
    hr(); log("[1] 모델 데이터 (dashboard_units, wafer_map, FI, location, scale, lots)")

    def rd(f, split):
        d = pd.read_csv(best / f); d["split"] = split; return d
    all_die = pd.concat([rd("oof_die.csv", "train"), rd("val_die.csv", "val"),
                         rd("test_die.csv", "test")], ignore_index=True)
    all_unit = pd.concat([rd("oof_unit.csv", "train"), rd("val_unit.csv", "val"),
                          rd("test_unit.csv", "test")], ignore_index=True)
    all_die["pred"] = all_die["pred_taupi"]   # die = 합 구조 기여분
    log(f"  die {len(all_die):,} | unit {len(all_unit):,} | "
        f"unit pred mean={all_unit['pred'].mean():.6f}")

    # 메타(run_id,wafer_no,split,health,date)는 기존 wafer_map 에서 재사용
    wmap_meta = pd.read_csv(PROC / "wafer_map.csv")
    unit_meta = (wmap_meta.groupby("ufs_serial", as_index=False)
                 .first()[["ufs_serial", "run_id", "wafer_no", "split", "health", "date"]])

    # ── dashboard_units.csv (grade: P90=grade3, upper_fence=grade4) ──
    units = unit_meta.merge(
        all_unit[["ufs_serial", "split", "pred"]].rename(columns={"pred": "reg_pred"}),
        on=["ufs_serial", "split"], how="left")
    ap = units["reg_pred"].dropna()
    q1, q2, q3, p90 = ap.quantile(.25), ap.quantile(.50), ap.quantile(.75), ap.quantile(.90)
    upper_fence = q3 + 1.5 * (q3 - q1)
    log(f"  Q2={q2:.6f} Q3={q3:.6f} P90={p90:.6f} upper_fence={upper_fence:.6f}")

    def risk(p):  return "HIGH" if p >= upper_fence else "MED" if p >= p90 else "LOW"
    def grade(p): return ("grade4" if p >= upper_fence else "grade3" if p >= p90
                          else "grade2" if p >= q2 else "grade1")
    units["risk"]  = units["reg_pred"].apply(risk)
    units["grade"] = units["reg_pred"].apply(grade)

    # anomaly_score: 모델 무관 → 기존 dashboard_units 에서 유지
    try:
        old = pd.read_csv(PROC / "dashboard_units.csv", usecols=["ufs_serial", "anomaly_score"])
        units = units.merge(old, on="ufs_serial", how="left")
    except Exception:
        units["anomaly_score"] = np.nan

    # Conformal 95% CI (val 잔차)
    vw = units[(units["split"] == "val") & units["health"].notna() & units["reg_pred"].notna()]
    if len(vw):
        qs = (vw["health"].astype(float) - vw["reg_pred"].astype(float)).abs().quantile(0.95)
        units["ci_low"]  = (units["reg_pred"].astype(float) - qs).clip(lower=0).round(6)
        units["ci_high"] = (units["reg_pred"].astype(float) + qs).round(6)
    else:
        units["ci_low"] = units["ci_high"] = np.nan

    cols = ["ufs_serial", "run_id", "wafer_no", "split", "health", "reg_pred",
            "risk", "grade", "anomaly_score", "ci_low", "ci_high", "date"]
    units[cols].to_csv(PROC / "dashboard_units.csv", index=False)
    log(f"  ✔ dashboard_units.csv ({len(units):,}) grade={units['grade'].value_counts().to_dict()}")

    # ── wafer_map.csv die pred 교체 ──
    wmap = pd.read_csv(PROC / "wafer_map.csv")
    lk = all_die.drop_duplicates(["ufs_serial", "position"]).set_index(["ufs_serial", "position"])["pred"]
    wmap["pred"] = wmap.set_index(["ufs_serial", "position"]).index.map(lk)
    miss = wmap["pred"].isna().sum()
    wmap.to_csv(PROC / "wafer_map.csv", index=False)
    log(f"  ✔ wafer_map.csv ({len(wmap):,}) {'매핑실패 '+str(miss) if miss else ''}")

    # ── feature_importance.csv ──
    ckpt = pickle.load(open(best / "fold_models.pkl", "rb"))
    feat_names, fold_models = ckpt["feature_names"], ckpt["fold_models"]
    gain = np.zeros(len(feat_names))
    for fm in fold_models:
        gain += fm.lgb_mu_.booster_.feature_importance(importance_type="gain")
    gain /= len(fold_models)
    fi = (pd.DataFrame({"feature": feat_names, "lgbm_gain": gain})
          .sort_values("lgbm_gain", ascending=False).reset_index(drop=True))
    fi["lgbm_rank"] = fi.index + 1
    fi.to_csv(PROC / "feature_importance.csv", index=False)
    log(f"  ✔ feature_importance.csv Top5={fi['feature'].head(5).tolist()}")

    # ── location_stats.csv / wafer_scale.json / wafer_map_lots/ ──
    wl = pd.read_csv(PROC / "wafer_map.csv"); wl["pred"] = pd.to_numeric(wl["pred"], errors="coerce")
    wl = wl.dropna(subset=["pred"])
    die_th = float(wl["pred"].quantile(0.90))
    lg = wl.groupby(["die_x", "die_y"], as_index=False).agg(
        count=("pred", "count"), pred_mean=("pred", "mean"), pred_max=("pred", "max"),
        pred_std=("pred", "std"), risk_count=("pred", lambda x: (x > die_th).sum()))
    lg["pred_mean"] = lg["pred_mean"].round(8); lg["pred_max"] = lg["pred_max"].round(8)
    lg["pred_std"] = lg["pred_std"].fillna(0).round(8)
    lg["risk_rate"] = (lg["risk_count"] / lg["count"] * 100).round(2)
    lg["ppm_mean"] = (lg["pred_mean"] * 1e6).round(1); lg["ppm_max"] = (lg["pred_max"] * 1e6).round(1)
    xc = (lg["die_x"].max() + lg["die_x"].min()) / 2; yc = (lg["die_y"].max() + lg["die_y"].min()) / 2
    lg["radial_dist"] = np.sqrt((lg["die_x"] - xc) ** 2 + (lg["die_y"] - yc) ** 2).round(3)
    lg.to_csv(PROC / "location_stats.csv", index=False)
    log(f"  ✔ location_stats.csv ({len(lg):,})")

    dp = np.sort(wl["pred"].values)
    scale = {"threshold": float(dp[int(len(dp) * 0.90)]), "pred_min": float(dp[0]),
             "pred_max": float(dp[-1]),
             "grid_x_range": int(wl["die_x"].max() - wl["die_x"].min() + 1),
             "grid_y_range": int(wl["die_y"].max() - wl["die_y"].min() + 1)}
    json.dump(scale, open(PROC / "wafer_scale.json", "w"))
    log(f"  ✔ wafer_scale.json threshold={scale['threshold']:.8f}")

    LOTS = PROC / "wafer_map_lots"
    pref = all_die[["ufs_serial", "position", "pred"]].drop_duplicates(["ufs_serial", "position"])
    lot_files = sorted(LOTS.glob("lot_*.csv"))
    for lp in lot_files:
        ld = (pd.read_csv(lp).drop_duplicates(["ufs_serial", "position", "die_x", "die_y"])
              .drop(columns=["pred", "clf_proba"], errors="ignore")
              .merge(pref, on=["ufs_serial", "position"], how="left"))
        ld.to_csv(lp, index=False)
    log(f"  ✔ wafer_map_lots/ ({len(lot_files)} lots)")

    return all_die, feat_names, fold_models


# ════════════════════════════════════════════════════════════════
#  2. SHAP (전체 die: train+val+test) → bar / beeswarm / unit
# ════════════════════════════════════════════════════════════════
def gen_shap(all_die, feat_names, fold_models):
    hr(); log("[2] SHAP 재계산 (train+val+test 전체 die → shap_bar/beeswarm/shap_unit)")
    import shap
    xs_cols = set(pd.read_csv(XS_PATH, nrows=0).columns)
    missing_feats = [f for f in feat_names if f.endswith("_missing")]
    missing_base  = [f.replace("_missing", "") for f in missing_feats]
    feat_xs = [f for f in feat_names if f in xs_cols and not f.endswith("_missing")]
    extra   = [c for c in missing_base if c in xs_cols and c not in feat_xs]

    serials = set(all_die["ufs_serial"].unique())
    xs = pd.read_csv(XS_PATH, usecols=["ufs_serial", "run_wf_xy"] + feat_xs + extra)
    xs = xs[xs["ufs_serial"].isin(serials)]
    if "die_x" in feat_names or "die_y" in feat_names:
        parts = xs["run_wf_xy"].str.split("_")
        xs["die_x"] = parts.str[-2].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
        xs["die_y"] = parts.str[-1].apply(pd.to_numeric, errors="coerce").fillna(0).astype(int)
    xs = xs.drop(columns="run_wf_xy")
    for base, mc in zip(missing_base, missing_feats):
        xs[mc] = xs[base].isna().astype(int) if base in xs.columns else 0
    xs = xs.drop(columns=[c for c in extra if c not in feat_names], errors="ignore")

    merged = all_die[["ufs_serial"]].merge(xs, on="ufs_serial", how="left")
    X_df = merged[feat_names].copy()
    X = X_df.fillna(0).values
    serials_arr = merged["ufs_serial"].values
    log(f"  X={X.shape}")

    BATCH = 1000; n = len(X); ssum = np.zeros((n, len(feat_names)))
    for i, fm in enumerate(fold_models):
        log(f"  fold {i+1}/{len(fold_models)} ...")
        ex = shap.TreeExplainer(fm.lgb_mu_)
        ssum += np.vstack([ex.shap_values(X[j:j+BATCH]) for j in range(0, n, BATCH)])
    sv = ssum / len(fold_models)

    mean_abs = np.abs(sv).mean(axis=0); mean_shap = sv.mean(axis=0)
    order = np.argsort(mean_abs)[::-1]
    pd.DataFrame({"feature": [feat_names[i] for i in order],
                  "mean_abs_shap": mean_abs[order], "mean_shap": mean_shap[order],
                  "rank": np.arange(1, len(feat_names) + 1)}).to_csv(PROC / "shap_bar.csv", index=False)
    log("  ✔ shap_bar.csv")

    TOP = 20; idx = order[:TOP]; tfn = [feat_names[i] for i in idx]
    sdf = pd.DataFrame(sv[:, idx], columns=tfn); sdf["ufs_serial"] = serials_arr
    fdf = pd.DataFrame(X_df[tfn].values, columns=[f"fv_{c}" for c in tfn]); fdf["ufs_serial"] = serials_arr
    su = sdf.groupby("ufs_serial")[tfn].mean()
    fu = fdf.groupby("ufs_serial")[[f"fv_{c}" for c in tfn]].mean()
    rows = []
    for ri, feat in enumerate(tfn):
        s = su[feat]; fv = fu[f"fv_{feat}"]
        fn = ((fv - fv.min()) / (fv.max() - fv.min() + 1e-12)).round(4).fillna(0)
        rows.append(pd.DataFrame({"ufs_serial": s.index, "feature": feat,
                                  "shap_value": s.values, "feat_norm": fn.values, "rank": ri}))
    bee = pd.concat(rows, ignore_index=True)
    bee.to_csv(PROC / "shap_beeswarm.csv", index=False)
    log(f"  ✔ shap_beeswarm.csv ({len(bee):,})")

    result = {}
    for serial, grp in bee.groupby("ufs_serial"):
        nz = grp[grp["shap_value"] != 0].copy()
        if nz.empty: continue
        nz["mag"] = nz["shap_value"].abs()
        top10 = nz.nlargest(10, "mag")[["feature", "shap_value"]]
        result[serial] = [{"feature": r["feature"], "shap_value": round(float(r["shap_value"]), 8)}
                          for _, r in top10.iterrows()]
    json.dump(result, open(PROC / "shap_unit.json", "w"), separators=(",", ":"))
    log(f"  ✔ shap_unit.json ({len(result):,} unit)")


# ════════════════════════════════════════════════════════════════
#  3. Lot 패턴 (dashboard_lot_patterns / pattern_maps)
# ════════════════════════════════════════════════════════════════
def classify_wafer_pattern(dies, threshold):
    if not len(dies): return "normal"
    xs = np.array([d[0] for d in dies], float); ys = np.array([d[1] for d in dies], float)
    ps = np.array([d[2] for d in dies], float)
    cx = (xs.max() + xs.min()) / 2; cy = (ys.max() + ys.min()) / 2
    r = np.hypot(xs - cx, (ys - cy) * 2.5); rm = r.max()
    if rm == 0: return "normal"
    rn = r / rm
    hr_ratio = (ps > threshold).mean()
    if hr_ratio >= 0.55: return "nearfull"
    cm = rn < 0.45; em = rn > 0.75
    if cm.sum() == 0 or em.sum() == 0:
        return "normal" if hr_ratio < 0.10 else "random"
    ca, ea = ps[cm].mean(), ps[em].mean()
    if ea > ca * 1.6 and ea > threshold * 0.3: return "edge"
    if ca > ea * 1.6 and ca > threshold * 0.3: return "center"
    return "normal" if hr_ratio < 0.10 else "random"


def gen_patterns():
    hr(); log("[3] Lot 패턴 (dashboard_lot_patterns, dashboard_lot_pattern_maps) — 유닛 reg_pred 기준")
    wm = pd.read_csv(PROC / "wafer_map.csv"); wm["pred"] = pd.to_numeric(wm["pred"], errors="coerce")
    # 유닛 기준: 각 die에 소속 유닛 reg_pred 부착 → 좌표별 worst 유닛 reg_pred 로 집계
    units = pd.read_csv(PROC / "dashboard_units.csv", usecols=["ufs_serial", "reg_pred"])
    units["reg_pred"] = pd.to_numeric(units["reg_pred"], errors="coerce")
    wm = wm.merge(units, on="ufs_serial", how="left")
    th = float(units["reg_pred"].dropna().quantile(0.90))   # 유닛 위험 임계 = reg_pred P90
    # 대상 lot = 기존 patterns.csv 의 lot 집합 (원본 1~28)
    try:
        target = set(pd.read_csv(PROC / "dashboard_lot_patterns.csv")["lot"].astype(int).tolist())
    except Exception:
        target = set(range(1, 29))
    maps, rows = {}, []
    for lot, g in wm.groupby("run_id"):
        if int(lot) not in target: continue
        # 좌표별 값 = 그 좌표에 닿는 유닛들의 reg_pred 최댓값(worst 유닛 위험도)
        coord = g.groupby(["die_x", "die_y"], as_index=False)["reg_pred"].max().dropna(subset=["reg_pred"])
        dl = [[int(r["die_x"]), int(r["die_y"]), round(float(r["reg_pred"]), 6)] for _, r in coord.iterrows()]
        maps[str(int(lot))] = dl
        rows.append({"lot": int(lot), "pattern": classify_wafer_pattern(dl, th),
                     "n_dies": len(coord), "n_wafers": g["wafer_no"].nunique(),
                     "risk_ratio": round(float((coord["reg_pred"] > th).mean()), 6),
                     "avg_pred": round(float(coord["reg_pred"].mean()), 6),
                     "max_pred": round(float(coord["reg_pred"].max()), 6)})
    json.dump(maps, open(PROC / "dashboard_lot_pattern_maps.json", "w"), separators=(",", ":"))
    pd.DataFrame(rows).sort_values("lot").to_csv(PROC / "dashboard_lot_patterns.csv", index=False)
    log(f"  ✔ pattern_maps.json + dashboard_lot_patterns.csv ({len(rows)} lot) · 유닛 P90 th={th:.6f}")


# ════════════════════════════════════════════════════════════════
#  4. dashboard_lot_summary  (wafer_map + threshold 파생)
# ════════════════════════════════════════════════════════════════
def gen_lot_summary():
    hr(); log("[4] dashboard_lot_summary.csv (계층탐색 lot/wafer 트리)")
    wm = pd.read_csv(PROC / "wafer_map.csv"); wm["pred"] = pd.to_numeric(wm["pred"], errors="coerce")
    wm = wm.dropna(subset=["pred"])
    th = json.load(open(PROC / "wafer_scale.json"))["threshold"]
    g = wm.groupby(["run_id", "wafer_no"]).agg(
        total_dies=("pred", "size"),
        risk_dies=("pred", lambda x: int((x > th).sum())),
        avg_ppm=("pred", lambda x: round(x.mean() * 1e6, 1))).reset_index()
    # 유닛 기반 위험비율: 그 웨이퍼의 위험 유닛(grade3/4 = reg_pred≥P90) 수 / 전체 유닛 수
    units = pd.read_csv(PROC / "dashboard_units.csv", usecols=["run_id", "wafer_no", "grade"])
    ug = units.groupby(["run_id", "wafer_no"]).agg(
        total_units=("grade", "size"),
        risk_units=("grade", lambda s: int(s.isin(["grade3", "grade4"]).sum()))).reset_index()
    g = g.merge(ug, on=["run_id", "wafer_no"], how="left")
    g["total_units"] = g["total_units"].fillna(0).astype(int)
    g["risk_units"]  = g["risk_units"].fillna(0).astype(int)
    g.to_csv(PROC / "dashboard_lot_summary.csv", index=False)
    log(f"  ✔ dashboard_lot_summary.csv ({len(g):,} wafers) · 유닛 위험비율 컬럼 추가")


# ════════════════════════════════════════════════════════════════
#  5. metrics.csv val RMSE  (summary_record.json)
# ════════════════════════════════════════════════════════════════
def update_metrics(best: Path) -> float:
    hr(); log("[5] metrics.csv val RMSE")
    v = round(float(json.load(open(best / "summary_record.json"))["val_rmse"]), 6)
    mp = PROC / "metrics.csv"
    if mp.exists():
        m = pd.read_csv(mp)
        mask = ((m["stage"] == "reg") & (m["model"] == "stacking")
                & (m["split"] == "val") & (m["metric"] == "rmse"))
        if mask.any():
            m.loc[mask, "value"] = v
        else:
            m = pd.concat([m, pd.DataFrame([{"stage": "reg", "model": "stacking",
                          "split": "val", "metric": "rmse", "value": v}])], ignore_index=True)
    else:
        m = pd.DataFrame([{"stage": "reg", "model": "stacking", "split": "val",
                           "metric": "rmse", "value": v}])
    m.to_csv(mp, index=False)
    log(f"  ✔ metrics.csv val RMSE = {v}")
    return v


# ════════════════════════════════════════════════════════════════
#  6. 서브 생성기 (feature_dist / outlier)  — 이미 파라미터화됨
# ════════════════════════════════════════════════════════════════
def run_subgenerators():
    hr(); log("[6] feature_dist / outlier_wafer(s)")
    for script in ["generate_feature_dist.py", "generate_outlier_wafer.py"]:
        log(f"  → {script} fin")
        r = subprocess.run([sys.executable, str(PIPE / script), "fin"],
                           capture_output=True, text=True)
        tail = (r.stdout or "").strip().splitlines()[-2:]
        for t in tail: log(f"    {t}")
        if r.returncode != 0:
            log(f"    ⚠ stderr: {(r.stderr or '').strip()[-400:]}")
            raise RuntimeError(f"{script} 실패")


# ════════════════════════════════════════════════════════════════
#  7. processed → public 복사
# ════════════════════════════════════════════════════════════════
def copy_to_public():
    hr(); log("[7] processed → Dashboard/public 복사")
    for f in PUBLIC_FILES:
        src = PROC / f
        if src.exists(): shutil.copy2(src, PUBLIC / f)
        else: log(f"  ⚠ 누락: {f}")
    dst_lots = PUBLIC / "wafer_map_lots"
    if dst_lots.exists(): shutil.rmtree(dst_lots)
    shutil.copytree(PROC / "wafer_map_lots", dst_lots)
    log(f"  ✔ {len(PUBLIC_FILES)} 파일 + wafer_map_lots/ "
        f"({len(list(dst_lots.glob('lot_*.csv')))} lots)")


# ════════════════════════════════════════════════════════════════
#  8. 하드코딩 val RMSE 기본값 갱신 (report/tools/agent)
# ════════════════════════════════════════════════════════════════
def patch_val_rmse(val: float):
    hr(); log("[8] 하드코딩 val RMSE 기본값 갱신")
    import re
    new = f"{val:.6f}"
    targets = {
        FIN_ROOT / "agent" / "report.py": [r'(meta\.get\("val_rmse",\s*")[0-9.]+(")'],
        FIN_ROOT / "agent" / "tools.py":  [r'(return\s*")0\.005[0-9]+(")'],
        FIN_ROOT / "agent" / "agent.py":  [r'(_val_rmse\s*=\s*")0\.005[0-9]+(")'],
    }
    for path, pats in targets.items():
        if not path.exists(): continue
        txt = path.read_text(encoding="utf-8"); orig = txt
        for pat in pats:
            txt = re.sub(pat, lambda m: m.group(1) + new + m.group(2), txt)
        if txt != orig:
            path.write_text(txt, encoding="utf-8")
            log(f"  ✔ {path.name} 기본값 → {new}")
        else:
            log(f"  · {path.name} 변경 없음 (패턴 불일치/이미 동일)")


# ════════════════════════════════════════════════════════════════
#  메인
# ════════════════════════════════════════════════════════════════
def main():
    if len(sys.argv) < 2:
        log(__doc__); sys.exit(1)
    run_dir = Path(sys.argv[1])
    check_only = "--check" in sys.argv[2:]

    hr(); log(f"dashboard_fin 데이터 업데이트  |  run = {run_dir.name}")
    log(f"  FIN_ROOT = {FIN_ROOT}")
    log(f"  XS_PATH  = {XS_PATH}")
    hr()

    best, problems = preflight(run_dir)
    if problems:
        log("✗ 사전 검증 실패:")
        for p in problems: log(f"   - {p}")
        sys.exit(2)
    log("✔ 사전 검증 통과 (입력/의존성 OK)")
    if check_only:
        v = round(float(json.load(open(best / "summary_record.json"))["val_rmse"]), 6)
        log(f"  (--check) summary_record val_rmse = {v}")
        log("  --check 모드: 쓰기 작업 없이 종료"); return

    for p in MODEL_MODULES.split(";"):
        if p: sys.path.insert(0, p)

    all_die, feat_names, fold_models = gen_model_data(best)
    gen_shap(all_die, feat_names, fold_models)
    gen_patterns()
    gen_lot_summary()
    val = update_metrics(best)
    run_subgenerators()
    copy_to_public()
    patch_val_rmse(val)

    hr(); log("✅ 완료")
    log(f"  val RMSE = {val:.6f}")
    log("  다음: cd Dashboard && npm run build 로 검증 후, 사용자 승인 시 git push")
    hr()


if __name__ == "__main__":
    main()
