"""
트렌드 그래프용 데이터 생성 스크립트
출력: Dashboard/public/trend_data.csv

구간 1 (4개월 전 ~ 2개월 전): 합성 생성 — y_pred + y_true (이쁘게)
구간 2 (2개월 전 ~ 오늘):     실제 데이터 기반 — y_pred only
  - 하루 10개 합성 로트 생성
  - 합성 로트 1개 = 실제 로트에서 웨이퍼 25개 복원추출 → 3일 윈도우 분산
  - 새 로트번호 부여 (1001번~)
"""

import pandas as pd
import numpy as np
from pathlib import Path
from datetime import timedelta

# ── 경로 설정 ──────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
UNITS_PATH = BASE_DIR / "Dashboard/public/dashboard_units.csv"
OUT_PATH   = BASE_DIR / "Dashboard/public/trend_data.csv"

# ── 날짜 설정 ──────────────────────────────────────────────
TODAY = pd.Timestamp("2026-05-07")
START = TODAY - pd.DateOffset(months=4)   # 2026-01-07
MID   = TODAY - pd.DateOffset(months=2)   # 2026-03-07

dates_p1 = pd.date_range(START, MID - pd.Timedelta(days=1), freq="D")
dates_p2 = pd.date_range(MID, TODAY, freq="D")
dates_p2_set = set(dates_p2)

rng = np.random.default_rng(42)

# ── 데이터 로드 & defect threshold ────────────────────────
units = pd.read_csv(UNITS_PATH)
units["reg_pred"] = units["reg_pred"].astype(float)
units["health"]   = units["health"].astype(float)

train_preds   = sorted(units[units["split"] == "train"]["reg_pred"].tolist())
defect_thresh = train_preds[int(len(train_preds) * 0.708)]
print(f"defect_thresh : {defect_thresh:.6f}")

# ── 웨이퍼 풀: (run_id, wafer_no) 단위 수율 ──────────────
wafer_pool = (
    units.groupby(["run_id", "wafer_no"], group_keys=False)
    .apply(lambda g: pd.Series({
        "pred_yield": 100.0 * (1 - (g["reg_pred"] >= defect_thresh).mean())
    }), include_groups=False)
    .reset_index()
)
real_lots = wafer_pool["run_id"].unique()
print(f"웨이퍼 풀     : {len(wafer_pool)}개  |  실제 로트: {len(real_lots)}개")

# ══════════════════════════════════════════════════════════
# 구간 1: 합성 생성 (y_pred + y_true)
# ══════════════════════════════════════════════════════════
BASELINE = 71.0
n1 = len(dates_p1)

y_pred_p1, y_true_p1 = [], []
val = BASELINE
for _ in range(n1):
    val = val * 0.95 + BASELINE * 0.05 + rng.normal(0, 1.5)
    val = float(np.clip(val, 63, 82))
    y_pred_p1.append(round(val, 2))
    y_true_p1.append(round(float(np.clip(val + rng.normal(0, 3.0), 60, 85)), 2))

# ══════════════════════════════════════════════════════════
# 구간 2: 합성 로트 생성 → 일별 수율 집계
# ══════════════════════════════════════════════════════════
LOTS_PER_DAY  = 10
WAFERS_PER_LOT = 25
WINDOW_DAYS   = 3

date_wafers: dict[pd.Timestamp, list[float]] = {d: [] for d in dates_p2}
aug_records = []   # 증강 데이터셋 레코드
lot_counter = 1001

for day in dates_p2:
    for _ in range(LOTS_PER_DAY):
        # 실제 로트 복원추출
        real_lot = rng.choice(real_lots)
        lot_wafers = wafer_pool[wafer_pool["run_id"] == real_lot]

        # 해당 로트에서 웨이퍼 25개 복원추출
        sampled = lot_wafers.sample(n=WAFERS_PER_LOT, replace=True,
                                    random_state=int(rng.integers(99999)))

        # 3일 윈도우 (TODAY 초과 방지)
        window = [
            day + timedelta(days=i)
            for i in range(WINDOW_DAYS)
            if (day + timedelta(days=i)) in dates_p2_set
        ]

        # 25개 웨이퍼를 윈도우 안에 랜덤 배정
        for _, row in sampled.iterrows():
            assigned = pd.Timestamp(rng.choice(window))
            date_wafers[assigned].append(row["pred_yield"])
            aug_records.append({
                "date":          assigned.strftime("%Y-%m-%d"),
                "syn_lot_id":    lot_counter,
                "src_run_id":    int(row["run_id"]),
                "src_wafer_no":  int(row["wafer_no"]),
                "pred_yield":    round(row["pred_yield"], 4),
            })

        lot_counter += 1

total_lots = lot_counter - 1001
print(f"합성 로트 수  : {total_lots}개 ({LOTS_PER_DAY}/일 × {len(dates_p2)}일)")

# 일별 평균 수율
y_pred_p2 = [
    round(float(np.mean(date_wafers[d])), 2) if date_wafers[d]
    else round(BASELINE, 2)
    for d in dates_p2
]

# ── 구간 경계 자연스럽게 연결 (7일 블렌딩) ───────────────
gap        = y_pred_p2[0] - y_pred_p1[-1]
blend_days = min(7, len(dates_p2))
for i in range(blend_days):
    y_pred_p2[i] = round(y_pred_p2[i] - gap * (blend_days - i) / blend_days, 2)

# ══════════════════════════════════════════════════════════
# 출력 CSV
# ══════════════════════════════════════════════════════════
df = pd.DataFrame({
    "date":   list(dates_p1.strftime("%Y-%m-%d")) + list(dates_p2.strftime("%Y-%m-%d")),
    "y_pred": y_pred_p1 + y_pred_p2,
    "y_true": y_true_p1 + [None] * len(dates_p2),
})

df.to_csv(OUT_PATH, index=False)

# 증강 데이터셋 저장 (웨이퍼 단위)
aug_df = pd.DataFrame(aug_records).sort_values(["date", "syn_lot_id"]).reset_index(drop=True)
AUG_PATH = BASE_DIR / "Dashboard/public/augmented_wafers.csv"
aug_df.to_csv(AUG_PATH, index=False)
print(f"증강 데이터셋  : {AUG_PATH}")
print(f"총 {len(aug_df)}행  |  합성 로트: {aug_df['syn_lot_id'].nunique()}개  |  날짜 범위: {aug_df['date'].min()} ~ {aug_df['date'].max()}")

p1_stats = df[df["y_true"].notna()]["y_pred"]
p2_stats = df[df["y_true"].isna()]["y_pred"]
print(f"\n저장 완료    : {OUT_PATH}")
print(f"총 {len(df)}행  |  구간1: {len(dates_p1)}일 / 구간2: {len(dates_p2)}일")
print(f"\n구간1 y_pred  mean={p1_stats.mean():.1f}  std={p1_stats.std():.1f}  "
      f"min={p1_stats.min():.1f}  max={p1_stats.max():.1f}")
print(f"구간2 y_pred  mean={p2_stats.mean():.1f}  std={p2_stats.std():.1f}  "
      f"min={p2_stats.min():.1f}  max={p2_stats.max():.1f}")
print(df.tail(5).to_string(index=False))
