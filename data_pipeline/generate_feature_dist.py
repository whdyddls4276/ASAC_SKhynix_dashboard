"""
feature_dist.csv 재생성 — 공정인자 진단 '안전 vs 위험 분포' 차트용

유닛별 X피처 값(= 4개 die 평균)을 담는다. 차트에서 클릭 가능한 모든 상위 피처를 커버하도록
FI(gain) 상위 N ∪ SHAP 상위 N 피처를 포함한다. (기존 35개 → 누락 피처 X557 등 보완)

컬럼: ufs_serial, X..., health, is_defect
실행: python generate_feature_dist.py [v3|v4|v5]
"""
import sys
import re
import pandas as pd
from pathlib import Path

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v3'
PROC = Path(f'C:/Users/Dell3571/Desktop/dashboard_{VERSION}/data/processed')
XS = Path('C:/Users/Dell3571/Desktop/ASAC_SKhynix/0_data/compet_xs_data.csv')

isx = lambda f: bool(re.match(r'^X\d+$', str(f)))
N = 30

fi = pd.read_csv(PROC / 'feature_importance.csv')
fi_top = fi[fi['feature'].map(isx)].sort_values('lgbm_gain', ascending=False)['feature'].head(N).tolist()
sb = pd.read_csv(PROC / 'shap_bar.csv')
sb_top = sb[sb['feature'].map(isx)].sort_values('mean_abs_shap', ascending=False)['feature'].head(N).tolist()
feats = list(dict.fromkeys(fi_top + sb_top))   # 합집합 (FI 순서 우선)
print(f'[{VERSION}] 대상 피처: FI{N} ∪ SHAP{N} = {len(feats)}개 | X557 포함? {"X557" in feats}')

# 유닛별 X피처 평균 (4개 die)
xs = pd.read_csv(XS, usecols=['ufs_serial'] + feats)
g = xs.groupby('ufs_serial', as_index=False)[feats].mean()

# health + is_defect
u = pd.read_csv(PROC / 'dashboard_units.csv', usecols=['ufs_serial', 'health'])
g = g.merge(u, on='ufs_serial', how='left')
g['is_defect'] = (pd.to_numeric(g['health'], errors='coerce') > 0).astype('Int64')

g.to_csv(PROC / 'feature_dist.csv', index=False)
print(f'  저장: feature_dist.csv ({len(g):,} unit, {len(feats)} 피처)')
