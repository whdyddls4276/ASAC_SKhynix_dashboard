# SK hynix DRAM 불량 예측 대시보드

Wafer Test(WT) 데이터로 DRAM 유닛의 Field Health(RCC) 불량을 예측하고, 그 **원인을 설명하고 보고서까지 만들어주는** 분석 대시보드입니다.

단순 시각화에 그치지 않고 두 개의 AI가 붙어 있습니다 — 실제 데이터를 조회해 원인을 분석하는 **에이전트**와, 반도체 도메인 지식에 답하는 **RAG 어시스턴트**입니다.

---

## 구성

3개 층으로 나뉘며, 실행 시 프로세스는 **2개**입니다.

```
┌─────────────────────────────────────────────┐
│  브라우저 — React 대시보드 (차트 · 챗봇)       │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  Vite 개발 서버          :5173               │
│  JSX 변환 · 번들링 · API 프록시               │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  FastAPI 백엔드          :8000               │
│  ├─ 데이터 API      (CSV/JSON 서빙)          │
│  ├─ 분석 에이전트    (Claude + 도구 9종)      │
│  ├─ RAG 어시스턴트   (Gemini + ChromaDB)     │
│  └─ 보고서 생성      (HTML · PPTX)           │
└─────────────────────────────────────────────┘
```

---

## 주요 기능

### 대시보드 (4개 화면)

| 화면 | 내용 |
|---|---|
| **불량 현황** | 전체 예측 ppm 분포, 위험 등급별 현황, 이상 웨이퍼 탐지 |
| **불량 상세 분석** | 유닛·LOT·웨이퍼 드릴다운, SHAP 기반 원인 피처, 웨이퍼 맵 |
| **공정 인자 진단** | 피처 중요도, 분포 비교, 모델 성능 지표(RMSE 등) |
| **보고서** | 생성된 품질불량개선조치 보고서 열람·편집·PPTX 내보내기 |

### AI 챗봇 (탭 2개)

우측 하단 말풍선을 누르면 열립니다.

**🔧 분석 탭** — Claude 기반 에이전트

실제 CSV·SHAP 데이터를 **직접 조회**해서 답합니다. 답변은 SSE로 스트리밍되고, 어떤 도구를 쓰는 중인지 실시간 표시됩니다.

```
"S22474는 왜 위험해?"        → SHAP 원인 피처 분석
"제일 위험한 LOT 어디야?"     → LOT별 평균 ppm 순위
"X592 분포 보여줘"           → 피처 분포 비교 차트
```

사용 도구 9종: 유닛 조회 · SHAP 분석 · 위험 유닛/LOT/웨이퍼 순위 · 피처 분포 비교 · 피처 중요도 · LOT 등급 분포 · 대표 유닛 추출

여기서 바로 **보고서 생성**까지 이어집니다 (유닛 선택 → 원인 분석 → 보고서 생성 → 열기).

**📚 도메인 Q&A 탭** — Gemini + RAG

벡터 DB에서 관련 문서를 찾아 근거로 삼아 답합니다.

```
"PTE가 뭐야?"                → 사내 용어집 정확 매칭
"Zero-inflated 모델이 뭐야?"  → 논문 기반 개념 설명
"HBM이랑 DDR 차이는?"        → 도메인 지식
```

검색은 **2단계 하이브리드**입니다. ① 질문 속 영문 약어를 용어집과 정확 매칭해 최상단 고정 → ② 나머지는 벡터 의미 검색. 약어 질문에서 엉뚱한 문서가 딸려오는 걸 막는 구조입니다.

---

## 빠른 시작

### 사전 준비

