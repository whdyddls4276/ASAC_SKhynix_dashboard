"""
Agent 루프 핵심 로직.
Claude API tool_use를 사용하여 ①~⑦ 단계를 처리하고
SSE(Server-Sent Events)로 프론트에 스트리밍.
"""
import json
import asyncio
import os
from dotenv import load_dotenv
import anthropic
from tools import (infer_period, scan_data, analyze_features, get_importance,
                   get_pred_actual_data, get_trend_top1_data, get_top_unit_data,
                   get_position_defect_rate, get_ppm_delta, get_feature_scatter_data,
                   get_lot_trend_with_split, get_wafer_die_data, get_recent_lot_trend,
                   get_pred_ppm_trend, get_weekly_grade_trend, get_weekly_yield_trend,
                   get_anomaly_feature_stats, get_val_rmse, get_feat_vs_health_scatter)
from report import build_html

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
MODEL = "claude-sonnet-4-6"

# Claude에게 제공하는 tool 정의
TOOLS = [
    {
        "name": "scan_data",
        "description": "val 데이터를 스캔하여 grade1~4 unit 수, 집중 lot/wafer를 반환. start/end로 날짜 필터 가능.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "시작 날짜 YYYYMMDD (예: 20201109). 생략 시 전체."},
                "end":   {"type": "string", "description": "종료 날짜 YYYYMMDD (예: 20201111). 생략 시 전체."},
            },
            "required": [],
        },
    },
    {
        "name": "analyze_features",
        "description": "grade1 vs grade4 그룹 feature 분포를 비교하여 유의미하게 다른 feature를 반환. start/end로 날짜 필터 가능.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "시작 날짜 YYYYMMDD (예: 20201109). 생략 시 전체."},
                "end":   {"type": "string", "description": "종료 날짜 YYYYMMDD (예: 20201111). 생략 시 전체."},
                "top_n": {"type": "integer", "description": "반환할 feature 수 (기본 10)"},
            },
            "required": [],
        },
    },
    {
        "name": "get_importance",
        "description": "feature_importance.csv에서 전체 feature 중요도 상위 목록을 반환.",
        "input_schema": {
            "type": "object",
            "properties": {
                "top_n": {"type": "integer", "description": "반환할 feature 수 (기본 10)"}
            },
        },
    },
]

SYSTEM_PROMPT = """당신은 SK Hynix 반도체 공정 품질 분석 AI Agent입니다.
PI(Process Integration 엔지니어)의 요청에 따라 데이터를 분석하고 품질불량예측보고서를 작성합니다.

## 생성되는 보고서 양식 (확정된 양식)

보고서는 "품질불량예측보고서" 양식으로 생성됩니다. 구조는 아래와 같습니다.

**왼쪽 — 프레싱 현황**
- 요약 3열: 오전 성능(Val RMSE) / 불량 수량 / 예측 ppm
- 전주 대비 알림 + 불량 좌표
- 불량률 트렌드 라인차트 (LOT별 HIGH 건수)
- SHAP 분석 수평 막대차트
- SHAP 분석 결과 테이블 (HIGH vs MED 비교)

**오른쪽 — 불량 유닛 분석 현황**
- 대표 Unit 정보 테이블 ⚠️ 더미
- 이력맵 대비 / 좌표별 불량(Position 1~4 ⚠️ 더미) / 피처임포턴스 비율
- X1056 트렌드 라인차트 ⚠️ 더미
- 집중 LOT / 웨이퍼 텍스트

⚠️ 더미 표시 섹션은 현재 샘플 데이터로 표시되며, 추후 실데이터로 교체 예정입니다.
보고서 생성 시 PI에게 이 사실을 한 줄 안내하세요.

## 흐름 (반드시 순서대로, 각 단계는 딱 한 번만 실행)

**각 단계는 딱 한 번만, 순서대로 실행합니다.**

1. 보고서 요청이 오면 기간을 먼저 확인:
   "어떤 기간으로 분석할까요?
   (데이터 범위: 2020.11.07 ~ 2020.11.11)
   <<<BUTTONS: 전체(5일), 최근 3일, 최근 1일, 직접 입력>>>"

2. 기간 확인 후 scan_data(start, end) 실행 후 아래 형식으로만 출력:
   📊 스캔 결과 (기간: YYYY.MM.DD ~ YYYY.MM.DD)
   - 총 unit: N개
   - grade1(위험): M개 (X%) / grade2: M개 / grade3: M개 / grade4(정상): M개
   - 집중 LOT: LOT_XXX (grade1 N개)
   - 집중 웨이퍼: LOT_XXX-WF_YY (grade1 N개)

3. 이어서 get_importance 실행 후 아래 형식으로만 출력:
   📋 주요 Feature TOP5
   - 1위: X234 (gain: 0.XXX)
   - 2위: X891 (gain: 0.XXX)
   - 3위: X102 (gain: 0.XXX)
   - 4위: X445 (gain: 0.XXX)
   - 5위: X778 (gain: 0.XXX)

4. 이어서 analyze_features(start, end) 실행 후 아래 형식으로만 출력:
   🔬 분포 분석 (grade1 vs grade4)
   - X234: grade1 평균 0.082 vs grade4 평균 0.035 (2.3배, p=0.001)
   - X891: grade1 평균 0.071 vs grade4 평균 0.041 (1.7배, p=0.004)
   ...
   그 후 확인:
   <<<BUTTONS: 보고서 작성, 다른 feature 보기>>>

5. "보고서 작성" 확인을 받으면 **아래 한 줄만** 출력하세요. 앞뒤 텍스트 절대 금지:
<<<HTML_REPORT>>>

## 절대 금지 사항

- **이미 실행한 tool은 절대 다시 실행하지 마세요.**
- **"보고서 작성" 확인 후**: 설명, 안내, ⚠️ 메시지 등 어떤 텍스트도 붙이지 말고 <<<HTML_REPORT>>> 한 줄만 출력하세요.
- **같은 내용을 두 번 출력하지 마세요.**

## 버튼 태그 규칙 (필수)

PI에게 선택을 요청할 때는 반드시 아래 태그를 텍스트 끝에 붙이세요:
<<<BUTTONS: 버튼1, 버튼2>>>

버튼은 최대 4개, 각 버튼은 짧고 명확하게 (10자 이내).

## 날짜 필터 규칙

데이터 날짜 범위: **20201107 ~ 20201111** (5일치)

버튼 선택 → start/end 변환:
- "전체(5일)" → start/end 생략
- "최근 3일"  → start=20201109, end=20201111
- "최근 1일"  → start=20201111, end=20201111
- "직접 입력" → "시작일과 종료일을 입력해주세요. (예: 20201109 ~ 20201111)" 라고 물어보기

날짜 필터 적용 시 scan_data와 analyze_features 모두 동일한 start/end 사용.

## 기타 주의사항
- 수치는 구체적으로 (예: "2.3배 높음", "HIGH 그룹 평균 0.082")
- 한국어로 답변"""


