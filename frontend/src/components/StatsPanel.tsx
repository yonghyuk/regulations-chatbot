import { useState, useEffect, useCallback } from 'react'
import {
  X, MessageSquare, Users, ArrowDownToLine, ArrowUpFromLine,
  RefreshCw, DollarSign, TrendingUp,
} from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import api from '@/services/api'

// ===== 타입 =====
interface SummaryStats {
  active_users: number
  active_sessions: number
  total_sessions: number
  total_chats: number
  tokens_input: number
  tokens_output: number
  tokens_cached: number
}

interface DailyRow {
  date: string
  chat_count: number
  tokens_input: number
  tokens_output: number
  tokens_cached: number
}

interface TokenStatsResponse {
  by_date: DailyRow[]
  by_model: unknown[]
}

interface CostEstimate {
  provider: string
  month_start: string
  currency: string
  usd_to_krw: number
  month: { tokens_input: number; tokens_output: number; tokens_cached: number; cost_usd: number; cost_krw: number }
  total: { tokens_input: number; tokens_output: number; tokens_cached: number; cost_usd: number; cost_krw: number }
  budget_krw: number | null
  budget_used_pct: number | null
  price_per_m_usd: { input: number; output: number; cached: number }
}

// ===== 유틸 =====
function fmtToken(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtDate(d: string): string {
  const parts = d.split('-')
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`
  return d
}

function fmtKrw(v: number): string {
  return `₩${Math.round(v).toLocaleString('ko-KR')}`
}

// ===== 컴포넌트 =====
interface StatCardProps {
  label: string
  value: string | number
  icon: React.ReactNode
  color: string
  sub?: string
}

function StatCard({ label, value, icon, color, sub }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
      </div>
    </div>
  )
}

interface BudgetBarProps {
  usedKrw: number
  budgetKrw: number
  pct: number
}

function BudgetBar({ usedKrw, budgetKrw, pct }: BudgetBarProps) {
  const clamped = Math.min(pct, 100)
  const color =
    pct >= 90 ? 'bg-red-500' :
    pct >= 70 ? 'bg-orange-400' :
    'bg-emerald-500'

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">이번 달 예산 사용률</span>
        <span className={`text-sm font-bold ${pct >= 90 ? 'text-red-500' : pct >= 70 ? 'text-orange-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>{fmtKrw(usedKrw)} 사용</span>
        <span>한도 {fmtKrw(budgetKrw)}</span>
      </div>
    </div>
  )
}

interface StatsPanelProps {
  open: boolean
  onClose: () => void
}

export function StatsPanel({ open, onClose }: StatsPanelProps) {
  const [summary, setSummary] = useState<SummaryStats | null>(null)
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [cost, setCost] = useState<CostEstimate | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, tokenRes, costRes] = await Promise.all([
        api.get<SummaryStats>('/stats'),
        api.get<TokenStatsResponse>('/token-stats'),
        api.get<CostEstimate>('/cost-estimate'),
      ])
      setSummary(statsRes.data)
      setDaily(
        (tokenRes.data.by_date ?? []).map((r) => ({ ...r, date: fmtDate(r.date) }))
      )
      setCost(costRes.data)
    } catch {
      setError('통계를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  return (
    <>
      {/* 딤 오버레이 */}
      <div
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 패널 */}
      <aside
        className={`fixed right-0 top-0 z-40 flex h-full w-[440px] max-w-full flex-col border-l border-gray-200 bg-gray-50 shadow-2xl transition-transform duration-300 ease-in-out dark:border-gray-700 dark:bg-gray-900 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="통계 패널"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">📊 사용 통계</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={load}
              disabled={loading}
              title="새로고침"
              aria-label="통계 새로고침"
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 disabled:opacity-50 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              aria-label="패널 닫기"
              title="닫기"
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </p>
          )}

          {loading && !summary && (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
              ))}
            </div>
          )}

          {summary && cost && (
            <>
              {/* ── 비용 섹션 ── */}
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                비용 추정 ({cost.provider.toUpperCase()})
              </h3>

              <div className="mb-3 grid grid-cols-2 gap-3">
                <StatCard
                  label="이번 달 추정 비용"
                  value={fmtKrw(cost.month.cost_krw)}
                  icon={<DollarSign size={18} className="text-emerald-600" />}
                  color="bg-emerald-50 dark:bg-emerald-900/30"
                  sub={`${cost.month_start} ~`}
                />
                <StatCard
                  label="누적 추정 비용"
                  value={fmtKrw(cost.total.cost_krw)}
                  icon={<TrendingUp size={18} className="text-indigo-600" />}
                  color="bg-indigo-50 dark:bg-indigo-900/30"
                  sub="전체 기간"
                />
              </div>

              {/* 예산 프로그레스바 (budget_krw 설정 시에만 표시) */}
              {cost.budget_krw !== null && cost.budget_used_pct !== null && (
                <div className="mb-4">
                  <BudgetBar
                    usedKrw={cost.month.cost_krw}
                    budgetKrw={cost.budget_krw}
                    pct={cost.budget_used_pct}
                  />
                </div>
              )}

              {/* 단가 안내 */}
              <p className="mb-5 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                단가: 입력 ${cost.price_per_m_usd.input}/M · 출력 ${cost.price_per_m_usd.output}/M · 캐시 ${cost.price_per_m_usd.cached}/M
                &nbsp;· 환율 ₩{cost.usd_to_krw.toLocaleString()} — 실제 청구액과 다를 수 있음
              </p>

              {/* ── 사용량 섹션 ── */}
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                사용량 (전체 누적)
              </h3>

              <div className="mb-6 grid grid-cols-2 gap-3">
                <StatCard
                  label="전체 대화"
                  value={summary.total_chats.toLocaleString()}
                  icon={<MessageSquare size={18} className="text-blue-600" />}
                  color="bg-blue-50 dark:bg-blue-900/30"
                />
                <StatCard
                  label="세션 수"
                  value={summary.total_sessions.toLocaleString()}
                  icon={<Users size={18} className="text-purple-600" />}
                  color="bg-purple-50 dark:bg-purple-900/30"
                />
                <StatCard
                  label="입력 토큰"
                  value={fmtToken(summary.tokens_input)}
                  icon={<ArrowDownToLine size={18} className="text-green-600" />}
                  color="bg-green-50 dark:bg-green-900/30"
                />
                <StatCard
                  label="출력 토큰"
                  value={fmtToken(summary.tokens_output)}
                  icon={<ArrowUpFromLine size={18} className="text-orange-600" />}
                  color="bg-orange-50 dark:bg-orange-900/30"
                />
              </div>

              {daily.length > 0 && (
                <>
                  {/* ── 차트 섹션 ── */}
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    일별 추이
                  </h3>

                  {/* 날짜별 대화 수 바차트 */}
                  <div className="mb-6">
                    <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">대화 수</p>
                    <ResponsiveContainer width="100%" height={170}>
                      <BarChart data={daily} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          formatter={(v) => [`${v}건`, '대화 수']}
                        />
                        <Bar dataKey="chat_count" name="대화 수" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* 날짜별 토큰 라인차트 */}
                  <div>
                    <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">토큰 사용량</p>
                    <ResponsiveContainer width="100%" height={170}>
                      <LineChart data={daily} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtToken(v)} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          formatter={(v) => [fmtToken(Number(v)), '']}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="tokens_input"  name="입력" stroke="#10b981" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="tokens_output" name="출력" stroke="#f97316" strokeWidth={2} dot={false} />
                        {daily.some((r) => r.tokens_cached > 0) && (
                          <Line type="monotone" dataKey="tokens_cached" name="캐시" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}

              {daily.length === 0 && (
                <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  아직 데이터가 없어요
                </p>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}
