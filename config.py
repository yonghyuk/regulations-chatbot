"""애플리케이션 설정 중앙 관리.

코드 곳곳에 흩어진 설정값(모델명, 포트, 검색 개수, 경로 등)을
Pydantic Settings로 모아 .env 또는 환경변수로 제어한다.
타입 검증과 기본값을 한곳에서 관리할 수 있다.
"""


from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # .env의 미정의 키(LANGSMITH 등) 무시
    )

    # ===== LLM 공통 =====
    # provider 스위치: "openai" 또는 "gemini" (.env의 LLM_PROVIDER 로 전환)
    llm_provider: str = "gemini"
    llm_temperature: float = 0.1
    llm_timeout: int = 30          # LLM 호출 타임아웃(초)
    llm_max_retries: int = 3       # LLM 호출 실패 시 재시도 횟수

    # ----- OpenAI -----
    openai_api_key: str = ""               # .env의 OPENAI_API_KEY
    openai_model: str = "gpt-4o-mini"

    # ----- Google Gemini -----
    google_api_key: str = ""               # .env의 GOOGLE_API_KEY
    gemini_model: str = "gemini-2.5-flash"

    # ===== 조직 정보 (프롬프트·화면 표시용) =====
    # 비우면 범용 문구로 표시된다. 예) COMPANY_NAME=ACME, REGULATION_SCOPE=2024년 개정 취업규칙
    company_name: str = ""
    regulation_scope: str = "취업규칙"

    # ===== 임베딩 / RAG =====
    embedding_model: str = "BAAI/bge-m3"
    data_dir: str = "./data"
    # ----- Chroma (현재 벡터스토어) -----
    chroma_dir: str = "./chroma_langchain_db"      # Chroma 영속 디렉토리
    chroma_collection: str = "regulations"         # 컬렉션 이름
    chunk_size: int = 1000
    chunk_overlap: int = 200
    retriever_k: int = 6           # 검색 시 반환할 상위 문서 개수

    # ===== 인증 (다우오피스 계정 로그인) =====
    # 환경 의존 값은 .env에서 주입(필수). 코드에 리터럴을 두지 않는다.
    daou_base_url: str                                # .env: DAOU_BASE_URL (필수)
    daou_company_id: str                              # .env: DAOU_COMPANY_ID (필수)
    auth_secret: str                                  # .env: AUTH_SECRET (토큰 서명키, 필수)
    auth_enabled: bool = True                         # .env: AUTH_ENABLED (False면 X-User-Id 폴백)
    auth_token_ttl_seconds: int = 28800               # .env: AUTH_TOKEN_TTL_SECONDS (초, 기본 8시간)

    # ===== 세션 / 로깅 =====
    session_ttl_seconds: int = 2592000  # 세션 자동 만료(초) = 30일
    history_keep: int = 20             # 세션당 보관할 최근 대화 수
    history_context: int = 5           # 프롬프트에 주입할 최근 대화 수
    log_level: str = "INFO"

    # ===== 세션 영속화 (SQLite) =====
    db_path: str = "./data/sessions.db"   # 세션 DB 파일 (gitignore됨)
    db_timeout: float = 5.0               # sqlite connect timeout(초)
    persist_sessions: bool = True         # False면 메모리 동작으로 폴백(롤백 스위치)

    # ===== LLM 토큰 (스트리밍 usage) =====
    # OpenAI 스트리밍에서 usage_metadata를 받으려면 True 필요. Gemini는 무관.
    openai_stream_usage: bool = True

    # ===== 비용 추정 =====
    # 월 예산 (KRW). 0이면 예산 표시 비활성화. (Google AI Studio 한도와 동일 단위)
    monthly_budget_krw: float = 30000.0       # ₩30,000
    # USD → KRW 환율 (수동 갱신. 환율 API 연동 전까지 고정값 사용)
    usd_to_krw: float = 1380.0
    # Gemini 2.5 Flash 단가 (USD / 1M tokens, 2025-06 기준)
    gemini_price_input_per_m: float = 0.15    # $0.15 / 1M input tokens
    gemini_price_output_per_m: float = 0.60   # $0.60 / 1M output tokens
    gemini_price_cached_per_m: float = 0.04   # $0.04 / 1M cached tokens
    # OpenAI gpt-4o-mini 단가 (USD / 1M tokens)
    openai_price_input_per_m: float = 0.15    # $0.15 / 1M input tokens
    openai_price_output_per_m: float = 0.60   # $0.60 / 1M output tokens
    openai_price_cached_per_m: float = 0.075  # $0.075 / 1M cached tokens

    # ===== FastAPI / 프론트엔드 =====
    api_port: int = 8085                              # FastAPI 서버 포트 (.env의 API_PORT)
    api_host: str = "0.0.0.0"
    vite_dev_port: int = 5173                         # Vite dev 서버 포트 (.env의 VITE_DEV_PORT)
    serve_static: bool = True                         # React 빌드(dist)를 FastAPI가 서빙할지
    # 단일 repo: "./frontend/dist" (기본값)
    # repo 분리(C안) 배포 시: .env에 FRONTEND_DIST=../frontend/dist 추가
    frontend_dist: str = "./frontend/dist"
    # CORS 허용 origin (개발 시 Vite dev 서버). prod 단일서버면 비워도 됨.
    # VITE_DEV_PORT 변경 시 이 값도 자동 반영되도록 property로 관리
    cors_origins: list[str] = []

    @property
    def effective_cors_origins(self) -> list[str]:
        if self.cors_origins:
            return self.cors_origins
        return [
            f"http://localhost:{self.vite_dev_port}",
            f"http://127.0.0.1:{self.vite_dev_port}",
        ]


settings = Settings()
