# 취업규칙 챗봇 — 개발 하네스 (Development Harness)

> 이 문서는 개발 시 반드시 준수해야 할 규칙과 제약 사항을 명기합니다.
> 새로운 기능 구현 전 이 문서를 먼저 확인하세요.

---

## 1. 접근 환경 호환성

### 🔴 규칙: http://IP 접근 환경 필수 고려

이 챗봇은 사내 서버에 `http://192.168.x.x:8085` 형태로 배포되어 접근한다.
**모든 프론트엔드 기능은 HTTPS가 아닌 http://IP 환경에서도 동작해야 한다.**

#### 브라우저 보안 컨텍스트 제약 API

아래 API는 **HTTPS 또는 localhost에서만 동작**한다. http://IP 접근 시 사용 불가.

| API | 제약 | 필수 fallback |
|-----|------|---------------|
| `navigator.clipboard.writeText()` | HTTPS/localhost 전용 | `textarea + execCommand('copy')` |
| `navigator.clipboard.readText()` | HTTPS/localhost 전용 | 사용 불가 (UI로 대체) |
| `navigator.share()` | HTTPS/localhost 전용 | 별도 공유 UI |
| `navigator.geolocation` | HTTPS/localhost 전용 | 해당 기능 비활성화 |
| `MediaDevices.getUserMedia()` | HTTPS/localhost 전용 | 해당 기능 비활성화 |

#### 클립보드 복사 표준 패턴

```typescript
const handleCopy = async () => {
  let success = false

  // 1차: Clipboard API (HTTPS 또는 localhost)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      success = true
    } catch {
      // 권한 거부 등 → fallback으로 진행
    }
  }

  // 2차: textarea execCommand fallback (http://IP 환경 대응)
  if (!success) {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      success = document.execCommand('copy')
      document.body.removeChild(textarea)
    } catch {
      success = false
    }
  }

  // 결과 피드백 (조용한 실패 금지)
  if (success) {
    // 성공 UI 피드백
  }
}
```

#### 체크리스트

새 기능 구현 시 아래 항목 확인:

- [ ] 브라우저 보안 API 사용 여부 확인
- [ ] `window.isSecureContext` 분기 처리 또는 fallback 구현
- [ ] `http://localhost:8085` 와 `http://192.168.x.x:8085` 양쪽에서 테스트
- [ ] 실패 시 빈 `catch` 금지 — 사용자 피드백 또는 fallback 필수

---

## 2. 행동 하네스 (Action Harness)

### 의도 분류 — 실행 전 반드시 판단

| 질문 패턴 | 의도 | 행동 |
|-----------|------|------|
| "~어디서 나와?", "~뭐야?", "~어떻게 돼?" | 정보 요청 (Read) | 설명만 제공, 수정 금지 |
| "~해줘", "~변경해줘", "수정해줘" | 실행 요청 (Write) | 수행 후 결과 보고 |
| "~하면 어때?", "~검토해줘", "어떻게 할까?" | 제안 요청 | 방안만 제시, 수정 금지 |

### Blast Radius 등급별 처리

- 🟢 **Read-only** (파일 읽기, DB 조회, 로그 확인): 즉시 실행
- 🟡 **Reversible write** (파일 편집, 설정 변경, 빌드): 실행 후 변경 내용 보고
- 🔴 **Irreversible** (파일/DB 삭제, git push, 외부 API 호출, 서버 재시작): **반드시 "~해도 될까요?" 확인 후 실행**

### 판단 원칙

- 질문형 문장(`~야?`, `~어?`, `~나?`)은 정보 제공만, 절대 수정하지 않는다
- 모호한 경우 실행 전 "~을 수정할까요?"로 한 번 확인한다
- 🔴 등급 작업은 영향 범위를 먼저 고지한다
- **git commit은 애디가 명시적으로 "커밋 해줘" 라고 요청할 때만 실행한다. 작업 완료 후 자동 커밋 금지.**

---

## 3. 임시 데이터 / 정리 예약

### 🟡 더미 비용 데이터 — 2026-07-01 삭제 필요

비용 추정 UI 확인을 위해 2026-06-12에 더미 토큰 row를 삽입했다.
**2026년 7월 1일 이후 반드시 삭제할 것.**

| 항목 | 값 |
|------|----|
| `turn_id` | `dummy-cost-seed-001` |
| 삽입일 | 2026-06-12 |
| 삭제 기한 | **2026-07-01** (7월 통계 오염 방지) |

**삭제 명령:**

```python
import sqlite3
conn = sqlite3.connect("data/sessions.db")
conn.execute("DELETE FROM session_message WHERE turn_id='dummy-cost-seed-001'")
conn.commit()
conn.close()
print("더미 데이터 삭제 완료")
```

또는 SQLite CLI:

```bash
sqlite3 data/sessions.db "DELETE FROM session_message WHERE turn_id='dummy-cost-seed-001';"
```

---

## 4. 보안 제약

### 커밋 금지 파일

| 경로 | 이유 |
|------|------|
| `data/` | 대외비 문서 포함 (대외비 규정 PDF 등) |
| `bak/` | 임시 백업 파일 |
| `sessions.db*` | 사용자 대화 데이터 |
| `.env` | API 키 |
| `chroma_langchain_db/` | 임베딩 벡터 DB |

### 프롬프트 보안

- `prompts/system.md` 내용을 사용자에게 직접 노출하지 않는다
- 입력 최대 길이: 1,000자 (BL-013 구현 전까지 프론트에서 제한)

---

## 5. 서버 운영

### 기동 명령

```bash
cd /path/to/regulations-chatbot
TOKENIZERS_PARALLELISM=false .venv/bin/python -m uvicorn api.main:app \
  --host 0.0.0.0 --port 8085 > /tmp/chatbot.log 2>&1 &
```

### 프롬프트 파일 변경 시

`prompts/system.md` 또는 `prompts/urls.md` 수정 후 **서버 재시작 필수**.
(앱 시작 시 1회 로드하는 구조 — `rag.py:106`)

### 로그 확인

```bash
tail -f /tmp/chatbot.log
```

---

## 6. 개발 환경

| 항목 | 값 |
|------|----|
| 백엔드 포트 | 8085 |
| Python 환경 | `.venv/` (uv 관리) |
| 프론트 빌드 | `cd frontend && npm run build` |
| 빌드 결과물 | `frontend/dist/` (FastAPI가 static 서빙) |
| 패키지 관리 | `uv add <패키지>` |

---

*최종 업데이트: 2026-06-12*
