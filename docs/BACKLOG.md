# 취업규칙 챗봇 — 개선 백로그

> devops_agent 프로젝트 분석 기반 도출 (2026-06-11)
> 완료된 항목은 [CHANGELOG.md](./CHANGELOG.md) 로 이동

---

## 우선순위 기준

| 기호 | 난이도 |
|------|--------|
| ⭐ | 낮음 (수 시간 이내) |
| ⭐⭐ | 중간 (반나절 ~ 하루) |
| ⭐⭐⭐ | 높음 (2일 이상) |

---

## 🔴 즉시 적용 (난이도 낮음, 효과 높음)

### BL-001 · 세션 자동 정리 스케줄러 ⭐
- **문제**: `cleanup_expired()` 메서드는 있지만 호출하는 곳이 없어 만료 세션/메시지가 무한정 쌓임
- **해결**: APScheduler로 6시간마다 자동 호출
- **파일**: `api/main.py` lifespan에 추가
- **참고**: devops_agent `monitoring_agent.py` APScheduler 패턴

### BL-002 · 메시지 복사 버튼 ⭐
- **문제**: assistant 응답을 클립보드에 복사할 방법 없음
- **해결**: 버블 hover 시 Copy 아이콘 버튼 표시 → `navigator.clipboard.writeText()`
- **파일**: `frontend/src/components/MessageBubble.tsx`

### BL-003 · 응답 출처(Citation) 표시 ⭐⭐
- **문제**: 어떤 문서 어떤 조항 기반인지 불투명
- **해결**: RAG retriever의 `source_documents` 파일명/조항 하단 표시
- **구현**:
  - `rag.py`: `get_chain()` 에서 source_documents 함께 반환
  - `api/routes.py`: SSE `done` 프레임에 `sources` 배열 추가
  - `frontend`: 응답 하단 `📄 참조: 취업규칙 제23조` 형태로 렌더
- **예시**:
  ```
  📄 참조 문서: 취업규칙 제23조, 연차유급휴가.txt
  ```

### BL-004 · 세션 제목 LLM 자동 생성 ⭐⭐
- **문제**: 현재 첫 user 메시지 전체를 제목으로 사용 → 사이드바 가독성 저하
- **해결**: 첫 대화 완료 후 LLM으로 10자 이내 요약 제목 생성
- **구현**:
  - `db.py`: `update_session_title(session_id, title)` 메서드 추가
  - `api/routes.py`: `save_turn` 후 `chat_count == 1` 이면 제목 생성 요청
- **예시**:
  ```
  전: "근로시간은 어떻게 되나요?"
  후: "근로시간 규정"
  ```

---

## 🟡 중기 적용 (난이도 중간)

### BL-005 · 통계 대시보드 페이지 ⭐⭐
- **문제**: `/api/stats`, `/api/token-stats` API는 있지만 보여주는 화면이 없음
- **해결**: React 별도 페이지 추가
- **내용**:
  - 날짜별 사용량 차트 (recharts 또는 Chart.js)
  - 사용자별 대화 수
  - 자주 묻는 질문 Top 10 (session_message 기반)
  - 모델별 토큰 사용량
- **파일**: `frontend/src/components/StatsPage.tsx` 신규

### BL-006 · 채팅 히스토리 검색 ⭐⭐
- **문제**: 과거 대화 내용 재검색 불가
- **해결**: 키워드로 세션/메시지 전문 검색
- **구현**:
  - `db.py`: `search_messages(user_id, keyword)` 메서드 추가
  - `api/routes.py`: `GET /api/search?q=연차` 엔드포인트 추가
  - `frontend`: Sidebar 상단 검색창 추가
- **참고**: devops_agent `ChatHistoryListPage.tsx`

### BL-007 · 질문 재전송 / 응답 재생성 ⭐⭐ ✅
- **문제**: 응답 품질 불만족 시 재시도 불가
- **해결** (구현 완료):
  - **7a 응답 재생성**: assistant 버블 hover → 🔄 → 마지막 턴 삭제 후 같은 질문 재생성
  - **7b 질문 편집(경량)**: user 버블 hover → ✏️ → 마지막 질문 인라인 수정 후 재생성
