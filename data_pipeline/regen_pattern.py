"""
패턴 분류 데이터 재생성 — 새 wafer_map die pred 기준
(모델 업데이트로 die pred 스케일이 바뀌어 옛 pattern_maps와 wafer_scale 불일치 → 다 빨강 해결)

- dashboard_lot_pattern_maps.json : lot별 [die_x, die_y, pred(좌표 평균)]
- dashboard_lot_patterns.csv        : lot별 pattern, risk_ratio, avg/max_pred
  (pattern 분류 로직은 기존 classify와 동일 기준 — risk_ratio는 새 threshold 기반)
"""
import json
import pandas as pd
import numpy as np
from pathlib import Path

P = Path('C:/Users/Dell3571/Desktop/dashboard_v3/data/processed')


def classify_wafer_pattern(dies, threshold):
    """프론트 classifyWaferPattern 포팅. dies: [(die_x, die_y, pred), ...]"""
    if not len(dies):
        return 'normal'
    xs = np.array([d[0] for d in dies], dtype=float)
    ys = np.array([d[1] for d in dies], dtype=float)
    ps = np.array([d[2] for d in dies], dtype=float)
    cx = (xs.max() + xs.min()) / 2
    cy = (ys.max() + ys.min()) / 2
    r = np.hypot(xs - cx, (ys - cy) * 2.5)
    r_max = r.max()
    if r_max == 0:
        return 'normal'
    rn = r / r_max
    high_count = int((ps > threshold).sum())
    high_ratio = high_count / len(dies)
    # 1) NearFull: 위험 die 비율 55% 이상 — 웨이퍼 광역 불량 (우선)
    if high_ratio >= 0.55:
        return 'nearfull'
    # 2) 공간 편중(Edge Ring)
    center_mask = rn < 0.45
    edge_mask   = rn > 0.75
    if center_mask.sum() == 0 or edge_mask.sum() == 0:
        return 'normal' if high_ratio < 0.10 else 'random'
    center_avg = ps[center_mask].mean()
    edge_avg   = ps[edge_mask].mean()
    if edge_avg > center_avg * 1.6 and edge_avg > threshold * 0.3:
        return 'edge'
    if center_avg > edge_avg * 1.6 and center_avg > threshold * 0.3:
        return 'center'
    # 3) 편중 없으면 위험 die 비율 10% 기준으로 normal/random
    if high_ratio < 0.10:
        return 'normal'
    return 'random'


print("패턴 데이터 재생성 (새 wafer_map die pred 기준)")

wm = pd.read_csv(P / 'wafer_map.csv')
wm['pred'] = pd.to_numeric(wm['pred'], errors='coerce')
ws = json.load(open(P / 'wafer_scale.json'))
threshold = ws['threshold']
print(f"  새 threshold = {threshold:.6f}")

# 기존 patterns.csv의 lot별 pattern 라벨(위치 기반, 모델 무관) 유지
# 기존과 동일하게 원본 lot(1~28)만 대상 — 나머지는 split 시뮬레이션이라 제외
import glob
bk = sorted(glob.glob(str(P.parent / 'processed_backup_*')))[-1]
old_pat = pd.read_csv(Path(bk) / 'dashboard_lot_patterns.csv').set_index('lot')
target_lots = set(old_pat.index.tolist())
print(f"  대상 lot: {len(target_lots)}개 (기존과 동일, {min(target_lots)}~{max(target_lots)})")

pattern_maps = {}
rows = []
for lot, g in wm.groupby('run_id'):
    if int(lot) not in target_lots:
        continue
    # 좌표별 die pred 평균 (lot 내 여러 wafer 누적)
    # 좌표별 max pred — 계층탐색 lot 맵(lotAccumDies, 좌표별 max)과 동일하게 통일
    coord = g.groupby(['die_x', 'die_y'], as_index=False)['pred'].max().dropna(subset=['pred'])
    die_list = [[int(r['die_x']), int(r['die_y']), round(float(r['pred']), 6)]
                for _, r in coord.iterrows()]
    pattern_maps[str(int(lot))] = die_list
    n_dies   = len(coord)
    n_wafers = g['wafer_no'].nunique()
    risk_ratio = float((coord['pred'] > threshold).mean())
    avg_pred = round(float(coord['pred'].mean()), 6)
    max_pred = round(float(coord['pred'].max()), 6)
    # pattern 라벨을 새 die pred로 재분류 (lot 통합 좌표 평균 기준)
    pattern = classify_wafer_pattern(die_list, threshold)
    rows.append({'lot': int(lot), 'pattern': pattern, 'n_dies': n_dies, 'n_wafers': n_wafers,
                 'risk_ratio': round(risk_ratio, 6), 'avg_pred': avg_pred, 'max_pred': max_pred})

json.dump(pattern_maps, open(P / 'dashboard_lot_pattern_maps.json', 'w'), separators=(',', ':'))
pd.DataFrame(rows).sort_values('lot').to_csv(P / 'dashboard_lot_patterns.csv', index=False)

print(f"  저장: pattern_maps.json ({len(pattern_maps)} lot)")
print(f"  저장: dashboard_lot_patterns.csv ({len(rows)} lot)")
print(f"  risk_ratio 범위: {min(r['risk_ratio'] for r in rows):.3f} ~ {max(r['risk_ratio'] for r in rows):.3f}")
print(f"  die pred 샘플: {pattern_maps['1'][0]}")