def _run_tool(name: str, inputs: dict) -> str:
    """tool 이름과 입력값으로 실제 함수 실행."""
    fn_map = {
        "infer_period": infer_period,
        "scan_data": scan_data,
        "analyze_features": analyze_features,
        "get_importance": get_importance,
    }
    result = fn_map[name](**inputs)
    return json.dumps(result, ensure_ascii=False)


def _build_report_data(tool_cache: dict) -> dict:
    """tool_cache로부터 report_data를 조립 (pred_actual / trend_top1 실데이터 포함)."""
    # scan_data에서 사용된 날짜 필터 추출 (재사용)
    _scan = tool_cache.get("scan_data", {})
    analysis = dict(tool_cache.get("analyze_features", {}))

    # Pred vs Actual 실데이터 주입
    if "pred_actual" not in analysis:
        try:
            analysis["pred_actual"] = get_pred_actual_data()
        except Exception:
            analysis["pred_actual"] = []

    # 피처 top-1 트렌드 실데이터 주입
    if "trend_top1" not in analysis:
        try:
            analysis["trend_top1"] = get_trend_top1_data()
        except Exception:
            analysis["trend_top1"] = {}

    # 대표 Unit 실데이터 주입
    top_unit = {}
    try:
        top_unit = get_top_unit_data()
    except Exception:
        pass

    # 포지션별 불량률 실데이터 주입
    pos_defect = {}
    try:
        pos_defect = get_position_defect_rate()
    except Exception:
        pass

    # 배너 ppm delta
    ppm_delta = {}
    try:
        ppm_delta = get_ppm_delta()
    except Exception:
        pass

    # 피처 scatter (상위 2개)
    feat_scatter = {}
    try:
        feat_scatter = get_feature_scatter_data()
    except Exception:
        pass

    # L2 전체 split 트렌드
    lot_trend_split = {}
    try:
        lot_trend_split = get_lot_trend_with_split()
    except Exception:
        pass

    # L2 보고서용 주차별 수율 트렌드 (trend_data.csv, 최근 5주)
    weekly_yield_trend = {}
    try:
        weekly_yield_trend = get_weekly_yield_trend(recent_weeks=7)
    except Exception:
        pass

    # L2 fallback용 최근 LOT 트렌드
    recent_lot_trend = {}
    try:
        recent_lot_trend = get_recent_lot_trend(recent_n=35)
    except Exception:
        pass

    # R3 예측 ppm 트렌드 (HIGH/MED 그룹 평균)
    pred_ppm_trend = {}
    try:
        pred_ppm_trend = get_pred_ppm_trend(recent_n=20)
    except Exception:
        pass

    # 웨이퍼맵 die 좌표
    wafer_die = {}
    try:
        wafer_die = get_wafer_die_data()
    except Exception:
        pass

    # 어노멀리 피처 실데이터 (grade1 vs grade4, importance 상위 3개)
    anomaly_stats = []
    try:
        anomaly_stats = get_anomaly_feature_stats(top_n=5)
    except Exception:
        pass

    # L4: 피처값 vs 예측 health scatter
    feat_vs_health = {}
    try:
        feat_vs_health = get_feat_vs_health_scatter()
    except Exception:
        pass

    try:
        _val_rmse = get_val_rmse()
    except Exception:
        _val_rmse = "0.005736"

    return {
        "meta": {
            "title": "Field Health 불량 원인 분석 보고서",
            "period": tool_cache.get("infer_period", {}).get("label", ""),
            "model": "Two-Stage Model",
            "val_rmse": _val_rmse,
        },
        "scan":             tool_cache.get("scan_data", {}),
        "importance":       tool_cache.get("get_importance", {}),
        "analysis":         analysis,
        "top_unit":         top_unit,
        "pos_defect":       pos_defect,
        "ppm_delta":        ppm_delta,
        "feat_scatter":     feat_scatter,
        "lot_trend_split":  lot_trend_split,
        "weekly_yield_trend": weekly_yield_trend,
        "recent_lot_trend":   recent_lot_trend,
        "pred_ppm_trend":     pred_ppm_trend,
        "wafer_die":        wafer_die,
        "anomaly_stats":    anomaly_stats,
        "feat_vs_health":   feat_vs_health,
        "actions":          [],
    }


