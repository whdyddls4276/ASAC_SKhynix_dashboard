"""
agent.py
Gemini Function Calling 기반 AI Agent (tool_use 루프)
"""
import json
import os

from google import genai
from google.genai import types

from data_loader import (
    get_performance_summary,
    get_risk_distribution,
    get_top_features,
)
from rag_client import search as rag_search


def _get_client():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"), override=True)
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key or key.startswith("your_"):
        raise ValueError(".env 파일에 GEMINI_API_KEY가 설정되지 않았습니다.")
    return genai.Client(api_key=key)


# 우선순위 순서로 시도 (quota 소진 시 다음 모델로 fallback)
MODEL_CANDIDATES = [
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
]

SYSTEM_PROMPT = """당신은 SK Hynix DRAM Wafer Test 수율 분석 전문 AI Agent입니다.

역할:
- Wafer Test(WT) 예측 모델이 도출한 Field Health(RCC) 예측값을 기반으로,
  실제 고객 불량(Field Health 악화)의 원인을 진단하고 공정 개선 방향을 제시합니다.
- 목적은 모델 성능 향상이 아니라, 예측 결과를 활용하여 실제 제품의 Field Health를 개선하는 것입니다.
- 반드시 제공된 도구(tool)를 호출하여 실제 데이터를 확인한 뒤 답변하세요.

중요:
- 수치는 반드시 tool에서 가져온 실제 값을 사용하세요.
- 위험 피처(WT 파라미터)가 공정의 어떤 현상과 연결되는지 도메인 지식을 활용하여 해석하세요.
- RMSE·Recall 등 모델 지표 개선 언급은 지양하고, Field Health 개선과 수율 향상에 집중하세요.
- 공정 엔지니어가 실무에서 바로 활용할 수 있는 수준으로 작성하세요.
- 답변은 한국어로 작성하세요."""


# ── Tool 함수 정의 (docstring이 Gemini에게 설명 역할) ──────────────────────────

def tool_get_performance_summary() -> dict:
    """현재 모델의 RMSE 성능 지표를 반환합니다. Val/Test RMSE, 분류기 Recall/Precision/F1, FN/FP 샘플의 RMSE를 포함합니다."""
    return get_performance_summary()


def tool_get_risk_distribution() -> dict:
    """테스트 유닛의 Field Health 위험도 분포를 반환합니다. 저위험/중위험/고위험 구간별 유닛 수와 비율을 제공합니다."""
    return get_risk_distribution()


def tool_get_top_risk_features(n: int = 10) -> list:
    """잔차 분석에서 도출된 상위 위험 피처를 반환합니다. 각 피처의 중요도(importance)와 잔차 상관계수를 포함합니다."""
    return get_top_features(n)


def tool_search_knowledge_base(query: str) -> list:
    """반도체/DRAM 도메인 지식 DB를 검색합니다. 특정 피처나 공정 현상에 관련된 반도체 기술 문서를 찾습니다."""
    results = rag_search(query, n_results=4)
    return [{"text": r["text"][:600], "source": r["source"], "category": r["category"]} for r in results]


TOOL_FUNCTIONS = {
    # 모델이 tool_ 접두사를 붙이거나 생략할 수 있으므로 양쪽 등록
    "tool_get_performance_summary":  tool_get_performance_summary,
    "tool_get_risk_distribution":    tool_get_risk_distribution,
    "tool_get_top_risk_features":    tool_get_top_risk_features,
    "tool_search_knowledge_base":    tool_search_knowledge_base,
    "get_performance_summary":       tool_get_performance_summary,
    "get_risk_distribution":         tool_get_risk_distribution,
    "get_top_risk_features":         tool_get_top_risk_features,
    "search_knowledge_base":         tool_search_knowledge_base,
}

TOOLS = [
    tool_get_performance_summary,
    tool_get_risk_distribution,
    tool_get_top_risk_features,
    tool_search_knowledge_base,
]


# ── Agent 루프 ────────────────────────────────────────────────────────────────

def ask(
    user_message: str,
    history: list[dict] | None = None,
    stream_callback=None,
) -> tuple[str, list[dict]]:
    if history is None:
        history = []

    client = _get_client()

    # history → Gemini 형식 변환
    gemini_history = []
    for h in history:
        role = "user" if h["role"] == "user" else "model"
        gemini_history.append(
            types.Content(role=role, parts=[types.Part(text=h["content"])])
        )

    config = types.GenerateContentConfig(
        tools=TOOLS,
        system_instruction=SYSTEM_PROMPT,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )

    # quota 소진 시 다음 모델로 fallback
    last_err = None
    response = None
    chat = None
    for model_name in MODEL_CANDIDATES:
        try:
            chat = client.chats.create(
                model=model_name,
                config=config,
                history=gemini_history,
            )
            response = chat.send_message(user_message)
            break
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                last_err = e
                continue
            raise

    if response is None:
        quota_msg = "Gemini API 일일 무료 quota가 소진됐습니다. 내일 다시 시도하거나 Google AI Studio에서 billing을 활성화하세요."
        raise ValueError(quota_msg)

    full_response = ""

    # tool_use 루프: function_call이 없을 때까지 반복
    while True:
        fn_calls = [
            (p.function_call.name, dict(p.function_call.args))
            for p in response.candidates[0].content.parts
            if p.function_call and p.function_call.name
        ]

        if not fn_calls:
            for p in response.candidates[0].content.parts:
                if p.text:
                    full_response += p.text
            break

        # function call 실행 후 결과 반환
        result_parts = []
        for name, args in fn_calls:
            fn = TOOL_FUNCTIONS.get(name)
            if fn:
                result = fn(**args)
            else:
                result = {"error": f"unknown tool: {name}"}

            result_parts.append(
                types.Part.from_function_response(
                    name=name,
                    response={"result": json.dumps(result, ensure_ascii=False, default=str)},
                )
            )

        response = chat.send_message(result_parts)

    updated_history = history + [
        {"role": "user",      "content": user_message},
        {"role": "assistant", "content": full_response},
    ]
    return full_response, updated_history


