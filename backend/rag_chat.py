"""
rag_chat.py — RAG 기반 도메인 Q&A (Gemini)

벡터 DB에서 관련 문서를 찾아 프롬프트에 붙인 뒤 Gemini에 질의한다.
데이터 조회형 질문(유닛/LOT/SHAP)은 agent.py의 Claude 에이전트가 담당하고,
이쪽은 반도체·ML 도메인 지식 질문을 담당한다.

무거운 의존은 rag_client가 lazy-load 하므로 이 모듈 임포트 자체는 가볍다.
단 google.genai는 여기서 임포트하므로, main.py에서는 함수 안에서 임포트할 것.
"""
import os

from google import genai
from google.genai import types

from rag_client import search as rag_search

MODEL_CANDIDATES = [
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
]

SYSTEM_PROMPT = """당신은 SK Hynix DRAM Wafer Test(WT) 및 Field Health(RCC) 분석 전문 AI 어시스턴트입니다.

역할:
- WT 공정 용어, 피처(X0~X1086), 모델 지표(RMSE·Recall 등), SHAP 해석 등을 알기 쉽게 설명합니다.
- 분류기·회귀 모델의 동작 원리, Two-Stage 모델 구조, Zero-inflated 분포 등 개념을 설명합니다.
- 반도체 DRAM 공정, 웨이퍼 테스트, 패키지 구조, HBM/DDR 등 도메인 지식 질문에 답변합니다.
- 보고서 지표나 차트의 의미를 물어보면 데이터 맥락에 맞게 해석합니다.

지침:
- [참고 문서]가 제공되면, **질문과 실제로 관련 있는 문서인지 반드시 먼저 확인**하세요.
  - 관련 있으면 해당 내용을 활용하세요.
  - 관련 없으면 참고 문서를 무시하고 본인의 반도체·ML 도메인 지식으로 정확하게 답변하세요.
- 참고 문서의 내용이 질문의 답과 다르다고 판단되면, 문서보다 정확한 지식을 우선하세요.
- 참고 문서의 존재 여부, 활용 여부, 언급 여부를 답변에 절대 드러내지 마세요. 그냥 자연스럽게 답변하세요.
- 모르면 모른다고 솔직하게 말하세요.
- 답변은 한국어로, 핵심만 명확하게 작성하세요."""


def _get_client():
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key or key.startswith("your_"):
        raise ValueError("backend/.env에 GEMINI_API_KEY가 설정되지 않았습니다.")
    return genai.Client(api_key=key)


def ask_rag(user_message: str, history: list[dict] | None = None) -> tuple[str, list[dict]]:
    if history is None:
        history = []

    # 1. ChromaDB에서 관련 문서 검색
    chunks = rag_search(user_message, n_results=5)
    if chunks:
        ctx_lines = [
            f"[{i}] ({c['category']}) {c['source']}\n{c['text']}"
            for i, c in enumerate(chunks, 1)
        ]
        context_block = "\n\n=== 참고 문서 ===\n" + "\n\n".join(ctx_lines) + "\n=== 끝 ==="
    else:
        context_block = ""

    prompt = user_message + context_block

    # 2. Gemini 호출 (quota 소진 시 다음 모델로 폴백)
    client = _get_client()
    gemini_history = [
        types.Content(
            role="user" if h["role"] == "user" else "model",
            parts=[types.Part(text=h["content"])],
        )
        for h in history
    ]
    config = types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT)

    response = None
    for model_name in MODEL_CANDIDATES:
        try:
            chat = client.chats.create(model=model_name, config=config, history=gemini_history)
            response = chat.send_message(prompt)
            break
        except Exception as e:
            err = str(e)
            if any(kw in err for kw in ("429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "quota", "404")):
                continue
            raise

    if response is None:
        raise ValueError("Gemini API quota 소진. 내일 UTC 자정 이후 리셋됩니다.")

    candidate = response.candidates[0] if response.candidates else None
    parts = candidate.content.parts if (candidate and candidate.content and candidate.content.parts) else []
    answer = "".join(p.text for p in parts if p.text)

    updated_history = history + [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": answer},
    ]
    return answer, updated_history
