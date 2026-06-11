"""
shap_unit.json / shap_beeswarm.csv / shap_bar.csv 를 전체 die(train+val+test) 기준으로 재생성.

문제: update_model_v2.py 의 SHAP 섹션이 val_die 만 계산 → train/test 유닛은 per-unit SHAP 없음
      → 드릴다운에서 train/test die 선택 시 전역 SHAP로 폴백되어 '안 바뀜'.
해결: val_die → all_die 로 확장. 나머지 로직 동일.

실행: python regen_shap_all.py
"""
import sys, json, pickle
import pandas as pd
import numpy as np
from pathlib import Path

ROOT     = Path('C:/Users/Dell3571/Desktop/dashboard_fin')
RAW      = ROOT / 'data' / 'raw'
PUBLIC   = ROOT / 'data' / 'processed'
XS_PATH  = Path('C:/Users/Dell3571/Desktop/기업/0_data/compet_xs_data.csv')

# ZITboost(BagZITEQLRegressor) 언피클용 모듈 경로
_MODBASE = 'C:/Users/Dell3571/Desktop/backup/ASAC_SKhynix'
sys.path.insert(0, _MODBASE + '/3_modeling')
sys.path.insert(0, _MODBASE)

print("=" * 60)
print("SHAP 전체 die 재생성 (train + val + test)")
print("=" * 60)

# ── 1. die 로드 (전체) ────────────────────────────────────
oof_die  = pd.read_csv(RAW / 'oof_die.csv');  oof_die['split']  = 'train'
val_die  = pd.read_csv(RAW / 'val_die.csv');  val_die['split']  = 'val'
test_die = pd.read_csv(RAW / 'test_die.csv'); test_die['split'] = 'test'
all_die  = pd.concat([oof_die, val_die, test_die], ignore_index=True)
print(f"  전체 die: {len(all_die):,}행")

# ── 2. 모델 / 피처 ────────────────────────────────────────
import shap
ckpt = pickle.load(open(RAW / 'fold_models.pkl', 'rb'))
feat_names = ckpt['feature_names']; fold_models = ckpt['fold_models']
print(f"  피처: {len(feat_names)}개 | fold: {len(fold_models)}개")

xs_cols = set(pd.read_csv(XS_PATH, nrows=0).columns)
missing_feats = [f for f in feat_names if f.endswith('_missing')]
missing_base  = [f.replace('_missing', '') for f in missing_feats]
feat_xs   = [f for f in feat_names if f in xs_cols and not f.endswith('_missing')]
feat_meta = [f for f in feat_names if f not in xs_cols and not f.endswith('_missing')]
extra = [c for c in missing_base if c in xs_cols and c not in feat_xs]

# ── 3. xs 로드 (전체 unit) ────────────────────────────────
all_serials = set(all_die['ufs_serial'].unique())
xs_all = pd.read_csv(XS_PATH, usecols=['ufs_serial', 'run_wf_xy'] + feat_xs + extra)
xs_all = xs_all[xs_all['ufs_serial'].isin(all_serials)]
if 'die_x' in feat_meta or 'die_y' in feat_meta:
    parts = xs_all['run_wf_xy'].str.split('_')
    xs_all['die_x'] = parts.str[-2].apply(pd.to_numeric, errors='coerce').fillna(0).astype(int)
    xs_all['die_y'] = parts.str[-1].apply(pd.to_numeric, errors='coerce').fillna(0).astype(int)
for base, mc in zip(missing_base, missing_feats):
    xs_all[mc] = xs_all[base].isna().astype(int) if base in xs_all.columns else 0
xs_all = xs_all.drop(columns=[c for c in extra if c not in feat_names], errors='ignore')

# die 단위 1:1 매칭(run_wf_xy). ufs_serial 단독 merge는 unit당 die 4×4=16 카테시안 폭증 → SHAP 4배 부풀림 버그.
xs_merged = all_die[['ufs_serial', 'run_wf_xy']].merge(xs_all, on=['ufs_serial', 'run_wf_xy'], how='left')
X_df = xs_merged[feat_names].copy()
X = X_df.fillna(0).values
serials = xs_merged['ufs_serial'].values
print(f"  X: {X.shape}")

# ── 4. SHAP (fold 평균, 전체 die) ─────────────────────────
BATCH = 2000; n = len(X); shap_sum = np.zeros((n, len(feat_names)))
for i, fm in enumerate(fold_models):
    print(f"  fold {i+1}/{len(fold_models)} TreeExplainer...")
    ex = shap.TreeExplainer(fm.lgb_mu_)
    parts_sv = [ex.shap_values(X[j:j+BATCH]) for j in range(0, n, BATCH)]
    shap_sum += np.vstack(parts_sv)
shap_values = shap_sum / len(fold_models)
print(f"  SHAP 완료: {shap_values.shape}")

