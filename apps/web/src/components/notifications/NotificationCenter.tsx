import {
  AtSign,
  Bell,
  Check,
  CheckCheck,
  Info,
  MessageSquare,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatStatusTime } from "@whatsapp-web/shared";
import { AriaLive } from "@/components/ui/aria-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotificationCenter } from "@/hooks/notification";
import type { InAppNotification, NotificationType } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Returns the icon for a notification type
 */
function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "message":
      return <MessageSquare className="size-4" aria-hidden="true" />;
    case "mention":
      return <AtSign className="size-4" aria-hidden="true" />;
    case "assignment":
      return <UserPlus className="size-4" aria-hidden="true" />;
    case "team":
      return <Users className="size-4" aria-hidden="true" />;
    case "system":
      return <Info className="size-4" aria-hidden="true" />;
    default:
      return <Bell className="size-4" aria-hidden="true" />;
  }
}

/**
 * Returns the color scheme for a notification type
 */
function getNotificationColors(type: NotificationType) {
  switch (type) {
    case "message":
      return {
        bg: "bg-sky-50 dark:bg-sky-900/30",
        icon: "bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400",
        accent: "border-l-sky-400 dark:border-l-sky-500",
      };
    case "mention":
      return {
        bg: "bg-violet-50 dark:bg-violet-900/30",
        icon: "bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400",
        accent: "border-l-violet-400 dark:border-l-violet-500",
      };
    case "assignment":
      return {
        bg: "bg-emerald-50 dark:bg-emerald-900/30",
        icon: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400",
        accent: "border-l-emerald-400 dark:border-l-emerald-500",
      };
    case "team":
      return {
        bg: "bg-amber-50 dark:bg-amber-900/30",
        icon: "bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400",
        accent: "border-l-amber-400 dark:border-l-amber-500",
      };
    case "system":
      return {
        bg: "bg-slate-50 dark:bg-slate-800/30",
        icon: "bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400",
        accent: "border-l-slate-400 dark:border-l-slate-500",
      };
    default:
      return {
        bg: "bg-gray-50 dark:bg-dark-tertiary",
        icon: "bg-gray-100 dark:bg-dark-tertiary text-gray-500 dark:text-dark-text-tertiary",
        accent: "border-l-gray-300 dark:border-l-dark-text-tertiary",
      };
  }
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
  notification: InAppNotification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onClick: (notification: InAppNotification) => void;
}) {
  const colors = getNotificationColors(notification.notificationType);

  return (
    <button
      type="button"
      className={cn(
        "group relative flex items-start gap-3 p-3.5 w-full text-left cursor-pointer transition-all duration-200",
        "border-l-2 hover:bg-gray-50/80 dark:hover:bg-dark-tertiary/80",
        !notification.isRead ? colors.accent : "border-l-transparent",
        !notification.isRead && "bg-white dark:bg-dark-elevated",
      )}
      onClick={() => onClick(notification)}
      data-testid="notification-item"
    >
      {/* Type Icon */}
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          colors.icon,
        )}
      >
        {getNotificationIcon(notification.notificationType)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pr-6">
        <p
          className={cn(
            "text-sm text-gray-800 dark:text-dark-text-primary leading-snug",
            !notification.isRead ? "font-semibold" : "font-medium",
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
          {formatStatusTime(notification.createdAt)}
        </p>
      </div>

      {/* Unread indicator dot */}
      {!notification.isRead && (
        <div className="absolute right-3 top-4">
          <span className="inline-flex size-2.5 rounded-full bg-whatsapp-green" />
        </div>
      )}

      {/* Actions overlay on hover */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {!notification.isRead && (
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0 rounded-full hover:bg-whatsapp-green/10 dark:hover:bg-whatsapp-green/20 hover:text-whatsapp-dark-green"
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsRead(notification.id);
            }}
            aria-label="Mark as read"
          >
            <Check className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0 rounded-full hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 dark:text-dark-text-tertiary hover:text-red-500 dark:hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(notification.id);
          }}
          aria-label="Delete notification"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </button>
  );
}

/**
 * Empty state with clear visual hierarchy
 */
