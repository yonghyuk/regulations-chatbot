"""API 엔드포인트.

세션 식별: 인증 없이 localStorage UUID를 X-User-Id 헤더로 받는다.
스트리밍: SSE(text/event-stream). 델타는 JSON으로 감싸 마크다운 개행 충돌을 막는다.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage

from config import settings
from db import SessionStore
from rag import RagEngine, get_engine

from .auth import issue_token, validate_daou, verify_token
from .sanitize import check_injection
from .schemas import (
    AppInfoResponse,
    ChatRequest,
    CreateSessionResponse,
    LoginRequest,
    LoginResponse,
    MeResponse,
    MessageItem,
    MessagesResponse,
    OkResponse,
    SessionItem,
    SessionListResponse,
    StatsResponse,
    UpdateTitleRequest,
)

logger = logging.getLogger("regulations_chatbot")

router = APIRouter(prefix="/api")

# 세션 저장소 (FastAPI 전역 1개)
store = SessionStore(settings.db_path, settings.db_timeout)


def get_user_id(
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> str:
    """사용자 식별자 추출.

    - auth_enabled(기본): `Authorization: Bearer <token>` 의 서명토큰에서 다우 loginId 추출.
    - auth_enabled=False: 기존 X-User-Id 헤더 방식으로 폴백(롤백 스위치).
    """
    if settings.auth_enabled:
        if authorization and authorization.lower().startswith("bearer "):
            uid = verify_token(authorization[7:].strip())
            if uid:
                return uid
        raise HTTPException(status_code=401, detail="인증이 필요합니다. 다시 로그인해주세요.")
    if not x_user_id or not x_user_id.strip():
        raise HTTPException(status_code=400, detail="X-User-Id header required")
    return x_user_id.strip()


# ===== 앱 정보 (공개 — 로그인 화면 전에도 필요) =====
@router.get("/app-info", response_model=AppInfoResponse)
def app_info():
    """화면 표시용 조직 정보. 비밀값 없음."""
    return AppInfoResponse(
        company_name=settings.company_name,
        regulation_scope=settings.regulation_scope,
    )


# ===== 인증 =====
@router.post("/auth/login", response_model=LoginResponse)
def login(req: LoginRequest):
    """다우오피스 계정으로 로그인 → 서명토큰 발급."""
    username = req.username.strip()
    if not validate_daou(username, req.password):
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    logger.info("로그인 성공: %s", username)
    return LoginResponse(token=issue_token(username), user=username)


@router.get("/auth/me", response_model=MeResponse)
def me(user_id: str = Depends(get_user_id)):
    """현재 로그인 사용자 확인 (토큰 유효성 점검용)."""
    return MeResponse(user=user_id)


# ===== 세션 =====
@router.post("/sessions", response_model=CreateSessionResponse)
def create_session(user_id: str = Depends(get_user_id)):
    """새 채팅 세션 생성 (기존 세션은 유지 — ChatGPT식)."""
    session_id = store.create_session(user_id, settings.session_ttl_seconds)
    return CreateSessionResponse(session_id=session_id)


@router.get("/sessions", response_model=SessionListResponse)
def list_sessions(user_id: str = Depends(get_user_id)):
    """사이드바용 세션 목록 (최근 활동순)."""
    rows = store.list_sessions(user_id)
    sessions = [
        SessionItem(
            session_id=r["session_id"],
            title=r.get("title") or "새 대화",
            created_at=str(r["created_at"]),
            last_activity=str(r["last_activity"]),
            chat_count=r["chat_count"],
        )
        for r in rows
    ]
    return SessionListResponse(sessions=sessions)


@router.get("/sessions/{session_id}/messages", response_model=MessagesResponse)
def get_messages(session_id: str, user_id: str = Depends(get_user_id)):
    """세션의 대화 이력 (화면 복원용). 소유자만 조회 가능."""
    if not store.session_belongs_to(session_id, user_id):
        raise HTTPException(status_code=404, detail="Session not found")
    rows = store.get_session_messages(session_id)
    messages = [
        MessageItem(
            role=r["role"],
            content=r["content"],
            created_at=str(r["created_at"]),
            tokens_input=r.get("tokens_input", 0) or 0,
            tokens_output=r.get("tokens_output", 0) or 0,
        )
        for r in rows
    ]
    return MessagesResponse(session_id=session_id, messages=messages)


@router.patch("/sessions/{session_id}/title", response_model=OkResponse)
def update_title(session_id: str, req: UpdateTitleRequest, user_id: str = Depends(get_user_id)):
    """세션 제목 직접 편집 (소유자만)."""
    if not store.session_belongs_to(session_id, user_id):
        raise HTTPException(status_code=404, detail="Session not found")
    store.update_session_title(session_id, req.title.strip())
    return OkResponse(ok=True)


@router.delete("/sessions/{session_id}", response_model=OkResponse)
def delete_session(session_id: str, user_id: str = Depends(get_user_id)):
    """세션 삭제 (소유자만)."""
    ok = store.delete_session(session_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return OkResponse(ok=True)


# ===== 채팅 (SSE 스트리밍) =====
@router.post("/chat/stream")
def chat_stream(req: ChatRequest, user_id: str = Depends(get_user_id)):
    """메시지 전송 + SSE 스트리밍 응답.

    프레임:
      event: token  data: {"delta": "..."}   — 본문 델타 (JSON 인코딩, 개행 안전)
      event: done   data: {"usage": {...}}   — 완료 + 토큰 사용량
      event: error  data: {"message": "..."} — 에러
    """
    # 계층 1: 길이 제한 — schemas.py Field(max_length=1000) 에서 처리
    # 계층 2: 프롬프트 인젝션 패턴 탐지
    check_injection(req.message)

    # 세션 소유 검증 (없으면 새로 만들지 않고 거부 — 프론트가 먼저 create)
    if not store.session_belongs_to(req.session_id, user_id):
        raise HTTPException(status_code=404, detail="Session not found")

    # 재생성(BL-007a): 마지막 턴을 먼저 삭제해 히스토리 중복 주입 방지
    if req.regenerate:
        store.delete_last_turn(req.session_id)

    engine = get_engine()
    history_text = store.get_history_text(req.session_id, settings.history_context)

    # 문서 검색 1회 → context + sources 동시 확보 (체인과 출처 표시에 재사용)
    context_str, sources = engine.retrieve_with_sources(req.message)
    chain = engine.get_chain_with_context(history_text, context_str)

    def event_gen():
        partial = ""
        aggregate = None
        try:
            for chunk in chain.stream(req.message):
                delta = getattr(chunk, "content", "") or ""
                partial += delta
                aggregate = chunk if aggregate is None else aggregate + chunk
                if delta:
                    yield f"event: token\ndata: {json.dumps({'delta': delta}, ensure_ascii=False)}\n\n"

            usage = RagEngine.extract_usage(getattr(aggregate, "usage_metadata", None))
            if not getattr(aggregate, "usage_metadata", None):
                logger.warning("토큰 usage_metadata 미수신 (0으로 저장)")

            # 턴 저장 (대화 + 토큰)
            store.save_turn(
                req.session_id, req.message, partial,
                tokens_input=usage["tokens_input"],
                tokens_output=usage["tokens_output"],
                tokens_cached=usage["tokens_cached"],
                turn_model=engine.active_model_name,
            )

            # A안: sources는 스트리밍 시작 전에 이미 확보됨 → done 전에 즉시 전송
            if sources:
                yield f"event: sources\ndata: {json.dumps({'sources': sources}, ensure_ascii=False)}\n\n"

            # done 프레임 (usage만 — sources는 위에서 선전송)
            yield f"event: done\ndata: {json.dumps({'usage': usage}, ensure_ascii=False)}\n\n"

            # 제목 생성: done 이후 동기 블로킹 — 답변·참조파일은 이미 전송 완료된 상태
            # 사용자는 텍스트를 읽는 동안 제목이 타이핑 효과로 나타남
            sess_info = store.get_session_info(req.session_id)
            if sess_info and sess_info.get("chat_count") == 1:
                try:
                    generated_title = _generate_title(engine, req.message)
                    if generated_title:
                        store.update_session_title(req.session_id, generated_title)
                        logger.info("세션 제목 자동 생성: %s → %s", req.session_id[:8], generated_title)
                        yield f"event: title\ndata: {json.dumps({'title': generated_title}, ensure_ascii=False)}\n\n"
                except Exception as e:
                    logger.warning("세션 제목 생성 실패 (폴백 유지): %s", e)

        except Exception as exc:
            logger.error("스트리밍 중 에러: %s", exc, exc_info=True)
            yield f"event: error\ndata: {json.dumps({'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _generate_title(engine: RagEngine, first_message: str) -> str:
    """첫 질문을 LLM으로 10자 이내 제목으로 요약."""
    prompt = (
        f"다음 질문을 10자 이내의 명사형 한국어 제목으로 요약하라. "
        f"숫자/특수문자 없이 핵심 키워드만. 예) '연차휴가 규정', '경조금 신청'\n\n"
        f"질문: {first_message[:200]}\n제목:"
    )
    result = engine.model.invoke([HumanMessage(content=prompt)])
    title = (getattr(result, "content", "") or "").strip().strip('"').strip("'")
    return title[:20]  # 최대 20자 하드컷


# ===== 통계 =====
@router.get("/stats", response_model=StatsResponse)
def get_stats(_user: str = Depends(get_user_id)):
    s = store.get_stats()
    return StatsResponse(**s)


@router.get("/token-stats")
def get_token_stats(
    date_from: str | None = None,
    date_to: str | None = None,
    _user: str = Depends(get_user_id),
):
    return store.get_token_stats(date_from=date_from, date_to=date_to)


@router.get("/cost-estimate")
def get_cost_estimate(_user: str = Depends(get_user_id)):
    """이번 달 추정 비용 (KRW) + 월 예산 대비 사용률.

    USD 단가로 계산 후 usd_to_krw 환율로 원화 환산.
    토큰 단가·환율·예산은 config.py(또는 .env)에서 관리.
    실제 Google AI Studio 청구액과 다를 수 있음 (무료 티어, 프로모션 미반영).
    """
    from datetime import date
    month_start = date.today().replace(day=1).isoformat()

    month_stats = store.get_token_stats(date_from=month_start)
    all_stats   = store.get_token_stats()

    month_input  = sum(r["tokens_input"]  for r in month_stats["by_date"])
    month_output = sum(r["tokens_output"] for r in month_stats["by_date"])
    month_cached = sum(r["tokens_cached"] for r in month_stats["by_date"])

    total_input  = sum(r["tokens_input"]  for r in all_stats["by_date"])
    total_output = sum(r["tokens_output"] for r in all_stats["by_date"])
    total_cached = sum(r["tokens_cached"] for r in all_stats["by_date"])

    if settings.llm_provider == "openai":
        pi, po, pc = (settings.openai_price_input_per_m,
                      settings.openai_price_output_per_m,
                      settings.openai_price_cached_per_m)
    else:
        pi, po, pc = (settings.gemini_price_input_per_m,
                      settings.gemini_price_output_per_m,
                      settings.gemini_price_cached_per_m)

    def to_usd(inp: int, out: int, cached: int) -> float:
        return (inp * pi + out * po + cached * pc) / 1_000_000

    rate = settings.usd_to_krw
    month_usd = to_usd(month_input, month_output, month_cached)
    total_usd = to_usd(total_input, total_output, total_cached)
    month_krw = month_usd * rate
    total_krw = total_usd * rate

    budget_krw = settings.monthly_budget_krw
    budget_pct = round(month_krw / budget_krw * 100, 1) if budget_krw > 0 else None

    return {
        "provider": settings.llm_provider,
        "month_start": month_start,
        "currency": "KRW",
        "usd_to_krw": rate,
        "month": {
            "tokens_input":  month_input,
            "tokens_output": month_output,
            "tokens_cached": month_cached,
            "cost_usd": round(month_usd, 4),
            "cost_krw": round(month_krw),
        },
        "total": {
            "tokens_input":  total_input,
            "tokens_output": total_output,
            "tokens_cached": total_cached,
            "cost_usd": round(total_usd, 4),
            "cost_krw": round(total_krw),
        },
        "budget_krw": budget_krw if budget_krw > 0 else None,
        "budget_used_pct": budget_pct,
        "price_per_m_usd": {"input": pi, "output": po, "cached": pc},
    }
