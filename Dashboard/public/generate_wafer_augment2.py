"""
최근 2주(2026-05-28 ~ 2026-06-10)에 하루 9개 합성 lot 추가
- 원본 val lot(29~56) die들을 복수추출 → 가상 lot(201~) 생성
- 하루 9개 × 14일 = 126개 합성 lot
- 원본 val 1개 + 합성 9개 = 하루 ~10 lot
- lotToDate 매핑: n >= 201 → 날짜 직접 date 컬럼으로 기록
"""
import csv, os
import numpy as np
from datetime import date, timedelta
from collections import defaultdict

rng = np.random.default_rng(123)

SRC = os.path.join(os.path.dirname(__file__), 'wafer_map.csv')
OUT = os.path.join(os.path.dirname(__file__), 'wafer_map.csv')

# ── 날짜 범위: 최근 2주 ───────────────────────────────────────
D_AUG_START = date(2026, 5, 28)
D_AUG_END   = date(2026, 6, 10)
LOTS_PER_DAY = 9

def daterange(s, e):
    d = s
    while d <= e:
        yield d
        d += timedelta(days=1)

aug_dates = list(daterange(D_AUG_START, D_AUG_END))
print(f'증강 날짜 범위: {aug_dates[0]} ~ {aug_dates[-1]} ({len(aug_dates)}일)')
print(f'하루 {LOTS_PER_DAY}개 × {len(aug_dates)}일 = {LOTS_PER_DAY * len(aug_dates)}개 합성 lot')

# ── 기존 데이터 로드 ─────────────────────────────────────────
print('\n기존 wafer_map.csv 로드 중...')
with open(SRC, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    all_rows = list(reader)

print(f'기존 행 수: {len(all_rows):,}')

# 기존 run_id 최대값 확인 (201부터 시작)
existing_ids = set(round(float(r['run_id'])) for r in all_rows)
print(f'기존 run_id 범위: {min(existing_ids)} ~ {max(existing_ids)}')

# val die들을 lot→wafer별로 그룹화 — 원본 val만 (lot 29~56)
val_lot_wafer_dies = defaultdict(lambda: defaultdict(list))
for row in all_rows:
    lot = round(float(row['run_id']))
    if row['split'] == 'val' and 29 <= lot <= 56:
        wafer = round(float(row['wafer_no']))
        val_lot_wafer_dies[lot][wafer].append(row)

val_lots = sorted(val_lot_wafer_dies.keys())
print(f'val lot 풀: {val_lots}')

# ── 합성 lot 생성 ─────────────────────────────────────────────
aug_rows = []
synth_lot_id = 201  # 기존 101~156과 겹치지 않게 201부터
WAFERS_PER_LOT = 25  # 로트당 웨이퍼 수

lot_date_map = {}  # lot_id → date_str

for day_date in aug_dates:
    for _ in range(LOTS_PER_DAY):
        src_lot = int(rng.choice(val_lots))
        src_wafers = sorted(val_lot_wafer_dies[src_lot].keys())

        # 웨이퍼 25개 복원추출 (웨이퍼 단위 — die는 통째로 가져옴)
        sampled_wafers = rng.choice(src_wafers, size=WAFERS_PER_LOT, replace=True)

        lot_date_map[synth_lot_id] = str(day_date)

        for new_wafer_no, src_wafer in enumerate(sampled_wafers, start=1):
            for orig in val_lot_wafer_dies[src_lot][src_wafer]:
                new_row = dict(orig)
                new_row['run_id']   = str(synth_lot_id)
                new_row['wafer_no'] = str(new_wafer_no)
                new_row['date']     = str(day_date)
                new_row['split']    = 'val'
                aug_rows.append(new_row)

        synth_lot_id += 1

total_synth = synth_lot_id - 201
print(f'\n생성된 합성 lot 수: {total_synth}개 (lot 201~{synth_lot_id-1})')
print(f'생성된 합성 die 수: {len(aug_rows):,}개')

# 날짜별 lot 수 확인
from collections import Counter
date_lot_count = Counter(lot_date_map.values())
print('\n날짜별 합성 lot 수 (샘플):')
for d in sorted(date_lot_count.keys()):
    print(f'  {d}: 합성 {date_lot_count[d]}개 lot')

# ── CSV 저장 ─────────────────────────────────────────────────
all_rows_out = all_rows + aug_rows
print(f'\n최종 행 수: {len(all_rows_out):,} (기존 {len(all_rows):,} + 합성 {len(aug_rows):,})')

with open(OUT, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(all_rows_out)

print(f'저장 완료: {OUT}')

# ── lotToDate 수정 안내 ───────────────────────────────────────
print(f'\n=== WaferMap.jsx lotToDate 수정 필요 ===')
print(f'합성 lot 201~ 은 date 컬럼에 날짜가 직접 기록됨')
print(f'=> if (n >= 201) 날짜는 wafer_map의 date 컬럼 참조')
print(f'=> lotToDate에 n >= 201: base=2026-05-28, offset=floor((n-201)/9)')
