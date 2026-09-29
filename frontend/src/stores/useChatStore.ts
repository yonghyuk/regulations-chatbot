import { create } from 'zustand'
import type { SessionItem, ChatMessage } from '@/types/chat.types'
import { chatService } from '@/services/chatService'
import { streamChat } from '@/services/streamChat'

interface ChatState {
  sessions: SessionItem[]
  currentSessionId: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  isInitializing: boolean  // 앱 최초 로드 중 여부 (flash 방지)

  // 액션
  loadSessions: () => Promise<void>
  selectSession: (sessionId: string) => Promise<void>
  newChat: () => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  sendMessage: (message: string) => Promise<void>
  regenerateLast: () => Promise<void>
  editLastAndResend: (newText: string) => Promise<void>
}

export const useChatStore = create<ChatState>()((set, get) => {
  // 공통 SSE 소비 — 호출 전에 마지막 버블이 비어있는 assistant 버블로 준비돼 있어야 한다.
  // sendMessage(신규 전송)와 regenerateLast(재생성)가 동일 로직을 공유한다.
  const runStream = async (sessionId: string, message: string, regenerate: boolean) => {
    try {
      for await (const ev of streamChat(sessionId, message, undefined, regenerate)) {
        if (ev.type === 'token') {
          set((s) => {
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: last.content + ev.delta }
            }
            return { messages: msgs }
          })
        } else if (ev.type === 'sources') {
          set((s) => {
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            if (last?.role === 'assistant' && ev.sources.length > 0) {
              msgs[msgs.length - 1] = { ...last, sources: ev.sources }
            }
            return { messages: msgs }
          })
        } else if (ev.type === 'done') {
          // done: usage만 수신 — 현재 별도 표시 없음
        } else if (ev.type === 'title') {
          set((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.session_id === sessionId ? { ...sess, title: ev.title } : sess
            ),
          }))
        } else if (ev.type === 'error') {
          set((s) => {
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = {
                ...last,
                content: last.content || `⚠️ 오류: ${ev.message}`,
              }
            }
            return { messages: msgs }
          })
        }
      }
    } finally {
      set({ isStreaming: false })
      // last_activity 갱신 목적 재요청 — sources/title은 각자 SSE 프레임으로 이미 반영
      const { sessions: fresh } = await chatService.listSessions()
      set((s) => ({
        sessions: fresh.map((f) => {
          const existing = s.sessions.find((e) => e.session_id === f.session_id)
          return { ...f, title: f.title ?? existing?.title ?? null }
        }),
      }))
    }
  }

  return {
    sessions: [],
    currentSessionId: null,
    messages: [],
    isStreaming: false,
    isInitializing: true,

    // 세션 목록 로드 + 최근 세션 자동 선택 (앱 시작/새로고침 시 대화 복원)
    loadSessions: async () => {
      const { sessions } = await chatService.listSessions()
      set({ sessions })
      if (!get().currentSessionId && sessions.length > 0) {
        await get().selectSession(sessions[0].session_id)
      }
      set({ isInitializing: false })
    },

    // 세션 선택 → 화면에 대화 복원
    selectSession: async (sessionId: string) => {
      set({ currentSessionId: sessionId, messages: [] })
      const { messages } = await chatService.getMessages(sessionId)
      set({ messages })
    },

    // 새 채팅 (기존 세션 유지)
    newChat: async () => {
      const { session_id } = await chatService.createSession()
      set({ currentSessionId: session_id, messages: [] })
      await get().loadSessions()
      set({ currentSessionId: session_id }) // loadSessions가 덮어쓰지 않게 재설정
    },

    deleteSession: async (sessionId: string) => {
      await chatService.deleteSession(sessionId)
      const wasCurrentSession = get().currentSessionId === sessionId
      if (wasCurrentSession) {
        set({ currentSessionId: null, messages: [] })
      }
      await get().loadSessions()
    },

    renameSession: async (sessionId: string, title: string) => {
      // optimistic update: 서버 응답 전에 먼저 UI 반영
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.session_id === sessionId ? { ...sess, title } : sess
        ),
      }))
      try {
        await chatService.updateTitle(sessionId, title)
      } catch {
        const { sessions } = await chatService.listSessions()
        set({ sessions })
      }
    },

    // 메시지 전송 + SSE 스트리밍
    sendMessage: async (message: string) => {
      let sessionId = get().currentSessionId
      if (!sessionId) {
        const { session_id } = await chatService.createSession()
        sessionId = session_id
        set({ currentSessionId: sessionId })
      }
      // 사용자 메시지 + 빈 assistant 버블 추가
      set((s) => ({
        messages: [
          ...s.messages,
          { role: 'user', content: message },
          { role: 'assistant', content: '' },
        ],
        isStreaming: true,
      }))
      await runStream(sessionId, message, false)
    },

    // 마지막 응답 재생성 (BL-007a) — 마지막 질문을 그대로 다시 보내 답변만 새로 생성
    regenerateLast: async () => {
      const { messages, currentSessionId, isStreaming } = get()
      if (isStreaming || !currentSessionId) return
      const last = messages[messages.length - 1]
      if (!last || last.role !== 'assistant') return  // 마지막이 assistant일 때만
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      if (!lastUser) return
      const question = lastUser.content
      // 마지막 assistant 버블을 비워 재스트리밍 대상으로 (sources도 초기화)
      set((s) => {
        const msgs = [...s.messages]
        msgs[msgs.length - 1] = { role: 'assistant', content: '' }
        return { messages: msgs, isStreaming: true }
      })
      await runStream(currentSessionId, question, true)
    },

    // 마지막 질문 편집 후 재전송 (경량 BL-007b) — 마지막 턴을 삭제하고 수정된 질문으로 재생성
    editLastAndResend: async (newText: string) => {
      const { messages, currentSessionId, isStreaming } = get()
      if (isStreaming || !currentSessionId) return
      const trimmed = newText.trim()
      if (!trimmed) return
      // 마지막 user 인덱스
      const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')
      if (lastUserIdx === -1) return
      // 마지막 user를 수정값으로 교체하고 그 뒤를 빈 assistant 버블로 재구성
      set((s) => {
        const msgs = s.messages.slice(0, lastUserIdx)
        msgs.push({ role: 'user', content: trimmed })
        msgs.push({ role: 'assistant', content: '' })
        return { messages: msgs, isStreaming: true }
      })
      // regenerate=true → 백엔드가 마지막 턴 삭제 후 수정된 질문으로 새 답변 생성
      await runStream(currentSessionId, trimmed, true)
    },
  }
})
