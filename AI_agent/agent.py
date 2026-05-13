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
from tools import infer_period, scan_data, analyze_features, get_importance
from report import build_html

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
MODEL = "claude-sonnet-4-6"

# Claude에게 제공하는 tool 정의
TOOLS = [
    {
        "name": "infer_period",
        "description": "사용자 입력에서 분석 기간을 추론한다. '이번 주', '지난 주' 등의 표현을 날짜로 변환.",
        "input_schema": {
            "type": "object",
            "properties": {
                "user_text": {"type": "string", "description": "사용자가 입력한 기간 관련 텍스트"}
            },
            "required": ["user_text"],
        },
    },
    {
        "name": "scan_data",
        "description": "val 데이터 전체를 스캔하여 HIGH 위험 unit 수, 집중 lot/wafer를 반환.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "사용 안 함 (호환용)"},
                "end": {"type": "string", "description": "사용 안 함 (호환용)"},
            },
            "required": [],
        },
    },
    {
        "name": "analyze_features",
        "description": "val 데이터 전체의 HIGH vs LOW 그룹 feature 분포를 비교하여 유의미하게 다른 feature를 반환.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "사용 안 함 (호환용)"},
                "end": {"type": "string", "description": "사용 안 함 (호환용)"},
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
PI(Process Integration 엔지니어)의 요청에 따라 데이터를 분석하고 개선조치 보고서를 작성합니다.

## 흐름 (반드시 순서대로, 각 단계는 딱 한 번만 실행)

1. 기간 추론 후 아래 형식으로 한 줄만 확인 요청:
   → "2025년 06월 23일 ~ 2025년 06월 29일 기간으로 진행할까요?"
   표나 목록 없이 딱 한 문장으로 물어보세요.

2. 확인되면 scan_data → get_importance 순서로 실행 후 결과 요약:
   바로 데이터를 스캔하겠습니다!

   📊 스캔 결과
   - 총 unit: N개
   - HIGH 위험: M개 (X%)
   - MED: M개 / LOW: M개
   - 집중 LOT: LOT_XXX (HIGH N개)
   - 집중 웨이퍼: LOT_XXX-WF_YY (HIGH N개)

   📋 주요 Feature TOP5
   - 1위: X234 (gain: 0.XXX)
   - 2위: X891 (gain: 0.XXX)
   - 3위: X102 (gain: 0.XXX)
   - 4위: X445 (gain: 0.XXX)
   - 5위: X778 (gain: 0.XXX)

3. analyze_features 실행 후 결과를 아래처럼 텍스트로 요약:
   → "🔬 원인 분석 (HIGH vs MED): HIGH 그룹에서 X234가 MED 대비 2.3배 높음(p=0.001), ..."
   LOW 그룹이 없으면 MED와 비교했음을 명시. 그 후 "위 내용으로 보고서를 작성할까요?" 확인

4. 확인되면 아래 태그 한 줄만 출력하세요. HTML을 직접 작성하지 마세요:
   <<<HTML_REPORT>>>
   시스템이 자동으로 PPTX와 동일한 레이아웃의 HTML 보고서를 생성합니다.

## 절대 금지 사항

- **이미 실행한 tool은 절대 다시 실행하지 마세요.**
  대화 이력에 scan_data 결과가 있으면 scan_data를 다시 호출하지 않습니다.
  대화 이력에 get_importance 결과가 있으면 get_importance를 다시 호출하지 않습니다.
  대화 이력에 analyze_features 결과가 있으면 analyze_features를 다시 호출하지 않습니다.
- **보고서 작성 요청이 오면**: 이미 수집된 데이터로 바로 HTML을 생성하세요. tool을 다시 실행하지 마세요.
- **같은 내용을 두 번 출력하지 마세요.** 스캔 결과나 feature 목록이 이미 출력됐으면 반복하지 않습니다.

## 보고서 생성 규칙

보고서 작성 확인을 받으면 <<<HTML_REPORT>>> 태그 한 줄만 출력하세요.
HTML을 직접 작성하지 마세요. 시스템이 자동으로 생성합니다.

## 버튼 태그 규칙 (필수)

PI에게 선택을 요청할 때는 반드시 아래 태그를 텍스트 끝에 붙이세요:
<<<BUTTONS: 버튼1, 버튼2, 버튼3>>>

예시:
- 기간 확인: "2025년 06월 23일 ~ 06월 29일로 진행할까요?\n<<<BUTTONS: 확인, 기간 변경>>>"
- 분석 후 확인: "위 내용으로 보고서를 작성할까요?\n<<<BUTTONS: 보고서 작성, 다른 feature 보기, 기간 변경>>>"
- 선택지 제시: "어떻게 진행할까요?\n<<<BUTTONS: HIGH vs LOW 분석, HIGH vs MED 분석, feature 중요도만>>>"

버튼은 최대 4개, 각 버튼은 짧고 명확하게 (10자 이내).
태그 없이 질문만 하면 PI가 버튼을 볼 수 없으니 반드시 포함하세요.

## 기타 주의사항
- 수치는 구체적으로 (예: "2.3배 높음", "HIGH 그룹 평균 0.082")
- 한국어로 답변

## HTML 보고서 출력 규칙 (절대 필수)

보고서 작성 확인을 받으면 반드시 아래 한 줄만 출력하세요:

<<<HTML_REPORT>>>

HTML을 직접 작성하지 마세요. 태그만 출력하면 시스템이 자동으로 보고서를 생성합니다.
태그 앞뒤에 다른 텍스트를 넣지 마세요.

## 보고서 수정 명령 인식 (보고서가 이미 열려있는 경우)

보고서 열람 중 PI가 차트나 내용 수정을 요청하면, 아래 태그를 출력하세요.
이 태그는 시스템이 자동으로 파싱하여 HTML 보고서를 재생성합니다.

**차트 수정 명령 예시:**
- "SHAP 상위 5개만 보여줘" → <<<UPDATE_CHART: chart=shap, top_n=5>>>
- "SHAP 상위 10개" → <<<UPDATE_CHART: chart=shap, top_n=10>>>
- "LOT 트렌드 상위 10개만" → <<<UPDATE_CHART: chart=lot, top_n=10>>>
- "LOT 트렌드 20개로 늘려줘" → <<<UPDATE_CHART: chart=lot, top_n=20>>>
- "피처 분포 상위 3개" → <<<UPDATE_CHART: chart=dist, top_n=3>>>

**규칙:**
- chart 값: `shap`(SHAP Value Trend), `lot`(LOT 트렌드), `dist`(피처 분포)
- top_n: 표시할 항목 수 (정수)
- 수정 태그 뒤에 수정 내용을 한 줄 설명하세요: "SHAP 차트를 상위 5개로 축소했습니다."
- 여러 차트 동시 수정은 태그를 여러 줄로 출력하세요.

**명령이 불명확한 경우 (절대 추측 금지):**
- 어떤 차트인지 특정되지 않으면 **반드시 먼저 질문하세요**. 추측해서 여러 차트를 한꺼번에 수정하지 마세요.
- 잘못된 예: "명확하지 않아 두 차트 모두 적용했습니다" → 이렇게 하지 마세요.
- 올바른 예: "어떤 차트를 수정할까요?\n<<<BUTTONS: SHAP 차트, LOT 트렌드, 피처 분포>>>"
- top_n 숫자가 없는 경우도 추측하지 말고 물어보세요: "몇 개로 줄일까요?\n<<<BUTTONS: 3개, 5개, 10개>>>"

**보고서 작성 명령 처리 (절대 규칙):**
- "보고서 작성", "보고서 만들어", "작성해줘" 등의 메시지를 받으면 **tool을 일절 실행하지 말고** 즉시 <<<HTML_REPORT>>> 한 줄만 출력하세요.
- analyze_features가 tool_cache에 없어도 보고서 작성 요청이 오면 tool 실행 없이 바로 보고서를 생성합니다."""


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
        if "infer_period" in cache:
            done.append(f"- infer_period: 완료 → {json.dumps(cache['infer_period'], ensure_ascii=False)}")
        if "scan_data" in cache:
            done.append(f"- scan_data: 완료 → total_units={cache['scan_data'].get('total_units')}, high_count={cache['scan_data'].get('high_count')}")
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

    # "보고서 작성" 계열 메시지는 Claude 없이 코드에서 직접 처리
    _REPORT_TRIGGERS = {"보고서 작성", "작성", "보고서 만들어", "만들어줘", "작성해줘", "보고서 출력", "생성"}
    if any(t in user_message for t in _REPORT_TRIGGERS):
        report_data = {
            "meta": {"title": "Field Health 불량 원인 분석 보고서",
                     "period": tool_cache.get("infer_period", {}).get("label", ""),
                     "model": "Two-Stage Model"},
            "scan":       tool_cache.get("scan_data", {}),
            "importance": tool_cache.get("get_importance", {}),
            "analysis":   tool_cache.get("analyze_features", {}),
            "actions":    [],
        }
        html = build_html(report_data)
        yield {"type": "report_ready", "html": html, "report_data": report_data}
        yield {"type": "done"}
        return

    while True:
        try:
            response = await asyncio.to_thread(
                client.messages.create,
                model=MODEL,
                max_tokens=4096,
                system=_build_system(tool_cache),
                tools=TOOLS,
                messages=messages,
            )
        except anthropic.BadRequestError as e:
            yield {"type": "error", "message": f"API 오류: {e.message if hasattr(e, 'message') else str(e)}"}
            return
        except anthropic.AuthenticationError:
            yield {"type": "error", "message": "API 키가 유효하지 않습니다. .env 파일의 ANTHROPIC_API_KEY를 확인해주세요."}
            return
        except Exception as e:
            yield {"type": "error", "message": f"서버 오류: {str(e)}"}
            return

        # assistant 응답을 history에 추가 (trailing whitespace 제거)
        from anthropic.types import TextBlock
        clean_content = []
        for block in response.content:
            if block.type == "text":
                stripped = block.text.rstrip()
                if stripped:
                    clean_content.append(TextBlock(type="text", text=stripped))
                # 빈 text block은 완전히 제거
            else:
                clean_content.append(block)
        # clean_content가 비었으면 dummy text 넣어 API 오류 방지
        if not clean_content:
            clean_content = [TextBlock(type="text", text=".")]
        messages.append({"role": "assistant", "content": clean_content})

        # 텍스트 블록 처리
        for block in response.content:
            if block.type == "text":
                text = block.text

                # 보고서 초안 완성 감지 (<<<HTML_REPORT>>> 태그)
                if "<<<HTML_REPORT>>>" in text:
                    report_data = {
                        "meta": {"title": "Field Health 불량 원인 분석 보고서",
                                 "period": tool_cache.get("infer_period", {}).get("label", ""),
                                 "model": "Two-Stage Model"},
                        "scan":       tool_cache.get("scan_data", {}),
                        "importance": tool_cache.get("get_importance", {}),
                        "analysis":   tool_cache.get("analyze_features", {}),
                        "actions":    [],
                    }
                    html = build_html(report_data)
                    yield {"type": "report_ready", "html": html, "report_data": report_data}
                # 차트 수정 명령 감지: <<<UPDATE_CHART: chart=shap, top_n=5>>>
                elif "<<<UPDATE_CHART:" in text:
                    # 태그와 일반 텍스트 분리
                    remaining = text
                    clean_text_parts = []
                    while "<<<UPDATE_CHART:" in remaining:
                        before, rest = remaining.split("<<<UPDATE_CHART:", 1)
                        if before.strip():
                            clean_text_parts.append(before.strip())
                        tag_body, remaining = rest.split(">>>", 1) if ">>>" in rest else (rest, "")
                        # 파라미터 파싱: chart=shap, top_n=5
                        params = {}
                        for part in tag_body.split(","):
                            part = part.strip()
                            if "=" in part:
                                k, v = part.split("=", 1)
                                params[k.strip()] = v.strip()
                        # chart_params를 tool_cache에 overlay하여 build_html 호출
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
                    before = parts[0].strip()
                    btn_part = parts[1].split(">>>", 1)
                    buttons = [b.strip() for b in btn_part[0].split(",") if b.strip()]
                    after = btn_part[1].strip() if len(btn_part) > 1 else ""
                    content = (before + "\n" + after).strip()
                    if content:
                        yield {"type": "text", "content": content}
                    if buttons:
                        yield {"type": "confirm", "buttons": buttons}
                else:
                    yield {"type": "text", "content": text}

        # tool_use 처리
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
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
사용자가 보고서의 특정 영역을 선택하고 수정을 요청하면, 적절한 tool을 호출하여 보고서를 수정합니다.

## 보고서 구성
- SHAP Value Trend 차트: 모델이 중요하게 본 feature 상위 N개
- LOT 트렌드 차트: 불량 unit이 집중된 LOT 상위 N개
- 피처 분포 차트: HIGH vs 비교군 feature 분포 비교 상위 N개
- 스캔 요약 테이블: 총 unit, HIGH/MED/LOW 분포, 집중 LOT/웨이퍼
- 원인 분석 텍스트: 각 feature별 HIGH vs 비교군 통계

## 행동 원칙
- 요청이 명확하면 바로 tool을 호출하세요.
- 어떤 차트인지, 몇 개인지 불명확하면 **반드시 먼저 질문**하고 tool을 호출하지 마세요.
- 여러 차트를 동시에 수정하려면 tool을 순차적으로 여러 번 호출하세요.
- 데이터 자체를 바꾸는 요청(예: "X552를 더 높게 만들어줘")은 불가능하다고 솔직하게 말하세요.
- 항상 한국어로 답변하세요."""

REPORT_EDITOR_TOOLS = [
    {
        "name": "update_chart",
        "description": "보고서의 차트 표시 개수(top_n)를 변경하고 새 HTML을 생성한다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "chart": {
                    "type": "string",
                    "enum": ["shap", "lot", "dist"],
                    "description": "수정할 차트. shap=SHAP Value Trend, lot=LOT 트렌드, dist=피처 분포",
                },
                "top_n": {
                    "type": "integer",
                    "description": "표시할 항목 수 (1 이상의 정수)",
                },
            },
            "required": ["chart", "top_n"],
        },
    },
    {
        "name": "ask_clarification",
        "description": "요청이 불명확할 때 사용자에게 선택지를 제시하여 확인한다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "사용자에게 물어볼 질문",
                },
                "buttons": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "선택지 버튼 목록 (최대 4개, 각 10자 이내)",
                },
            },
            "required": ["question", "buttons"],
        },
    },
]