function EmptyState({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      {/* Stacked icon treatment */}
      <div className="relative mb-6">
        <div className="flex size-20 items-center justify-center rounded-2xl bg-gray-100 dark:bg-dark-tertiary">
          <Bell className="size-9 text-gray-400 dark:text-dark-text-tertiary" />
        </div>
        {/* Check badge */}
        <div className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-whatsapp-green shadow-sm">
          <Check className="size-4 text-white" />
        </div>
      </div>
      <p className="text-base font-semibold text-gray-900 dark:text-dark-text-primary text-balance">
        You're all caught up
      </p>
      <p className="mt-1 text-sm text-gray-500 dark:text-dark-text-secondary text-center text-pretty max-w-[220px]">
        No new notifications right now. Check back later or adjust your
        preferences.
      </p>
      {/* Clear next action */}
      {onNavigate && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 h-9 px-4 text-sm font-medium text-whatsapp-dark-green hover:bg-whatsapp-green/10 dark:hover:bg-whatsapp-green/20 rounded-lg"
          onClick={() => onNavigate("/settings")}
        >
          Notification settings
        </Button>
      )}
    </div>
  );
}

/**
 * Loading skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 p-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2 py-0.5">
            <Skeleton className="h-4 w-4/5 rounded" />
            <Skeleton className="h-3 w-3/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Notification panel that overlays the sidebar
 */
function NotificationPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    isMarkingAllAsRead,
  } = useNotificationCenter();

  const handleNotificationClick = useCallback(
    (notification: InAppNotification) => {
      if (!notification.isRead) {
        markAsRead(notification.id);
      }

      if (notification.actionUrl) {
        onClose();
        navigate(notification.actionUrl);
      }
    },
    [markAsRead, navigate, onClose],
  );

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    // Delay to avoid immediate close on trigger click
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        "absolute inset-0 z-50 flex flex-col",
        "bg-white dark:bg-dark-secondary",
      )}
      data-testid="notification-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900 dark:text-dark-text-primary">
            Notifications
          </h2>
          {unreadCount > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium tabular-nums bg-whatsapp-green/10 dark:bg-whatsapp-green/20 text-whatsapp-dark-green">
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
              <CheckCheck className="size-3.5 mr-1.5" />
              Mark all
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0 rounded-lg text-gray-400 dark:text-dark-text-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
            onClick={onClose}
            aria-label="Close notifications"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <LoadingSkeleton />
        ) : notifications.length === 0 ? (
          <EmptyState
            onNavigate={(path) => {
              onClose();
              navigate(path);
            }}
          />
        ) : (
          <div className="py-1">
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
        <div className="border-t border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-tertiary">
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-11 text-sm font-medium text-gray-600 dark:text-dark-text-secondary hover:text-whatsapp-dark-green hover:bg-transparent rounded-none"
            onClick={() => {
              onClose();
              navigate("/notifications");
            }}
          >
            View all notifications
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Main NotificationCenter component - Bell trigger + full panel overlay
 */
export const NotificationCenter = memo(function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const prevUnreadCountRef = useRef<number | null>(null);

  const { unreadCount } = useNotificationCenter();

  // Announce when new notifications arrive
  useEffect(() => {
    // Skip initial render
    if (prevUnreadCountRef.current === null) {
      prevUnreadCountRef.current = unreadCount;
      return;
    }

    const prevCount = prevUnreadCountRef.current;
    prevUnreadCountRef.current = unreadCount;

    // Announce when unread count increases
    if (unreadCount > prevCount) {
      const newCount = unreadCount - prevCount;
      setAnnouncement(
        newCount === 1 ? "New notification" : `${newCount} new notifications`,
      );

      // Clear announcement after screen reader has time to read it
      const timer = setTimeout(() => setAnnouncement(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [unreadCount]);

  return (
    <>
      {/* ARIA live region for new notification announcements */}
      <AriaLive politeness="polite">{announcement}</AriaLive>

      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "relative size-9 p-0 rounded-full",
          "hover:bg-whatsapp-green/10 hover:text-whatsapp-dark-green",
          isOpen && "bg-whatsapp-green/10 text-whatsapp-dark-green",
        )}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={isOpen}
        data-testid="notification-bell"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-5 min-w-5 px-1.5 text-[10px] font-bold tabular-nums rounded-full border-2 border-white dark:border-dark-elevated shadow-sm"
            data-testid="notification-badge"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </Button>

      <NotificationPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
});

export default NotificationCenter;
