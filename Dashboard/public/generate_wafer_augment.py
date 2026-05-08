"""
wafer_map.csv에 합성 lot 데이터 추가 (구간2: 2026-04-11 ~ 2026-06-05, 55일)
- 기존 val lot(29~56) die들을 복수추출 → 가상 lot(101~) 생성
- lotToDate() 매핑: val lot 29~56 → 2026-05-12~06-08
  합성 lot 101~ → 2026-04-11~2026-06-05
- 하루 1~2 lot, lot당 die 수는 기존 val 평균(~1247개) 복수추출
"""
import csv, os
import numpy as np
from datetime import date, timedelta
from collections import defaultdict

rng = np.random.default_rng(42)

SRC = os.path.join(os.path.dirname(__file__), 'wafer_map.csv')
OUT = os.path.join(os.path.dirname(__file__), 'wafer_map.csv')

# ── 날짜 범위 (구간2 앞부분: 합성 lot 채울 구간) ─────────────
D_AUG_START = date(2026, 4, 11)
D_AUG_END   = date(2026, 6, 5)   # 06-06~06-10은 실제 5일치

def daterange(s, e):
    d = s
    while d <= e:
        yield d
        d += timedelta(days=1)

aug_dates = list(daterange(D_AUG_START, D_AUG_END))  # 56일
print(f'증강 날짜 범위: {aug_dates[0]} ~ {aug_dates[-1]} ({len(aug_dates)}일)')

# ── 기존 데이터 로드 ─────────────────────────────────────────
print('기존 wafer_map.csv 로드 중...')
with open(SRC, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    all_rows = list(reader)

print(f'기존 행 수: {len(all_rows)}')

# val die들을 lot→wafer별로 그룹화 (웨이퍼 단위 복원추출 풀)
val_lot_wafer_dies = defaultdict(lambda: defaultdict(list))
for row in all_rows:
    if row['split'] == 'val':
        lot = round(float(row['run_id']))
        wafer = round(float(row['wafer_no']))
        val_lot_wafer_dies[lot][wafer].append(row)

val_lots = sorted(val_lot_wafer_dies.keys())
print(f'val lot 풀: {val_lots}')

# ── 합성 lot 생성 ─────────────────────────────────────────────
# lot 번호: 101부터 시작 (기존 1~84와 겹치지 않게)
aug_rows = []
synth_lot_id = 101
WAFERS_PER_LOT = 25  # 로트당 웨이퍼 수

synth_lot_date_map = {}  # lot_id → date_str

for day_date in aug_dates:
    src_lot = int(rng.choice(val_lots))           # val lot 복원추출
    src_wafers = sorted(val_lot_wafer_dies[src_lot].keys())

    # 웨이퍼 25개 복원추출 (웨이퍼 단위)
    sampled_wafers = rng.choice(src_wafers, size=WAFERS_PER_LOT, replace=True)

    synth_lot_date_map[synth_lot_id] = str(day_date)

    for new_wafer_no, src_wafer in enumerate(sampled_wafers, start=1):
        for orig in val_lot_wafer_dies[src_lot][src_wafer]:
            new_row = dict(orig)
            new_row['run_id']   = str(synth_lot_id)
            new_row['wafer_no'] = str(new_wafer_no)
            new_row['date']     = str(day_date)
            new_row['split']    = 'val'
            aug_rows.append(new_row)

    synth_lot_id += 1

print(f'생성된 합성 lot 수: {synth_lot_id - 101}개 (lot {101}~{synth_lot_id-1})')
print(f'생성된 합성 die 수: {len(aug_rows)}개')

# ── 합성 lot → date 매핑 확인용 출력 ─────────────────────────
print(f'\n합성 lot 날짜 매핑 (샘플):')
sample_lots = list(synth_lot_date_map.items())[:5] + list(synth_lot_date_map.items())[-3:]
for lot, d in sample_lots:
    print(f'  Lot {lot} → {d}')

# ── CSV 저장 ─────────────────────────────────────────────────
all_rows_out = all_rows + aug_rows
print(f'\n최종 행 수: {len(all_rows_out)} (기존 {len(all_rows)} + 합성 {len(aug_rows)})')

with open(OUT, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(all_rows_out)

print(f'저장 완료: {OUT}')

# ── lotToDate 함수용 매핑 출력 (WaferMap.jsx 수정용) ─────────
print(f'\n=== WaferMap.jsx lotToDate 수정 필요 ===')
print(f'합성 lot 범위: 101 ~ {synth_lot_id-1}')
print(f'날짜 범위: {aug_dates[0]} ~ {aug_dates[-1]}')
print(f'=> if (n >= 101) base=2026-04-11, offset=n-101')