async def run_agent(user_message: str, history: list, initial_tool_cache: dict = None):
    """
    Agent 루프 실행. SSE 이벤트를 yield.
    history: [{"role": "user"/"assistant", "content": "..."}]
    initial_tool_cache: 이미 실행된 tool 결과 (프론트에서 전달, 재실행 방지)

    yield하는 이벤트 형식:
    {"type": "text", "content": "..."}          - 일반 텍스트 메시지
    {"type": "tool_start", "tool": "..."}        - tool 실행 시작
    {"type": "tool_result", "tool": "...", ...}  - tool 실행 결과
    {"type": "confirm", "buttons": [...]}        - PI 확인 요청 (버튼)
    {"type": "report_ready", "markdown": "..."}  - 보고서 초안 완성
    {"type": "done"}                             - 완료
    """
    # history에서 단순 텍스트 메시지만 추출 (tool_use 블록 등 복잡한 구조 제거)
    clean_history = []
    for msg in history:
        role = msg.get("role")
        content = msg.get("content", "")
        if not isinstance(content, str):
            continue
        content = content.strip()
        if not content:
            continue
        # 연속된 같은 role 스킵
        if clean_history and clean_history[-1]["role"] == role:
            continue
        clean_history.append({"role": role, "content": content})

    # 마지막이 assistant면 제거
    if clean_history and clean_history[-1]["role"] == "assistant":
        clean_history = clean_history[:-1]

    messages = clean_history + [{"role": "user", "content": user_message}]
    # 프론트에서 전달된 이미 실행된 tool 결과로 초기화 (재실행 방지)
    tool_cache = dict(initial_tool_cache) if initial_tool_cache else {}

    # 이미 실행된 tool 목록을 system prompt에 주입 → Claude가 재실행 안 함
    def _build_system(cache: dict) -> str:
        if not cache:
            return SYSTEM_PROMPT
        done = []
        if "scan_data" in cache:
            done.append(f"- scan_data: 완료 → total_units={cache['scan_data'].get('total_units')}, grade1_count={cache['scan_data'].get('grade1_count')}")
        if "get_importance" in cache:
            n = len(cache['get_importance'].get('features', []))
            done.append(f"- get_importance: 완료 → {n}개 feature 반환됨")
        if "analyze_features" in cache:
            n = len(cache['analyze_features'].get('top_features', []))
            done.append(f"- analyze_features: 완료 → top_features {n}개 반환됨")
        if not done:
            return SYSTEM_PROMPT
        injected = "\n\n## 이미 실행 완료된 Tool (절대 재실행 금지)\n" + "\n".join(done)
        return SYSTEM_PROMPT + injected

    # "보고서 작성" shortcut — Claude tool 흐름을 타야 하므로 여기서는 처리 안 함
    # (<<<HTML_REPORT>>> 태그 감지 시 build_html 호출로 처리됨)

    while True:
        # asyncio.Queue를 통해 스트리밍 청크를 실시간 yield
        # (client.messages.stream은 동기 블로킹이므로 별도 스레드에서 실행 후 Queue로 전달)
        queue: asyncio.Queue = asyncio.Queue()
        _SENTINEL = object()  # 스트림 종료 신호

        def _stream_to_queue(q: asyncio.Queue, loop: asyncio.AbstractEventLoop):
            """동기 스트리밍 — 스레드 안에서 실행하며 청크를 loop.call_soon_threadsafe로 Queue에 적재."""
            try:
                with client.messages.stream(
                    model=MODEL,
                    max_tokens=4096,
                    system=_build_system(tool_cache),
                    tools=TOOLS,
                    messages=messages,
                ) as stream:
                    for event in stream:
                        etype = type(event).__name__
                        if etype == "RawContentBlockDeltaEvent":
                            delta = event.delta
                            if hasattr(delta, "text") and delta.text:
                                loop.call_soon_threadsafe(q.put_nowait, ("chunk", delta.text))
                    msg = stream.get_final_message()
                    loop.call_soon_threadsafe(q.put_nowait, ("final", msg))
            except Exception as e:
                loop.call_soon_threadsafe(q.put_nowait, ("error", e))
            finally:
                loop.call_soon_threadsafe(q.put_nowait, (_SENTINEL, None))

        loop = asyncio.get_running_loop()
        import threading
        t = threading.Thread(target=_stream_to_queue, args=(queue, loop), daemon=True)
        t.start()

        # Queue에서 실시간으로 이벤트 수신
        full_text = ""
        final_msg = None
        stream_error = None
        # 태그 포함 여부 감지용: <<<가 나타난 순간부터 청크 버퍼링
        tag_started = False

        while True:
            kind, payload = await queue.get()
            if kind is _SENTINEL:
                break
            if kind == "chunk":
                full_text += payload
                # <<<가 아직 안 나타난 순수 텍스트만 실시간 전송
                if not tag_started:
                    if "<<<" in full_text:
                        tag_started = True
                        # <<<HTML_REPORT>>> 태그면 앞 텍스트 버림 (중복 방지)
                        # <<<BUTTONS 등 다른 태그면 앞 텍스트 전송
                        before_tag = full_text.split("<<<", 1)[0]
                        tag_body = full_text.split("<<<", 1)[1]
                        if before_tag and not tag_body.startswith("HTML_REPORT"):
                            yield {"type": "text", "content": before_tag}
                    else:
                        yield {"type": "text", "content": payload}
            elif kind == "final":
                final_msg = payload
            elif kind == "error":
                stream_error = payload

        if stream_error:
            if isinstance(stream_error, anthropic.BadRequestError):
                yield {"type": "error", "message": f"API 오류: {getattr(stream_error, 'message', str(stream_error))}"}
            elif isinstance(stream_error, anthropic.AuthenticationError):
                yield {"type": "error", "message": "API 키가 유효하지 않습니다. .env 파일의 ANTHROPIC_API_KEY를 확인해주세요."}
            else:
                yield {"type": "error", "message": f"서버 오류: {str(stream_error)}"}
            return

        if final_msg is None:
            yield {"type": "error", "message": "스트림에서 최종 메시지를 받지 못했습니다."}
            return

        # assistant 응답을 history에 추가
        from anthropic.types import TextBlock
        clean_content = []
        for block in final_msg.content:
            if block.type == "text":
                stripped = block.text.rstrip()
                if stripped:
                    clean_content.append(TextBlock(type="text", text=stripped))
            else:
                clean_content.append(block)
        if not clean_content:
            clean_content = [TextBlock(type="text", text=".")]
        messages.append({"role": "assistant", "content": clean_content})

        # 텍스트 블록 최종 처리 (태그 감지 및 분리)
        # final block 처리: 태그(<<<...>>>)가 있는 블록만 처리
        # 태그 앞 텍스트는 청크 스트리밍에서 이미 전송됐으므로 skip
        for block in final_msg.content:
            if block.type == "text":
                text = block.text

                # 태그 없는 순수 텍스트 → 청크로 이미 전송됨, 중복 방지
                if "<<<" not in text:
                    continue

                # 보고서 초안 완성 감지 (<<<HTML_REPORT>>> 태그)
                if "<<<HTML_REPORT>>>" in text:
                    report_data = _build_report_data(tool_cache)
                    html = build_html(report_data)
                    yield {"type": "report_ready", "html": html, "report_data": report_data}
                # 차트 수정 명령 감지: <<<UPDATE_CHART: chart=shap, top_n=5>>>
                elif "<<<UPDATE_CHART:" in text:
                    remaining = text
                    clean_text_parts = []
                    while "<<<UPDATE_CHART:" in remaining:
                        before, rest = remaining.split("<<<UPDATE_CHART:", 1)
                        if before.strip():
                            clean_text_parts.append(before.strip())
                        tag_body, remaining = rest.split(">>>", 1) if ">>>" in rest else (rest, "")
                        params = {}
                        for part in tag_body.split(","):
                            part = part.strip()
                            if "=" in part:
                                k, v = part.split("=", 1)
                                params[k.strip()] = v.strip()
                        import copy
                        patched = copy.deepcopy({
                            "meta":       {"title": "Field Health 불량 원인 분석 보고서",
                                           "model": "Two-Stage Model"},
                            "scan":       tool_cache.get("scan_data", {}),
                            "importance": tool_cache.get("get_importance", {}),
                            "analysis":   tool_cache.get("analyze_features", {}),
                            "actions":    [],
                            "chart_params": params,
                        })
                        html = build_html(patched)
                        yield {"type": "report_ready", "html": html, "report_data": patched}
                    if remaining.strip():
                        clean_text_parts.append(remaining.strip())
                    combined = "\n".join(clean_text_parts)
                    if combined:
                        yield {"type": "text", "content": combined}
                # 버튼 태그 감지: <<<BUTTONS: 버튼1, 버튼2>>>
                elif "<<<BUTTONS:" in text:
                    parts = text.split("<<<BUTTONS:", 1)
                    # before 텍스트는 청크로 이미 전송됨 → skip
                    btn_part = parts[1].split(">>>", 1)
                    buttons = [b.strip() for b in btn_part[0].split(",") if b.strip()]
                    if buttons:
                        yield {"type": "confirm", "buttons": buttons}
                else:
                    pass  # <<<가 없으면 이미 청크로 실시간 전송됨 → 중복 전송 방지

        # tool_use 처리
        if final_msg.stop_reason == "tool_use":
            tool_results = []
            for block in final_msg.content:
                if block.type == "tool_use":
                    yield {"type": "tool_start", "tool": block.name}
                    result_str = await asyncio.to_thread(_run_tool, block.name, block.input)
                    result_data = json.loads(result_str)
                    tool_cache[block.name] = result_data
                    yield {"type": "tool_result", "tool": block.name, "result": result_data}
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_str,
                    })

            messages.append({"role": "user", "content": tool_results})
            continue

        # end_turn 또는 그 외 모든 경우 종료
        yield {"type": "done"}
        break


