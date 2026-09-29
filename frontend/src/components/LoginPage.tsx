import { useState } from 'react'
import { LogIn, Loader2 } from 'lucide-react'
import api from '@/services/api'
import { useUserStore } from '@/stores/useUserStore'

/**
 * 다우오피스 계정 로그인 화면.
 * 미인증 상태(App 게이트)에서 표시되며, 로그인 성공 시 토큰을 저장한다.
 */
export function LoginPage() {
  const setAuth = useUserStore((s) => s.setAuth)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', {
        username: username.trim(),
        password,
      })
      setAuth(data.token, data.user)
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail || '로그인에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-100 dark:bg-gray-900">
      <form
        onSubmit={submit}
        className="w-[340px] rounded-2xl bg-white p-8 shadow-xl dark:bg-gray-800"
      >
        <div className="mb-6 text-center">
          <h1 className="text-lg font-bold text-gray-800 dark:text-gray-100">
            취업규칙 챗봇
          </h1>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}

        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
          아이디
        </label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          className="mb-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />

        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
          비밀번호
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="mb-5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />

        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          {loading ? '로그인 중…' : '로그인'}
        </button>
      </form>
    </div>
  )
}
