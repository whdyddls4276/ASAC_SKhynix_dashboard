"""
dashboard_v3 모델 데이터 업데이트 — val 기준 best (run_0604_163553, seed 1114, BagZITEQL)

신규 모델 특성:
- unit = die 4개의 '합' 구조 (기존은 평균) → die pred는 pred_taupi 그대로 사용
- oof_die: pred → pred_raw/pred_taupi 로 분리됨
- unit pred 컬럼은 그대로 존재

처리:
1. 신규 best → data/raw 교체
2. dashboard_units.csv  : unit.pred → reg_pred, grade(IQR), CI / anomaly_score는 백업 유지
3. wafer_map.csv        : die pred_taupi → pred (변환 없이, 합 구조)
4. feature_importance / shap_bar / shap_beeswarm / shap_unit.json : fold_models.pkl 재계산
5. location_stats / wafer_scale / wafer_map_lots : die pred 기준 재집계

실행: python update_model_v2.py
"""
import sys, json, shutil, pickle
import pandas as pd
import numpy as np
from pathlib import Path

# ── 경로 ──────────────────────────────────────────────────
SRC_BEST = Path('C:/Users/Dell3571/Downloads/seed-20260605T075237Z-3-001/seed/run_0604_163553/best')
ROOT     = Path('C:/Users/Dell3571/Desktop/dashboard_v3')
RAW      = ROOT / 'data' / 'raw'
PUBLIC   = ROOT / 'data' / 'processed'
XS_PATH  = Path('C:/Users/Dell3571/Desktop/ASAC_SKhynix/0_data/compet_xs_data.csv')

# ZITboost/BagZITEQL 모듈 경로
sys.path.insert(0, 'C:/Users/Dell3571/Desktop/ASAC_SKhynix/3_modeling')
sys.path.insert(0, 'C:/Users/Dell3571/Desktop/ASAC_SKhynix')

print("=" * 60)
print("dashboard_v3 모델 업데이트 (val best: run_0604_163553)")
print("=" * 60)

# ── 1. best → data/raw 교체 ──────────────────────────────
print("\n[1] best 파일 → data/raw 복사...")
for f in SRC_BEST.glob('*'):
    shutil.copy2(f, RAW / f.name)
    print(f"  복사: {f.name}")

# ── 0. 예측 로드 ──────────────────────────────────────────
print("\n[2] 예측 로드...")
oof_die  = pd.read_csv(RAW / 'oof_die.csv');  oof_die['split']  = 'train'
val_die  = pd.read_csv(RAW / 'val_die.csv');  val_die['split']  = 'val'
test_die = pd.read_csv(RAW / 'test_die.csv'); test_die['split'] = 'test'
oof_unit  = pd.read_csv(RAW / 'oof_unit.csv');  oof_unit['split']  = 'train'
val_unit  = pd.read_csv(RAW / 'val_unit.csv');  val_unit['split']  = 'val'
test_unit = pd.read_csv(RAW / 'test_unit.csv'); test_unit['split'] = 'test'

all_die  = pd.concat([oof_die, val_die, test_die],   ignore_index=True)
all_unit = pd.concat([oof_unit, val_unit, test_unit], ignore_index=True)

# die pred: 신규는 pred_taupi (기여분, 합=unit 구조) → 그대로 'pred'로 사용
all_die['pred'] = all_die['pred_taupi']
print(f"  die {len(all_die):,} | unit {len(all_unit):,}")
print(f"  unit pred mean={all_unit['pred'].mean():.6f} | die pred(taupi) mean={all_die['pred'].mean():.6f}")

# ── wafer_map 메타 (run_id, wafer_no, split, health, date) ─
wmap_meta = pd.read_csv(PUBLIC / 'wafer_map.csv')
unit_meta = (wmap_meta.groupby('ufs_serial', as_index=False)
             .first()[['ufs_serial', 'run_id', 'wafer_no', 'split', 'health', 'date']])

# ── 3. dashboard_units.csv ───────────────────────────────
print("\n[3] dashboard_units.csv 생성...")
units = unit_meta.merge(
    all_unit[['ufs_serial', 'split', 'pred']].rename(columns={'pred': 'reg_pred'}),
    on=['ufs_serial', 'split'], how='left')

