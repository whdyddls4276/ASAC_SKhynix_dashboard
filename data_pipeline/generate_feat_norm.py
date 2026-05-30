"""
die 좌표별 피처 히트맵용 CSV 생성
- xs_data -> die_x, die_y 파싱 -> robust 스케일링 -> 좌표별 평균 -> 0~1 정규화
- 출력: dashboard/public/wafer_feat_norm.csv
        columns: die_x, die_y, feature, feat_norm
"""
import sys
import pandas as pd
import numpy as np
from pathlib import Path

ROOT    = Path(__file__).parent.parent.parent
PUBLIC  = ROOT / "5_분석시스템" / "data" / "processed"
DASH    = ROOT / "5_분석시스템" / "dashboard" / "public"
XS_PATH = ROOT / "0_data" / "compet_xs_data.csv"

print("wafer_feat_norm.csv 생성 시작...")

# Top20 피처 목록
top_features = pd.read_csv(PUBLIC / "shap_beeswarm.csv")["feature"].unique().tolist()
xs_cols = set(pd.read_csv(XS_PATH, nrows=0).columns)
feat_xs = [f for f in top_features if f in xs_cols]
print(f"대상 피처 {len(feat_xs)}개")

# xs_data 로드 (run_wf_xy + 피처)
print("xs_data 로드 중...")
xs = pd.read_csv(XS_PATH, usecols=["run_wf_xy"] + feat_xs)

# die 좌표 파싱
parts = xs["run_wf_xy"].str.split("_", expand=True)
xs["die_x"] = parts[2].astype(int)
xs["die_y"] = parts[3].astype(int)
xs = xs.drop(columns="run_wf_xy")
print(f"  {len(xs):,}행, 좌표 범위 x=[{xs.die_x.min()},{xs.die_x.max()}] y=[{xs.die_y.min()},{xs.die_y.max()}]")

# 결측치 median 대체
print("결측치 처리...")
medians = xs[feat_xs].median()
xs[feat_xs] = xs[feat_xs].fillna(medians)

# 이상치 clip (99%)
print("이상치 clip...")
upper = xs[feat_xs].quantile(0.99)
lower = xs[feat_xs].quantile(0.01)
xs[feat_xs] = xs[feat_xs].clip(lower=lower, upper=upper, axis=1)

# 좌표별 평균 집계
print("좌표별 평균 집계...")
coord_agg = xs.groupby(["die_x", "die_y"])[feat_xs].mean()
print(f"  고유 좌표 수: {len(coord_agg)}")

# 0~1 min-max 정규화 -> long format
print("feat_norm 계산...")
rows = []
for feat in feat_xs:
    col = coord_agg[feat]
    fmin, fmax = col.min(), col.max()
    norm = ((col - fmin) / (fmax - fmin + 1e-12)).round(4)
    df = norm.reset_index()
    df.columns = ["die_x", "die_y", "feat_norm"]
    df["feature"] = feat
    rows.append(df[["die_x", "die_y", "feature", "feat_norm"]])

result = pd.concat(rows, ignore_index=True)
print(f"총 {len(result):,}행")

out = DASH / "wafer_feat_norm.csv"
result.to_csv(out, index=False)
sz = out.stat().st_size / 1024
print(f"저장 완료: wafer_feat_norm.csv ({sz:.0f} KB)")