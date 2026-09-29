import { useState, useEffect, useRef } from 'react'
import { Plus, MessageSquare, Trash2, Loader2, LogOut } from 'lucide-react'
import { useChatStore } from '@/stores/useChatStore'
import { useUserStore } from '@/stores/useUserStore'

// 제목이 새로 생성될 때 글자를 하나씩 타이핑하듯 보여주는 훅.
// null → 값 변경(첫 생성)에만 스트림 효과 적용, 이후 변경은 즉시 교체.
function useStreamingTitle(title: string | null) {
  const [displayed, setDisplayed] = useState(title ?? '')
  const prevTitle = useRef(title)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const prev = prevTitle.current
    prevTitle.current = title

    // 제목 미변경 시 무시
    if (title === prev) return

    // 기존 타이머 정리
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!title) {
      setDisplayed('')
      return
    }

    // null → 값: 타이핑 스트림 효과 (글자당 40ms)
    if (prev === null) {
      setDisplayed('')
      let i = 0
      const type = () => {
        i++
        setDisplayed(title.slice(0, i))
        if (i < title.length) {
          timerRef.current = setTimeout(type, 40)
        }
      }
      timerRef.current = setTimeout(type, 40)
      return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    }

    // 값 → 다른값: 즉시 교체 (사용자가 직접 편집하는 경우 등)
    setDisplayed(title)
  }, [title])

  return displayed || '새 대화'
}

interface SessionListItemProps {
  session: { session_id: string; title: string | null }
  isActive: boolean
  isDeleting: boolean
  isConfirming: boolean
  onSelect: () => void
  onConfirmDelete: () => void
  onDelete: () => void
  onCancelDelete: () => void
  onRename: (sessionId: string, title: string) => void
}

function SessionListItem({
  session, isActive, isDeleting, isConfirming,
  onSelect, onConfirmDelete, onDelete, onCancelDelete, onRename,
}: SessionListItemProps) {
  const displayTitle = useStreamingTitle(session.title)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDraft(session.title ?? '')
    setEditing(true)
    // 삭제 확인 상태 해제
    onCancelDelete()
  }

  // double-fire 방지: Enter → blur 순으로 두 번 호출되는 것을 막음
  const committingRef = useRef(false)

  const commitEdit = () => {
    if (committingRef.current) return
    committingRef.current = true

    const trimmed = draft.trim()
    if (trimmed && trimmed !== (session.title ?? '')) {
      onRename(session.session_id, trimmed)
    }
    setEditing(false)
    setDraft('')
    committingRef.current = false
  }

  const cancelEdit = () => {
    committingRef.current = true  // blur 무시
    setEditing(false)
    setDraft('')
    committingRef.current = false
  }

  // editing 전환 시 input에 포커스
  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  return (
    <li
      className={`group flex items-center gap-1 rounded-lg pr-1 transition ${
        isActive ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {editing ? (
        // 인라인 편집 모드
        <div className="flex flex-1 items-center gap-1 px-2 py-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 30))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
              if (e.key === 'Escape') cancelEdit()
            }}
            onBlur={commitEdit}
            maxLength={30}
            className="flex-1 rounded border border-blue-400 bg-white px-2 py-0.5 text-sm text-gray-800 outline-none focus:ring-1 focus:ring-blue-400 dark:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
      ) : (
        <button
          onClick={onSelect}
          onDoubleClick={startEdit}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
            isActive ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'
          }`}
          title="더블클릭하여 제목 편집"
        >
          <MessageSquare size={15} className="flex-shrink-0 text-gray-400 dark:text-gray-500" />
          <span className="flex-1 truncate">{displayTitle}</span>
        </button>
      )}

      {!editing && (
        isConfirming ? (
          <span className="flex flex-shrink-0 items-center gap-0.5">
            <button
              onClick={onDelete}
              className="rounded px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
              aria-label="삭제 확인"
            >삭제</button>
            <button
              onClick={onCancelDelete}
              className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
              aria-label="삭제 취소"
            >취소</button>
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onConfirmDelete() }}
            disabled={isDeleting}
            aria-label="대화 삭제"
            title="대화 삭제"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-500 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-50 dark:text-gray-500 dark:hover:bg-red-900/30 dark:hover:text-red-400 md:opacity-0 md:group-hover:opacity-100"
          >
            {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        )
      )}
    </li>
  )
}

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const selectSession = useChatStore((s) => s.selectSession)
  const newChat = useChatStore((s) => s.newChat)
  const deleteSession = useChatStore((s) => s.deleteSession)

  // 삭제 진행 중인 세션 id (중복 클릭 방지 + 로딩 표시)
  const renameSession = useChatStore((s) => s.renameSession)
  const isInitializing = useChatStore((s) => s.isInitializing)
  const username = useUserStore((s) => s.username)
  const logout = useUserStore((s) => s.logout)

  // 삭제 진행 중인 세션 id (중복 클릭 방지 + 로딩 표시)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // 삭제 확인 대기 중인 세션 id
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const handleDelete = async (sessionId: string) => {
    setConfirmingId(null)
    setDeletingId(sessionId)
    try {
      await deleteSession(sessionId)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
      {/* 새 채팅 */}
      <div className="p-3">
        <button
          onClick={() => newChat()}
          className="flex w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <Plus size={16} />새 채팅
        </button>
      </div>

      {/* 세션 목록 */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {isInitializing ? (
          // 초기화 중: 세션 목록 skeleton
          <div className="animate-pulse space-y-1 px-1 pt-1">
            {[80, 60, 72, 55].map((w) => (
              <div key={w} className="flex items-center gap-2 rounded-lg px-3 py-2.5">
                <div className="h-3.5 w-3.5 flex-shrink-0 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className={`h-3 rounded-full bg-gray-200 dark:bg-gray-700`} style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
            아직 대화가 없어요
          </p>
        ) : (
          <ul className="space-y-1">
            {sessions.map((s) => (
              <SessionListItem
                key={s.session_id}
                session={s}
                isActive={s.session_id === currentSessionId}
                isDeleting={deletingId === s.session_id}
                isConfirming={confirmingId === s.session_id}
                onSelect={() => selectSession(s.session_id)}
                onConfirmDelete={() => setConfirmingId(s.session_id)}
                onDelete={() => handleDelete(s.session_id)}
                onCancelDelete={() => setConfirmingId(null)}
                onRename={renameSession}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 푸터 — 로그인 사용자 + 로그아웃 */}
      <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
        <span className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400" title={username}>
          👤 {username || '사용자'}
        </span>
        <button
          onClick={logout}
          title="로그아웃"
          aria-label="로그아웃"
          className="flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-200 hover:text-red-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-red-400"
        >
          <LogOut size={13} />로그아웃
        </button>
      </div>
    </aside>
  )
}
