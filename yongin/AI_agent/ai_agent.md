# 프로젝트명: AI 기반 반도체 수율 분석 및 Actionable Report 생성 에이전트

## 1. 프로젝트 목적 (Objective)
PI(Process Engineer)가 대시보드를 통해 수율 이상 징후를 감지했을 때, 즉각적으로 데이터 기반의 심층 분석을 수행하고, 현상 파악부터 개선 조치 및 방어선 구축까지 포함된 전문적인 보고서를 자동 생성함.

## 2. 페르소나 및 핵심 질문 (User Persona & Core Questions)
*   **주요 사용자:** PI (공정 엔지니어링 전문가)
*   **사용자의 핵심 질문 흐름:**
    1.  **문제 파악:** 어떤 Unit/Lot이 불량 위험인가? (Yield Prediction)
    2.  **현상 파악:** 어디서 발생했는가? (Lot ID, Wafer 내 위치, 공정 단계)
    3.  **위험도 평가:** 얼마나 위험한가? (y_pred, Risk Score)
    4.  **원인 분석:** 왜 그렇게 판단했는가? (Key Features, SHAP Value)
    5.  **비교 분석:** 정상 그룹(Good)과 위험 그룹(Bad)의 데이터 분포 차이는 무엇인가?
    6.  **조치 및 방어:** 어떻게 조치해야 하며, 재발 방지를 위한 Interlock 설정값은 무엇인가?

## 3. 에이전트 파이프라인 구조 (Pipeline Architecture)

### Stage 1: 데이터 로딩 및 분석 모듈 (Preset Skills)
*   LLM이 직접 코드를 짜기보다, 검증된 분석 모듈을 호출하여 안정성 확보.
    *   `get_yield_prediction()`: 수율 예측 및 위험 유닛 리스트업.
    *   `spatial_analysis()`: Wafer Map 패턴 분석 (Center, Edge, Tilt 등).
    *   `commonality_analysis()`: 불량 유닛들의 공통 공정/장비/챔버 추적.
    *   `contrastive_analysis()`: Golden Set(정상군) vs Bad Set(위험군) 변수 분포 비교.

### Stage 2: 사고 흐름 기반 분석 (Reasoning Loop)
*   **문제 파악 → 현상 파악 → 연계 분석 → 조치 제안**의 논리 단계를 거침.
*   대시보드에 표현되지 않은 로우 센서 데이터(Raw Sensor Log)까지 쿼리하여 심층 원인 분석.

### Stage 3: 보고서 생성 (Document Assembly)
*   정해진 양식(SOP)에 분석 결과 자동 매핑.
*   시각화 자료(Overlay Chart, Pareto Chart, Wafer Map) 자동 삽입.

## 4. 보고서 필수 포함 내용 (Report Structure)

| 섹션 | 포함 내용 |
| :--- | :--- |
| **1. 요약 (Summary)** | 탐지된 위험 유닛 정보 및 예상 수율 손실량 |
| **2. 현상 분석 (Phenomenon)** | 발생 로트(Lot), 웨이퍼 위치 패턴, 공정 계보(Lineage) |
| **3. 근거 분석 (Root Cause)** | 판단 기여도(Feature Importance), 정상군 대비 변수 이탈 수치 |
| **4. 비교 데이터 (Contrast)** | Good vs Bad 그룹의 변수 분포 Overlay 그래프 및 통계적 유의성 |
| **5. 조치 권고 (Action)** | 파라미터(Recipe) 조정 제안 및 시뮬레이션 결과 |
| **6. 방어선 구축 (Defense)** | Interlock 임계치(Limit) 추천 및 유사 공정 수평 전개 방안 |

## 5. 구현 진행 현황 (Implementation Progress)

### ✅ 완료

#### 백엔드 (FastAPI · port 8080)
| 파일 | 내용 |
|------|------|
| `backend/main.py` | FastAPI 앱, CORS 설정, API 엔드포인트 라우팅 |
| `backend/agent.py` | **google-genai 1.x SDK + gemini-2.5-flash** 기반 AI Agent. function calling 수동 루프, RAG 검색 통합 |
| `backend/data_loader.py` | 예측 결과 CSV 로드, 성능 요약·위험도 분포·피처 임포턴스 반환 |
| `backend/rag_client.py` | ChromaDB 벡터 DB 검색 (paraphrase-multilingual-MiniLM-L12-v2) |

