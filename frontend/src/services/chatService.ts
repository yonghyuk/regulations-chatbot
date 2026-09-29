import api from './api'
import type {
  SessionListResponse,
  CreateSessionResponse,
  MessagesResponse,
} from '@/types/chat.types'

export const chatService = {
  // 새 세션 생성 (ChatGPT '새 채팅')
  createSession: async (): Promise<CreateSessionResponse> => {
    const res = await api.post<CreateSessionResponse>('/sessions', {})
    return res.data
  },

  // 사이드바용 세션 목록
  listSessions: async (): Promise<SessionListResponse> => {
    const res = await api.get<SessionListResponse>('/sessions')
    return res.data
  },

  // 세션의 대화 이력 (화면 복원)
  getMessages: async (sessionId: string): Promise<MessagesResponse> => {
    const res = await api.get<MessagesResponse>(`/sessions/${sessionId}/messages`)
    return res.data
  },

  // 세션 삭제
  deleteSession: async (sessionId: string): Promise<void> => {
    await api.delete(`/sessions/${sessionId}`)
  },

  // 세션 제목 편집 (BL-008)
  updateTitle: async (sessionId: string, title: string): Promise<void> => {
    await api.patch(`/sessions/${sessionId}/title`, { title })
  },
}
