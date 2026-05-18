"""
agent.py
Claude API tool-use 기반 AI Agent
"""
import json
import os
from typing import Any

import anthropic

from data_loader import (
    get_clf_proba_series,
    get_performance_summary,
    get_prediction_series,
    get_risk_distribution,
    get_top_features,
)
from rag_client import search as rag_search

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
MODEL = "claude-sonnet-4-6"

# ── Tool 정의 ────────────────────────────────────────────────────────────────

TOOLS = [
    {
        "name": "get_performance_summary",
        "description": (
            "현재 모델의 RMSE 성능 지표를 반환합니다. "
            "Val/Test RMSE, 분류기(Classifier) Recall·Precision·F1, "
            "FN/FP 샘플의 RMSE, y=0·y>0 각각의 RMSE를 포함합니다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_risk_distribution",
        "description": (
            "테스트 유닛(unit)의 Field Health 위험도(clf_proba) 분포를 반환합니다. "
            "저위험(0~0.2), 중위험(0.2~0.4), 고위험(0.4~1.0) 구간별 유닛 수와 비율을 제공합니다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "get_top_risk_features",
        "description": (
            "잔차 분석에서 도출된 Field Health 예측 오차와 관련된 상위 피처를 반환합니다. "
            "각 피처의 중요도(importance)와 잔차와의 상관계수(corr_with_residual)를 포함합니다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "n": {
                    "type": "integer",
                    "description": "반환할 피처 수 (기본 10)",
                    "default": 10,
                }
            },
            "required": [],
        },
    },
    {
        "name": "search_knowledge_base",
        "description": (
            "반도체/DRAM 도메인 지식 DB를 검색합니다. "
            "특정 피처나 공정 현상에 관련된 반도체 기술 문서, 논문, SK Hynix 자료를 찾습니다."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "검색할 질문 또는 키워드",
                }
            },
            "required": ["query"],
        },
    },
]

# ── Tool 실행 ─────────────────────────────────────────────────────────────────

def run_tool(name: str, inputs: dict) -> Any:
    if name == "get_performance_summary":
        return get_performance_summary()
    elif name == "get_risk_distribution":
        return get_risk_distribution()
    elif name == "get_top_risk_features":
        n = inputs.get("n", 10)
        return get_top_features(n)
    elif name == "search_knowledge_base":
        query = inputs["query"]
        results = rag_search(query, n_results=4)
        return [{"text": r["text"][:600], "source": r["source"], "category": r["category"]} for r in results]
    return {"error": f"unknown tool: {name}"}


# ── Agent 루프 ────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """당신은 SK Hynix DRAM Wafer Test 수율 분석 전문 AI Agent입니다.

역할:
- Field Health(RCC) 예측 모델의 결과를 분석하고 공정 개선 인사이트를 제공합니다
- 제공된 도구(tool)를 활용하여 실제 모델 성능 데이터와 도메인 지식을 기반으로 답변합니다
- 분석 보고서는 세 섹션으로 구성합니다: 현황 분석 / 추천 대응방안 / 예상 결과

중요:
- 수치를 인용할 때는 반드시 도구에서 가져온 실제 값을 사용하세요
- 추론보다 데이터 기반 근거를 우선시하세요
- 보고서는 반도체 공정 엔지니어가 읽을 수 있는 수준으로 작성하세요
"""


def ask(user_message: str, history: list[dict] | None = None, stream_callback=None) -> tuple[str, list[dict]]:
    """
    user_message: 사용자 질문
    history: 이전 대화 목록 [{"role": ..., "content": ...}]
    stream_callback: 스트리밍 텍스트 콜백 (Streamlit에서 사용)
    returns: (assistant_response, updated_history)
    """
    if history is None:
        history = []

    messages = history + [{"role": "user", "content": user_message}]
    full_response = ""

    while True:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        # 텍스트 블록 수집
        text_parts = []
        tool_uses = []

        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
                if stream_callback:
                    stream_callback(block.text)
            elif block.type == "tool_use":
                tool_uses.append(block)

        if text_parts:
            full_response += "".join(text_parts)

        # 모든 tool 결과 계산
        if tool_uses:
            messages.append({"role": "assistant", "content": response.content})

            tool_results = []
            for tool_use in tool_uses:
                result = run_tool(tool_use.name, tool_use.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                })

            messages.append({"role": "user", "content": tool_results})

        if response.stop_reason == "end_turn":
            break
        if response.stop_reason != "tool_use":
            break

    updated_history = history + [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": full_response},
    ]
    return full_response, updated_history


def generate_report() -> str:
    """표준 분석 보고서 생성 (현황 분석 + 추천 대응방안 + 예상 결과)"""
    prompt = """
다음 세 섹션으로 구성된 Field Health 예측 분석 보고서를 작성해주세요.
반드시 도구를 사용하여 실제 데이터를 수집한 뒤 작성하세요.

## 1. 현황 분석
- 모델 성능 지표 (Val RMSE, 분류기 Recall/Precision)
- 테스트 유닛의 위험도 분포 현황
- 주요 예측 오차 패턴

## 2. 추천 대응방안
- 상위 위험 피처 분석 및 공정 개선 방향
- 반도체 도메인 지식 기반 근거 (knowledge base 검색 활용)
- 우선순위별 조치 사항

## 3. 예상 결과
- 대응 방안 실행 시 기대 효과
- RMSE 개선 예상 범위
- 리스크 감소 추정치

각 섹션을 충실하게 작성해주세요. 데이터 수치는 반드시 도구에서 가져온 값을 사용하세요.
"""
    report, _ = ask(prompt)
    return report
