"""FastAPI 앱 진입점.

- lifespan: 시작 시 RAG 엔진을 미리 초기화(임베딩 1회).
- CORS: 개발 시 Vite dev 서버 허용 (config 토글).
- static: prod에서 React 빌드(frontend/dist)를 서빙 (serve_static=True).

실행:
  uv run uvicorn api.main:app --host 0.0.0.0 --port 8085 --reload   # 개발
  uv run uvicorn api.main:app --host 0.0.0.0 --port 8085            # 운영
"""

from __future__ import annotations

import asyncio
import datetime
import logging
import os
from contextlib import asynccontextmanager

import dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

dotenv.load_dotenv()

from config import settings
from db import SessionStore
from rag import get_engine

from .routes import router

_CLEANUP_INTERVAL_HOURS = 6  # 세션 정리 주기 (TTL 30일 기준 6시간마다 충분)


# ===== 로깅 (KST) =====
class KSTFormatter(logging.Formatter):
    def formatTime(self, record, datefmt=None):
        ct = datetime.datetime.fromtimestamp(record.created)
        return ct.strftime(datefmt or "%Y-%m-%d %H:%M:%S")


def _setup_logging() -> logging.Logger:
    _logger = logging.getLogger("regulations_chatbot")
    _logger.setLevel(settings.log_level)
    if not _logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            KSTFormatter("%(asctime)s KST  %(levelname)-7s  %(name)s: %(message)s")
        )
        _logger.addHandler(handler)
    return _logger


logger = _setup_logging()


async def _session_cleanup_loop(store: SessionStore) -> None:
    """만료 세션을 주기적으로 정리하는 백그라운드 루프."""
    while True:
        await asyncio.sleep(_CLEANUP_INTERVAL_HOURS * 3600)
        try:
            deleted = store.cleanup_expired()
            if deleted:
                logger.info("세션 자동 정리 완료: %d개 삭제", deleted)
        except Exception as e:
            logger.warning("세션 정리 중 오류 (다음 주기에 재시도): %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시 RAG 엔진 초기화 (임베딩 캐시 로드)
    logger.info(
        "취업규칙 챗봇 API 시작 (provider=%s, port=%d)",
        settings.llm_provider, settings.api_port,
    )
    get_engine()  # 무거운 초기화를 startup에서 1회

    # 세션 자동 정리 스케줄러 (BL-001)
    store = SessionStore(settings.db_path, settings.db_timeout)
    cleanup_task = asyncio.create_task(_session_cleanup_loop(store))
    logger.info("세션 자동 정리 스케줄러 시작 (주기: %dh, TTL: %dd)",
                _CLEANUP_INTERVAL_HOURS, settings.session_ttl_seconds // 86400)

    logger.info("RAG 엔진 준비 완료 — 요청 수신 대기")
    yield

    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    logger.info("취업규칙 챗봇 API 종료")


app = FastAPI(title="취업규칙 챗봇 API", lifespan=lifespan)

# CORS (개발용 — Vite dev 서버)
if settings.effective_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.effective_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# API 라우터
app.include_router(router)


# Health check
@app.get("/health")
def health():
    return {"status": "ok"}


# static 서빙 (prod) — 라우터 뒤에 마운트해야 /api 가 가려지지 않음
if settings.serve_static and os.path.isdir(settings.frontend_dist):
    app.mount(
        "/",
        StaticFiles(directory=settings.frontend_dist, html=True),
        name="static",
    )
    logger.info("React 빌드 static 서빙: %s", settings.frontend_dist)