all_preds = units['reg_pred'].dropna()
q1 = all_preds.quantile(0.25); q2 = all_preds.quantile(0.50); q3 = all_preds.quantile(0.75)
p90 = all_preds.quantile(0.90)   # 위험 경계: 상위 10%
iqr = q3 - q1; upper_fence = q3 + 1.5 * iqr
risk_bound = p90                  # grade3(위험) 시작 경계
print(f"  Q2={q2:.6f} Q3={q3:.6f} P90={p90:.6f} upper_fence={upper_fence:.6f}")
print(f"  위험 경계(grade3 시작): P90={risk_bound:.6f} (상위 10%)")

def assign_risk(p):
    if p >= upper_fence: return 'HIGH'
    if p >= risk_bound: return 'MED'
    return 'LOW'
def assign_grade(p):
    if p >= upper_fence: return 'grade4'   # 매우위험
    if p >= risk_bound: return 'grade3'    # 위험 (상위 10%)
    if p >= q2:         return 'grade2'    # 조심
    return 'grade1'                        # 안전

units['risk']  = units['reg_pred'].apply(assign_risk)
units['grade'] = units['reg_pred'].apply(assign_grade)

# anomaly_score: 모델 무관 → 백업값 유지
print("  anomaly_score: 기존 백업값 유지 (모델 무관)...")
bk = list((ROOT / 'data').glob('processed_backup_*'))
if bk:
    bk_units = pd.read_csv(sorted(bk)[-1] / 'dashboard_units.csv')[['ufs_serial', 'anomaly_score']]
    units = units.merge(bk_units, on='ufs_serial', how='left')
    print(f"    백업에서 anomaly_score 병합 ({units['anomaly_score'].notna().sum():,}개)")
else:
    units['anomaly_score'] = np.nan
    print("    백업 없음 → anomaly_score NaN")

# Conformal Prediction 95% CI
val_wh = units[(units['split'] == 'val') & units['health'].notna() & units['reg_pred'].notna()].copy()
if len(val_wh):
    resid = val_wh['health'].astype(float) - val_wh['reg_pred'].astype(float)
    qs = resid.abs().quantile(0.95)
    units['ci_low']  = (units['reg_pred'].astype(float) - qs).clip(lower=0).round(6)
    units['ci_high'] = (units['reg_pred'].astype(float) + qs).round(6)
    print(f"  CI ±{qs:.6f}")
else:
    units['ci_low'] = np.nan; units['ci_high'] = np.nan

out_cols = ['ufs_serial', 'run_id', 'wafer_no', 'split', 'health', 'reg_pred',
            'risk', 'grade', 'anomaly_score', 'ci_low', 'ci_high', 'date']
units[out_cols].to_csv(PUBLIC / 'dashboard_units.csv', index=False)
print(f"  저장: dashboard_units.csv ({len(units):,}행)")
print(f"  grade: {units['grade'].value_counts().to_dict()}")

# ── 4. wafer_map.csv (die pred 교체) ─────────────────────
print("\n[4] wafer_map.csv die pred 교체...")
wmap = pd.read_csv(PUBLIC / 'wafer_map.csv')
die_lookup = all_die.drop_duplicates(['ufs_serial', 'position']).set_index(['ufs_serial', 'position'])['pred']
wmap['pred'] = wmap.set_index(['ufs_serial', 'position']).index.map(die_lookup)
n_miss = wmap['pred'].isna().sum()
if n_miss:
    print(f"  매핑 실패 {n_miss:,}개 → 기존값 유지")
    orig = pd.read_csv(PUBLIC.parent / 'processed' / 'wafer_map.csv')
wmap.to_csv(PUBLIC / 'wafer_map.csv', index=False)
print(f"  저장: wafer_map.csv ({len(wmap):,}행)")

# ── 5. feature_importance.csv ────────────────────────────
print("\n[5] feature_importance.csv (lgb_mu_ gain)...")
ckpt = pickle.load(open(RAW / 'fold_models.pkl', 'rb'))
feat_names = ckpt['feature_names']; fold_models = ckpt['fold_models']
gain = np.zeros(len(feat_names))
for fm in fold_models:
    gain += fm.lgb_mu_.booster_.feature_importance(importance_type='gain')
gain /= len(fold_models)
fi = pd.DataFrame({'feature': feat_names, 'lgbm_gain': gain}).sort_values('lgbm_gain', ascending=False).reset_index(drop=True)
fi['lgbm_rank'] = fi.index + 1
fi.to_csv(PUBLIC / 'feature_importance.csv', index=False)
print(f"  저장: {len(fi)}개, Top5: {fi['feature'].head(5).tolist()}")

