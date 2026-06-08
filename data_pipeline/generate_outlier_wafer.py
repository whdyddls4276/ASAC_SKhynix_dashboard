"""
outlier_wafer.json 생성 — 불량현황의 '이상치 유닛 웨이퍼맵'용

이상치(매우위험 grade4) 유닛 1개를 고르고(부족하면 reg_pred 최상위),
그 유닛이 속한 웨이퍼의 die 맵(die_x, die_y, pred)을 추출한다.
클릭 시 해당 lot/wafer 계층탐색으로 이동하기 위한 lot/wafer/serial/ppm 포함.

실행: python generate_outlier_wafer.py [v3|v4|v5]
"""
import sys
import json
import pandas as pd
from pathlib import Path

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v3'
PROC = Path(f'C:/Users/Dell3571/Desktop/dashboard_{VERSION}/data/processed')

u = pd.read_csv(PROC / 'dashboard_units.csv')
u['reg_pred'] = pd.to_numeric(u['reg_pred'], errors='coerce')

# 이상치 유닛: grade4 우선, 없으면 reg_pred 최상위
o = u[u['grade'] == 'grade4'].sort_values('reg_pred', ascending=False)
if o.empty:
    o = u.sort_values('reg_pred', ascending=False)
top = o.iloc[0]
lot, wafer, serial = int(top['run_id']), int(top['wafer_no']), str(top['ufs_serial'])
ppm = round(float(top['reg_pred']) * 1e6, 1)

# 해당 웨이퍼의 die 맵
wm = pd.read_csv(PROC / 'wafer_map.csv', usecols=['run_id', 'wafer_no', 'die_x', 'die_y', 'pred', 'ufs_serial'])
wm['pred'] = pd.to_numeric(wm['pred'], errors='coerce')
sub = wm[(wm['run_id'] == top['run_id']) & (wm['wafer_no'] == top['wafer_no'])].dropna(subset=['pred'])

dies = [[int(r.die_x), int(r.die_y), round(float(r.pred), 6)] for r in sub.itertuples()]
unit_dies = [[int(r.die_x), int(r.die_y)] for r in sub[sub['ufs_serial'] == serial].itertuples()]

out = {
    'lot': str(lot), 'wafer': str(wafer), 'serial': serial, 'ppm': ppm,
    'max_pred': round(float(sub['pred'].max()), 6),
    'dies': dies, 'unit_dies': unit_dies,
}
json.dump(out, open(PROC / 'outlier_wafer.json', 'w'), separators=(',', ':'))
print(f'[{VERSION}] 이상치 웨이퍼: LOT{lot}-WF{wafer} {serial} ({ppm} ppm) | die {len(dies)}개, 이상치 유닛 die {len(unit_dies)}개')
print(f'  저장: {PROC / "outlier_wafer.json"}')
