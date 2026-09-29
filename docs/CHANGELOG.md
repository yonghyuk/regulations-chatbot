# 취업규칙 챗봇 — 변경 이력

> 완료된 작업을 날짜 역순으로 기록합니다.
> 진행 중인 작업은 [BACKLOG.md](./BACKLOG.md) 참조

---

## 2026-09-29

### ✅ 의존성 슬림화 + CPU 전용 torch
- **내용**: 코드에서 쓰지 않는 의존성 17개 제거(gradio, faiss-cpu, unstructured, selenium, pinecone 등), 직접 쓰지만 선언이 빠져 있던 `pydantic-settings`·`langchain-text-splitters` 명시, torch를 CPU 전용 휠로 전환(GPU 없는 서버 — CUDA 라이브러리 ~5G 제거)
- **효과**: venv 7.7G → 1.5G, 챗봇 프로세스 swap 사용 해소. bge-m3 임베딩 결과 동일(코사인 1.0) 확인
- **변경 파일**: `pyproject.toml`, `uv.lock`

### ✅ 재시작마다 전체 재임베딩되던 버그 수정
- **원인**: 문서 변경 감지 해시가 `data/` 전체를 훑어 같은 폴더의 `sessions.db`까지 포함 → 채팅만 해도 해시가 바뀌어 재시작 시 캐시 폐기(약 3분 재임베딩)
- **수정**: 해시 대상을 로더가 읽는 문서 형식(.pdf/.txt/.xlsx)으로 한정
- **변경 파일**: `rag.py`
- **참고**: 해시 기준이 바뀌어 적용 직후 첫 재시작은 1회 재임베딩, 이후로는 캐시 사용

### ✅ 죽은 코드 정리
- `config.py` — 레거시 `faiss_index_dir`, Gradio `server_name`/`server_port` 제거
- `README.md` — 삭제된 `my_project.py` 항목 제거
- `api/main.py` — 실행 예시 포트 8084 → 8085

---

## 2026-06-12 (5차)

### ✅ 사이드바 제목 타이핑 스트림 효과
- **내용**: 새 세션 제목이 LLM에서 처음 생성될 때 글자가 하나씩 타이핑되는 스트림 효과
- **동작**: `null → 값` 전환 시 40ms/글자 타이핑, 이후 변경(직접 편집 등)은 즉시 교체
- **변경 파일**:
  - `Sidebar.tsx` — `useAnimatedTitle` → `useStreamingTitle` 훅 교체, `SessionListItem` 내부에서 훅 사용, `fading` 상태 제거
- **커밋**: `b4e629c`

---

## 2026-06-12 (4차)

### ✅ 사이드바 제목 B안 전환 (SSE done 프레임에 title 포함)
- **내용**: 세션 제목을 API 재요청 없이 done 이벤트로 직접 전달 → listSessions() 왕복 제거
- **변경 파일**:
  - `api/routes.py` — done 프레임에 `title` 포함 (첫 턴에만)
  - `streamChat.ts` — done 파싱에 `title` 추가
  - `useChatStore.ts` — done 핸들러에서 sessions 스토어 직접 패치, finally의 listSessions()는 last_activity 갱신 목적만 유지 (title null이면 기존값 보존)
  - `SessionListItem` / `useAnimatedTitle` 수정 없음

---

## 2026-06-12 (3차)

### ✅ Citation·사이드바 제목 변경 트랜지션 (A안)
- **문제**: 참조 배지와 사이드바 제목이 순간적으로 팝업/교체되는 UX 불편
- **해결**: 페이드인/페이드아웃 트랜지션 적용
- **변경 파일**:
  - `MessageBubble.tsx` — `SourceBadges` 마운트 시 80ms 딜레이 후 `opacity-0 → opacity-100` (500ms)
  - `Sidebar.tsx` — `useAnimatedTitle` 훅: 제목 변경 감지 시 fade-out(150ms) → 교체 → fade-in(300ms), `SessionListItem` 컴포넌트 분리
  - `chat.types.ts` — `StreamEvent done`에 `title?: string` 필드 추가 (B안 전환 대비)
- **B안 전환 시 추가 작업**:
  - `api/routes.py`: done 프레임에 `title` 포함
  - `streamChat.ts`: done 파싱에 `title` 추가
  - `useChatStore.ts`: done 핸들러에서 `sessions` 스토어의 해당 세션 title 직접 업데이트
  - `SessionListItem` / `useAnimatedTitle`은 수정 불필요

---

## 2026-06-12 (2차)

### ✅ 세션 TTL 30일로 연장
- **변경**: `config.py` `session_ttl_seconds` 86400(24h) → 2592000(30일)
- **이유**: ChatGPT식 히스토리 유지 UX, 사내 소규모 트래픽에서 DB 용량 무리 없음

