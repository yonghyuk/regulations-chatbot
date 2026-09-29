# 사내 규정 RAG 챗봇

사내 규정(취업규칙 등)을 자연어로 질의응답하는 RAG 챗봇입니다.
다우오피스(DaouOffice) 계정으로 로그인하며, 회사명·규정 범위는 `.env`로 설정합니다.
사내 문서를 임베딩해 벡터 검색으로 근거를 찾고, LLM이 한국어로 답변합니다.

## 주요 기능

- **RAG 기반 질의응답**: 사내 규정 문서를 근거로 정확한 답변 생성
- **응답 출처 표시**: 답변에 사용된 문서명·페이지 번호 표시
- **다중 세션 관리**: ChatGPT식 세션 목록 (30일 자동 만료, 6시간마다 정리)
- **세션 제목 자동 생성**: 첫 대화 완료 후 LLM이 사이드바 제목 자동 생성
- **세션 제목 직접 편집**: 사이드바 더블클릭으로 인라인 편집
- **SSE 스트리밍 응답**: 실시간 타이핑 출력
- **다크 / 라이트 테마**: 토글 지원
- **통계 패널**: 토큰 사용량 및 비용 추정 표시
- **임베딩 캐싱**: 문서 해시 감지로 변경 시에만 재임베딩
- **다중 문서 디렉토리**: `data/` 하위 서브디렉토리 구조를 재귀 탐색해 전체 임베딩
- **LLM 스위치**: OpenAI / Google Gemini 중 선택 (`.env`의 `LLM_PROVIDER`)
- **프롬프트 인젝션 방어**: 입력 길이 제한(1,000자) + 패턴 필터링

## 기술 스택

| 영역 | 사용 기술 |
|------|-----------|
| 백엔드 | FastAPI + Python 3.12 |
| 프론트엔드 | React + Vite + TypeScript + Tailwind CSS + Zustand |
| LLM | Google Gemini (`gemini-2.5-flash`) / OpenAI (`gpt-4o-mini`) |
| 임베딩 | HuggingFace `BAAI/bge-m3` |
| 벡터스토어 | Chroma (`langchain-chroma`) |
| RAG 프레임워크 | LangChain |
| 세션 영속화 | SQLite (WAL 모드) |
| 패키지 관리 | uv |

## 프로젝트 구조

```
ai-company-regulations/
├── api/
│   ├── main.py            # FastAPI 앱, lifespan, 세션 정리 스케줄러
│   ├── routes.py          # API 엔드포인트 (세션·채팅·통계·비용)
│   ├── schemas.py         # Pydantic 요청/응답 모델
│   └── sanitize.py        # 프롬프트 인젝션 방어 (패턴 필터)
├── frontend/
│   ├── src/
│   │   ├── components/    # ChatArea, MessageBubble, MessageInput, Sidebar, StatsPanel, RightBar
│   │   ├── stores/        # useChatStore, useUserStore, useThemeStore (Zustand)
│   │   ├── services/      # chatService, streamChat, api (axios)
│   │   └── types/         # chat.types.ts
│   └── dist/              # 빌드 산출물 (FastAPI가 서빙, git 제외)
├── prompts/
│   ├── system.md          # 시스템 프롬프트 (한국어 출력 고정)
│   ├── urls.md            # 전자결재·휴가 신청 URL 테이블
│   └── __init__.py        # load_prompt() 로더
├── data/
│   ├── <규정 폴더>/        # 사내 규정 문서 PDF/TXT/XLSX (git 제외 — 대외비)
│   │   └── .gitkeep
│   ├── .gitkeep
│   └── sessions.db        # 세션 DB (자동 생성, git 제외)
├── chroma_langchain_db/   # 벡터 인덱스 캐시 (자동 생성, git 제외)
├── rag.py                 # RAG 엔진 (문서 로드·임베딩·체인)
├── db.py                  # SessionStore (SQLite CRUD)
├── config.py              # 설정 중앙 관리 (Pydantic Settings)
├── run.sh                 # 실행 스크립트 (build / dev / serve)
├── .env                   # API 키 / 설정 (git 제외)
├── pyproject.toml         # 의존성 정의 (uv)
└── docs/
    ├── CHANGELOG.md       # 변경 이력
    ├── BACKLOG.md         # 기능 백로그
    └── HARNESS.md         # 개발 규칙 (http://IP 호환, 보안 제약)
```

## 실행 방법

### 1. 환경 변수 설정 (`.env`)

```env
# LLM provider 선택: openai 또는 gemini
LLM_PROVIDER=gemini

# 사용할 provider의 키만 입력
GOOGLE_API_KEY=...          # Gemini 사용 시
OPENAI_API_KEY=sk-...       # OpenAI 사용 시

# 포트 (기본값 유지 시 생략 가능)
API_PORT=8085
VITE_DEV_PORT=5173

# 조직 정보 (화면·프롬프트 표시용, 비우면 범용 문구)
COMPANY_NAME=ACME
REGULATION_SCOPE=2024년 개정 취업규칙

# 다우오피스 로그인 인증 (필수)
DAOU_BASE_URL=https://<your-tenant>.daouoffice.com
DAOU_COMPANY_ID=<company-id>
AUTH_SECRET=<openssl rand -hex 32 로 생성>
AUTH_ENABLED=true
AUTH_TOKEN_TTL_SECONDS=28800

# LangSmith 트레이싱 (사용 안 하면 false)
LANGSMITH_TRACING=false
LANGCHAIN_TRACING=false
```

