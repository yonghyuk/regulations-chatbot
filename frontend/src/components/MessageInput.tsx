import { useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

const MAX_LENGTH = 1000

interface Props {
  onSend: (message: string) => void
  disabled?: boolean
}

export function MessageInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('')

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 전송, Shift+Enter 줄바꿈
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const remaining = MAX_LENGTH - text.length
  const nearLimit = remaining <= 100

  return (
    <div className="border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-950">
      <div className="mx-auto flex max-w-3xl flex-col gap-1">
        <div className="flex items-end gap-2 rounded-2xl border border-gray-300 bg-white p-2 shadow-sm focus-within:border-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:focus-within:border-gray-400">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={handleKeyDown}
            placeholder="취업규칙에 대해 질문해보세요... (Enter 전송, Shift+Enter 줄바꿈)"
            rows={1}
            maxLength={MAX_LENGTH}
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
            disabled={disabled}
          />
          <button
            onClick={handleSend}
            disabled={disabled || !text.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-600 dark:hover:bg-gray-500"
            aria-label="전송"
          >
            <Send size={18} />
          </button>
        </div>
        {nearLimit && (
          <p className={`text-right text-xs ${remaining <= 0 ? 'text-red-500' : 'text-orange-500'}`}>
            {remaining <= 0 ? '최대 글자 수 초과' : `${remaining}자 남음`}
          </p>
        )}
      </div>
    </div>
  )
}
