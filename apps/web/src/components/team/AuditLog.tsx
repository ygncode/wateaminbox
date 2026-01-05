import { ChevronLeft, ChevronRight, Clock, FileDown, Filter, Globe, Info, User } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Input, Skeleton } from '@/components/ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  type AuditAction,
  type AuditLog as AuditLogType,
  formatAuditAction,
  useAuditActions,
  useAuditLogs,
} from '@/hooks/useAudit'
import { cn } from '@/lib/utils'

export interface AuditLogProps {
  companyId: string
}

/**
 * Audit Log viewer component
 */
export function AuditLog({ companyId }: AuditLogProps) {
  const [page, setPage] = useState(0)
  const [actionFilter, setActionFilter] = useState<AuditAction | ''>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const limit = 20

  const { data, isLoading, error } = useAuditLogs(companyId, {
    action: actionFilter || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    limit,
    offset: page * limit,
  })

  const { data: actions } = useAuditActions()

  const handleExport = () => {
    const params = new URLSearchParams()
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    const queryString = params.toString()
    window.open(`/api/audit/export${queryString ? `?${queryString}` : ''}`, '_blank')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-xl font-semibold text-gray-900">Audit Log</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(showFilters && 'bg-gray-100')}
          >
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <FileDown className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Action Type</label>
              <select
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value as AuditAction | '')
                  setPage(0)
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="">All actions</option>
                {actions?.map((action) => (
                  <option key={action.value} value={action.value}>
                    {action.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setPage(0)
                }}
                className="w-40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setPage(0)
                }}
                className="w-40"
              />
            </div>
            {(actionFilter || startDate || endDate) && (
              <div className="flex items-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setActionFilter('')
                    setStartDate('')
                    setEndDate('')
                    setPage(0)
                  }}
                >
                  Clear filters
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <AuditLogSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-500">Failed to load audit logs</div>
        ) : data?.data.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <Info className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-2">No audit logs found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data?.data.map((log) => (
              <AuditLogItem key={log.id} log={log} />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Pagination */}
      {data && data.pagination.total > limit && (
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-3">
          <p className="text-sm text-gray-500">
            Showing {page * limit + 1} to {Math.min((page + 1) * limit, data.pagination.total)} of{' '}
            {data.pagination.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.pagination.hasMore}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Individual audit log item
 */
function AuditLogItem({ log }: { log: AuditLogType }) {
  const [expanded, setExpanded] = useState(false)
  const createdAt = new Date(log.createdAt)

  return (
    <div
      className={cn(
        'px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors',
        expanded && 'bg-gray-50'
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {formatAuditAction(log.action)}
            </Badge>
            {log.entityType && (
              <span className="text-sm text-gray-500">
                on {log.entityType}
                {log.entityId && ` #${log.entityId.slice(0, 8)}`}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
            {log.userId && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {log.userId.slice(0, 8)}...
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {createdAt.toLocaleString()}
            </span>
            {log.ipAddress && (
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {log.ipAddress}
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && log.details && Object.keys(log.details).length > 0 && (
        <div className="mt-3 rounded-md bg-gray-100 p-3">
          <pre className="text-xs text-gray-700 overflow-auto">
            {JSON.stringify(log.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

/**
 * Loading skeleton
 */
function AuditLogSkeleton() {
  return (
    <div className="flex items-start justify-between px-6 py-4">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="mt-1 flex items-center gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </div>
  )
}

export default AuditLog