def _run_editor_tool(name: str, inputs: dict, tool_cache: dict):
    """에디터 tool 실행. (yield할 이벤트 dict, tool_result 문자열) 반환."""
    if name == "update_chart":
        chart = inputs["chart"]
        top_n = int(inputs["top_n"])
        import copy
        patched = copy.deepcopy({
            "meta":       {"title": "Field Health 불량 원인 분석 보고서", "model": "Two-Stage Model"},
            "scan":       tool_cache.get("scan_data", {}),
            "importance": tool_cache.get("get_importance", {}),
            "analysis":   tool_cache.get("analyze_features", {}),
            "actions":    [],
            "chart_params": {"chart": chart, "top_n": str(top_n)},
        })
        html = build_html(patched)
        event = {"type": "report_ready", "html": html, "report_data": patched}
        result_str = json.dumps({"ok": True, "chart": chart, "top_n": top_n}, ensure_ascii=False)
        return event, result_str

    if name == "ask_clarification":
        event = {
            "type": "confirm",
            "buttons": inputs.get("buttons", []),
            "_question": inputs.get("question", ""),
        }
        result_str = json.dumps({"ok": True}, ensure_ascii=False)
        return event, result_str

    return {}, json.dumps({"error": f"unknown tool: {name}"})


async def run_report_editor(user_message: str, history: list,
                            tool_cache: dict = None, current_html: str = ""):
    """
    보고서 수정 전용 Agent. tool_use 루프로 Claude가 자율적으로 판단.
    """
    cache = dict(tool_cache) if tool_cache else {}

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

    while True:
        try:
            response = await asyncio.to_thread(
                client.messages.create,
                model=MODEL,
                max_tokens=1024,
                system=REPORT_EDITOR_SYSTEM,
                tools=REPORT_EDITOR_TOOLS,
                messages=messages,
            )
        except Exception as e:
            yield {"type": "error", "message": str(e)}
            return

        from anthropic.types import TextBlock
        clean_content = []
        for block in response.content:
            if block.type == "text":
                stripped = block.text.rstrip()
                if stripped:
                    clean_content.append(TextBlock(type="text", text=stripped))
            else:
                clean_content.append(block)
        if not clean_content:
            clean_content = [TextBlock(type="text", text=".")]
        messages.append({"role": "assistant", "content": clean_content})

        # 텍스트 블록 → 그대로 스트리밍
        for block in response.content:
            if block.type == "text" and block.text.strip():
                yield {"type": "text", "content": block.text.strip()}

        # tool_use 처리
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue

                event, result_str = _run_editor_tool(block.name, block.input, cache)

                if block.name == "ask_clarification":
                    # 질문 텍스트 + 버튼 분리 전송
                    question = event.pop("_question", "")
                    if question:
                        yield {"type": "text", "content": question}
                    yield event   # {"type": "confirm", "buttons": [...]}
                elif event:
                    yield event   # {"type": "report_ready", ...}

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result_str,
                })

            messages.append({"role": "user", "content": tool_results})
            continue

        yield {"type": "done"}
        break
