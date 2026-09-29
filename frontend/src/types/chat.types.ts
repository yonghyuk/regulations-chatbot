// 채팅 관련 타입 정의

export interface SessionItem {
  session_id: string
  title: string | null
  created_at: string
  last_activity: string
  chat_count: number
}

export interface SessionListResponse {
  sessions: SessionItem[]
}

export interface CreateSessionResponse {
  session_id: string
}

export interface SourceItem {
  file: string        // 파일명 (예: "취업규칙.pdf", "연차유급휴가.txt")
  page?: number | null  // PDF 페이지 번호 (0-based), TXT는 null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  created_at?: string
  tokens_input?: number
  tokens_output?: number
  sources?: SourceItem[]  // 응답 출처 (assistant only)
}

export interface MessagesResponse {
  session_id: string
  messages: ChatMessage[]
}

export interface TokenUsage {
  tokens_input: number
  tokens_output: number
  tokens_cached: number
}

// SSE 스트림 이벤트
// sources: 스트리밍 종료 직후 별도 프레임으로 즉시 수신 (A안)
// title:   제목 LLM 완료 후 별도 프레임으로 수신 (B안)
export type StreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'sources'; sources: SourceItem[] }
  | { type: 'done'; usage: TokenUsage }
  | { type: 'title'; title: string }
  | { type: 'error'; message: string }
