import { Circle, Clock, Eye, Plus } from 'lucide-react'
import { useState } from 'react'
import { Avatar, AvatarFallback, Skeleton } from '@/components/ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  type ContactStatus,
  useMyStatus,
  useStatusStats,
  useStatusUpdates,
} from '@/hooks/useStatus'
import { PostStatusDialog } from './PostStatusDialog'

export interface StatusListProps {
  onStatusSelect: (jid: string) => void
  selectedJid?: string
}

/**
 * Status list sidebar component
 * Displays contacts with active status updates
 */
export function StatusList({ onStatusSelect, selectedJid }: StatusListProps) {
  const { data: statuses, isLoading, isError } = useStatusUpdates()
  const { data: stats } = useStatusStats()
  const { data: myStatus } = useMyStatus()
  const [postDialogOpen, setPostDialogOpen] = useState(false)

  const myStatusCount = myStatus?.count || 0

  return (
    <div className="flex flex-col h-full bg-white dark:bg-dark-secondary border-r border-gray-200 dark:border-dark-border">
      {/* Post Status Dialog */}
      <PostStatusDialog open={postDialogOpen} onOpenChange={setPostDialogOpen} />

      {/* My Status */}
      <button
        type="button"
        onClick={() => setPostDialogOpen(true)}
        className="w-full px-4 py-3 border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary hover:bg-gray-50 dark:hover:bg-dark-tertiary transition-colors text-left"
        data-testid="my-status-button"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar
              className={`h-12 w-12 border-2 ${
                myStatusCount > 0
                  ? 'border-whatsapp-teal-green'
                  : 'border-gray-300 dark:border-dark-border border-dashed'
              }`}
            >
              <AvatarFallback
                className={
                  myStatusCount > 0
                    ? 'bg-whatsapp-teal-green text-white'
                    : 'bg-gray-100 dark:bg-dark-tertiary text-gray-500 dark:text-dark-text-secondary'
                }
              >
                ME
              </AvatarFallback>
            </Avatar>
            <div className="absolute bottom-0 right-0 w-5 h-5 bg-whatsapp-teal-green rounded-full border-2 border-white dark:border-dark-secondary flex items-center justify-center">
              <Plus className="h-3 w-3 text-white" />
            </div>
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-dark-text-primary">My status</p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
              {myStatusCount > 0
                ? `${myStatusCount} active update${myStatusCount > 1 ? 's' : ''}`
                : 'Tap to add status update'}
            </p>
          </div>
        </div>
      </button>

      {/* Recent Updates Header */}
      {statuses && statuses.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2">
          <p className="text-xs font-medium text-gray-500 dark:text-dark-text-tertiary uppercase tracking-wider">
            Recent updates
          </p>
          {stats && (
            <span className="text-xs text-gray-500 dark:text-dark-text-tertiary">
              {stats.activeStatuses} active
            </span>
          )}
        </div>
      )}

      {/* Status List */}
      <ScrollArea className="flex-1">
        {/* Loading State */}
        {isLoading && (
          <div className="p-4 space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <StatusItemSkeleton key={index} />
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
            <Circle className="w-12 h-12 text-gray-400 dark:text-dark-text-tertiary mb-4" />
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">
              Failed to load status
            </p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              Please try again later
            </p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !isError && (!statuses || statuses.length === 0) && (
          <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
            <Circle className="w-12 h-12 text-gray-400 dark:text-dark-text-tertiary mb-4" />
            <p className="text-gray-600 dark:text-dark-text-primary font-medium">
              No status updates
            </p>
            <p className="text-sm text-gray-500 dark:text-dark-text-secondary mt-1">
              Status updates from your contacts will appear here
            </p>
          </div>
        )}

        {/* Status Items */}
        {!isLoading && !isError && statuses && statuses.length > 0 && (
          <div>
            {statuses.map((contactStatus) => (
              <StatusItem
                key={contactStatus.jid}
                contactStatus={contactStatus}
                isSelected={contactStatus.jid === selectedJid}
                onClick={() => onStatusSelect(contactStatus.jid)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

interface StatusItemProps {
  contactStatus: ContactStatus
  isSelected: boolean
  onClick: () => void
}

function StatusItem({ contactStatus, isSelected, onClick }: StatusItemProps) {
  const { jid, statuses } = contactStatus
  const latestStatus = statuses[statuses.length - 1]
  const totalStatuses = statuses.length

  // Extract phone number from JID
  const phoneNumber = jid.split('@')[0]
  const displayName = phoneNumber || 'Unknown'

  // Calculate time since latest status
  const getTimeAgo = (timestamp: string) => {
    const now = new Date()
    const statusTime = new Date(timestamp)
    const diffMs = now.getTime() - statusTime.getTime()
    const diffMins = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMins / 60)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return statusTime.toLocaleDateString()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                  ${isSelected ? 'bg-gray-200 dark:bg-dark-tertiary' : 'hover:bg-gray-50 dark:hover:bg-dark-tertiary'}`}
    >
      {/* Avatar with status ring */}
      <div className="relative">
        <div
          className="w-12 h-12 rounded-full p-0.5"
          style={{
            background:
              totalStatuses > 0
                ? `conic-gradient(from 0deg, #25D366 0deg, #25D366 ${360 / totalStatuses}deg, #e5e7eb ${360 / totalStatuses}deg)`
                : '#e5e7eb',
          }}
        >
          <Avatar className="h-full w-full border-2 border-white dark:border-dark-secondary">
            <AvatarFallback className="bg-gray-400 dark:bg-dark-text-tertiary text-white">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>

      {/* Status Info */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 dark:text-dark-text-primary truncate">
          {displayName}
        </p>
        <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-dark-text-secondary">
          <Clock className="w-3 h-3" />
          <span>{getTimeAgo(latestStatus.timestamp)}</span>
          {totalStatuses > 1 && (
            <span className="text-gray-400 dark:text-dark-text-tertiary">
              ({totalStatuses} updates)
            </span>
          )}
        </div>
      </div>

      {/* View indicator */}
      <Eye className="w-4 h-4 text-gray-400 dark:text-dark-text-tertiary" />
    </button>
  )
}

function StatusItemSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="w-12 h-12 rounded-full" />
      <div className="flex-1">
        <Skeleton className="h-4 w-32 mb-2" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  )
}

export default StatusList
