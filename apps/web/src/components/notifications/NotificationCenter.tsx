import {
  AtSign,
  Bell,
  Check,
  CheckCheck,
  Info,
  MessageSquare,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Skeleton,
} from '@/components/ui'
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
 * Returns the color scheme for a notification type
 */
function getNotificationColors(type: NotificationType) {
  switch (type) {
    case 'message':
      return {
        bg: 'bg-sky-50 dark:bg-sky-900/30',
        icon: 'bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400',
        accent: 'border-l-sky-400 dark:border-l-sky-500',
      }
    case 'mention':
      return {
        bg: 'bg-violet-50 dark:bg-violet-900/30',
        icon: 'bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400',
        accent: 'border-l-violet-400 dark:border-l-violet-500',
      }
    case 'assignment':
      return {
        bg: 'bg-emerald-50 dark:bg-emerald-900/30',
        icon: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400',
        accent: 'border-l-emerald-400 dark:border-l-emerald-500',
      }
    case 'team':
      return {
        bg: 'bg-amber-50 dark:bg-amber-900/30',
        icon: 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400',
        accent: 'border-l-amber-400 dark:border-l-amber-500',
      }
    case 'system':
      return {
        bg: 'bg-slate-50 dark:bg-slate-800/30',
        icon: 'bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400',
        accent: 'border-l-slate-400 dark:border-l-slate-500',
      }
    default:
      return {
        bg: 'bg-gray-50 dark:bg-dark-tertiary',
        icon: 'bg-gray-100 dark:bg-dark-tertiary text-gray-500 dark:text-dark-text-tertiary',
        accent: 'border-l-gray-300 dark:border-l-dark-text-tertiary',
      }
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
 * Single notification item component with refined styling
 */
function NotificationItem({
  notification,
  onMarkAsRead,
  onDelete,
  onClick,
  index,
}: {
  notification: InAppNotification
  onMarkAsRead: (id: string) => void
  onDelete: (id: string) => void
  onClick: (notification: InAppNotification) => void
  index: number
}) {
  const colors = getNotificationColors(notification.notificationType)

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 p-3.5 cursor-pointer transition-all duration-200',
        'border-l-2 hover:bg-gray-50/80 dark:hover:bg-dark-tertiary/80',
        !notification.isRead ? colors.accent : 'border-l-transparent',
        !notification.isRead && 'bg-white dark:bg-dark-elevated'
      )}
      onClick={() => onClick(notification)}
      data-testid="notification-item"
      style={{
        animationDelay: `${index * 50}ms`,
      }}
    >
      {/* Type Icon */}
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105',
          colors.icon
        )}
      >
        {getNotificationIcon(notification.notificationType)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-6">
        <p
          className={cn(
            'text-sm text-gray-800 dark:text-dark-text-primary leading-snug',
            !notification.isRead ? 'font-semibold' : 'font-medium'
          )}
        >
          {notification.title}
        </p>
        {notification.message && (
          <p className="text-sm text-gray-500 dark:text-dark-text-secondary truncate mt-0.5 leading-snug">
            {notification.message}
          </p>
        )}
        <p className="text-xs text-gray-400 dark:text-dark-text-tertiary mt-1.5 font-medium">
          {formatNotificationTime(notification.createdAt)}
        </p>
      </div>

      {/* Unread indicator dot */}
      {!notification.isRead && (
        <div className="absolute right-3 top-4">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-whatsapp-green opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-whatsapp-green" />
          </span>
        </div>
      )}

      {/* Actions overlay on hover */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-x-2 group-hover:translate-x-0">
        {!notification.isRead && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-full hover:bg-whatsapp-green/10 dark:hover:bg-whatsapp-green/20 hover:text-whatsapp-dark-green"
            onClick={(e) => {
              e.stopPropagation()
              onMarkAsRead(notification.id)
            }}
            title="Mark as read"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 rounded-full hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 dark:text-dark-text-tertiary hover:text-red-500 dark:hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(notification.id)
          }}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

/**
 * Refined empty state with subtle animation
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6">
      <div className="relative mb-4">
        {/* Background glow */}
        <div className="absolute inset-0 bg-whatsapp-green/10 dark:bg-whatsapp-green/5 rounded-full blur-xl scale-150" />
        {/* Icon container */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-gray-50 to-gray-100 dark:from-dark-tertiary dark:to-dark-secondary ring-1 ring-gray-200/50 dark:ring-dark-border">
          <Bell className="h-7 w-7 text-gray-300 dark:text-dark-text-tertiary" />
          <Sparkles className="absolute -top-1 -right-1 h-4 w-4 text-whatsapp-green animate-pulse" />
        </div>
      </div>
      <p className="text-sm font-semibold text-gray-700 dark:text-dark-text-primary mb-1">
        All caught up!
      </p>
      <p className="text-xs text-gray-400 dark:text-dark-text-tertiary text-center max-w-[180px]">
        No new notifications. We'll let you know when something arrives.
      </p>
    </div>
  )
}