### ✅ 세션 자동 정리 스케줄러 — BL-001
- **내용**: 만료 세션을 6시간마다 자동 삭제 (APScheduler 미사용, asyncio 루프)
- **변경 파일**:
  - `api/main.py` — `_session_cleanup_loop()` 코루틴 + lifespan에 `create_task/cancel`
  - 오류 발생 시 다음 주기에 재시도 (예외 무시 없음)

### ✅ 세션 제목 LLM 자동 생성 — BL-004
- **내용**: 첫 대화 완료 후 LLM이 10자 이내 명사형 제목 자동 생성 → 사이드바 가독성 개선
- **변경 파일**:
  - `db.py` — `chat_session.title` 컬럼 추가 + 기존 DB 자동 마이그레이션, `update_session_title()`, `list_sessions()` COALESCE 폴백
  - `api/routes.py` — `_generate_title()` 함수, 첫 턴 완료 후 비동기 호출
- **동작**: 제목 생성 실패 시 기존 첫 질문 텍스트로 폴백 (무중단)

---

## 2026-06-12

### ✅ 연차/반차 신청 링크 추가
- **문제**: 연차·반차는 전자결재가 아닌 다우오피스 휴가 메뉴에 있어 챗봇이 링크를 제공하지 못함
- **해결**: `prompts/urls.md`에 휴가 메뉴 링크 추가, `system.md` 가이드라인 9번 범위 확장
- **변경 파일**:
  - `prompts/urls.md` — 연차/반차 신청 (휴가 신청 메뉴) 2행 추가
  - `prompts/system.md` — "electronic approval form" → "electronic approval form or vacation/leave menu", 섹션명 `📎 관련 신청 링크`로 통일

### ✅ 메시지 복사 버튼 — BL-002
- **내용**: assistant 응답 버블 hover 시 우상단에 복사 아이콘 표시, 클릭 시 클립보드 복사 + 1.5초 체크 아이콘 피드백
- **변경 파일**:
  - `frontend/src/components/MessageBubble.tsx` — `CopyButton` 컴포넌트 추가 (다크 모드 대응, 스트리밍 중 비표시)

---

## 2026-06-11

### ✅ 응답 출처(Citation) 표시 — BL-003
- **내용**: RAG 검색 문서의 파일명/페이지를 assistant 응답 하단에 뱃지로 표시
- **구현 방식**: A안 — retriever 선호출 후 체인에 context 직접 주입 (벡터 검색 1회)
- **변경 파일**:
  - `rag.py` — `retrieve_with_sources()`, `get_chain_with_context()`, `_extract_sources()` 추가
  - `api/routes.py` — done SSE 프레임에 `sources` 배열 포함
  - `frontend/src/types/chat.types.ts` — `SourceItem` 인터페이스, `ChatMessage.sources` 필드 추가
  - `frontend/src/services/streamChat.ts` — done 이벤트 sources 파싱
  - `frontend/src/stores/useChatStore.ts` — done 이벤트에서 마지막 버블에 sources 저장
  - `frontend/src/components/MessageBubble.tsx` — `SourceBadges` 컴포넌트 (확장자 제거, PDF 페이지 번호, 다크 모드)
- **화면 예시**: `📄 참조: 취업규칙 p.3  연차유급휴가`
- **커밋**: `851b4db`



### ✅ 새로고침 flash 방지 — isInitializing 플래그 + 스켈레톤 UI
- **문제**: 새로고침 시 세션 로드 전 환영 화면이 순간 보이는 flash 현상
- **해결**: `isInitializing` 플래그 도입, 초기화 완료 전까지 스켈레톤 렌더
- **변경 파일**:
  - `frontend/src/stores/useChatStore.ts` — `isInitializing: true` 초기값, `loadSessions()` 완료 시 `false`
  - `frontend/src/components/ChatArea.tsx` — `<ChatSkeleton>` 컴포넌트 추가 (pulse 버블 3개)
  - `frontend/src/components/Sidebar.tsx` — 세션 목록 자리 skeleton 아이템 4개
  - 입력창 `disabled` 처리 (초기화 중 전송 불가)
- **커밋**: `90e1aa4`

### ✅ 다크/라이트 테마 토글
- **내용**: Tailwind `dark:` class 기반 테마 전환, localStorage 영속
- **변경 파일**:
  - `frontend/src/stores/useThemeStore.ts` — 신규 (zustand persist)
  - `frontend/src/index.css` — `@variant dark` + `html.dark body` 배경색
  - `frontend/src/App.tsx` — 마운트 시 `html.dark` 클래스 복원
  - `frontend/src/components/Sidebar.tsx` — 푸터에 🌙/☀️ 토글 버튼, 모든 색상 `dark:` 변형
  - `frontend/src/components/ChatArea.tsx` — `dark:` 변형
  - `frontend/src/components/MessageInput.tsx` — `dark:` 변형
  - `frontend/src/components/MessageBubble.tsx` — `oneLight ↔ oneDark` 조건부 전환, `dark:prose-invert`
