"""
main.py — FastAPI 백엔드
AI Agent API 서버

실행:
    cd 기업/5_agent/backend
    uvicorn main:app --reload --port 8000
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agent import ask, ask_rag, generate_report, refine_report
from data_loader import (
    get_performance_summary,
    get_prediction_series,
    get_risk_distribution,
    get_top_features,
)
from report_modifier import get_live_data, reset_live_data, interpret_and_apply

app = FastAPI(title="SK Hynix WT Field Health Agent", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 데이터 엔드포인트 ────────────────────────────────────────────────────────

@app.get("/api/performance")
def api_performance():
    return get_performance_summary()


@app.get("/api/risk-distribution")
def api_risk():
    return get_risk_distribution()


@app.get("/api/top-features")
def api_features(n: int = 15):
    return get_top_features(n)


@app.get("/api/predictions")
def api_predictions():
    y_true, y_pred = get_prediction_series()
    import numpy as np
    # 샘플 500개 (y>0 비율 유지)
    nz_idx = (y_true > 0).nonzero()[0]
    z_idx = (y_true == 0).nonzero()[0]
    sample = list(nz_idx[:250]) + list(z_idx[:250])
    return {
        "y_true": y_true[sample].tolist(),
        "y_pred": np.clip(y_pred[sample], 0, None).tolist(),
    }


# ── 채팅 엔드포인트 ──────────────────────────────────────────────��──────────

class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


@app.post("/api/chat/stream")
async def api_chat_stream(req: ChatRequest):
    def generate():
        collected = []

        def stream_cb(text):
            collected.append(text)
            data = json.dumps({"type": "text", "text": text}, ensure_ascii=False)
            yield f"data: {data}\n\n"

        # 스트리밍 텍스트 생성을 위해 순차 실행
        response, updated_history = ask(req.message, history=req.history)
        yield f"data: {json.dumps({'type': 'text', 'text': response}, ensure_ascii=False)}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'history': updated_history}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/chat")
def api_chat(req: ChatRequest):
    try:
        response, updated_history = ask(req.message, history=req.history)
        return {"response": response, "history": updated_history}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err = str(e)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            raise HTTPException(
                status_code=429,
                detail="Gemini API 일일 무료 quota 소진 (20회/일). 내일 UTC 자정 이후 리셋됩니다.",
            )
        raise HTTPException(status_code=500, detail=err)


@app.post("/api/chat/assistant")
def api_chat_assistant(req: ChatRequest):
    """RAG 기반 어시스턴트 — 용어·지표·모델 개념 Q&A"""
    try:
        response, updated_history = ask_rag(req.message, history=req.history)
        return {"response": response, "history": updated_history}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err = str(e)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            raise HTTPException(
                status_code=429,
                detail="Gemini API 일일 무료 quota 소진. 내일 UTC 자정 이후 리셋됩니다.",
            )
        raise HTTPException(status_code=500, detail=err)


# ── 보고서 엔드포인트 ────────────────────────────────────────────────────────

@app.post("/api/report")
def api_report():
    try:
        report = generate_report()
        return {"report": report}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/report/generate")
def api_report_generate():
    """보고서 생성 (마크다운 반환)"""
    try:
        md = generate_report()
        return {"markdown": md}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err = str(e)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            raise HTTPException(status_code=429, detail="Gemini API quota 소진")
        raise HTTPException(status_code=500, detail=err)


class RefineRequest(BaseModel):
    markdown: str
    feedback: str


@app.post("/api/report/refine")
def api_report_refine(req: RefineRequest):
    """피드백 반영 보고서 수정"""
    try:
        md = refine_report(req.markdown, req.feedback)
        return {"markdown": md}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err = str(e)
        if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
            raise HTTPException(status_code=429, detail="Gemini API quota 소진")
        raise HTTPException(status_code=500, detail=err)


class ExportPptRequest(BaseModel):
    markdown: str


@app.post("/api/report/export-ppt")
def api_report_export_ppt(req: ExportPptRequest):
    """AI 보고서 마크다운을 PPT 파일로 변환하여 다운로드"""
    try:
        from ppt_builder import build_text_ppt
        from fastapi.responses import Response
        pptx_bytes = build_text_ppt(req.markdown)
        filename = f"field_health_report_{__import__('datetime').datetime.now().strftime('%Y%m%d_%H%M')}.pptx"
        return Response(
            content=pptx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/report/stream")
def api_report_stream():
    def generate():
        report = generate_report()
        chunk_size = 200
        for i in range(0, len(report), chunk_size):
            chunk = report[i:i + chunk_size]
            data = json.dumps({"type": "text", "text": chunk}, ensure_ascii=False)
            yield f"data: {data}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/report/export-data-ppt")
def api_export_data_ppt():
    """현재 live 데이터(수정 반영) 기반 PPT 생성"""
    import sys as _sys
    import tempfile
    import datetime as _dt

    try:
        # 파일 대신 인메모리 live 데이터 사용 (AI 수정 사항 반영)
        from report_modifier import get_live_data
        data = get_live_data()

        frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
        if frontend_dir not in _sys.path:
            _sys.path.insert(0, frontend_dir)
        from report_v3 import build_ppt  # type: ignore

        with tempfile.NamedTemporaryFile(suffix=".pptx", delete=False) as tmp:
            tmp_path = tmp.name

        build_ppt(data, tmp_path)

        with open(tmp_path, "rb") as f:
            pptx_bytes = f.read()
        os.unlink(tmp_path)

        filename = f"field_health_report_{_dt.datetime.now().strftime('%Y%m%d_%H%M')}.pptx"
        return Response(
            content=pptx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 보고서 데이터 Live 엔드포인트 ────────────────────────────────────────────

@app.get("/api/report/data-live")
def api_report_data_live():
    """인메모리 수정 보고서 데이터 반환 (report_v2.html이 여기서 fetch)"""
    return get_live_data()


class ReportModifyRequest(BaseModel):
    feedback: str
    history: list[dict] = []


@app.post("/api/report/chat-modify")
def api_report_chat_modify(req: ReportModifyRequest):
    """보고서 AI 어시스턴트 — 수정 명령 + 일반 대화 모두 지원"""
    try:
        result = interpret_and_apply(req.feedback, history=req.history)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        err = str(e)
        if "429" in err or "quota" in err.lower():
            raise HTTPException(status_code=429, detail="Gemini API quota 소진")
        raise HTTPException(status_code=500, detail=err)


@app.post("/api/report/reset-data")
def api_report_reset_data():
    """보고서 데이터를 원본으로 초기화"""
    reset_live_data()
    return {"success": True}


# ── 프론트엔드 정적 파일 서빙 (/ui/report_v2.html 등) ──────────────────────────
_frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/ui", StaticFiles(directory=_frontend_dir), name="ui")
