import { useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/useChatStore'
import { useAppInfoStore } from '@/stores/useAppInfoStore'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'

function ChatSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 animate-pulse">
      {/* assistant 버블 skeleton */}
      <div className="flex justify-start">
        <div className="w-[75%] space-y-2">
          <div className="h-3.5 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-3.5 w-5/6 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-3.5 w-4/6 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
      {/* user 버블 skeleton */}
      <div className="flex justify-end">
        <div className="w-[45%] space-y-2">
          <div className="h-3.5 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-3.5 w-4/6 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
      {/* assistant 버블 skeleton */}
      <div className="flex justify-start">
        <div className="w-[65%] space-y-2">
          <div className="h-3.5 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="h-3.5 w-5/6 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    </div>
  )
}

export function ChatArea() {
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const isInitializing = useChatStore((s) => s.isInitializing)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const companyName = useAppInfoStore((s) => s.companyName)
  const regulationScope = useAppInfoStore((s) => s.regulationScope)
  const regenerateLast = useChatStore((s) => s.regenerateLast)
  const editLastAndResend = useChatStore((s) => s.editLastAndResend)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 메시지 추가/스트리밍 시 자동 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const isEmpty = messages.length === 0

  return (
    <main className="flex h-full flex-1 flex-col bg-white dark:bg-gray-950">
      <div className="flex-1 overflow-y-auto">
        {isInitializing ? (
          // 앱 초기화 중: 스켈레톤 표시 (환영화면 flash 방지)
          <ChatSkeleton />
        ) : isEmpty ? (
          // 초기화 완료 + 새 세션: 환영 화면
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <h1 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-gray-100">
              취업규칙 챗봇 🤖
            </h1>
            <p className="max-w-md text-gray-500 dark:text-gray-400">
              {companyName || '사내'} {regulationScope}에 대해 무엇이든 물어보세요.
              <br />
              근로시간, 휴가, 퇴직금 등 궁금한 규정을 안내해드려요 💡
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {['연차 신청은 어떻게 하나요?', '연차 휴가는 며칠인가요?', '경조휴가 대상과 일수가 어떻게 되나요?'].map(
                (ex) => (
                  <button
                    key={ex}
                    onClick={() => sendMessage(ex)}
                    className="rounded-full border border-gray-300 px-4 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    {ex}
                  </button>
                ),
              )}
            </div>
          </div>
        ) : (
          // 초기화 완료 + 메시지 있음: 대화 목록
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
            {(() => {
              const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user')
              return messages.map((m, i) => {
                // 마지막 assistant 응답에만 재생성 버튼 / 마지막 user에만 편집 버튼 (스트리밍 중 제외)
                const canRegen = i === messages.length - 1 && m.role === 'assistant' && !isStreaming
                const canEdit = i === lastUserIdx && !isStreaming
                return (
                  <MessageBubble
                    key={i}
                    message={m}
                    onRegenerate={canRegen ? regenerateLast : undefined}
                    onEdit={canEdit ? editLastAndResend : undefined}
                  />
                )
              })
            })()}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageInput onSend={sendMessage} disabled={isStreaming || isInitializing} />
    </main>
  )
}