REPORT_EDITOR_SYSTEM = """당신은 SK Hynix 반도체 보고서 수정 전문 AI입니다.
사용자 요청을 분석하여 보고서 데이터(d)를 수정하는 Python 코드를 생성합니다.

## 보고서 레이아웃 — 품질불량예측보고서 (한 페이지 고정)
보고서는 반드시 한 페이지(1200px 너비) 안에만 존재합니다.
추가 가능한 위치: left_col(왼쪽 컬럼 하단) 또는 right_col(오른쪽 컬럼 하단)만.

### 헤더 구조
- 좌: 발행일자 / 중앙: 품질불량예측보고서 / 우: 대외비 뱃지
- 알림 배너 (전체 너비): "전주 대비 품질불량 ▲ ppm 이상 | [피처명] 특성 불량에 대해 Inline 원인 소급 요청"

### 왼쪽 컬럼 — 모델링 현황 보고
| 섹션 | 내용 | 데이터 |
|------|------|--------|
| L1. 요약 3열 | 모델 성능(Val RMSE) / 분석 유닛 / 예측 ppm | d["meta"]["val_rmse"], d["scan"] |
| L2. 불량률 트렌드 | LOT별 HIGH 건수 라인차트 | chart_params: {"chart":"lot"} |
| L3. SHAP 분석 (2열) | 왼쪽: bee-swarm scatter (HIGH빨강/MED파랑) / 오른쪽: Pred vs Actual scatter | d["importance"], d["analysis"] |

### 오른쪽 컬럼 — 불량 유닛 분석 현황
| 섹션 | sid | 내용 | 데이터 | 상태 |
|------|-----|------|--------|------|
| R1. 웨이퍼맵 + 대표 Unit | R1_unit | 웨이퍼맵(grade 색상) + 시리얼/LOT/WAFER/예측health/생산일자 | d["top_unit"], d["wafer_die"] | ✅ 실데이터 |
| R1b. 포지션별 예측 health | (R1 내부) | P1~P4 예측 health값 | d["top_unit"]["pos_health"] | ✅ 실데이터 |
| R2. Anomaly Feature | R2_anomaly | 피처별 정상/불량 바 비교 (grade1 vs grade4) | d["anomaly_stats"] | ✅ 실데이터 |
| R2. Feature Importance | R2_importance | 피처 중요도 비율 막대 | d["importance"]["features"] | ✅ 실데이터 |

## 더미 섹션 처리 규칙 (절대 원칙)
현재 보고서에서 더미인 섹션은 **없습니다**. 모든 섹션에 실데이터가 연결되어 있습니다.
절대로 실데이터 섹션을 "더미"라고 말하지 마세요.

## Anomaly Feature / Feature Importance 수정 가능
- Anomaly Feature 피처 수 변경: d["anomaly_stats"] = d.get("anomaly_stats", [])[:N]
- 특정 피처만: d["anomaly_stats"] = [s for s in d.get("anomaly_stats",[]) if s["feature"] in ["X1064","X592"]]
- Feature Importance 개수 변경: d.setdefault("importance",{})["features"] = d.get("importance",{}).get("features",[])[:N]

## 공간 제약
각 컬럼의 남은 공간은 약 100~150px입니다.
새 섹션 높이가 150px를 초과하면 바로 추가하지 말고 먼저 물어보세요.

## 인터랙션 이벤트 처리 (드래그·우클릭·hover)
사용자가 보고서에서 드래그하거나 우클릭하면 아래 형식의 컨텍스트가 앞에 붙습니다:
```
## 현재 보고서 레이아웃 (섹션 좌표)
- [L2_trend] 주차별 수율 트렌드 : x=0, y=148, w=580, h=120
- [L3_scatter] 피처 scatter : x=0, y=276, w=580, h=240
...
드래그 선택 영역: x=20, y=160, w=300, h=80
```
이 좌표를 보고 드래그가 어느 섹션과 겹치는지 파악하세요.
- 기존 섹션과 겹치면 → 수정 요청으로 처리
- 빈 영역이면 → 어느 컬럼(x<600=왼쪽, x≥600=오른쪽)인지 파악 후 추가 요청으로 처리

## 응답 말투 규칙 (절대 원칙)
- 첫 인사말, "안녕하세요", "물론입니다", "두 가지 요청을 확인했습니다" 같은 서두 절대 금지
- 바로 핵심 내용으로 시작할 것
- 추가/수정 완료 시: "X를 Y로 변경했습니다." 한 문장으로 끝낼 것
- 새 섹션 추가 요청 시 정보 부족이면: "어떤 데이터를 어떤 형태로 추가할까요?" 한 줄로 물어볼 것
- JSON code 필드에 절대 주석(#) 넣지 말 것, 실행 가능한 코드만

## 불명확한 요청 처리 (절대 원칙)
새 섹션/차트 추가 시 아래 정보 중 하나라도 없으면 반드시 먼저 질문하고 code는 "":
1. 어떤 데이터를 넣을지 (피처명, 기간, 지표 등)
2. 어떤 형태인지 — 불명확하면: <<<BUTTONS: 막대차트, 라인차트, 표, 텍스트카드>>>
3. 피처 미지정 시 → <<<BUTTONS: {top5_features}>>>

기존 섹션 수정은 내용이 명확하면 바로 실행하세요.
기간 변경 시 주수/일수 미지정이면 반드시 물어보세요.

## 보고서 데이터 구조 (d)
d["scan"]            - total_units, high_count, high_ratio, top_lot, top_wafer, morning_rmse 등
d["importance"]      - features: [{feature, lgbm_rank, lgbm_gain}, ...]
d["analysis"]        - top_features: [{feature, high_mean, low_mean, ratio, pval}, ...]
d["meta"]            - title, model, val_rmse, test_rmse, report_title, summary_title, summary_sub, alert_features, section_labels
d["custom_sections"] - 커스텀 섹션 목록
d["chart_params"]    - 차트 파라미터 (chart, top_n)
d["table_params"]    - 테이블 파라미터 (shap_hide_cols 등)

## 코드 작성 규칙
✅ 사용 가능: sorted, len, max, min, sum, int, float, str, list, dict, filter, map, any, all
⛔ 절대 금지: import, exec, eval, open, __import__, subprocess, globals, getattr

## 기존 차트 수정
d["chart_params"] = {"chart": "shap", "top_n": "5"}   # SHAP 막대 상위 N개
d["chart_params"] = {"chart": "lot",  "top_n": "10"}  # 불량률 트렌드 상위 N개

## Anomaly Feature (R2) — 표시 피처 수 변경
# d["anomaly_stats"]는 실데이터 리스트: [{feature, danger, normal, grade1_mean, grade4_mean, z_score}, ...]
# 절대 더미라고 하지 말 것 — 실데이터가 연결된 실제 섹션임
# 상위 N개로 줄이기:
d["anomaly_stats"] = d.get("anomaly_stats", [])[:3]   # 상위 3개만
# 특정 피처만 보이기:
# d["anomaly_stats"] = [s for s in d.get("anomaly_stats", []) if s.get("feature") in ["X1064","X592","X1066"]]

## Feature Importance (R2) — 표시 피처 수 변경
# d["importance"]는 {"features": [{feature, lgbm_rank, lgbm_gain}, ...]} 구조
# 상위 N개만 표시하려면 features 리스트를 자른다:
feats = d.get("importance", {}).get("features", [])
d.setdefault("importance", {})["features"] = feats[:5]   # 상위 5개만

## 타이틀 / 소제목 수정
# 보고서 헤더 제목 (상단 가운데)
d.setdefault("meta", {})["report_title"] = "Field Health 불량 예측 분석 보고서"
# 요약 배너 첫째 줄 (HTML 허용, span 태그로 색상 지정 가능)
d["meta"]["summary_title"] = "전주 대비 품질 불량 &nbsp;<span style=\"color:#EF4444\">▲163,452 ppm</span>&nbsp; <span style=\"font-size:17px;font-weight:600;color:#555\">열화</span>"
# 요약 배너 둘째 줄 (HTML 허용)
d["meta"]["summary_sub"] = "원인 WT Parameter&nbsp;<span style=\"background:#fef3c7;color:#92400e;padding:1px 7px;font-size:15px;font-weight:800\">X1064, X592</span>&nbsp;이상 → inline 참원인 도출 요청"
# 원인 피처만 바꾸려면 (summary_sub 자동 재생성됨):
d["meta"]["alert_features"] = "X1064, X592"
# 좌측/우측 패널 헤더
d["meta"].setdefault("section_labels", {})["left_header"]  = "[ 모델링 결과 ]"
d["meta"]["section_labels"]["right_header"] = "[ 불량 예측 현황 ]"
# 섹션 소제목 (번호는 자동 유지, 텍스트만 교체)
d["meta"]["section_labels"]["L1"] = "모델 성능"
d["meta"]["section_labels"]["L2"] = "불량 트렌드"
d["meta"]["section_labels"]["L3"] = "Lot별 불량 개수"
d["meta"]["section_labels"]["L4"] = "주요 피처 임계값 분포"
d["meta"]["section_labels"]["R1"] = "불량 예측 현황 · 대표 불량 unit 기준"

## 주차별 수율 트렌드 (L2) — 표시 주수 변경
# d["weekly_yield_trend"]는 {"labels": [...], "production": [...], "pred_yield": [...]} 구조
# 최근 N주만 보이려면 리스트를 tail로 자른다
# 예) 최근 3주:
n = 3
wyt = d.get("weekly_yield_trend", {})
d["weekly_yield_trend"] = {
    "labels":     wyt.get("labels",     [])[-n:],
    "production": wyt.get("production", [])[-n:],
    "pred_yield": wyt.get("pred_yield", [])[-n:],
}

## SHAP 분석 테이블 컬럼 숨기기/복원
# 숨길 수 있는 컬럼명: "feature", "high_mean", "low_mean", "ratio", "pval"
d.setdefault("table_params", {})["shap_hide_cols"] = ["pval"]          # p-value 숨기기
d.setdefault("table_params", {})["shap_hide_cols"] = ["pval", "ratio"] # 여러 개 숨기기
d.setdefault("table_params", {})["shap_hide_cols"] = []                # 전체 복원

## 커스텀 섹션 추가 (left_col / right_col만)
d.setdefault("custom_sections", []).append({
  "title": "섹션 제목",
  "position": "left_col",      # left_col 또는 right_col만
  "chart_type": "bar",         # bar, line, table, pie, doughnut
  "labels": [...],
  "datasets": [{"label": "시리즈", "data": [...], "color": "#3B82F6"}],
  "height": 120,               # 150px 이하 권장
  "horizontal": False,
})

## 테이블 추가
d.setdefault("custom_sections", []).append({
  "title": "표 제목",
  "position": "right_col",
  "chart_type": "table",
  "columns": ["항목", "값"],
  "rows": [["Val RMSE", d["meta"].get("val_rmse", "-")], ["불량 수량", d["scan"].get("high_count", "-")]],
  "height": 120,
})

## 응답 형식 (JSON, 코드블록 없이)
{"response": "사용자에게 전달할 답변", "code": "Python 코드 (없으면 빈 문자열)"}"""


