import { useUserStore } from '@/stores/useUserStore'
import type { StreamEvent } from '@/types/chat.types'

/**
 * SSE 스트리밍 채팅.
 * EventSource는 POST 바디를 못 보내므로 fetch + ReadableStream을 사용한다.
 * 서버는 `event: token|done|error` + `data: {json}` 프레임을 보낸다.
 */
export async function* streamChat(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
  regenerate = false,
): AsyncGenerator<StreamEvent> {
  const token = useUserStore.getState().token
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ session_id: sessionId, message, regenerate }),
    signal,
  })

  if (res.status === 401) {
    useUserStore.getState().logout()  // 토큰 만료 → 로그인 화면으로
    throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.')
  }
  if (!res.ok || !res.body) {
    throw new Error(`스트리밍 요청 실패: HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE 프레임은 \n\n 으로 구분
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? '' // 마지막 미완성 프레임은 버퍼에 보관

    for (const frame of frames) {
      if (!frame.trim()) continue
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue
      try {
        const payload = JSON.parse(data)
        if (event === 'token') yield { type: 'token', delta: payload.delta }
        else if (event === 'sources') yield { type: 'sources', sources: payload.sources ?? [] }
        else if (event === 'done') yield { type: 'done', usage: payload.usage }
        else if (event === 'title') yield { type: 'title', title: payload.title }
        else if (event === 'error') yield { type: 'error', message: payload.message }
      } catch {
        // JSON 파싱 실패 프레임은 무시
      }
    }
  }
}