- **구현**:
  - `db.py`: `delete_last_turn()` — 재생성/편집 시 마지막 턴 삭제(히스토리 오염 방지)
  - `api/schemas,routes`: `ChatRequest.regenerate` 플래그
  - `frontend`: `useChatStore`(`regenerateLast`/`editLastAndResend` + `runStream` 헬퍼),
    `MessageBubble`(재생성·편집 UI), `ChatArea`(마지막 버블에만 연결)
- **후속(미구현)**: 7b 완전판 — 중간 메시지 편집(turn_id 기반 `delete_turns_from`). 수요 발생 시 진행

### BL-008 · 세션 이름 직접 편집 ⭐⭐
- **문제**: 자동 생성 제목이 마음에 안 들어도 수정 불가
- **해결**: 사이드바 세션 더블클릭 → 인라인 편집
- **구현**:
  - `db.py`: `update_session_title()` 추가 (BL-004 와 공유)
  - `api/routes.py`: `PATCH /api/sessions/{id}/title` 엔드포인트
  - `frontend/Sidebar.tsx`: 더블클릭 인라인 input 전환

### BL-009 · 세션 목록 가상 스크롤 ⭐⭐
- **문제**: 세션이 많아지면 DOM 부하 증가
- **해결**: 세션 목록 페이지네이션 또는 가상 스크롤 (TanStack Virtual)
- **파일**: `frontend/src/components/Sidebar.tsx`

### BL-010 · 모바일 반응형 Sidebar 토글 ⭐⭐
- **문제**: 사이드바가 항상 고정 노출 → 모바일 화면 낭비
- **해결**:
  - `md` 이상: 현재 방식 유지
  - `md` 미만: 숨김 + 햄버거 버튼으로 오버레이 토글
- **파일**: `frontend/src/App.tsx`, `frontend/src/components/Sidebar.tsx`
- **참고**: devops_agent `AppLayout.tsx`

---

## 🟢 장기 / 선택 적용 (난이도 높음)

### BL-011 · 다우오피스 계정 인증 ⭐⭐ ✅
- **문제**: X-User-Id 헤더만으로 인증 → 스푸핑 가능, 외부 접근 차단 없음
- **해결 (구현 완료, 2026-06-24)**: 단일 공유비밀번호 대신 **다우오피스 계정 인증으로 승격**
  (개인 식별·공유비번 없음·통계/히스토리 실명 연동). 파일브라우저에서 검증한 직접 HTTP 로그인 재사용.
  ```
  흐름: 다우 ID/PW 입력 → 서버가 다우 로그인 API 직접검증(~0.1s) → 서명토큰 발급 → localStorage 저장
        → 모든 요청 Authorization: Bearer, 서버가 토큰에서 다우 loginId 추출 → user_id
  ```
- **구현**:
  - `api/auth.py` 신규: `validate_daou()`(다우 `POST /api/portal/public/auth/login` 직접검증, PORTAL-0013=동시접속=유효라 **기존 세션 강제종료 안 함** → 근태 자동화 보호), `issue_token()/verify_token()`(HMAC-SHA256, 무의존성)
  - `api/routes.py`: `POST /api/auth/login`, `GET /api/auth/me`, `get_user_id`를 Bearer 토큰 기반으로 전환(`auth_enabled=False`면 X-User-Id 폴백)
  - `config.py`: `auth_enabled / daou_base_url / daou_company_id / auth_secret / auth_token_ttl_seconds`
  - `frontend`: `LoginPage.tsx` 신규, `useUserStore`(token/username), `api.ts`·`streamChat.ts`(Authorization + 401 자동 로그아웃), `App.tsx`(미인증 게이트), `Sidebar`(사용자명+로그아웃)