def _execute_editor_code(code: str, d: dict):
    """Claude가 생성한 코드를 안전하게 실행. (success, error_msg) 반환."""
    if not code.strip():
        return True, ""

    forbidden = ["import ", "__import__", "exec(", "eval(", "open(",
                 "compile(", "globals(", "getattr(", "subprocess"]
    for f in forbidden:
        if f in code:
            return False, f"금지된 표현: {f}"

    safe_builtins = {
        "sorted": sorted, "len": len, "max": max, "min": min, "sum": sum,
        "int": int, "float": float, "str": str, "list": list, "dict": dict,
        "filter": filter, "map": map, "any": any, "all": all, "zip": zip,
        "enumerate": enumerate, "range": range, "round": round,
        "True": True, "False": False, "None": None,
        "print": lambda *a, **k: None,
    }
    try:
        exec(code, {"__builtins__": safe_builtins, "d": d})
        return True, ""
    except Exception as e:
        return False, str(e)


async def run_report_editor(user_message: str, history: list,
                            tool_cache: dict = None, current_html: str = "",
                            current_report_data: dict = None):
    """
    보고서 수정 전용 Agent. Claude가 Python 코드를 생성하면 exec()으로 실행.
    current_report_data: 이전 수정이 누적된 보고서 데이터 (custom_sections, commentary 포함)
    """
    import copy
    cache = dict(tool_cache) if tool_cache else {}

    # current_report_data가 있으면 그걸 기반으로, 없으면 tool_cache로 초기화
    if current_report_data and isinstance(current_report_data, dict) and current_report_data:
        d = copy.deepcopy(current_report_data)
        d.setdefault("meta", {"title": "Field Health 불량 원인 분석 보고서", "model": "Two-Stage Model"})
        if not d.get("scan"):
            d["scan"] = cache.get("scan_data", {})
        if not d.get("importance"):
            d["importance"] = cache.get("get_importance", {})
        if not d.get("analysis"):
            d["analysis"] = cache.get("analyze_features", {})
        d.setdefault("actions",         [])
        d.setdefault("chart_params",    {})
        d.setdefault("custom_sections", [])
        d.setdefault("commentary",      [])
        # 신규 실데이터 키 — 없으면 새로 조회
        if not d.get("top_unit"):
            try: d["top_unit"] = get_top_unit_data()
            except Exception: d["top_unit"] = {}
        if not d.get("wafer_die"):
            try: d["wafer_die"] = get_wafer_die_data()
            except Exception: d["wafer_die"] = {}
        if not d.get("pos_defect"):
            try: d["pos_defect"] = get_position_defect_rate()
            except Exception: d["pos_defect"] = {}
        if not d.get("ppm_delta"):
            try: d["ppm_delta"] = get_ppm_delta()
            except Exception: d["ppm_delta"] = {}
        if not d.get("feat_scatter"):
            try: d["feat_scatter"] = get_feature_scatter_data()
            except Exception: d["feat_scatter"] = {}
        if not d.get("lot_trend_split"):
            try: d["lot_trend_split"] = get_lot_trend_with_split()
            except Exception: d["lot_trend_split"] = {}
        if not d.get("weekly_yield_trend"):
            try: d["weekly_yield_trend"] = get_weekly_yield_trend(recent_weeks=7)
            except Exception: d["weekly_yield_trend"] = {}
        if not d.get("recent_lot_trend"):
            try: d["recent_lot_trend"] = get_recent_lot_trend(recent_n=35)
            except Exception: d["recent_lot_trend"] = {}
        if not d.get("pred_ppm_trend"):
            try: d["pred_ppm_trend"] = get_pred_ppm_trend(recent_n=20)
            except Exception: d["pred_ppm_trend"] = {}
        if not d.get("anomaly_stats"):
            try: d["anomaly_stats"] = get_anomaly_feature_stats(top_n=3)
            except Exception: d["anomaly_stats"] = []
    else:
        d = _build_report_data(cache)

    clean_history = []
    for msg in history:
        role = msg.get("role")
        content = msg.get("content", "")
        if not isinstance(content, str) or not content.strip():
            continue
        if clean_history and clean_history[-1]["role"] == role:
            continue
        clean_history.append({"role": role, "content": content.strip()})
    if clean_history and clean_history[-1]["role"] == "assistant":
        clean_history = clean_history[:-1]

    messages = clean_history + [{"role": "user", "content": user_message}]

    # 현재 보고서 상태를 system에 주입 → 이미 적용된 수정을 Claude가 인지
    def _build_editor_system(d: dict) -> str:
        lines = []
        cp = d.get("chart_params", {})
        if cp.get("chart") and cp.get("top_n"):
            chart_name = {"shap": "SHAP Value Trend Graph", "lot": "LOT 불량 트렌드", "dist": "피처 분포"}.get(cp["chart"], cp["chart"])
            lines.append(f"- {chart_name} 상위 {cp['top_n']}개로 변경됨")
        tp = d.get("table_params", {})
        hidden = tp.get("shap_hide_cols", [])
        if hidden:
            col_names = {"pval": "p-value", "ratio": "배율", "high_mean": "HIGH 평균", "low_mean": "MED/LOW 평균", "feature": "Feature"}
            labels = [col_names.get(c, c) for c in hidden]
            lines.append(f"- SHAP 분석 테이블에서 [{', '.join(labels)}] 컬럼 숨김 처리됨")
        cs = d.get("custom_sections", [])
        for sec in cs:
            lines.append(f"- 커스텀 섹션 추가됨: \"{sec.get('title','')}\" ({sec.get('position','')})")
        if not lines:
            return REPORT_EDITOR_SYSTEM
        state_note = "\n\n## 현재 보고서에 이미 적용된 수정 (중복 언급 금지)\n" + "\n".join(lines)
        return REPORT_EDITOR_SYSTEM + state_note

    try:
        response = await asyncio.to_thread(
            client.messages.create,
            model=MODEL,
            max_tokens=2048,
            system=_build_editor_system(d),
            messages=messages,
        )
    except Exception as e:
        yield {"type": "error", "message": str(e)}
        return

    # 응답 파싱
    raw_text = ""
    for block in response.content:
        if block.type == "text":
            raw_text += block.text

    # JSON 파싱
    try:
        clean = raw_text.strip()
        if "```" in clean:
            parts = clean.split("```")
            clean = parts[1]
            if clean.startswith("json"):
                clean = clean[4:]
        cmd = json.loads(clean.strip())
    except Exception:
        # JSON 파싱 실패 → response 키 추출 시도, 없으면 "처리 중 오류" 안내
        import re as _re
        m = _re.search(r'"response"\s*:\s*"(.*?)"(?:,|\})', raw_text, _re.DOTALL)
        if m:
            yield {"type": "text", "content": m.group(1).replace("\\n", "\n")}
        else:
            yield {"type": "text", "content": "요청을 처리하지 못했습니다. 다시 시도해 주세요."}
        yield {"type": "done"}
        return

    response_text = cmd.get("response", "").strip()
    code = cmd.get("code", "").strip()

    # 코드 실행
    if code:
        success, err = _execute_editor_code(code, d)
        if not success:
            response_text += f"\n\n⚠️ 코드 실행 오류: {err}"
        else:
            # d가 수정됐으면 HTML 재생성
            html = build_html(d)
            yield {"type": "report_ready", "html": html, "report_data": copy.deepcopy(d)}

    if response_text:
        yield {"type": "text", "content": response_text}

    yield {"type": "done"}
