import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Badge,
  ScrollArea,
  Skeleton,
} from '@/components/ui'
import {
  Bell,
  Check,
  CheckCheck,
  MessageSquare,
  AtSign,
  UserPlus,
  Users,
  Info,
  Trash2,
  X,
} from 'lucide-react'
import { useNotificationCenter } from '@/hooks/useNotificationCenter'
import type { InAppNotification, NotificationType } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Returns the icon for a notification type
 */
function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case 'message':
      return <MessageSquare className="h-4 w-4" />
    case 'mention':
      return <AtSign className="h-4 w-4" />
    case 'assignment':
      return <UserPlus className="h-4 w-4" />
    case 'team':
      return <Users className="h-4 w-4" />
    case 'system':
      return <Info className="h-4 w-4" />
    default:
      return <Bell className="h-4 w-4" />
  }
}

/**
 * Returns the color for a notification type
 */
function getNotificationColor(type: NotificationType) {
  switch (type) {
    case 'message':
      return 'bg-blue-100 text-blue-600'
    case 'mention':
      return 'bg-purple-100 text-purple-600'
    case 'assignment':
      return 'bg-green-100 text-green-600'
    case 'team':
      return 'bg-orange-100 text-orange-600'
    case 'system':
      return 'bg-gray-100 text-gray-600'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

/**
 * Formats a date for display
 */
function formatNotificationTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return date.toLocaleDateString()
}

/**
 * Single notification item component
 */
function NotificationItem({
  notification,
  onMarkAsRead,
  onDelete,
  onClick,
}: {
  notification: InAppNotification
  onMarkAsRead: (id: string) => void
  onDelete: (id: string) => void
  onClick: (notification: InAppNotification) => void
}) {
  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 p-3 hover:bg-gray-50 cursor-pointer transition-colors',
        !notification.isRead && 'bg-blue-50/50'
      )}
      onClick={() => onClick(notification)}
      data-testid="notification-item"
    >
      {/* Icon */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          getNotificationColor(notification.notificationType)
        )}
      >
        {getNotificationIcon(notification.notificationType)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium text-gray-900', !notification.isRead && 'font-semibold')}>
          {notification.title}
        </p>
        {notification.message && (
          <p className="text-sm text-gray-500 truncate">{notification.message}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          {formatNotificationTime(notification.createdAt)}
        </p>
      </div>

      {/* Unread indicator */}
      {!notification.isRead && (
        <div className="absolute right-3 top-3">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
        </div>
      )}

      {/* Actions (shown on hover) */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!notification.isRead && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={(e) => {
              e.stopPropagation()
              onMarkAsRead(notification.id)
            }}
            title="Mark as read"
          >
            <Check className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(notification.id)
          }}
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Empty state component
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Bell className="h-10 w-10 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-500">No notifications</p>
      <p className="text-xs text-gray-400 mt-1">You're all caught up!</p>
    </div>
  )
}

/**
 * Loading skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Main NotificationCenter component
 */
export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()

  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    isMarkingAllAsRead,
  } = useNotificationCenter()

  const handleNotificationClick = (notification: InAppNotification) => {
    // Mark as read
    if (!notification.isRead) {
      markAsRead(notification.id)
    }

    // Navigate if there's an action URL
    if (notification.actionUrl) {
      setIsOpen(false)
      navigate(notification.actionUrl)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 w-9 p-0"
          aria-label="Notifications"
          data-testid="notification-bell"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-xs"
              data-testid="notification-badge"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-80 p-0"
        align="end"
        data-testid="notification-popover"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold text-gray-900">Notifications</h3>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={markAllAsRead}
                disabled={isMarkingAllAsRead}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="max-h-96">
          {isLoading ? (
            <LoadingSkeleton />
          ) : notifications.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="divide-y divide-gray-100">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={markAsRead}
                  onDelete={deleteNotification}
                  onClick={handleNotificationClick}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                setIsOpen(false)
                navigate('/notifications')
              }}
            >
              View all notifications
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default NotificationCenter