> 전체 목록은 `.env.example` 참고 (`cp .env.example .env`).

### 2. 의존성 설치

```bash
uv sync
```

### 3. 사내 규정 문서 배치

`data/` 하위에 서브디렉토리를 만들고 문서를 넣으면 됩니다. 디렉토리 이름은 자유롭게 지정 가능합니다.

```
data/
├── 취업규칙/
│   └── 취업규칙_2025.pdf
├── 인사규정/
│   └── 인사관리규정.pdf
└── 복리후생/
    └── 복리후생규정.txt
```

> 서브디렉토리 없이 `data/` 바로 아래에 파일을 두어도 동작합니다.
> 문서 조각은 최소 5개 이상이어야 서버가 기동됩니다.

`prompts/urls.md`는 답변에 붙일 전자결재 양식 링크 표입니다. 예시 URL을 자기 조직 링크로 바꿔 쓰세요.

### 4. 프론트엔드 빌드

```bash
./run.sh build
# 또는 직접
cd frontend && npm install && npm run build && cd ..
```

> 이미 `frontend/dist/`가 있으면 생략 가능. 코드 변경 시에만 재빌드.

### 5. 서버 실행

```bash
# 운영 모드 (프론트 + 백엔드 단일 서버, http://서버IP:8085)
./run.sh

# 백그라운드 실행
nohup .venv/bin/python -m uvicorn api.main:app \
  --host 0.0.0.0 --port 8085 > /tmp/chatbot.log 2>&1 &
```

> 첫 실행 시 임베딩 생성에 약 2~3분 소요. 이후 캐시 재사용으로 빠르게 시작.

### 개발 모드 (프론트 핫리로드)

터미널 2개 필요:

```bash
# 터미널 1 — 백엔드 (자동 재시작)
TOKENIZERS_PARALLELISM=false \
.venv/bin/python -m uvicorn api.main:app --host 0.0.0.0 --port 8085 --reload

# 터미널 2 — 프론트엔드 (http://localhost:5173)
cd frontend && npm run dev
```

### 서버 종료

```bash
pkill -f "uvicorn api.main:app"
```

### 로그 확인

```bash
tail -f /tmp/chatbot.log
```

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/health` | 헬스체크 |
| `POST` | `/api/sessions` | 새 세션 생성 |
| `GET` | `/api/sessions` | 세션 목록 (사이드바용) |
| `GET` | `/api/sessions/{id}/messages` | 대화 이력 복원 |
| `PATCH` | `/api/sessions/{id}/title` | 세션 제목 편집 |
| `DELETE` | `/api/sessions/{id}` | 세션 삭제 |
| `POST` | `/api/chat/stream` | 메시지 전송 + SSE 스트리밍 |
| `GET` | `/api/stats` | 세션·메시지 통계 |
| `GET` | `/api/token-stats` | 날짜별 토큰 사용량 |
| `GET` | `/api/cost-estimate` | 이번 달 추정 비용 (KRW) |

SSE 스트리밍 프레임:
- `event: token` — 본문 델타 `{"delta": "..."}`
- `event: sources` — 참조 문서 `{"sources": [...]}`
- `event: done` — 완료 + 토큰 사용량 `{"usage": {...}}`
- `event: title` — 자동 생성된 세션 제목 `{"title": "..."}`
- `event: error` — 에러 메시지 `{"message": "..."}`

## 주요 설정 (`config.py`)

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `llm_provider` | `gemini` | LLM 제공자 (`openai`/`gemini`) |
| `gemini_model` | `gemini-2.5-flash` | Gemini 모델명 |
| `openai_model` | `gpt-4o-mini` | OpenAI 모델명 |
| `embedding_model` | `BAAI/bge-m3` | 임베딩 모델 |
| `data_dir` | `./data` | 문서 루트 디렉토리 (서브디렉토리 재귀 탐색) |
| `retriever_k` | `6` | 검색 시 반환할 문서 수 |
| `api_port` | `8085` | FastAPI 서버 포트 |
| `vite_dev_port` | `5173` | Vite dev 서버 포트 |
| `session_ttl_seconds` | `2592000` | 세션 만료 시간 (30일) |
| `history_context` | `5` | 프롬프트에 주입할 최근 대화 수 |
| `monthly_budget_krw` | `30000` | 월 예산 (KRW, 0이면 비활성) |

설정은 환경 변수(`.env`)로 오버라이드 가능. 예: `RETRIEVER_K=8`, `API_PORT=9000`

## 문서 추가 / 변경

`data/` 하위 아무 서브디렉토리에나 PDF / TXT / XLSX 파일을 추가·수정하면,
다음 서버 시작 시 문서 해시 변경이 자동 감지되어 벡터 인덱스가 재생성됩니다.
재임베딩은 약 2~3분 소요됩니다.

새 서브디렉토리를 추가할 경우 `.gitkeep` 파일을 함께 만들어두면 git에서 빈 폴더가 추적됩니다.

```bash
mkdir data/인사규정
touch data/인사규정/.gitkeep
```

## 보안 주의사항

아래 항목은 절대 git에 커밋하지 않습니다:

| 경로 | 이유 |
|------|------|
| `data/**` (`.gitkeep` 제외) | 대외비 사내 문서 및 직원 대화 내역 |
| `.env` | API 키 포함 |
| `chroma_langchain_db/` | 임베딩 캐시 (용량 큼) |
| `bak/` | 임시 백업 파일 |
| `frontend/dist/` | 빌드 산출물 |

## 라이선스

[MIT](LICENSE)
