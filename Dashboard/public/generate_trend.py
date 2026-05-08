"""
trend_data.csv 생성 스크립트 (계획서 v2 기준)
- 전체: 2026-02-10 ~ 2026-06-10 (121일)
- 구간1 (합성):   2026-02-10 ~ 2026-04-10 (59일) → y_pred + y_true
- 구간2 (증강):   2026-04-11 ~ 2026-06-10 (61일) → y_pred only
  - 매일 10 lots × 25 wafers 복수추출, 3일 윈도우 배정
  - 구간1 끝 → 구간2 시작: 7일 선형 블렌딩
"""
import csv, zipfile, io, os
import numpy as np
from datetime import date, timedelta
from collections import defaultdict

rng = np.random.default_rng(42)

BASELINE     = 71.0
# train 70.8 percentile → 불량 29.2% 기준 (계획서 방식)
# dashboard_units.csv train split reg_pred 기준으로 계산
DEFECT_THRESH = None  # 아래에서 계산
DATASET_ZIP  = r'c:\Users\suyou\OneDrive\Desktop\ASAC\PROJECT\sk_하이닉스\0_data\dataset.zip'
UNITS_CSV    = os.path.join(os.path.dirname(__file__), 'dashboard_units.csv')
OUT_CSV      = os.path.join(os.path.dirname(__file__), 'trend_data.csv')

# ── 날짜 범위 ─────────────────────────────────────────────────
D_START = date(2026, 2, 10)
D_MID   = date(2026, 4, 11)   # 구간2 시작
D_END   = date(2026, 6, 10)

def daterange(s, e):
    d = s
    while d <= e:
        yield d
        d += timedelta(days=1)

dates_p1 = list(daterange(D_START, D_MID - timedelta(days=1)))  # 59일
dates_p2 = list(daterange(D_MID, D_END))                         # 61일

# ── 구간1: 합성 ───────────────────────────────────────────────
# y_pred: random walk + mean reversion
val = BASELINE
p1_pred = []
for _ in dates_p1:
    val = val * 0.95 + BASELINE * 0.05 + rng.normal(0, 1.5)
    val = float(np.clip(val, 63, 82))
    p1_pred.append(round(val, 2))

# y_true: y_pred + 독립 노이즈 (±3~5%p)
p1_true = [round(float(np.clip(p + rng.normal(0, 3.0), 60, 85)), 2) for p in p1_pred]

print(f'구간1 y_pred mean={np.mean(p1_pred):.1f}%, std={np.std(p1_pred):.1f}%')
print(f'구간1 y_true mean={np.mean(p1_true):.1f}%, std={np.std(p1_true):.1f}%')

# ── defect_thresh 계산 (train 70.8 percentile) ───────────────
units = []
with open(UNITS_CSV) as f:
    for row in csv.DictReader(f):
        units.append(row)

train_preds = sorted(float(u['reg_pred']) for u in units if u['split'] == 'train')
DEFECT_THRESH = train_preds[int(len(train_preds) * 0.708)]
print(f'defect_thresh (train 70.8pct): {DEFECT_THRESH:.6f}')

wafer_preds = defaultdict(list)
for u in units:
    key = (int(u['run_id']), int(u['wafer_no']))
    wafer_preds[key].append(float(u['reg_pred']))

# 웨이퍼별 수율
wafer_pool = []
for (run_id, wafer_no), preds in wafer_preds.items():
    pred_yield = 100 * (1 - sum(1 for p in preds if p >= DEFECT_THRESH) / len(preds))
    wafer_pool.append({'run_id': run_id, 'wafer_no': wafer_no, 'pred_yield': round(pred_yield, 2)})

# 로트별 웨이퍼 그룹 (복수추출 시 로트 단위로)
lot_wafers = defaultdict(list)
for w in wafer_pool:
    lot_wafers[w['run_id']].append(w['pred_yield'])
lot_ids = list(lot_wafers.keys())

print(f'웨이퍼 풀: {len(wafer_pool)}개, 로트: {len(lot_ids)}개')

# ── 구간2: 합성 로트 생성 → 날짜 배정 ───────────────────────
# 매일 10 lots × 25 wafers 복수추출, 각 로트의 25개를 3일 윈도우에 배정
n_days_p2 = len(dates_p2)
date_yields = defaultdict(list)

LOTS_PER_DAY  = 10
WAFERS_PER_LOT = 25
WINDOW = 3

for day_idx in range(n_days_p2):
    for _ in range(LOTS_PER_DAY):
        # 실제 로트 복수추출
        src_lot = lot_ids[int(rng.integers(0, len(lot_ids)))]
        src_yields = lot_wafers[src_lot]
        # 25개 복수추출
        sampled = rng.choice(src_yields, size=WAFERS_PER_LOT, replace=True)
        # 3일 윈도우에 분산 배정
        for y in sampled:
            offset = int(rng.integers(0, WINDOW))
            target_idx = min(day_idx + offset, n_days_p2 - 1)
            date_yields[dates_p2[target_idx]].append(float(y))

# 날짜별 평균
p2_raw = []
for d in dates_p2:
    bucket = date_yields[d]
    p2_raw.append(round(float(np.mean(bucket)), 2) if bucket else None)

# 빈 날 보간 (거의 없겠지만)
for i in range(len(p2_raw)):
    if p2_raw[i] is None:
        prev = next((p2_raw[j] for j in range(i-1, -1, -1) if p2_raw[j] is not None), BASELINE)
        nxt  = next((p2_raw[j] for j in range(i+1, len(p2_raw)) if p2_raw[j] is not None), BASELINE)
        p2_raw[i] = round((prev + nxt) / 2, 2)

print(f'구간2 y_pred mean={np.mean(p2_raw):.1f}%, std={np.std(p2_raw):.1f}%')

# ── 구간 경계 블렌딩 (7일 선형) ──────────────────────────────
p1_last  = p1_pred[-1]
p2_first = p2_raw[0]
BLEND_DAYS = 7
for i in range(min(BLEND_DAYS, len(p2_raw))):
    alpha = (i + 1) / (BLEND_DAYS + 1)
    p2_raw[i] = round(p1_last * (1 - alpha) + p2_raw[i] * alpha, 2)

# ── CSV 출력 ─────────────────────────────────────────────────
rows = []
for i, d in enumerate(dates_p1):
    rows.append({'date': str(d), 'y_pred': p1_pred[i], 'y_true': p1_true[i]})
for i, d in enumerate(dates_p2):
    rows.append({'date': str(d), 'y_pred': p2_raw[i], 'y_true': ''})

with open(OUT_CSV, 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['date', 'y_pred', 'y_true'])
    writer.writeheader()
    writer.writerows(rows)

print(f'\n생성 완료: {OUT_CSV} ({len(rows)}행)')
print(f'구간1 마지막: {p1_pred[-1]}, 구간2 첫날(블렌딩후): {p2_raw[0]}')
print(f'구간2 마지막 7일: {p2_raw[-7:]}')