/**
 * Loading skeleton with staggered animation
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-3 animate-pulse"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2 py-0.5">
            <Skeleton className="h-4 w-4/5 rounded" />
            <Skeleton className="h-3 w-3/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Main NotificationCenter component - Elevated dropdown design
 */
export const NotificationCenter = memo(function NotificationCenter() {
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

  const handleNotificationClick = useCallback(
    (notification: InAppNotification) => {
      if (!notification.isRead) {
        markAsRead(notification.id)
      }

      if (notification.actionUrl) {
        setIsOpen(false)
        navigate(notification.actionUrl)
      }
    },
    [markAsRead, navigate]
  )

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'relative h-9 w-9 p-0 rounded-full transition-all duration-200',
            'hover:bg-whatsapp-green/10 hover:text-whatsapp-dark-green',
            isOpen && 'bg-whatsapp-green/10 text-whatsapp-dark-green'
          )}
          aria-label="Notifications"
          data-testid="notification-bell"
        >
          <Bell className={cn('h-5 w-5 transition-transform', isOpen && 'scale-110')} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-50" />
              <Badge
                variant="destructive"
                className="relative h-5 min-w-5 px-1.5 text-[10px] font-bold rounded-full border-2 border-white shadow-sm"
                data-testid="notification-badge"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </Badge>
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className={cn(
          'w-[360px] p-0 overflow-hidden',
          'bg-white/95 dark:bg-dark-elevated/95 backdrop-blur-xl',
          'border border-gray-200/80 dark:border-dark-border',
          'shadow-xl shadow-gray-900/10 dark:shadow-black/30',
          'rounded-xl'
        )}
        align="end"
        sideOffset={8}
        data-testid="notification-popover"
      >
        {/* Header with gradient accent */}
        <div className="relative border-b border-gray-100 dark:border-dark-border">
          {/* Subtle gradient line at top */}
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-whatsapp-green via-whatsapp-dark-green to-whatsapp-teal-green" />

          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900 dark:text-dark-text-primary">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-whatsapp-green/10 dark:bg-whatsapp-green/20 text-whatsapp-dark-green">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-xs font-medium text-gray-600 dark:text-dark-text-secondary hover:text-whatsapp-dark-green hover:bg-whatsapp-green/10 dark:hover:bg-whatsapp-green/20 rounded-lg"
                  onClick={markAllAsRead}
                  disabled={isMarkingAllAsRead}
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 rounded-lg text-gray-400 dark:text-dark-text-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <LoadingSkeleton />
          ) : notifications.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="py-1">
              {notifications.map((notification, index) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={markAsRead}
                  onDelete={deleteNotification}
                  onClick={handleNotificationClick}
                  index={index}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t border-gray-100 dark:border-dark-border bg-gray-50/50 dark:bg-dark-secondary/50">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-10 text-xs font-medium text-gray-600 dark:text-dark-text-secondary hover:text-whatsapp-dark-green hover:bg-transparent rounded-none"
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
})

export default NotificationCenter
