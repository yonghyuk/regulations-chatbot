import { Sun, Moon, BarChart2 } from 'lucide-react'
import { useThemeStore } from '@/stores/useThemeStore'

interface RightBarProps {
  onStatsToggle: () => void
  statsOpen: boolean
}

export function RightBar({ onStatsToggle, statsOpen }: RightBarProps) {
  const isDark = useThemeStore((s) => s.isDark)
  const toggleTheme = useThemeStore((s) => s.toggle)

  return (
    <aside className="flex h-full w-12 flex-col items-center border-l border-gray-200 bg-gray-50 py-3 dark:border-gray-700 dark:bg-gray-900">
      {/* 통계 */}
      <button
        onClick={onStatsToggle}
        aria-label="통계 보기"
        title="사용 통계"
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
          statsOpen
            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
            : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300'
        }`}
      >
        <BarChart2 size={18} />
      </button>

      {/* 스페이서 */}
      <div className="flex-1" />

      {/* 테마 토글 */}
      <button
        onClick={toggleTheme}
        aria-label={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
        title={isDark ? '라이트 모드' : '다크 모드'}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
      >
        {isDark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    </aside>
  )
}