# ── 5. shap_bar.csv (전체 평균 순위) ──────────────────────
mean_abs = np.abs(shap_values).mean(axis=0); mean_shap = shap_values.mean(axis=0)
rank_order = np.argsort(mean_abs)[::-1]
pd.DataFrame({
    'feature': [feat_names[i] for i in rank_order],
    'mean_abs_shap': mean_abs[rank_order], 'mean_shap': mean_shap[rank_order],
    'rank': np.arange(1, len(feat_names) + 1),
}).to_csv(PUBLIC / 'shap_bar.csv', index=False)
print(f"  저장: shap_bar.csv | Top5: {[feat_names[i] for i in rank_order[:5]]}")

# ── 6. shap_beeswarm.csv (unit별) ────────────────────────
# 대시보드 정렬 토글(SHAP/피처임포턴스) 대응:
#   beeswarm 피처 = (SHAP 상위 25) ∪ (LGBM gain 상위 25)
#   → 두 기준 어느 쪽으로 정렬해도 점 데이터가 존재하도록 합집합 생성
TOP = 25
shap_top = [feat_names[i] for i in rank_order[:TOP]]
import re as _re
_isx = lambda f: bool(_re.match(r'^X\d+$', str(f)))
fi_csv = pd.read_csv(PUBLIC / 'feature_importance.csv')
gain_top = (fi_csv[fi_csv['feature'].map(_isx)]
            .sort_values('lgbm_gain', ascending=False)['feature'].head(TOP).tolist())
# SHAP 순위 기준으로 정렬 유지하면서 gain-only 피처를 뒤에 추가
union_feats = list(dict.fromkeys(shap_top + [f for f in gain_top if f not in shap_top]))
tfn = [f for f in union_feats if f in feat_names]
idx = [feat_names.index(f) for f in tfn]
print(f"  beeswarm 피처: SHAP{TOP} ∪ gain{TOP} = {len(tfn)}개")
sdf = pd.DataFrame(shap_values[:, idx], columns=tfn); sdf['ufs_serial'] = serials
fdf = pd.DataFrame(X_df[tfn].values, columns=[f'fv_{c}' for c in tfn]); fdf['ufs_serial'] = serials
su = sdf.groupby('ufs_serial')[tfn].mean(); fu = fdf.groupby('ufs_serial')[[f'fv_{c}' for c in tfn]].mean()  # die SHAP 평균(unit 대표 기여), 피처값(fv_)도 평균
rows = []
for ri, feat in enumerate(tfn):
    sv = su[feat]; fv = fu[f'fv_{feat}']
    fn = ((fv - fv.min()) / (fv.max() - fv.min() + 1e-12)).round(4).fillna(0)
    rows.append(pd.DataFrame({'ufs_serial': sv.index, 'feature': feat,
                              'shap_value': sv.values, 'feat_norm': fn.values, 'rank': ri}))
beeswarm = pd.concat(rows, ignore_index=True)
beeswarm.to_csv(PUBLIC / 'shap_beeswarm.csv', index=False)
print(f"  저장: shap_beeswarm.csv ({len(beeswarm):,}행, {beeswarm['ufs_serial'].nunique():,} unit)")

# ── 7. shap_unit.json (전체 X피처에서 unit별 non-zero top10) ──
# 프론트 '주요 기여 변수 Top 10'은 X피처만 표시 → beeswarm(32개)이 아니라
# 전체 X피처(~530개)에서 unit별 |SHAP| 상위 10개를 뽑아 항상 10개가 채워지게 함
xcols = [i for i, f in enumerate(feat_names) if _isx(f)]
xnames = np.array([feat_names[i] for i in xcols])
um = pd.DataFrame(shap_values[:, xcols], columns=xnames).groupby(serials).mean()  # die SHAP 평균(unit 대표 기여)
arr = um.values                      # (unit, X피처)
abs_arr = np.abs(arr)
unit_serials = um.index.values
k = min(10, arr.shape[1])
part = np.argpartition(-abs_arr, k - 1, axis=1)[:, :k]   # 상위 k 후보(미정렬)
result = {}
for r in range(arr.shape[0]):
    cand = part[r]
    cand = cand[np.argsort(-abs_arr[r, cand])]           # |SHAP| 내림차순 정렬
    items = [{'feature': str(xnames[j]), 'shap_value': round(float(arr[r, j]), 8)}
             for j in cand if arr[r, j] != 0][:10]
    if items:
        result[str(unit_serials[r])] = items
json.dump(result, open(PUBLIC / 'shap_unit.json', 'w'), separators=(',', ':'))
n_full = sum(1 for v in result.values() if len(v) == 10)
print(f"  저장: shap_unit.json ({len(result):,} unit, 10개 채움 {n_full:,})")

print("\n완료!")
