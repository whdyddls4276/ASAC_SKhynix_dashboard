# 대시보드 전체(React 화면 + FastAPI 백엔드 + RAG + Agent)를 컨테이너 하나로 묶는다.
# 빌드:  docker compose build      실행:  docker compose up      접속:  http://localhost:7860

# ── 1단계: React 빌드 ─────────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# 화면과 API를 같은 서버에서 서빙하므로 API 주소는 상대 경로(".")로 빌드
ENV VITE_API_URL=.
RUN npm run build

# ── 2단계: 백엔드 ─────────────────────────────────────────────
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.hf_cache

# Hugging Face Spaces 규칙대로 uid 1000 사용자로 실행
RUN useradd -m -u 1000 app
WORKDIR /app

# torch는 CPU 전용 빌드를 먼저 설치 — sentence-transformers가 GPU용(수 GB)을 끌어오지 않게
RUN pip install torch==2.12.1 --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

# 임베딩 모델을 이미지 안에 미리 받아 둔다 — 실행 중에는 인터넷 없이 동작
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"
ENV HF_HUB_OFFLINE=1

COPY backend/ backend/
COPY assistant/vectordb_v3/ assistant/vectordb_v3/
COPY --from=frontend /frontend/dist /app/frontend_dist
RUN chown -R app:app /app

USER app
WORKDIR /app/backend
ENV FRONTEND_DIST=/app/frontend_dist \
    PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
