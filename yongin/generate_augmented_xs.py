"""
X 데이터 증강 스크립트
출력: augmented_xs_data.csv (14일치)

구성:
  - 증강 9일 (20260529~20260606): 웨이퍼 복원추출, X1086 새 날짜, 나머지 원본값 유지
  - 실제 5일 (20260607~20260611): 원본 X 데이터, X1086만 날짜 매핑
"""

import pandas as pd
import numpy as np
from pathlib import Path
from datetime import date, timedelta

# ── 경로 ──────────────────────────────────────────────────
XS_PATH  = Path(r"C:\Users\Dell3571\Desktop\기업\원천데이터\compet_xs_data.csv")
OUT_PATH = Path(r"C:\Users\Dell3571\Desktop\ASAC_SKhynix\6_분업\sk-dashboard\augmented_xs_data.csv")

# ── 날짜 설정 ──────────────────────────────────────────────
DATE_MAP = {          # 실제 5일 X1086 매핑
    20201107: 20260607,
    20201108: 20260608,
    20201109: 20260609,
    20201110: 20260610,
    20201111: 20260611,
}

AUG_START = date(2026, 5, 29)   # 증강 9일 시작
AUG_END   = date(2026, 6,  6)   # 증강 9일 끝
aug_dates = [AUG_START + timedelta(days=i)
             for i in range((AUG_END - AUG_START).days + 1)]  # 9일

LOTS_PER_DAY   = 10
WAFERS_PER_LOT = 25
WINDOW_DAYS    = 3

rng = np.random.default_rng(42)

# ══════════════════════════════════════════════════════════
# 1. 원본 데이터 로드
# ══════════════════════════════════════════════════════════
print("원본 데이터 로드 중...")
xs = pd.read_csv(XS_PATH)
print(f"  원본: {xs.shape[0]:,}행 × {xs.shape[1]}열")

# run_wf_xy 파싱
parsed      = xs["run_wf_xy"].str.split("_", expand=True)
xs["_rid"]  = parsed[0]          # run_id (문자열)
xs["_wno"]  = parsed[1]          # wafer_no (문자열)
xs["_dx"]   = parsed[2]          # die_x
xs["_dy"]   = parsed[3]          # die_y

# ══════════════════════════════════════════════════════════
# 2. 실제 5일: X1086만 날짜 매핑, 나머지 원본 그대로
# ══════════════════════════════════════════════════════════
print("실제 5일 처리 중...")
real_part = xs.copy()
real_part["X1086"] = real_part["X1086"].map(
    lambda v: DATE_MAP.get(int(v), int(v)) if pd.notna(v) else v
)
# 파싱 임시 컬럼 제거
real_part = real_part.drop(columns=["_rid", "_wno", "_dx", "_dy"])
print(f"  실제분: {len(real_part):,}행")

# ══════════════════════════════════════════════════════════
# 3. 웨이퍼 풀 구성 (전체 split)
# ══════════════════════════════════════════════════════════
print("웨이퍼 풀 구성 중...")
# run_id → {wafer_no → [row indices]} 매핑
wafer_groups = xs.groupby(["_rid", "_wno"]).indices   # {(rid, wno): array of idx}
run_ids      = xs["_rid"].unique()
run_wafer_map = {}   # run_id → list of wafer_no (unique)
for (rid, wno) in wafer_groups:
    run_wafer_map.setdefault(rid, []).append(wno)

print(f"  run_id 수: {len(run_ids)}")
print(f"  총 웨이퍼 수: {len(wafer_groups)}")

# ══════════════════════════════════════════════════════════
# 4. 증강 9일: 복원추출
# ══════════════════════════════════════════════════════════
print("증강 9일 생성 중...")
aug_date_set = set(aug_dates)
aug_chunks   = []
lot_counter  = 1001
serial_counter = 0

for start_day in aug_dates:
    for _ in range(LOTS_PER_DAY):
        # 실제 run_id 복원추출
        src_rid = rng.choice(run_ids)

        # 해당 lot에서 wafer_no 25개 복원추출
        wafers_in_lot = run_wafer_map[src_rid]
        sampled_wafers = rng.choice(wafers_in_lot, size=WAFERS_PER_LOT, replace=True)

        # 3일 윈도우 (AUG_END 초과 방지)
        window = []
        for i in range(WINDOW_DAYS):
            d = start_day + timedelta(days=i)
            if d <= AUG_END:
                window.append(d)
        if not window:
            window = [start_day]

        new_rid = str(lot_counter)

        for wno in sampled_wafers:
            # 해당 웨이퍼의 모든 die 행 추출
            idx = wafer_groups[(src_rid, wno)]
            die_rows = xs.iloc[idx].copy()

            # 날짜 배정
            assigned = window[int(rng.integers(len(window)))]
            x1086_val = int(assigned.strftime("%Y%m%d"))

            # X1086 교체
            die_rows["X1086"] = x1086_val

            # run_wf_xy 업데이트 (run_id만 교체, 벡터 연산)
            die_rows["run_wf_xy"] = (
                new_rid + "_" + die_rows["_wno"] + "_"
                + die_rows["_dx"] + "_" + die_rows["_dy"]
            )

            # ufs_serial 새로 부여 (원본 serial 구조 보존)
            orig_serials = die_rows["ufs_serial"].unique()
            serial_map = {
                orig: f"A{serial_counter + i:07d}"
                for i, orig in enumerate(orig_serials)
            }
            die_rows["ufs_serial"] = die_rows["ufs_serial"].map(serial_map)
            serial_counter += len(orig_serials)

            aug_chunks.append(die_rows)

        lot_counter += 1

    if (aug_dates.index(start_day) + 1) % 3 == 0:
        done = aug_dates.index(start_day) + 1
        print(f"  {done}/{len(aug_dates)}일 완료...")

# 증강분 합치기
print("증강분 합치는 중...")
aug_part = pd.concat(aug_chunks, ignore_index=True)
aug_part = aug_part.drop(columns=["_rid", "_wno", "_dx", "_dy"])
print(f"  증강분: {len(aug_part):,}행")

# ══════════════════════════════════════════════════════════
# 5. 최종 합치기 & 저장
# ══════════════════════════════════════════════════════════
print("최종 파일 저장 중...")
cols = list(pd.read_csv(XS_PATH, nrows=0).columns)

# 메모리 절약: 증강분 먼저 쓰고 실제분 append
aug_part[cols].to_csv(OUT_PATH, index=False)
real_part[cols].to_csv(OUT_PATH, mode='a', header=False, index=False)

total_rows = len(aug_part) + len(real_part)
print(f"\n완료!")
print(f"저장 위치: {OUT_PATH}")
print(f"총 행 수 : {total_rows:,}행")
print(f"  - 증강분: {len(aug_part):,}행 ({len(aug_dates)}일)")
print(f"  - 실제분: {len(real_part):,}행 (5일)")
print(f"증강분 X1086 날짜 분포:")
print(aug_part["X1086"].value_counts().sort_index())
print(f"실제분 X1086 날짜 분포:")
print(real_part["X1086"].value_counts().sort_index())
