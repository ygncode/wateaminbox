import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle, Clock, TrendingUp, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  getResponseTimeStats,
  getResponseTimeTrend,
  getSlaBreaches,
  getTeamResponseTimeStats,
} from '../../lib/api'

type TimeRange = '7d' | '30d' | '90d'

function formatMinutes(minutes: number): string {
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function getSlaColor(rate: number): string {
  if (rate >= 90) return 'text-green-600'
  if (rate >= 70) return 'text-yellow-600'
  return 'text-red-600'
}

function getSlaBg(rate: number): string {
  if (rate >= 90) return 'bg-green-100'
  if (rate >= 70) return 'bg-yellow-100'
  return 'bg-red-100'
}

interface ResponseTimeAnalyticsProps {
  companyId: string
  isAdmin?: boolean
  slaThreshold?: number
}

export function ResponseTimeAnalytics({
  companyId,
  isAdmin = false,
  slaThreshold = 60,
}: ResponseTimeAnalyticsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')

  const dateRange = useMemo(() => {
    const end = new Date()
    const start = new Date()
    switch (timeRange) {
      case '7d':
        start.setDate(start.getDate() - 7)
        break
      case '30d':
        start.setDate(start.getDate() - 30)
        break
      case '90d':
        start.setDate(start.getDate() - 90)
        break
    }
    return { start, end }
  }, [timeRange])

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['responseTimeStats', companyId, dateRange.start, dateRange.end, slaThreshold],
    queryFn: () => getResponseTimeStats(dateRange.start, dateRange.end, slaThreshold),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: trendData, isLoading: trendLoading } = useQuery({
    queryKey: ['responseTimeTrend', companyId, dateRange.start, dateRange.end, slaThreshold],
    queryFn: () => getResponseTimeTrend(dateRange.start, dateRange.end, slaThreshold),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: teamData } = useQuery({
    queryKey: ['teamResponseTime', companyId, dateRange.start, dateRange.end, slaThreshold],
    queryFn: () => getTeamResponseTimeStats(dateRange.start, dateRange.end, slaThreshold),
    enabled: !!companyId && isAdmin,
    staleTime: 5 * 60 * 1000,
  })

  const { data: breachData } = useQuery({
    queryKey: ['slaBreaches', companyId, dateRange.start, dateRange.end, slaThreshold],
    queryFn: () => getSlaBreaches(dateRange.start, dateRange.end, slaThreshold, 10),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
  })

  const stats = statsData?.data
  const trend = trendData?.data || []
  const team = teamData?.data || []
  const breaches = breachData?.data || []

  const isLoading = statsLoading || trendLoading

  return (
    <div className="space-y-6">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-gray-600 dark:text-dark-text-secondary" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-dark-text-primary">
            Response Time Analytics
          </h2>
        </div>
        <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-dark-tertiary p-1">
          {(['7d', '30d', '90d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                timeRange === range
                  ? 'bg-white dark:bg-dark-secondary text-gray-900 dark:text-dark-text-primary shadow-sm'
                  : 'text-gray-600 dark:text-dark-text-secondary hover:text-gray-900 dark:hover:text-dark-text-primary'
              }`}
            >
              {range === '7d' ? '7 days' : range === '30d' ? '30 days' : '90 days'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-text-secondary">
            <Clock className="h-4 w-4" />
            Avg Response
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
            {isLoading ? '-' : formatMinutes(stats?.averageResponseTimeMinutes || 0)}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-dark-text-secondary">
            Median: {isLoading ? '-' : formatMinutes(stats?.medianResponseTimeMinutes || 0)}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-text-secondary">
            <CheckCircle className="h-4 w-4" />
            SLA Compliance
          </div>
          <div
            className={`mt-2 text-2xl font-bold ${
              isLoading
                ? 'text-gray-900 dark:text-dark-text-primary'
                : getSlaColor(stats?.slaComplianceRate || 0)
            }`}
          >
            {isLoading ? '-' : `${Math.round(stats?.slaComplianceRate || 0)}%`}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-dark-text-secondary">
            Target: {slaThreshold} min
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-text-secondary">
            <TrendingUp className="h-4 w-4" />
            Conversations
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
            {isLoading ? '-' : stats?.totalConversations || 0}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-dark-text-secondary">
            {isLoading ? '-' : stats?.withinSlaCount || 0} within SLA
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-dark-text-secondary">
            <AlertTriangle className="h-4 w-4" />
            Max Response
          </div>
          <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-dark-text-primary">
            {isLoading ? '-' : formatMinutes(stats?.maxResponseTimeMinutes || 0)}
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-dark-text-secondary">
            Min: {isLoading ? '-' : formatMinutes(stats?.minResponseTimeMinutes || 0)}
          </div>
        </div>
      </div>

      {/* Trend Chart */}
      {trend.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
          <h3 className="mb-4 font-medium text-gray-900 dark:text-dark-text-primary">
            Response Time Trend
          </h3>
          <div className="h-48">
            <div className="flex h-full items-end gap-1">
              {trend.slice(-14).map((day) => {
                const maxValue = Math.max(...trend.map((d) => d.averageResponseTimeMinutes))
                const height = maxValue > 0 ? (day.averageResponseTimeMinutes / maxValue) * 100 : 0
                return (
                  <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                    <div className="relative w-full flex-1">
                      <div
                        className={`absolute bottom-0 w-full rounded-t ${getSlaBg(day.slaComplianceRate)}`}
                        style={{ height: `${height}%` }}
                        title={`${day.date}: ${formatMinutes(day.averageResponseTimeMinutes)} avg, ${Math.round(day.slaComplianceRate)}% SLA`}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 dark:text-dark-text-tertiary">
                      {new Date(day.date).getDate()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-center gap-4 text-xs text-gray-500 dark:text-dark-text-secondary">
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-green-100 dark:bg-green-900/30" /> {'>'} 90% SLA
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-yellow-100 dark:bg-yellow-900/30" /> 70-90% SLA
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-red-100 dark:bg-red-900/30" /> {'<'} 70% SLA
            </span>
          </div>
        </div>
      )}

      {/* Team Performance (Admin only) */}
      {isAdmin && team.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
          <div className="mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-gray-600 dark:text-dark-text-secondary" />
            <h3 className="font-medium text-gray-900 dark:text-dark-text-primary">
              Team Response Times
            </h3>
          </div>
          <div className="space-y-3">
            {team.slice(0, 5).map((member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-dark-tertiary px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                    {member.email}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-dark-text-secondary">
                    {member.totalResponses} responses
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-900 dark:text-dark-text-primary">
                    {formatMinutes(member.averageResponseTimeMinutes)}
                  </div>
                  <div className={`text-xs ${getSlaColor(member.slaComplianceRate)}`}>
                    {Math.round(member.slaComplianceRate)}% SLA
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SLA Breaches */}
      {breaches.length > 0 && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <h3 className="font-medium text-red-900 dark:text-red-400">SLA Breaches</h3>
            <span className="rounded bg-red-100 dark:bg-red-900/50 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
              {breaches.length}
            </span>
          </div>
          <div className="space-y-2">
            {breaches.slice(0, 5).map((breach, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded bg-white dark:bg-dark-elevated px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium text-gray-900 dark:text-dark-text-primary">
                    {breach.contactName || breach.contactId}
                  </span>
                  <span className="ml-2 text-gray-500 dark:text-dark-text-secondary">
                    {new Date(breach.inboundMessageTime).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {formatMinutes(breach.responseMinutes)}
                  </span>
                  {breach.responseTime ? (
                    <span className="ml-2 text-xs text-gray-500 dark:text-dark-text-secondary">
                      responded
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-red-500 dark:text-red-400">no response</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