**API 엔드포인트**
- `GET /api/performance` — Val/Test RMSE, 분류기 Recall/Precision/F1, FN·FP 통계
- `GET /api/risk-distribution` — 고/중/저 위험 유닛 분포
- `GET /api/top-features` — 잔차 분석 기반 상위 피처 임포턴스
- `POST /api/chat` — Gemini Agent 챗봇 (RAG 검색 + 모델 데이터 컨텍스트)
- `POST /api/report` — AI 자동 보고서 생성

#### 프론트엔드
| 파일 | 내용 |
|------|------|
| `frontend/dashboard.html` | 메인 대시보드 (KPI 4종, 위험도 분포, 피처 Top15, AI 보고서 생성, 우하단 챗봇 플로팅 버튼) |
| `frontend/report_v2.html` | 보고서 슬라이드 (1280px, A4 landscape PDF 출력) |
| `frontend/report_data.json` | 사전 계산된 보고서 데이터 (prepare_report_data.py로 생성) |

#### 보고서 슬라이드 (`report_v2.html`) 주요 기능
- **불량 현황**: Day 75(6월 11일) 기준 최신 1일치 데이터 — 분석 유닛 수, 예측 불량 개수/불량률
- **로트별 불량률 트렌드**: 가상 75일 시계열(Train 45일 / Val 15일 / Test 15일), x축 날짜 표시, 개선 시뮬레이션 점선
- **SHAP 분석**: 상위 피처의 고위험 기여 방향 (표준화 중앙값 차이 기반)
- **피처 임포턴스 Top 15**: 잔차 예측 중요도
- **위험 집중 Wafer**: lot-wafer별 예측 불량률 테이블
- **고위험 피처 분포**: 고위험 vs 저위험 그룹 박스플롯
- **개선 방안**: 피처 조정 시 y_pred 변화 시뮬레이션
- **PDF 출력**: 🖨 버튼으로 A4 landscape 출력 (zoom 0.74)

#### 데이터 파이프라인
- `prepare_report_data.py`: 예측 결과 → report_data.json 생성
  - 가상 시계열 기준 **test 마지막 1일(Day 75)** 데이터만 지표에 사용
  - PRED_DEFECT_THR: train 실제 불량률(29.2%)로 역산 = 0.003412
  - 고위험 유닛 없는 경우 상위 30% 상대 기준 fallback 처리

#### RAG DB
- ChromaDB (`rag_db/vectordb/hynix_rag`)
- 소스: ml_papers, mentor_pptx, glossary, arxiv, web_articles, 논문요약.md
- 임베딩: paraphrase-multilingual-MiniLM-L12-v2 (다국어)

### 🔧 실행 방법
```
start.bat 더블클릭
  → Backend:  http://localhost:8080
  → Frontend: http://localhost:7700/dashboard.html
```

**포트 변경 이력**: 포트 8000에서 8080으로 변경 (이전 세션의 좀비 소켓 충돌 방지)

### ⏳ 미완료 / 추후 과제
- 실제 SHAP 값(`4_output/residual_analysis2/05_shap_*.png`) 보고서 연동
- 위험 집중 Wafer 섹션: 예측 불량률 0% 케이스(마지막 lot이 clean lot) UI 처리
- 보고서 슬라이드 → 대시보드 챗봇 연동

### 🐛 해결된 이슈
- **챗봇 연결 실패**: 포트 8000 좀비 소켓 → 포트 8080으로 변경, 대시보드 API 주소 동기화
- **Gemini 모델 오류**: `gemini-1.5-flash` 지원 종료 → `google-genai` 신규 SDK + `gemini-2.5-flash`로 마이그레이션
- **Agent 도구 루프**: `automatic_function_calling` 비활성화 후 수동 루프 구현 (실제 agentic behavior 확인)

---

## 6. 시스템 구현 가이드 (Technical Notes for Claude)
1.  **Code Interpreter 활용:** 데이터 분석 시 LLM의 추론 대신 Python 코드 실행 결과값을 우선할 것.
2.  **보안 준수:** 데이터 쿼리 시 스키마 정보를 활용하되, 실제 데이터는 분석 목적으로만 사용할 것.
3.  **오류 복구:** 코드 실행 실패 시 에러 메시지를 분석하여 1회에 한해 코드 수정 및 재실행(Self-Correction) 시도.
4.  **템플릿 엔진:** `python-docx` 또는 Markdown 템플릿을 사용하여 정해진 보고서 양식을 엄격히 준수할 것.