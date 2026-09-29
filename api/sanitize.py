"""프롬프트 인젝션 방어 유틸리티 (BL-013).

계층 2: 명백한 인젝션 패턴을 정규식으로 탐지해 422로 거부.
계층 1(길이 제한)은 schemas.py의 ChatRequest Field로 처리.
"""

from __future__ import annotations

import logging
import re

from fastapi import HTTPException

logger = logging.getLogger("regulations_chatbot")

# 명백한 인젝션 시도 패턴
_INJECTION_PATTERNS: list[re.Pattern] = [
    # LLM 특수 토큰
    re.compile(r'</s>', re.IGNORECASE),
    re.compile(r'\[INST\]', re.IGNORECASE),
    re.compile(r'<\|im_start\|>', re.IGNORECASE),
    re.compile(r'<\|im_end\|>', re.IGNORECASE),
    re.compile(r'<\|system\|>', re.IGNORECASE),
    # 시스템 지시 오버라이드 시도
    re.compile(r'\bsystem\s*:', re.IGNORECASE),
    re.compile(r'ignore\s+(above|previous|all\s+previous|prior)\s+(instructions?|prompts?|context)', re.IGNORECASE),
    re.compile(r'(forget|disregard|override)\s+(your|the|all)\s+(instructions?|prompts?|rules?|guidelines?)', re.IGNORECASE),
    re.compile(r'do\s+not\s+follow\s+(your|the|previous)\s+(instructions?|prompts?)', re.IGNORECASE),
    # 역할 전환 유도
    re.compile(r'you\s+are\s+now\s+(a|an|the)\b', re.IGNORECASE),
    re.compile(r'act\s+as\s+(if\s+you\s+are|a|an)\b', re.IGNORECASE),
    re.compile(r'pretend\s+(you\s+are|to\s+be)\b', re.IGNORECASE),
    # 탈옥 키워드
    re.compile(r'\bDAN\b'),
    re.compile(r'\bjailbreak\b', re.IGNORECASE),
    re.compile(r'developer\s+mode', re.IGNORECASE),
]


def check_injection(message: str) -> None:
    """인젝션 패턴 탐지 시 HTTP 422 발생.

    탐지된 패턴은 경고 로그만 남기고 구체적인 패턴은 응답에 노출하지 않는다.
    """
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(message):
            logger.warning("프롬프트 인젝션 시도 탐지 (패턴: %s, 입력 앞 30자: %.30r)",
                           pattern.pattern, message)
            raise HTTPException(
                status_code=422,
                detail="입력 내용에 허용되지 않는 패턴이 포함되어 있습니다.",
            )