- **검증**: 토큰 라운드트립·위조거부 OK / 다우 자격검증 0.11s(정상 True, 오류 False) / 프론트 tsc 타입체크 OK
- **운영 주의**:
  - ⚠️ `.env`에 **`AUTH_SECRET`(서명키)** 반드시 설정. `DAOU_COMPANY_ID`도 환경에 맞게.
  - 활성화 = 프론트 `npm run build` + uvicorn 재시작 필요.
  - 기존 X-User-Id(UUID) 세션은 새 식별자(다우 loginId)로 전환되어 분리됨(새 시작).
  - http(8085) 평문 전송이라 내부망 한정 권장.
- **후속(선택)**: 캡차(5회 실패) 대응 — 현재는 실패 처리. 필요 시 Playwright 폴백/안내.

### BL-012 · 규정 문서 업데이트 알림 ⭐⭐⭐
- **문제**: `data/취업규칙/` 파일 변경 시 수동 재시작 필요
- **해결**: watchdog으로 파일 변경 감지 → 자동 재임베딩 → 완료 알림
- **구현**:
  - `watchdog` 라이브러리로 디렉토리 감시
  - 변경 감지 → 백그라운드 재임베딩
  - 완료 시 서버 로그 + (선택) Slack 알림
- **참고**: devops_agent Webhook 패턴

### BL-013 · 프롬프트 인젝션 방어 ⭐⭐⭐
- **문제**: 사용자 입력을 프롬프트 템플릿에 그대로 포함 → 인젝션 가능
- **해결**: 입력 sanitize 미들웨어
  - `</s>`, `[INST]`, `system:`, `<|im_start|>` 등 패턴 필터링
  - 입력 길이 제한 (최대 1,000자)
- **파일**: `api/routes.py` 또는 별도 `api/middleware.py`

### BL-014 · 다국어 UI 지원 ⭐⭐⭐
- **문제**: UI 텍스트 하드코딩 (한국어 전용)
- **해결**: i18n 라이브러리 (react-i18next) 도입
- **우선 지원**: 한국어(기본), 영어

---

## 📊 우선순위 요약표

| ID | 기능 | 난이도 | 예상 효과 | 상태 |
|----|------|--------|----------|------|
| BL-001 | 세션 자동 정리 스케줄러 | ⭐ | DB 비대화 방지 | ✅ 완료 |
| BL-002 | 메시지 복사 버튼 | ⭐ | UX 편의성 | ✅ 완료 |
| BL-003 | 응답 출처(Citation) 표시 | ⭐⭐ | 신뢰도 향상 | ✅ 완료 |
| BL-004 | 세션 제목 자동 생성 | ⭐⭐ | 사이드바 가독성 | ✅ 완료 |
| BL-005 | 통계 대시보드 페이지 | ⭐⭐ | 운영 가시성 | ✅ 완료 |
| BL-006 | 채팅 히스토리 검색 | ⭐⭐ | 재사용성 | ⬜ 대기 |
| BL-007 | 질문 재전송 / 응답 재생성 | ⭐⭐ | UX 편의성 | ✅ 완료 |
| BL-008 | 세션 이름 직접 편집 | ⭐⭐ | 사이드바 편의성 | ✅ 완료 |
| BL-009 | 세션 목록 가상 스크롤 | ⭐⭐ | 성능 | ⬜ 대기 |
| BL-010 | 모바일 반응형 Sidebar | ⭐⭐ | 접근성 | 🚫 리젝 |
| BL-011 | 다우오피스 계정 인증 | ⭐⭐ | 보안 | ✅ 완료 |
| BL-012 | 문서 업데이트 자동 감지 | ⭐⭐⭐ | 운영 편의 | ⬜ 대기 |
| BL-013 | 프롬프트 인젝션 방어 | ⭐⭐⭐ | 보안 | ✅ 완료 |
| BL-014 | 다국어 UI 지원 | ⭐⭐⭐ | 접근성 | ⬜ 대기 |
