"""다우오피스 계정 인증 (네이티브 통합).

- validate_daou(): 다우 로그인 API 직접 호출로 자격검증 (브라우저 없이 ~0.1s).
    · 200            → 성공
    · PORTAL-0013    → 동시접속(이미 로그인) → 자격 정상 (세션 강제종료 안 함 → 근태 자동화 보호)
    · PORTAL-0004    → 아이디/비번 오류
    · 그 외(캡차 등)  → 실패 처리
- issue_token()/verify_token(): HMAC-SHA256 서명 토큰(무의존성). 만료 포함.

의존성 추가 없이 표준 라이브러리(urllib, hmac)만 사용한다.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
import urllib.error
import urllib.request

from config import settings

logger = logging.getLogger("regulations_chatbot")

_DAOU_LOGIN_PATH = "/api/portal/public/auth/login"


# ===== 서명 토큰 (HMAC-SHA256) =====
def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(body: str) -> str:
    return _b64e(hmac.new(settings.auth_secret.encode(), body.encode(), hashlib.sha256).digest())


def issue_token(login_id: str) -> str:
    """login_id + 만료시각을 담은 서명 토큰 발급."""
    payload = {"u": login_id, "exp": int(time.time()) + settings.auth_token_ttl_seconds}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    return f"{body}.{_sign(body)}"


def verify_token(token: str) -> str | None:
    """토큰 검증 → 유효하면 login_id, 아니면 None."""
    try:
        body, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        payload = json.loads(_b64d(body))
        if int(payload.get("exp", 0)) < time.time():
            return None
        return payload.get("u") or None
    except Exception:
        return None


# ===== 다우 자격검증 =====
def validate_daou(login_id: str, password: str) -> bool:
    """다우 로그인 API 직접 호출로 자격검증. 성공/유효면 True."""
    url = settings.daou_base_url.rstrip("/") + _DAOU_LOGIN_PATH
    body = json.dumps({
        "companyId": settings.daou_company_id, "loginId": login_id,
        "password": password, "captcha": "", "locale": "ko",
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "Origin": settings.daou_base_url.rstrip("/"),
        "Referer": settings.daou_base_url.rstrip("/") + "/login?nextUrl=/",
        "User-Agent": "Mozilla/5.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except urllib.error.HTTPError as e:
        try:
            code = json.loads(e.read().decode("utf-8", "ignore")).get("code", "")
        except Exception:
            code = ""
        if code == "PORTAL-0013":
            return True            # 동시접속 = 자격 정상 (세션 강제종료 안 함)
        if code == "PORTAL-0004":
            return False           # 아이디/비번 오류
        logger.warning("다우 로그인 비정상 응답: code=%s", code)
        return False               # 캡차 등 → 실패 처리
    except Exception as e:
        logger.error("다우 로그인 요청 오류: %s", e)
        return False