- **커밋**: (dark theme 커밋)

### ✅ git 초기화 및 최초 커밋
- **내용**: 프로젝트 git 관리 시작
- **`.gitignore` 추가 항목**: `bak/`, `data/`(대외비 문서), `sessions.db*`, `.venv`, `chroma_langchain_db/`
- **커밋**: `2824a63` — 47개 파일

---

## 2026-06-10

### ✅ 경조휴가 RAG 커버리지 개선
- **문제**: "고모님이 돌아가셨어" 질의 시 경조휴가 규정 미조회
- **원인**:
  1. `경조휴가및_경조사비.png` — PyPDFLoader가 이미지 파일 무시
  2. `retriever_k=3` 으로 검색 범위 부족
- **해결**:
  - `data/취업규칙/경조휴가규정.txt` 수동 생성 (PNG → 텍스트 수동 전사)
  - 상단 검색 키워드 라인 추가 (부고, 별세, 고모, 삼촌, 외조부모 등 구어체)
  - `config.py` `retriever_k` 3 → 6 상향

### ✅ system.md 영어 번역 + 한국어 출력 고정
- **문제**: system.md 영어화 후 답변에 영어 레이블 노출 (Key Answer, Basis 등)
- **해결**:
  - `prompts/system.md` — 영어로 번역 (토큰 절약 목적)
  - `Always answer in Korean regardless of the language of this prompt.` 지시어 추가
  - `prompts/system.md.kor` — 한국어 원본 백업

### ✅ 행동 하네스 (Action Harness) 적용
- **문제**: 정보 요청 질문에 무단 파일 수정 발생
- **해결**: `CLAUDE.md`에 의도 분류표 + Blast Radius 등급별 처리 규칙 추가
  - 🟢 Read-only: 즉시 실행
  - 🟡 Reversible write: 실행 후 보고
  - 🔴 Irreversible: 확인 후 실행

### ✅ 브라우저 탭 타이틀 변경
- **문제**: 탭에 "frontend" 표시
- **해결**: `frontend/index.html` `<title>(회사명) 취업규칙 챗봇</title>`
- **커밋**: (title fix 커밋)

### ✅ 불필요 파일 bak/ 정리
- **내용**: 루트에 산재된 미사용 파일 7개 → `bak/` 폴더로 이동

### ✅ React + FastAPI 풀스택 전환 (초기 구현)
- **배경**: Gradio 단일 파일 → ChatGPT 스타일 멀티 세션 UX로 전환
- **스택**: FastAPI + React + Vite + TypeScript + Tailwind CSS
- **주요 기능**:
  - 좌측 사이드바 세션 목록 (ChatGPT 스타일)
  - 새 채팅 버튼 (기존 세션 유지)
  - 새로고침 후 이전 대화 복원
  - SSE 스트리밍 응답
  - 브라우저 UUID로 사용자 식별 (IP 해시 대체)
  - 세션 삭제 (확인 단계 포함)
  - 토큰 사용량 추적 (input / output / cached)
  - 마크다운 + 코드 하이라이팅

---

## 이전 (Gradio 시대)

### ✅ 다우오피스 전자결재 URL 업데이트
- **내용**: 신규 URL 패턴(`/gw/app/approval/document/new/{companyId}/{formId}`)으로 16개 양식 URL 갱신
- **방법**: Playwright로 폼 ID 자동 수집, 3개 폐기된 양식 제거
- **파일**: `prompts/urls.md`

### ✅ 휴일근무신청서 문서 추가 후 재임베딩
- **내용**: `휴일근무신청서_대체휴무신청서.txt` 추가 → Chroma 재임베딩

### ✅ SQLite 세션 영속화
- **배경**: 메모리 기반 세션 → 서버 재시작 시 소멸 문제
- **해결**: `db.py` SessionStore 클래스, `data/sessions.db` WAL 모드

### ✅ IP 해시 → UUID 세션 식별 전환
- **배경**: 사내 NAT 환경에서 동일 IP 사용자 세션 혼용 문제
- **해결**: 브라우저 `crypto.randomUUID()` 기반 UUID, localStorage 영속

### ✅ LangChain RAG 구축
- **스택**: LangChain + Chroma + BAAI/bge-m3 + Gemini 2.5 Flash
- **문서**: 취업규칙.pdf 외 17개 규정 파일
- **캐싱**: 문서 해시 기반 자동 재임베딩 방지