RAG_SYSTEM_PROMPT = """당신은 SK Hynix DRAM Wafer Test(WT) 및 Field Health(RCC) 분석 전문 AI 어시스턴트입니다.

역할:
- WT 공정 용어, 피처(X0~X1086), 모델 지표(RMSE·Recall 등), SHAP 해석 등을 알기 쉽게 설명합니다.
- 분류기·회귀 모델의 동작 원리, Two-Stage 모델 구조, Zero-inflated 분포 등 개념을 설명합니다.
- 보고서 지표나 차트의 의미를 물어보면 데이터 맥락에 맞게 해석합니다.

지침:
- 제공된 [참고 문서]가 있으면 우선 활용하고, 출처를 간략히 언급하세요.
- 문서가 없으면 반도체·머신러닝 도메인 일반 지식으로 답변하세요.
- 모르면 모른다고 솔직하게 말하세요.
- 답변은 한국어로, 핵심만 명확하게 작성하세요."""


def ask_rag(
    user_message: str,
    history: list[dict] | None = None,
) -> tuple[str, list[dict]]:
    """RAG 기반 어시스턴트 — 지식DB 검색 후 Gemini로 답변 (tool calling 없음)"""
    if history is None:
        history = []

    # ── 1. 지식 DB 검색 ─────────────────────────────────────
    chunks = rag_search(user_message, n_results=5)
    if chunks:
        ctx_lines = []
        for i, c in enumerate(chunks, 1):
            ctx_lines.append(f"[{i}] {c['source']}\n{c['text']}")
        context_block = "\n\n=== 참고 문서 ===\n" + "\n\n".join(ctx_lines) + "\n=== 끝 ==="
    else:
        context_block = ""

    prompt = user_message + context_block

    # ── 2. Gemini 호출 (tools 없음) ──────────────────────────
    client = _get_client()

    gemini_history = []
    for h in history:
        role = "user" if h["role"] == "user" else "model"
        gemini_history.append(
            types.Content(role=role, parts=[types.Part(text=h["content"])])
        )

    config = types.GenerateContentConfig(system_instruction=RAG_SYSTEM_PROMPT)

    last_err = None
    response = None
    for model_name in MODEL_CANDIDATES:
        try:
            chat = client.chats.create(
                model=model_name,
                config=config,
                history=gemini_history,
            )
            response = chat.send_message(prompt)
            break
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
                last_err = e
                continue
            raise

    if response is None:
        raise ValueError("Gemini API 일일 무료 quota가 소진됐습니다. 내일 UTC 자정 이후 리셋됩니다.")

    answer = "".join(
        p.text for p in response.candidates[0].content.parts if p.text
    )

    updated_history = history + [
        {"role": "user",      "content": user_message},
        {"role": "assistant", "content": answer},
    ]
    return answer, updated_history


def refine_report(current_markdown: str, feedback: str) -> str:
    """기존 보고서에 사용자 피드백을 반영하여 수정된 보고서 반환"""
    prompt = f"""다음은 기존 보고서입니다:

{current_markdown}

---
사용자 피드백: {feedback}
---

위 피드백을 반영하여 보고서를 수정해주세요.
- 기존 구조(## 1. / ## 2. / ## 3. 섹션)를 반드시 유지하세요.
- 피드백이 요청하는 부분만 수정하고, 나머지는 그대로 유지하세요.
- 수정된 전체 보고서를 출력하세요."""
    refined, _ = ask(prompt)
    return refined


def generate_report() -> str:
    """Field Health 개선 방향 보고서 생성 (고위험 현황 진단 + 공정 개선 방향 + 기대 효과)"""
    prompt = """
다음 세 섹션으로 구성된 Field Health 개선 방향 보고서를 작성해주세요.
반드시 도구를 사용하여 실제 데이터를 수집한 뒤 작성하세요.

보고서의 목적: 예측 모델이 식별한 고위험 유닛 정보와 주요 WT 위험 인자를 근거로,
실제 Field Health(RCC) 악화를 줄이기 위한 공정 개선 방향을 제시하는 것입니다.
모델 성능(RMSE, Recall 등) 개선은 다루지 않습니다.

## 1. 고위험 현황 진단
- 테스트 유닛의 위험도 분포 (고위험/중위험/저위험 유닛 수·비율)
- 고위험 유닛의 Field Health 악화 수준 및 규모
- 예측 모델이 식별한 주요 위험 WT 파라미터 (상위 피처 목록 및 특성)

## 2. 공정 개선 방향
- 상위 위험 피처별 WT 파라미터가 시사하는 공정 이상 현상 해석
  (knowledge base를 반드시 검색하여 반도체 도메인 근거 제시)
- 각 위험 인자에 대한 구체적 공정 조치 방향 (측정값 편차 축소, 균일도 향상 등)
- 우선순위별 조치 사항 (긴급 / 중기 / 장기)

## 3. 기대 효과
- 공정 개선 시 고위험 유닛 비율 감소 추정
- Field Health 개선 및 고객 클레임 감소 기대 효과
- 수율 향상 관점에서의 사업적 기대치
"""
    report, _ = ask(prompt)
    return report