# ── 6. SHAP (lgb_mu_, 전체 die) ──────────────────────────
print("\n[6] SHAP 계산 (train+val+test 전체 die)...")
import shap
xs_cols = set(pd.read_csv(XS_PATH, nrows=0).columns)
missing_feats = [f for f in feat_names if f.endswith('_missing')]
missing_base  = [f.replace('_missing', '') for f in missing_feats]
feat_xs   = [f for f in feat_names if f in xs_cols and not f.endswith('_missing')]
feat_meta = [f for f in feat_names if f not in xs_cols and not f.endswith('_missing')]
extra = [c for c in missing_base if c in xs_cols and c not in feat_xs]

all_serials = set(all_die['ufs_serial'].unique())
xs_val = pd.read_csv(XS_PATH, usecols=['ufs_serial', 'run_wf_xy'] + feat_xs + extra)
xs_val = xs_val[xs_val['ufs_serial'].isin(all_serials)]
if 'die_x' in feat_meta or 'die_y' in feat_meta:
    parts = xs_val['run_wf_xy'].str.split('_')
    xs_val['die_x'] = parts.str[-2].apply(pd.to_numeric, errors='coerce').fillna(0).astype(int)
    xs_val['die_y'] = parts.str[-1].apply(pd.to_numeric, errors='coerce').fillna(0).astype(int)
for base, mc in zip(missing_base, missing_feats):
    xs_val[mc] = xs_val[base].isna().astype(int) if base in xs_val.columns else 0
xs_val = xs_val.drop(columns=[c for c in extra if c not in feat_names], errors='ignore')

# die 단위 1:1 매칭(run_wf_xy). ufs_serial 단독 merge는 unit당 die 4×4=16 카테시안 폭증 → SHAP 4배 부풀림 버그.
xs_merged = all_die[['ufs_serial', 'run_wf_xy']].merge(xs_val, on=['ufs_serial', 'run_wf_xy'], how='left')
X_val_df = xs_merged[feat_names].copy()
X_val = X_val_df.fillna(0).values
serials_val = xs_merged['ufs_serial'].values
print(f"  X_val: {X_val.shape}")

BATCH = 1000; n = len(X_val); shap_sum = np.zeros((n, len(feat_names)))
for i, fm in enumerate(fold_models):
    print(f"  fold {i+1}/{len(fold_models)}...")
    ex = shap.TreeExplainer(fm.lgb_mu_)
    parts_sv = [ex.shap_values(X_val[j:j+BATCH]) for j in range(0, n, BATCH)]
    shap_sum += np.vstack(parts_sv)
shap_values = shap_sum / len(fold_models)

mean_abs = np.abs(shap_values).mean(axis=0); mean_shap = shap_values.mean(axis=0)
rank_order = np.argsort(mean_abs)[::-1]
pd.DataFrame({
    'feature': [feat_names[i] for i in rank_order],
    'mean_abs_shap': mean_abs[rank_order], 'mean_shap': mean_shap[rank_order],
    'rank': np.arange(1, len(feat_names) + 1),
}).to_csv(PUBLIC / 'shap_bar.csv', index=False)
print(f"  저장: shap_bar.csv")

# shap_beeswarm (unit별 Top20)
TOP = 20; idx = rank_order[:TOP]; tfn = [feat_names[i] for i in idx]
sdf = pd.DataFrame(shap_values[:, idx], columns=tfn); sdf['ufs_serial'] = serials_val
fdf = pd.DataFrame(X_val_df[tfn].values, columns=[f'fv_{c}' for c in tfn]); fdf['ufs_serial'] = serials_val
su = sdf.groupby('ufs_serial')[tfn].mean(); fu = fdf.groupby('ufs_serial')[[f'fv_{c}' for c in tfn]].mean()  # die SHAP 평균(unit 대표 기여), 피처값(fv_)도 평균
rows = []
for ri, feat in enumerate(tfn):
    sv = su[feat]; fv = fu[f'fv_{feat}']
    fn = ((fv - fv.min()) / (fv.max() - fv.min() + 1e-12)).round(4).fillna(0)
    rows.append(pd.DataFrame({'ufs_serial': sv.index, 'feature': feat,
                              'shap_value': sv.values, 'feat_norm': fn.values, 'rank': ri}))
