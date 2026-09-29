import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { ChatArea } from '@/components/ChatArea'
import { RightBar } from '@/components/RightBar'
import { StatsPanel } from '@/components/StatsPanel'
import { LoginPage } from '@/components/LoginPage'
import { useUserStore } from '@/stores/useUserStore'
import { useChatStore } from '@/stores/useChatStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useAppInfoStore } from '@/stores/useAppInfoStore'

function App() {
  const token = useUserStore((s) => s.token)
  const loadSessions = useChatStore((s) => s.loadSessions)
  const isDark = useThemeStore((s) => s.isDark)
  const [showStats, setShowStats] = useState(false)
  const loadAppInfo = useAppInfoStore((s) => s.load)

  // 조직 정보(회사명·규정 범위) — 로그인 전에도 필요
  useEffect(() => {
    loadAppInfo()
  }, [loadAppInfo])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // 로그인(토큰) 후 세션 목록 로드
  useEffect(() => {
    if (token) loadSessions()
  }, [token, loadSessions])

  // 미인증 → 로그인 화면
  if (!token) {
    return <LoginPage />
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <ChatArea />
      <RightBar
        onStatsToggle={() => setShowStats((v) => !v)}
        statsOpen={showStats}
      />
      <StatsPanel open={showStats} onClose={() => setShowStats(false)} />
    </div>
  )
}

export default App
