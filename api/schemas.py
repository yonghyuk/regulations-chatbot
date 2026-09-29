"""API 요청/응답 Pydantic 모델."""

from __future__ import annotations

from pydantic import BaseModel, Field


# ===== 인증 =====
class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)  # 다우 loginId
    password: str = Field(..., min_length=1, max_length=200)


class LoginResponse(BaseModel):
    token: str
    user: str


class MeResponse(BaseModel):
    user: str


# ===== 요청 =====
class CreateSessionRequest(BaseModel):
    # user_id는 X-User-Id 헤더로 받으므로 바디는 비어있어도 됨
    pass


class ChatRequest(BaseModel):
    session_id: str
    message: str = Field(..., min_length=1, max_length=1000)
    regenerate: bool = False  # True면 마지막 턴 삭제 후 같은 질문으로 재생성 (BL-007a)


class UpdateTitleRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=30)


# ===== 응답 =====
class SessionItem(BaseModel):
    session_id: str
    title: str | None = None
    created_at: str
    last_activity: str
    chat_count: int = 0


class SessionListResponse(BaseModel):
    sessions: list[SessionItem]


class CreateSessionResponse(BaseModel):
    session_id: str


class MessageItem(BaseModel):
    role: str
    content: str
    created_at: str
    tokens_input: int = 0
    tokens_output: int = 0


class MessagesResponse(BaseModel):
    session_id: str
    messages: list[MessageItem]


class StatsResponse(BaseModel):
    active_users: int
    active_sessions: int
    total_sessions: int
    total_chats: int
    tokens_input: int
    tokens_output: int
    tokens_cached: int


class OkResponse(BaseModel):
    ok: bool


class AppInfoResponse(BaseModel):
    company_name: str
    regulation_scope: str
