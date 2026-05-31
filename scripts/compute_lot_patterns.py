"""
Lot별 통합 패턴 사전 계산.

DrilldownV2.jsx의 classifyWaferPattern과 동일한 규칙으로 모든 lot을 분류해서
dashboard/public/dashboard_lot_patterns.csv로 저장.

분류 입력: 해당 Lot의 모든 wafer die를 (die_x, die_y) 위치별 max pred로 합친 통합맵
(JS의 lotAccumDies와 동일).
"""
from pathlib import Path
import json
import math
import pandas as pd

ROOT = Path(__file__).resolve().parents[1] / "data" / "processed"
LOTS_DIR = ROOT / "wafer_map_lots"
SCALE_JSON = ROOT / "wafer_scale.json"
OUT_CSV = ROOT / "dashboard_lot_patterns.csv"
OUT_MAPS = ROOT / "dashboard_lot_pattern_maps.json"


def classify(dies, threshold):
    """JS classifyWaferPattern 1:1 포팅. dies: list of (die_x, die_y, pred)."""
    if not dies:
        return "normal"
    xs = [d[0] for d in dies]
    ys = [d[1] for d in dies]
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    r_max = max(math.hypot(d[0] - cx, (d[1] - cy) * 2.5) for d in dies)
    if r_max == 0:
        return "normal"

    center_sum = center_n = 0
    edge_sum = edge_n = 0
    high_count = 0
    for x, y, p in dies:
        if not math.isfinite(p):
            continue
        r = math.hypot(x - cx, (y - cy) * 2.5) / r_max
        if p > threshold:
            high_count += 1
        if r < 0.45:
            center_sum += p
            center_n += 1
        if r > 0.75:
            edge_sum += p
            edge_n += 1

    if center_n == 0 or edge_n == 0:
        return "normal"
    center_avg = center_sum / center_n
    edge_avg = edge_sum / edge_n
    high_ratio = high_count / len(dies)

    if high_ratio < 0.05:
        return "normal"
    if edge_avg > center_avg * 1.6 and edge_avg > threshold * 0.3:
        return "edge"
    if center_avg > edge_avg * 1.6 and center_avg > threshold * 0.3:
        return "center"
    return "random"


def main():
    threshold = json.loads(SCALE_JSON.read_text())["threshold"]
    rows = []
    maps = {}
    files = sorted(LOTS_DIR.glob("lot_*.csv"))
    print(f"processing {len(files)} lots, threshold={threshold:.6g}")

    for fp in files:
        lot = fp.stem.replace("lot_", "")
        df = pd.read_csv(fp, usecols=["run_id", "wafer_no", "die_x", "die_y", "pred"])
        # JS lotAccumDies: 같은 (die_x, die_y) 위치는 pred 최댓값으로 합침
        accum = df.loc[df.groupby(["die_x", "die_y"])["pred"].idxmax()]
        dies = list(zip(accum["die_x"].astype(int), accum["die_y"].astype(int), accum["pred"].astype(float)))
        pattern = classify(dies, threshold)
        preds = accum["pred"].astype(float)
        risk_n = int((preds > threshold).sum())
        rows.append({
            "lot": lot,
            "pattern": pattern,
            "n_dies": len(dies),
            "n_wafers": df["wafer_no"].nunique(),
            "risk_ratio": risk_n / len(dies) if dies else 0.0,
            "avg_pred": float(preds.mean()) if len(preds) else 0.0,
            "max_pred": float(preds.max()) if len(preds) else 0.0,
        })
        # 통합맵 그리기용: [x, y, pred] 배열 (소수점 6자리로 압축)
        maps[lot] = [[int(x), int(y), round(float(p), 6)] for x, y, p in dies]

    out = pd.DataFrame(rows)
    out.to_csv(OUT_CSV, index=False)
    OUT_MAPS.write_text(json.dumps(maps, separators=(",", ":")))
    size_mb = OUT_MAPS.stat().st_size / 1024 / 1024
    print(f"saved → {OUT_CSV}")
    print(f"saved → {OUT_MAPS} ({size_mb:.2f} MB)")
    print("lot count:", len(out), "→", out["pattern"].value_counts().to_dict())


if __name__ == "__main__":
    main()