- **Python 3.11**
- **Node.js** (LTS)
- **API 키 2개**
  - [Anthropic](https://console.anthropic.com) — 분석 에이전트용 (선불 충전형)
  - [Google AI Studio](https://aistudio.google.com/apikey) — RAG 어시스턴트용 (무료 등급 있음)

### 설치

```bash
git clone https://github.com/whdyddls4276/ASAC_SKhynix_dashboard.git
cd ASAC_SKhynix_dashboard

# 백엔드
cd backend
pip install -r requirements.txt

# 프론트엔드
cd ../frontend
npm install
```

### 환경변수

`backend/.env` 파일을 만들고:

```
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...
```

> `frontend/.env`는 **필요 없습니다.** 개발 모드에서는 Vite 프록시가 API 요청을 백엔드로 넘깁니다.

### 실행

```bash
start.bat        # Windows — 백엔드(8000) + 프론트엔드(5173) 동시 실행
```

브라우저에서 **http://localhost:5173**

---

## 프로젝트 구조

```
├── backend/                  FastAPI 서버 (:8000)
│   ├── main.py               엔드포인트 (/chat, /chat/assistant, /report/*, /api/data/*)
│   ├── agent.py              Claude 에이전트 루프 · 보고서 에디터
│   ├── tools.py              데이터 조회 도구 (CSV 로딩 · 집계 · SHAP)
│   ├── graphs.py             차트 생성
│   ├── report.py             보고서 HTML · PPTX 빌드
│   ├── rag_client.py         ChromaDB 벡터 검색 (약어 매칭 + 의미 검색)
│   ├── rag_chat.py           Gemini 호출 · RAG 프롬프트 구성
│   └── static/               가공된 데이터 CSV/JSON
│
├── frontend/                 React + Vite (:5173)
│   └── src/
│       ├── pages/            화면 4종 + 웨이퍼맵 · 모델성능
│       ├── components/       ChatBot · ReportModal · Sidebar · TopBar
│       ├── hooks/useCSV.js   CSV 로딩 훅
│       └── utils/dataUrl.js  데이터 경로 헬퍼
│
├── assistant/                독립 실행형 RAG 페이지 (:8002, 선택)
│   ├── main.py               단독 서버 — 대시보드 없이 챗봇만 쓸 때
│   └── vectordb_v2/          ChromaDB 벡터 DB (47MB)
│
└── start.bat                 백엔드 + 프론트엔드 동시 실행
```

> `assistant/` 폴더는 RAG가 백엔드로 통합되기 전의 독립 실행 버전입니다. 벡터 DB는 이 폴더에 그대로 두고 백엔드가 참조하며, 대시보드 없이 챗봇만 띄우고 싶을 때 폴백으로 쓸 수 있습니다.

---

## 데이터

`backend/static/`에 가공 완료된 데이터가 들어 있습니다 (약 150MB).

| 파일 | 내용 |
|---|---|
| `dashboard_units.csv` | 유닛별 예측 ppm · 등급 · 포지션별 피처 |
| `wafer_map.csv` | 웨이퍼 die 단위 예측값 |
| `shap_beeswarm.csv` / `shap_unit.json` | SHAP 값 (전역 / 유닛별) |
| `feature_importance.csv` | 피처 중요도 |
| `feature_dist.csv` | 피처 분포 |
| `dashboard_lot_summary.csv` | LOT별 집계 |
| `trend_data.csv` / `grade_trend.csv` | 주차별 추이 |

데이터 갱신 방법은 [DATA_UPDATE_GUIDE.md](DATA_UPDATE_GUIDE.md) 참고.

---

## RAG 지식베이스

`assistant/vectordb_v2/` — ChromaDB, **청크 7,935개**, 384차원
임베딩 모델: `paraphrase-multilingual-MiniLM-L12-v2` (한국어·영어 동시 지원)

| 카테고리 | 청크 | 내용 |
|---|---:|---|
| `ml_paper` | 3,111 | ML 논문 (Zero-Inflated, CatBoost, Tabular 학습, 수율 예측) |
| `arxiv` | 1,253 | arXiv 논문 |
| `mentor_pptx` | 1,165 | DRAM 소자·공정 교육자료 |
| `wiki` | 1,012 | 위키백과 (DDR SDRAM, Flash memory, Reliability 등) |
| `paper_summary` | 300 | 논문 요약서 46편 |
| `glossary` | 296 | DRAM 용어집 |
| `skhynix_insight` / `news` | 506 | 뉴스룸 · IR 자료 |
| 기타 | 292 | RAG 참고자료 · JEDEC 표준 |

---

## 기술 스택

**백엔드** — FastAPI · pandas · numpy · scipy · matplotlib · python-pptx
**AI** — Anthropic Claude (분석 에이전트) · Google Gemini (RAG) · ChromaDB · sentence-transformers
**프론트엔드** — React 19 · Vite 8 · ECharts · react-markdown · PapaParse

**포트**

| 포트 | 용도 |
|---|---|
| 5173 | 대시보드 (Vite) |
| 8000 | 백엔드 API |
| 8002 | 독립 RAG 페이지 (선택) |

---

## 문제 해결

**`node을(를) 찾을 수 없습니다`**
Node.js 설치 직후라면 이미 열려 있던 창(탐색기 포함)이 옛 PATH를 들고 있습니다. **재부팅** 후 다시 실행하세요.

**`uvicorn을(를) 찾을 수 없습니다`**
`pip`가 설치한 Scripts 폴더가 PATH에 없습니다. `C:\Users\<사용자>\AppData\Roaming\Python\Python311\Scripts`를 PATH에 추가하거나, `python -m uvicorn main:app --port 8000`으로 실행하세요.

**화면은 뜨는데 숫자가 하나도 안 나옴**
백엔드(8000)가 죽어 있습니다. `start.bat`이 띄운 두 창 중 백엔드 창의 에러 메시지를 확인하세요.

**도메인 Q&A 첫 질문이 50초쯤 걸림**
정상입니다. 임베딩 모델(약 500MB)을 그때 메모리에 올립니다. 서버 기동 속도를 유지하려는 의도적 설계이며, 이후 질문은 3초 내외입니다.

**`Gemini API quota 소진`**
무료 등급 한도 초과입니다. UTC 자정 이후 리셋됩니다. 이 경우에도 **분석 탭은 정상 동작합니다** (Claude를 사용).
