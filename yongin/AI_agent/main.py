"""
FastAPI 앱 진입점.
- POST /chat       : Agent 루프 실행 (SSE 스트리밍)
- POST /report/pptx: 마크다운 → PPTX 변환 후 다운로드
"""
import json
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from agent import run_agent
from report import build_pptx

load_dotenv()

app = FastAPI(title="SK Hynix AI Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    history: list = []
    tool_cache: dict = {}
    context: str = ""        # "report_edit" 이면 보고서 수정 모드
    current_html: str = ""   # 현재 보고서 HTML (수정 컨텍스트)


class ReportRequest(BaseModel):
    report_data: dict = {}
    filename: str = "품질불량개선조치보고서.pptx"


@app.post("/chat")
async def chat(req: ChatRequest):
    """
    Agent 루프를 실행하고 SSE로 이벤트를 스트리밍.
    프론트는 EventSource 또는 fetch + ReadableStream으로 수신.
    """
    async def event_stream():
        try:
            if req.context == "report_edit":
                from agent import run_report_editor
                gen = run_report_editor(req.message, req.history, req.tool_cache, req.current_html)
            else:
                gen = run_agent(req.message, req.history, req.tool_cache)
            async for event in gen:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            error_event = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/report/pptx")
async def generate_pptx(req: ReportRequest):
    """구조화된 report_data로 PPTX 생성."""
    pptx_bytes = build_pptx(req.report_data)
    from urllib.parse import quote
    encoded = quote(req.filename, encoding="utf-8")
    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded}",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    )


@app.options("/report/pptx")
async def pptx_preflight():
    """Preflight 요청 처리."""
    return Response(
        content="",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    )


@app.get("/report/preview")
async def preview_report():
    """개발용: 더미 데이터로 바로 HTML 보고서 반환 (API 비용 없음)."""
    from report import build_html
    dummy = {
        "meta": {"title": "Field Health 불량 예측 분석 보고서 [DEV]",
                 "model": "Two-Stage Model", "val_rmse": "0.005736", "test_rmse": "0.008427"},
        "scan": {
            "total_units": 8749, "high_count": 1823, "high_ratio": 20.8,
            "med_count": 2341, "low_count": 4585,
            "top_lot": 42, "top_lot_high_count": 187,
            "top_wafer": {"lot": 42, "wafer": 3, "high_count": 51},
        },
        "importance": {"features": [
            {"feature": f"X{n}", "lgbm_rank": i+1, "lgbm_gain": 5000 - i*300}
            for i, n in enumerate([1083,739,552,445,102,234,891,778,331,620,
                                    107,883,441,229,756])
        ]},
        "analysis": {
            "compare_group": "MED",
            "high_n": 1823, "low_n": 2341,
            "top_features": [
                {"feature": "X1083", "high_mean": 0.082, "low_mean": 0.035, "ratio": 2.34, "pval": 0.0001, "importance_rank": 1},
                {"feature": "X739",  "high_mean": 0.071, "low_mean": 0.041, "ratio": 1.73, "pval": 0.0003, "importance_rank": 2},
                {"feature": "X552",  "high_mean": 0.065, "low_mean": 0.038, "ratio": 1.71, "pval": 0.0012, "importance_rank": 3},
                {"feature": "X445",  "high_mean": 0.059, "low_mean": 0.037, "ratio": 1.59, "pval": 0.0021, "importance_rank": 4},
                {"feature": "X102",  "high_mean": 0.054, "low_mean": 0.036, "ratio": 1.50, "pval": 0.0045, "importance_rank": 5},
            ],
        },
        "actions": [],
    }
    html = build_html(dummy)
    return Response(content=html, media_type="text/html; charset=utf-8")


@app.get("/health")
def health():
    return {"status": "ok"}