beeswarm = pd.concat(rows, ignore_index=True)
beeswarm.to_csv(PUBLIC / 'shap_beeswarm.csv', index=False)
print(f"  저장: shap_beeswarm.csv ({len(beeswarm):,}행)")

# shap_unit.json (non-zero top10)
result = {}
for serial, grp in beeswarm.groupby('ufs_serial'):
    nz = grp[grp['shap_value'] != 0].copy()
    if nz.empty: continue
    nz['mag'] = nz['shap_value'].abs()
    top10 = nz.nlargest(10, 'mag')[['feature', 'shap_value']]
    result[serial] = [{'feature': r['feature'], 'shap_value': round(float(r['shap_value']), 8)} for _, r in top10.iterrows()]
json.dump(result, open(PUBLIC / 'shap_unit.json', 'w'), separators=(',', ':'))
print(f"  저장: shap_unit.json ({len(result):,} unit)")

# ── 7. location_stats.csv ────────────────────────────────
print("\n[7] location_stats.csv 재집계...")
wl = pd.read_csv(PUBLIC / 'wafer_map.csv'); wl['pred'] = pd.to_numeric(wl['pred'], errors='coerce'); wl = wl.dropna(subset=['pred'])
# die 위험 임계값 = die pred 분포의 P90 (unit grade와 동일하게 상위 10%)
die_thresh = float(wl['pred'].quantile(0.90))
print(f"  die 위험 임계값(P90) = {die_thresh:.6f}")
lg = wl.groupby(['die_x', 'die_y'], as_index=False).agg(
    count=('pred', 'count'), pred_mean=('pred', 'mean'), pred_max=('pred', 'max'),
    pred_std=('pred', 'std'), risk_count=('pred', lambda x: (x > die_thresh).sum()))
lg['pred_mean'] = lg['pred_mean'].round(8); lg['pred_max'] = lg['pred_max'].round(8); lg['pred_std'] = lg['pred_std'].fillna(0).round(8)
lg['risk_rate'] = (lg['risk_count'] / lg['count'] * 100).round(2)
lg['ppm_mean'] = (lg['pred_mean'] * 1e6).round(1); lg['ppm_max'] = (lg['pred_max'] * 1e6).round(1)
xc = (lg['die_x'].max() + lg['die_x'].min()) / 2; yc = (lg['die_y'].max() + lg['die_y'].min()) / 2
lg['radial_dist'] = np.sqrt((lg['die_x'] - xc)**2 + (lg['die_y'] - yc)**2).round(3)
lg.to_csv(PUBLIC / 'location_stats.csv', index=False)
print(f"  저장: {len(lg):,}행")

# ── 8. wafer_scale.json ──────────────────────────────────
print("\n[8] wafer_scale.json 재생성...")
dp = np.sort(pd.to_numeric(pd.read_csv(PUBLIC / 'wafer_map.csv')['pred'], errors='coerce').dropna().values)
# 위험 임계값 = die pred P90 (unit grade와 통일, 상위 10%)
scale = {'threshold': float(dp[int(len(dp)*0.90)]), 'pred_min': float(dp[0]), 'pred_max': float(dp[-1]),
         'grid_x_range': int(wl['die_x'].max()-wl['die_x'].min()+1), 'grid_y_range': int(wl['die_y'].max()-wl['die_y'].min()+1)}
json.dump(scale, open(PUBLIC / 'wafer_scale.json', 'w'))
print(f"  저장: threshold={scale['threshold']:.8f}")

# ── 9. wafer_map_lots/ 재생성 ────────────────────────────
print("\n[9] wafer_map_lots/ 재생성...")
LOTS = PUBLIC / 'wafer_map_lots'
pred_ref = all_die[['ufs_serial', 'position', 'pred']].drop_duplicates(['ufs_serial', 'position'])
lot_files = sorted(LOTS.glob('lot_*.csv'))
for lp in lot_files:
    ld = pd.read_csv(lp).drop_duplicates(['ufs_serial', 'position', 'die_x', 'die_y']).drop(columns=['pred', 'clf_proba'], errors='ignore')
    ld = ld.merge(pred_ref, on=['ufs_serial', 'position'], how='left')
    ld.to_csv(lp, index=False)
print(f"  완료: {len(lot_files)}개 lot 파일")

print("\n" + "=" * 60)
print("완료! val best 모델로 대시보드 데이터 업데이트됨")
print(f"  val_rmse: 0.005699 (seed 1114)")
print("=" * 60)
