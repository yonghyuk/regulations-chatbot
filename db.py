"""대화 세션 영속화 (SQLite).

기존 메모리(전역 dict) 기반 세션을 SQLite로 영속화한다.
devops_agent 프로젝트의 chat_session + session_message 2테이블 설계를
SQLite로 가볍게 가져왔다. 추가 인프라 없이 stdlib sqlite3만 사용한다.

- 서버 재시작해도 대화가 이어진다.
- 토큰 사용량(input/output/cached)을 기록해 통계를 낼 수 있다.
- Gradio 멀티스레드 대응: WAL 모드 + busy_timeout + connection-per-operation.
"""

from __future__ import annotations

import contextlib
import logging
import sqlite3
import uuid
from typing import Any

logger = logging.getLogger("regulations_chatbot")


# ===== 스키마 (SQLite 문법, 'localtime' = KST 단일 서버) =====
_SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_session (
    session_id    TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    expires_at    TEXT NOT NULL,
    last_activity TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    title         TEXT                                      -- LLM 자동 생성 제목 (NULL이면 첫 질문으로 폴백)
);
CREATE INDEX IF NOT EXISTS idx_cs_user_expires ON chat_session(user_id, expires_at);

CREATE TABLE IF NOT EXISTS session_message (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL,
    role          TEXT NOT NULL,                 -- 'user' | 'assistant'
    content       TEXT NOT NULL,
    turn_id       TEXT,
    tokens_input  INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    tokens_cached INTEGER NOT NULL DEFAULT 0,
    turn_model    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (session_id) REFERENCES chat_session(session_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sm_session_id ON session_message(session_id);
CREATE INDEX IF NOT EXISTS idx_sm_created_at ON session_message(created_at);
"""


class SessionStore:
    """SQLite 기반 세션/메시지 저장소.

    connection-per-operation 패턴으로 thread-safe.
    매 작업마다 새 커넥션을 열고 닫는다(짧은 챗봇 트래픽에 충분히 빠름).
    """

    def __init__(self, db_path: str, timeout: float = 5.0):
        self.db_path = db_path
        self.timeout = timeout
        self._init_schema()

    @contextlib.contextmanager
    def _conn(self):
        """커넥션 컨텍스트매니저: connect → (commit/rollback) → close."""
        conn = sqlite3.connect(self.db_path, timeout=self.timeout)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self):
        """스키마 생성 + WAL 모드 활성화 (최초 1회)."""
        with self._conn() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(_SCHEMA)
            # 기존 DB에 title 컬럼 없으면 추가 (마이그레이션)
            cols = [r[1] for r in c.execute("PRAGMA table_info(chat_session)").fetchall()]
            if "title" not in cols:
                c.execute("ALTER TABLE chat_session ADD COLUMN title TEXT")
                logger.info("chat_session.title 컬럼 마이그레이션 완료")
        logger.info("SessionStore 초기화 완료 (db=%s)", self.db_path)

    # ===== 세션 =====
    def get_or_create_session(self, user_id: str, ttl_seconds: int) -> str:
        """사용자의 활성 세션을 반환하거나 새로 생성.

        활성 세션(expires_at > now)이 있으면 last_activity/expires_at을 갱신해 반환,
        없으면 새 세션(uuid)을 생성한다.
        """
        with self._conn() as c:
            row = c.execute(
                """
                SELECT session_id FROM chat_session
                WHERE user_id = ? AND expires_at > datetime('now','localtime')
                ORDER BY last_activity DESC LIMIT 1
                """,
                (user_id,),
            ).fetchone()

            if row:
                session_id = row["session_id"]
                c.execute(
                    """
                    UPDATE chat_session
                    SET last_activity = datetime('now','localtime'),
                        expires_at = datetime('now','localtime', ?)
                    WHERE session_id = ?
                    """,
                    (f"+{ttl_seconds} seconds", session_id),
                )
                return session_id

            session_id = str(uuid.uuid4())
            c.execute(
                """
                INSERT INTO chat_session (session_id, user_id, expires_at)
                VALUES (?, ?, datetime('now','localtime', ?))
                """,
                (session_id, user_id, f"+{ttl_seconds} seconds"),
            )
            return session_id

    def expire_user_sessions(self, user_id: str) -> None:
        """사용자의 모든 활성 세션을 즉시 만료시킨다 (새 대화 시작용)."""
        with self._conn() as c:
            c.execute(
                """
                UPDATE chat_session
                SET expires_at = datetime('now','localtime')
                WHERE user_id = ? AND expires_at > datetime('now','localtime')
                """,
                (user_id,),
            )

    def get_session_info(self, session_id: str) -> dict[str, Any] | None:
        """세션 정보(대화 수, 생성 시각)를 반환. 없으면 None."""
        with self._conn() as c:
            sess = c.execute(
                "SELECT created_at FROM chat_session WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if not sess:
                return None
            # 대화 수 = assistant 메시지 행 수 (한 턴당 1개)
            cnt = c.execute(
                "SELECT COUNT(*) AS n FROM session_message "
                "WHERE session_id = ? AND role = 'assistant'",
                (session_id,),
            ).fetchone()
            return {
                "session_id": session_id,
                "created_at": sess["created_at"],
                "chat_count": cnt["n"],
            }

    # ===== 메시지 =====
    def save_turn(
        self,
        session_id: str,
        user_msg: str,
        bot_msg: str,
        tokens_input: int = 0,
        tokens_output: int = 0,
        tokens_cached: int = 0,
        turn_model: str | None = None,
    ) -> None:
        """한 턴(질문+답변)을 user 행 + assistant 행으로 저장.

        토큰은 assistant 행에만 기록한다. 같은 turn_id로 묶는다.
        last_activity도 함께 갱신한다.
        """
        turn_id = str(uuid.uuid4())
        with self._conn() as c:
            c.execute(
                "INSERT INTO session_message (session_id, role, content, turn_id) "
                "VALUES (?, 'user', ?, ?)",
                (session_id, user_msg, turn_id),
            )
            c.execute(
                """
                INSERT INTO session_message
                    (session_id, role, content, turn_id,
                     tokens_input, tokens_output, tokens_cached, turn_model)
                VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?)
                """,
                (session_id, bot_msg, turn_id,
                 tokens_input, tokens_output, tokens_cached, turn_model),
            )
            c.execute(
                "UPDATE chat_session SET last_activity = datetime('now','localtime') "
                "WHERE session_id = ?",
                (session_id,),
            )

    def delete_last_turn(self, session_id: str) -> str | None:
        """가장 최근 턴(user+assistant)을 삭제하고 그 user 질문을 반환.

        응답 재생성(BL-007a) 시 호출. 기존 턴을 지워야 get_history_text가
        그 질문/답을 히스토리에 중복 주입하지 않는다. 턴이 없으면 None.
        """
        with self._conn() as c:
            row = c.execute(
                "SELECT turn_id FROM session_message "
                "WHERE session_id = ? AND role = 'assistant' AND turn_id IS NOT NULL "
                "ORDER BY id DESC LIMIT 1",
                (session_id,),
            ).fetchone()
            if not row:
                return None
            tid = row["turn_id"]
            urow = c.execute(
                "SELECT content FROM session_message "
                "WHERE session_id = ? AND turn_id = ? AND role = 'user' "
                "ORDER BY id ASC LIMIT 1",
                (session_id, tid),
            ).fetchone()
            c.execute(
                "DELETE FROM session_message WHERE session_id = ? AND turn_id = ?",
                (session_id, tid),
            )
            return urow["content"] if urow else None

    def get_history_text(self, session_id: str, n_turns: int) -> str:
        """최근 n턴의 대화를 프롬프트용 텍스트로 반환.

        기존 get_chat_history()와 동일한 포맷을 유지한다:
            "사용자: ...\\n조수: ...\\n\\n"
        """
        with self._conn() as c:
            # 최근 n턴(turn_id 기준) 조회 — id 순으로 정렬해 user/assistant 쌍 재구성
            rows = c.execute(
                """
                SELECT role, content, turn_id FROM session_message
                WHERE session_id = ?
                  AND turn_id IN (
                      SELECT turn_id FROM session_message
                      WHERE session_id = ? AND role = 'assistant'
                      ORDER BY id DESC LIMIT ?
                  )
                ORDER BY id ASC
                """,
                (session_id, session_id, n_turns),
            ).fetchall()

        # turn_id별로 user/assistant 묶기
        turns: dict[str, dict[str, str]] = {}
        order: list[str] = []
        for r in rows:
            tid = r["turn_id"]
            if tid not in turns:
                turns[tid] = {}
                order.append(tid)
            turns[tid][r["role"]] = r["content"]

        history_text = ""
        for tid in order:
            user = turns[tid].get("user", "")
            bot = turns[tid].get("assistant", "")
            history_text += f"사용자: {user}\n조수: {bot}\n\n"
        return history_text

    # ===== 통계 =====
    def get_stats(self) -> dict[str, int]:
        """전체 세션 통계 (활성 사용자/세션, 총 세션, 총 대화)."""
        with self._conn() as c:
            active = c.execute(
                """
                SELECT COUNT(DISTINCT user_id) AS users, COUNT(*) AS sessions
                FROM chat_session
                WHERE expires_at > datetime('now','localtime')
                """
            ).fetchone()
            total_sessions = c.execute(
                "SELECT COUNT(*) AS n FROM chat_session"
            ).fetchone()["n"]
            total_chats = c.execute(
                "SELECT COUNT(*) AS n FROM session_message WHERE role = 'assistant'"
            ).fetchone()["n"]
            tokens = c.execute(
                """
                SELECT COALESCE(SUM(tokens_input), 0) AS ti,
                       COALESCE(SUM(tokens_output), 0) AS to_,
                       COALESCE(SUM(tokens_cached), 0) AS tc
                FROM session_message
                """
            ).fetchone()
        return {
            "active_users": active["users"],
            "active_sessions": active["sessions"],
            "total_sessions": total_sessions,
            "total_chats": total_chats,
            "tokens_input": tokens["ti"],
            "tokens_output": tokens["to_"],
            "tokens_cached": tokens["tc"],
        }

    def get_token_stats(
        self,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> dict[str, Any]:
        """날짜별/모델별 토큰 사용량 통계 (devops_agent token-stats 패턴)."""
        where = "WHERE role = 'assistant'"
        params: list[Any] = []
        if date_from:
            where += " AND date(created_at) >= date(?)"
            params.append(date_from)
        if date_to:
            where += " AND date(created_at) <= date(?)"
            params.append(date_to)

        with self._conn() as c:
            by_date = c.execute(
                f"""
                SELECT date(created_at) AS date,
                       COUNT(*) AS chat_count,
                       COALESCE(SUM(tokens_input), 0) AS tokens_input,
                       COALESCE(SUM(tokens_output), 0) AS tokens_output,
                       COALESCE(SUM(tokens_cached), 0) AS tokens_cached
                FROM session_message {where}
                GROUP BY date(created_at) ORDER BY date(created_at)
                """,
                params,
            ).fetchall()
            by_model = c.execute(
                f"""
                SELECT COALESCE(turn_model, 'unknown') AS turn_model,
                       COALESCE(SUM(tokens_input), 0) AS tokens_input,
                       COALESCE(SUM(tokens_output), 0) AS tokens_output,
                       COALESCE(SUM(tokens_cached), 0) AS tokens_cached,
                       COUNT(*) AS count
                FROM session_message {where}
                GROUP BY turn_model ORDER BY count DESC
                """,
                params,
            ).fetchall()

        return {
            "by_date": [dict(r) for r in by_date],
            "by_model": [dict(r) for r in by_model],
        }

    def cleanup_expired(self) -> int:
        """만료된 세션 삭제 (FK CASCADE로 메시지 동반 삭제). 삭제된 세션 수 반환."""
        with self._conn() as c:
            cur = c.execute(
                "DELETE FROM chat_session "
                "WHERE expires_at <= datetime('now','localtime')"
            )
            return cur.rowcount

    # ===== ChatGPT 스타일 UX 지원 (멀티 세션) =====
    def create_session(self, user_id: str, ttl_seconds: int) -> str:
        """항상 새 세션을 생성해 session_id 반환 (ChatGPT '새 채팅').

        get_or_create_session과 달리 기존 활성 세션을 재사용하지 않는다.
        기존 세션은 그대로 살아있어 사이드바 목록에 남는다.
        """
        session_id = str(uuid.uuid4())
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO chat_session (session_id, user_id, expires_at)
                VALUES (?, ?, datetime('now','localtime', ?))
                """,
                (session_id, user_id, f"+{ttl_seconds} seconds"),
            )
        return session_id

    def list_sessions(
        self, user_id: str, include_expired: bool = False
    ) -> list[dict[str, Any]]:
        """사이드바용 세션 목록을 반환 (last_activity 내림차순).

        각 세션의 제목(title)은 가장 오래된 user 메시지(=첫 질문)를 사용한다.
        chat_count는 assistant 메시지 수(=대화 턴 수)다.
        """
        where = "WHERE cs.user_id = ?"
        params: list[Any] = [user_id]
        if not include_expired:
            where += " AND cs.expires_at > datetime('now','localtime')"

        with self._conn() as c:
            rows = c.execute(
                f"""
                SELECT
                    cs.session_id,
                    cs.created_at,
                    cs.last_activity,
                    cs.expires_at,
                    (SELECT COUNT(*) FROM session_message
                       WHERE session_id = cs.session_id AND role = 'assistant') AS chat_count,
                    COALESCE(
                        cs.title,
                        (SELECT content FROM session_message
                           WHERE session_id = cs.session_id AND role = 'user'
                           ORDER BY id ASC LIMIT 1)
                    ) AS title
                FROM chat_session cs
                {where}
                ORDER BY cs.last_activity DESC
                """,
                params,
            ).fetchall()
        return [dict(r) for r in rows]

    def get_session_messages(self, session_id: str) -> list[dict[str, Any]]:
        """화면 복원용 구조화 메시지 배열 (시간순).

        get_history_text(프롬프트용 텍스트)와 달리 원본 메시지를 그대로 반환한다.
        """
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT role, content, created_at,
                       tokens_input, tokens_output, tokens_cached, turn_model
                FROM session_message
                WHERE session_id = ?
                ORDER BY id ASC
                """,
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def session_belongs_to(self, session_id: str, user_id: str) -> bool:
        """세션이 해당 user_id 소유인지 확인 (권한 체크용)."""
        with self._conn() as c:
            row = c.execute(
                "SELECT 1 FROM chat_session WHERE session_id = ? AND user_id = ?",
                (session_id, user_id),
            ).fetchone()
        return row is not None

    def update_session_title(self, session_id: str, title: str) -> None:
        """세션 제목을 갱신한다 (LLM 자동 생성 또는 사용자 직접 편집 공용)."""
        with self._conn() as c:
            c.execute(
                "UPDATE chat_session SET title = ? WHERE session_id = ?",
                (title, session_id),
            )

    def delete_session(self, session_id: str, user_id: str) -> bool:
        """세션 삭제 (소유자 검증 포함). 메시지도 함께 삭제한다.

        FK CASCADE에만 의존하지 않고 메시지를 명시적으로 먼저 삭제한다.
        (PRAGMA foreign_keys가 꺼진 환경에서도 고아 메시지가 남지 않도록 방어)
        """
        with self._conn() as c:
            # 소유자 검증
            owns = c.execute(
                "SELECT 1 FROM chat_session WHERE session_id = ? AND user_id = ?",
                (session_id, user_id),
            ).fetchone()
            if not owns:
                return False
            # 메시지 → 세션 순서로 삭제 (명시적, CASCADE 비의존)
            c.execute("DELETE FROM session_message WHERE session_id = ?", (session_id,))
            c.execute("DELETE FROM chat_session WHERE session_id = ?", (session_id,))
            return True
