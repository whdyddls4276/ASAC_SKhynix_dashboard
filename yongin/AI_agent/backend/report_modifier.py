"""
report_modifier.py
보고서 데이터(report_data.json) 인메모리 수정 관리
"""
import datetime as _dt
import json
import os

_FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
_DATA_PATH = os.path.join(_FRONTEND_DIR, "report_data.json")
# uvicorn --reload 재시작 시 in-memory 손실을 방지하기 위한 파일 캐시
_CACHE_PATH = os.path.join(os.path.dirname(__file__), "_live_cache.json")
_live_data = None


def _load_static() -> dict:
    with open(_DATA_PATH, encoding="utf-8") as f:
        return json.load(f)


def _load_original() -> dict:
    """Dashboard public CSV에서 실시간 보고서 데이터 생성. 실패 시 static JSON fallback."""
    from report_builder import build_report_data
    return build_report_data()


def _save_cache(data: dict):
    """수정된 _live_data를 파일에 저장 (uvicorn 재시작 후 복원용)"""
    try:
        with open(_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


def _load_cache() -> dict | None:
    """캐시 파일에서 마지막 수정 상태 복원. 없으면 None 반환."""
    try:
        if os.path.exists(_CACHE_PATH):
            with open(_CACHE_PATH, encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None


def get_live_data() -> dict:
    global _live_data
    if _live_data is None:
        # uvicorn 재시작 후라면 캐시 파일에서 복원, 없으면 원본에서 로드
        cached = _load_cache()
        _live_data = cached if cached is not None else _load_original()
    return _live_data


def reset_live_data():
    global _live_data
    _live_data = _load_original()
    # 초기화 시 캐시도 삭제
    try:
        if os.path.exists(_CACHE_PATH):
            os.remove(_CACHE_PATH)
    except Exception:
        pass


def execute_code(code: str, d: dict) -> tuple:
    """AI가 생성한 Python 코드를 제한된 환경에서 실행. (success, error_msg) 반환"""
    if not code or not code.strip():
        return False, ""

    # "__" 대신 구체적인 위험 패턴만 차단 (Python 런타임은 __import__ 내부적으로 필요)
    forbidden = [
        "import ",
        "__import__", "__builtins__", "__class__", "__dict__",
        "__bases__", "__mro__", "__subclasses__", "__globals__",
        "__code__", "__closure__", "__reduce__",
        "exec(", "eval(", "open(",
        "compile(", "globals(", "locals(", "vars(",
        "getattr(", "setattr(", "delattr(", "subprocess",
    ]
    for f in forbidden:
        if f in code:
            return False, f"금지된 표현: {f}"

    import builtins as _builtins_mod
    safe_builtins = {
        "sorted": sorted, "reversed": reversed, "enumerate": enumerate,
        "len": len, "range": range, "zip": zip,
        "int": int, "float": float, "str": str, "bool": bool,
        "list": list, "dict": dict, "set": set, "tuple": tuple,
        "max": max, "min": min, "sum": sum, "round": round, "abs": abs,
        "any": any, "all": all, "filter": filter, "map": map,
        "True": True, "False": False, "None": None,
        "print": lambda *a, **k: None,             # AI 코드의 print()를 조용히 무시
        "__import__": _builtins_mod.__import__,
        "__build_class__": _builtins_mod.__build_class__,
    }
    _today = _dt.date.today()
    try:
        exec(code, {  # noqa: S102
            "__builtins__": safe_builtins,
            "d": d,
            "datetime": _dt.datetime,
            "timedelta": _dt.timedelta,
            "date": _dt.date,
            "today":      _today.isoformat(),
            "week_ago":   (_today - _dt.timedelta(days=7)).isoformat(),
            "month_ago":  (_today - _dt.timedelta(days=30)).isoformat(),
            "three_months_ago": (_today - _dt.timedelta(days=90)).isoformat(),
        })
        # 수정 성공 시 파일 캐시에 즉시 저장 (uvicorn 재시작 후 복원)
        _save_cache(d)
        return True, ""
    except Exception as e:
        return False, str(e)


def apply_command(cmd: dict) -> bool:
    global _live_data
    d = get_live_data()
    t = cmd.get("type", "")

    # ── 피처 비교 (섹션3) ─────────────────────────────────
    if t == "change_improvement_feature":
        feat = cmd.get("feature", "")
        fc = d.get("feature_comparison", [])
        idx = next((i for i, f in enumerate(fc) if f["feature"] == feat), -1)
        if idx > 0:
            fc.insert(0, fc.pop(idx))
            return True
        return idx == 0

    elif t == "reorder_feature_comparison":
        features = cmd.get("features", [])
        fc = d.get("feature_comparison", [])
        fc_map = {f["feature"]: f for f in fc}
        new_fc = [fc_map[fn] for fn in features if fn in fc_map]
        remaining = [f for f in fc if f["feature"] not in {fn for fn in features}]
        d["feature_comparison"] = new_fc + remaining
        return True

    # ── 중요도 차트 ────────────────────────────────────────
    elif t == "set_top_n_importance":
        n = max(1, int(cmd.get("n", 15)))
        d["importance_all"] = _load_original()["importance_all"][:n]
        return True

    # ── SHAP 분석 ──────────────────────────────────────────
    elif t == "set_shap_top_n":
        n = max(1, int(cmd.get("n", 20)))
        d["shap_data"] = _load_original()["shap_data"][:n]
        return True

    # ── Wafer 위험 테이블 ──────────────────────────────────
    elif t == "set_wafer_top_n":
        n = max(1, int(cmd.get("n", 20)))
        original = _load_original()["wafer_risk"]
        d["wafer_risk"] = sorted(original, key=lambda w: w["pred_rate"], reverse=True)[:n]
        return True

    elif t == "filter_wafer_risk":
        min_rate = float(cmd.get("min_rate", 0))
        original = _load_original()["wafer_risk"]
        d["wafer_risk"] = [w for w in original if w["pred_rate"] >= min_rate]
        return True

    # ── 메모 ──────────────────────────────────────────────
    elif t == "add_commentary":
        if "commentary" not in d:
            d["commentary"] = []
        d["commentary"].append({
            "title": cmd.get("title", "추가 분석"),
            "content": cmd.get("content", ""),
        })
        return True

    elif t == "update_commentary":
        idx = int(cmd.get("index", 0))
        items = d.get("commentary", [])
        if 0 <= idx < len(items):
            if "title"   in cmd: items[idx]["title"]   = cmd["title"]
            if "content" in cmd: items[idx]["content"] = cmd["content"]
            return True
        return False

    elif t == "clear_commentary":
        d["commentary"] = []
        return True

    # ── 성능 지표 수동 오버라이드 ──────────────────────────
    elif t == "update_perf":
        field = cmd.get("field", "")
        value = cmd.get("value")
        if field and value is not None and field in d.get("perf", {}):
            d["perf"][field] = value
            return True
        return False

    # ── 임의 필드 경로 업데이트 (최후 수단) ───────────────
    elif t == "set_field":
        # path: "perf.val_rmse" 또는 "shap_meta.top_n"
        path  = str(cmd.get("path", "")).split(".")
        value = cmd.get("value")
        if not path or value is None:
            return False
        obj = d
        for key in path[:-1]:
            if isinstance(obj, dict) and key in obj:
                obj = obj[key]
            else:
                return False
        last = path[-1]
        if isinstance(obj, dict) and last in obj:
            obj[last] = value
            return True
        return False

    # ── 초기화 ────────────────────────────────────────────
    elif t == "reset":
        reset_live_data()
        return True

    return False


def interpret_and_apply(feedback: str, history: list = None) -> dict:
    """AI와 대화하며 보고서 수정 명령을 해석·적용. 일반 질문도 지원."""
    from agent import ask

    if history is None:
        history = []

    d = get_live_data()
    p = d.get("perf", {})
    fc_features   = [f["feature"] for f in d.get("feature_comparison", [])]
    imp_features  = [f["feature"] for f in d.get("importance_all", [])]
    shap_features = [s["feature"] for s in d.get("shap_data", [])]
    wafer_sample  = d.get("wafer_risk", [])[:3]
    commentary       = d.get("commentary", [])
    custom_sections  = d.get("custom_sections", [])

    prompt = f"""당신은 Field Health 불량 예측 보고서 AI 어시스턴트입니다.
수정 요청이 오면 Python 코드로 데이터(d)를 직접 조작하고, 질문이면 자연스럽게 답변하세요.

=== ⚠️ 핵심 판단 규칙 (반드시 준수) ===

【기본값: 기존 차트 수정 (A)】← 아래에 해당하면 반드시 이 경로
  - 기존 차트 이름이 언급된 경우: SHAP, 트렌드, Wafer, 피처 중요도, 박스플롯, 성능, RMSE
  - "수정", "변경", "줄여줘", "늘려줘", "필터링", "정렬", "바꿔줘", "보여줘",
    "기간", "N개만", "상위 N개", "최근 N일" 등의 표현
  → d 데이터를 직접 수정하는 Python 코드 작성

┌─────────────────────┬──────────────────────────────────────────────┐
│ SHAP 중요도 차트    │ d["shap_data"] = d["shap_data"][:N]          │
│ 피처 중요도 차트    │ d["importance_all"] = d["importance_all"][:N]│
│ 트렌드 차트         │ d["trend_data"] = [필터링...]                 │
│ Wafer 위험 테이블   │ d["wafer_risk"] = sorted(...) 또는 필터링    │
│ 성능 지표 카드      │ d["perf"]["필드명"] = 값                     │
│ 메모/코멘터리       │ d["commentary"] 추가/수정/삭제               │
└─────────────────────┴──────────────────────────────────────────────┘

【예외: 새 차트 추가 (B)】← 아래 표현이 명시적으로 있어야만 해당
  - "추가해줘", "새로 만들어줘", "새 차트", "차트 추가", "섹션 추가"
  - [선택 영역] 포함 + 추가/넣어줘 요청
  → d["custom_sections"]에 append 사용

⛔ 절대 금지: 기존 차트(SHAP·트렌드·Wafer·피처 중요도 등) 수정 요청에
   d["custom_sections"]를 사용하지 말 것. 기존 d 필드를 직접 수정하라.

[선택 영역: x=A~B%, y=C~D%]가 있을 때 position 결정 (추가 요청인 경우에만):
  x 중심 < 50%  → "left_col"
  x 중심 ≥ 50%  → "right_col"
  y < 10%       → "before_slide"
  y > 90%       → "after_slide"

=== 현재 보고서 데이터(d) 구조 ===
d["perf"] = {{
  "val_rmse": {p.get('val_rmse', 0):.6f}, "test_rmse": {p.get('test_rmse', 0):.6f},
  "clf_recall": {p.get('clf_recall', 0):.4f}, "clf_precision": {p.get('clf_precision', 0):.4f},
  "n_val": {p.get('n_val', 0)}, "n_high": {p.get('n_high', 0)}, "n_nonzero": {p.get('n_nonzero', 0)},
  "pred_defect_thr": {p.get('pred_defect_thr', 0):.6f}, "high_thr": {p.get('high_thr', 0):.6f},
  "train_days": {p.get('train_days', 0)}, "val_days": {p.get('val_days', 0)}, ...
}}
d["shap_data"]      = [{len(shap_features)}개] 각 항목: {{"feature","effect_norm","importance","high_med","low_med",...}}
  피처 목록: {shap_features}
d["importance_all"] = [{len(imp_features)}개] 각 항목: {{"feature","importance"}}
  피처 목록: {imp_features}
d["feature_comparison"] = [{len(fc_features)}개] 각 항목: {{"feature","high_box","low_box","corr","sim",...}}
  피처 목록: {fc_features}
d["wafer_risk"]     = [{len(d.get('wafer_risk', []))}개] 각 항목: {{"id","lot","wafer","pred_rate","true_rate","n"}}
  예시: {wafer_sample}
d["trend_data"]     = [{len(d.get('trend_data', []))}개] 각 항목: {{"day"(정수 인덱스),"date"("YYYY-MM-DD"),"pred_rate","true_rate","split","n"}}
  ※ pred_rate/true_rate는 None일 수 있음 — 반드시 None 체크 필요
d["commentary"]     = [{len(commentary)}개] 각 항목: {{"title","content"}}
  현재: {[c['title'] for c in commentary] if commentary else '없음'}
d["shap_meta"]      = {d.get('shap_meta', {})}
d["custom_sections"] = [{len(custom_sections)}개] — 명시적 추가 요청 시에만 사용

=== 코드 작성 규칙 ===
⛔ import 절대 금지 — 실행 환경에서 차단됩니다.

✅ 사용 가능 함수: sorted, len, range, int, float, str, list, dict, max, min, sum, round, abs, any, all
✅ 사용 가능 날짜 변수 (import 없이 바로 사용, "YYYY-MM-DD" 문자열):
   - today, week_ago, month_ago, three_months_ago
✅ 사용 가능 클래스: datetime, timedelta, date (import 없이 바로 사용)
⚠️ None 처리 필수: pred_rate/true_rate는 None일 수 있음 → `t["pred_rate"] is not None` 체크

■ 기존 차트 수정 예시:
  d["shap_data"] = d["shap_data"][:5]                        # SHAP 상위 5개만
  d["importance_all"] = d["importance_all"][:10]              # 피처 중요도 상위 10개
  d["trend_data"] = [t for t in d["trend_data"] if t.get("date","") >= week_ago]  # 트렌드 최근 1주
  d["wafer_risk"] = [w for w in d["wafer_risk"] if w["pred_rate"] >= 50]          # 50% 이상만
  d["wafer_risk"] = sorted(d["wafer_risk"], key=lambda w: w["true_rate"], reverse=True)

■ 새 차트 추가 (명시적 추가 요청 시에만):
  지원 chart_type: "bar", "line", "scatter", "pie", "doughnut", "table"
  삽입 위치(position): "before_slide", "after_slide", "end"(기본), "left_col", "right_col"
  d.setdefault("custom_sections",[]).append({{
    "title":"제목","position":"after_slide","chart_type":"bar",
    "labels":["A","B"],"datasets":[{{"label":"시리즈","data":[1,2],"color":"#3b82f6"}}],
    "height":260
  }})

- 수정 없이 질문에만 답할 때는 code를 빈 문자열("")로

=== 보고서 레이아웃 참고 (기존 차트 수정 요청 시) ===
- y 0~18%   : 보고서 상단 헤더
- y 18~72%  : 메인 슬라이드
  - x 0~50%  : 왼쪽 컬럼 → SHAP 중요도 차트 / 성능 지표 카드
  - x 50~100%: 오른쪽 컬럼 → 트렌드 차트 / Wafer 위험 테이블
- y 72~100% : 슬라이드 하단 → 커스텀 섹션 / 코멘터리

=== 사용자 메시지 ===
{feedback}

=== JSON 응답 (코드블록 없이) ===
{{
  "response": "사용자에게 전달할 자연어 답변",
  "code": "실행할 Python 코드 (없으면 빈 문자열)",
  "description": "수정 내용 한 줄 요약"
}}"""

    response, updated_history = ask(prompt, history=history)

    # JSON 파싱
    try:
        clean = response.strip()
        if "```" in clean:
            parts = clean.split("```")
            clean = parts[1] if len(parts) > 1 else clean
            if clean.startswith("json"):
                clean = clean[4:]
        cmd_data = json.loads(clean.strip())
    except Exception:
        return {
            "success": False,
            "response": response,
            "description": "",
            "applied": [],
            "history": updated_history,
        }

    # 코드 실행
    code = cmd_data.get("code", "").strip()
    success, err = execute_code(code, d)
    if code and not success:
        cmd_data["response"] = (cmd_data.get("response", "") +
                                f"\n\n⚠️ 코드 실행 오류: {err}")

    return {
        "success": success and bool(code),
        "response": cmd_data.get("response", ""),
        "description": cmd_data.get("description", ""),
        "applied": ["code_exec"] if (success and code) else [],
        "history": updated_history,
    }
