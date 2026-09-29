import { useState, useEffect } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight, oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { ChatMessage, SourceItem } from '@/types/chat.types'
import { useThemeStore } from '@/stores/useThemeStore'

function SourceBadges({ sources }: { sources: SourceItem[] }) {
  // 마운트 직후 opacity-0 → opacity-100 페이드인 (순간 팝업 방지)
  // B안(SSE title) 전환 시 이 컴포넌트는 그대로 유지 — sources prop 방식 변경 없음
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80)
    return () => clearTimeout(t)
  }, [])

  const labels = sources.map((s) => {
    const name = s.file.replace(/\.(pdf|txt|xlsx)$/i, '')
    return s.page != null ? `${name} p.${s.page + 1}` : name
  })

  return (
    <div
      className={`mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2 transition-opacity duration-500 dark:border-gray-700 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span className="text-xs text-gray-400 dark:text-gray-500">📄 참조:</span>
      {labels.map((label, i) => (
        <span
          key={i}
          className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400"
        >
          {label}
        </span>
      ))}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    let success = false

    // 1차: Clipboard API (HTTPS 또는 localhost 필요)
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        success = true
      } catch {
        // 권한 거부 등 → fallback으로 진행
      }
    }

    // 2차: textarea execCommand fallback (http:// 환경 대응)
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

    if (success) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button
      onClick={handleCopy}
      title="복사"
      className="rounded-md p-1 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:text-gray-500 dark:hover:text-gray-300"
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}

function RegenerateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="다시 생성"
      className="rounded-md p-1 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:text-gray-500 dark:hover:text-gray-300"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <polyline points="21 3 21 9 15 9" />
      </svg>
    </button>
  )
}

// user 질문 버블 — onEdit가 있으면 인라인 편집 가능 (경량 BL-007b)
function UserBubble({ content, onEdit }: { content: string; onEdit?: (text: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)

  const save = () => {
    const t = draft.trim()
    if (t && t !== content) onEdit?.(t)
    setEditing(false)
  }
  const cancel = () => {
    setDraft(content)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[80%]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                save()
              } else if (e.key === 'Escape') {
                cancel()
              }
            }}
            rows={2}
            autoFocus
            className="w-full resize-none rounded-2xl border border-gray-300 bg-white p-3 text-gray-800 outline-none focus:border-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <div className="mt-1 flex justify-end gap-2 text-sm">
            <button onClick={cancel} className="rounded-md px-3 py-1 text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800">
              취소
            </button>
            <button onClick={save} className="rounded-md bg-gray-900 px-3 py-1 text-white transition hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-500">
              보내기
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-center justify-end gap-1">
      {onEdit && (
        <button
          onClick={() => { setDraft(content); setEditing(true) }}
          title="질문 편집"
          className="rounded-md p-1 text-gray-400 opacity-0 transition-opacity hover:text-gray-600 group-hover:opacity-100 dark:text-gray-500 dark:hover:text-gray-300"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      )}
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl bg-gray-900 px-4 py-2.5 text-white dark:bg-gray-700">
        {content}
      </div>
    </div>
  )
}

export function MessageBubble({ message, onRegenerate, onEdit }: { message: ChatMessage; onRegenerate?: () => void; onEdit?: (text: string) => void }) {
  const isUser = message.role === 'user'
  const isDark = useThemeStore((s) => s.isDark)

  // 마크다운 커스텀 렌더러 (코드 하이라이트 + 링크)
  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      const isBlock = match || String(children).includes('\n')
      if (isBlock) {
        return (
          <SyntaxHighlighter
            style={isDark ? oneDark : oneLight}
            language={match ? match[1] : 'text'}
            PreTag="div"
            customStyle={{ borderRadius: '8px', fontSize: '0.85rem' }}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        )
      }
      return (
        <code
          className="rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] text-pink-600 dark:bg-gray-700 dark:text-pink-400"
          {...props}
        >
          {children}
        </code>
      )
    },
    a({ href, children, ...props }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          {...props}
        >
          {children}
        </a>
      )
    },
  }

  if (isUser) {
    return <UserBubble content={message.content} onEdit={onEdit} />
  }

  return (
    <div className="flex justify-start">
      <div className="group flex max-w-[85%] flex-col">
        <div className="prose prose-sm text-gray-800 dark:prose-invert dark:text-gray-200">
          {message.content ? (
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
              {message.sources && message.sources.length > 0 && (
                <SourceBadges sources={message.sources} />
              )}
            </>
          ) : (
            <span className="inline-flex gap-1 py-2 text-gray-400 dark:text-gray-500">
              <span className="animate-bounce">●</span>
              <span className="animate-bounce [animation-delay:0.15s]">●</span>
              <span className="animate-bounce [animation-delay:0.3s]">●</span>
            </span>
          )}
        </div>
        {message.content && (
          <div className="mt-1 flex items-center gap-0.5">
            <CopyButton text={message.content} />
            {onRegenerate && <RegenerateButton onClick={onRegenerate} />}
          </div>
        )}
      </div>
    </div>
  )
}
