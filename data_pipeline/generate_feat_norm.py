"""
feat_norm 전용 생성 스크립트 (SHAP 계산 없음, 빠름)
- shap_beeswarm.csv의 feat_norm 컬럼을 전체 unit(train+val+test)으로 갱신
- shap_value는 기존 파일 기준 유지 (있으면), 없으면 0
- 실행: python generate_feat_norm.py
"""
import sys
import pandas as pd
import numpy as np
from pathlib import Path

ROOT    = Path(__file__).parent.parent.parent
PUBLIC  = ROOT / "5_분석시스템" / "data" / "processed"
DIST    = ROOT / "5_분석시스템" / "dashboard" / "dist"
XS_PATH = ROOT / "0_data" / "compet_xs_data.csv"

print("feat_norm 전체 unit 생성 시작...")

# 기존 shap_beeswarm에서 Top20 피처 목록과 shap_value 가져오기
existing = pd.read_csv(PUBLIC / "shap_beeswarm.csv")
top_features = existing["feature"].unique().tolist()
feat_xs = [f for f in top_features if f in pd.read_csv(XS_PATH, nrows=0).columns]
print(f"Top20 피처: {top_features}")
print(f"xs_data에 있는 피처: {feat_xs}")

# xs_data에서 필요한 피처만 로드 (전체 unit)
print("xs_data 로드 중...")
xs = pd.read_csv(XS_PATH, usecols=["ufs_serial"] + feat_xs)

# die → unit 평균
print("die → unit 평균 집계 중...")
unit_feat = xs.groupby("ufs_serial")[feat_xs].mean()
print(f"  unit 수: {len(unit_feat):,}")

# feat_norm: 각 피처별 전체 unit 기준 min-max 0~1
print("feat_norm 계산 중...")
rows = []
for rank_i, feat in enumerate(top_features):
    if feat not in feat_xs:
        # die_y 등 xs에 없는 피처는 0으로
        fv_col = pd.Series(0.0, index=unit_feat.index)
        feat_norm = fv_col
    else:
        fv_col = unit_feat[feat]
        fv_min, fv_max = fv_col.min(skipna=True), fv_col.max(skipna=True)
        feat_norm = ((fv_col - fv_min) / (fv_max - fv_min + 1e-12)).round(4).fillna(0)

    # shap_value: 기존 파일에서 가져오기 (unit 평균)
    existing_feat = existing[existing["feature"] == feat].set_index("ufs_serial")["shap_value"]
    rows.append(pd.DataFrame({
        "ufs_serial": feat_norm.index,
        "feature":    feat,
        "shap_value": feat_norm.index.map(existing_feat).fillna(0).values,
        "feat_norm":  feat_norm.values,
        "rank":       rank_i,
    }))

result = pd.concat(rows, ignore_index=True)
print(f"총 행수: {len(result):,}  |  unit 수: {result['ufs_serial'].nunique():,}")

# 저장
result.to_csv(PUBLIC / "shap_beeswarm.csv", index=False)
print(f"저장 완료: shap_beeswarm.csv")

import shutil
dst = DIST / "shap_beeswarm.csv"
if dst.exists():
    shutil.copy2(PUBLIC / "shap_beeswarm.csv", dst)
    print(f"dist/ 동기화 완료")

print("완료!")