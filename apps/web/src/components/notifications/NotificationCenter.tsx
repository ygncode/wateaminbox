import { Bell, CheckCheck, X } from "lucide-react";
import {
  type HTMLAttributes,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { AriaLive } from "@/components/ui/aria-live";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkspace } from "@/contexts/workspace-context";
import { useNotificationCenter } from "@/hooks/notification";
import type { InAppNotification } from "@/lib/api/types";
import { navigateToNotificationTarget } from "@/lib/notification-navigation";
import { cn } from "@/lib/utils";
import { workspacePath } from "@/lib/workspace-routes";
import {
  NotificationEmptyState,
  NotificationErrorState,
  NotificationGroups,
  NotificationListSkeleton,
} from "./NotificationList";
import {
  NOTIFICATION_SCRIM_CLASS,
  NOTIFICATION_SHEET_CLASS,
  NOTIFICATION_SHEET_EMBEDDED_CLASS,
  SHEET_FOCUSABLE_SELECTOR,
} from "./notification-sheet";
import { useTranslation } from "react-i18next";

/**
 * Notification sheet: a full-viewport page on mobile, and a full-height sheet
 * anchored flush to the right edge from `md` upwards.
 */
function NotificationPanel({
  isOpen,
  onClose,
  controller,
  triggerRef,
  embedded = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  controller: ReturnType<typeof useNotificationCenter>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  embedded?: boolean;
}) {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const notificationsPath = activeWorkspaceId
    ? workspacePath(activeWorkspaceId, "notifications")
    : "/notifications";
  const settingsPath = activeWorkspaceId
    ? workspacePath(activeWorkspaceId, "settings", "notifications")
    : "/settings/notifications";

  const {
    notifications,
    unreadCount,
    isLoading,
    isFetching,
    error,
    refresh,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    isMarkingAllAsRead,
  } = controller;

  const handleNotificationClick = useCallback(
    (notification: InAppNotification) => {
      if (!notification.isRead) {
        markAsRead(notification.id);
      }

      if (notification.actionUrl) {
        onClose();
        navigateToNotificationTarget(
          notification.actionUrl,
          navigate,
          activeWorkspaceId,
        );
      }
    },
    [activeWorkspaceId, markAsRead, navigate, onClose],
  );

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        !triggerRef.current?.contains(target)
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
  }, [isOpen, onClose, triggerRef]);

  // Escape closes; Tab stays inside the sheet while it is modal
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab" || embedded) return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(SHEET_FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, embedded]);

  // Move focus into the sheet, and hand it back to the bell when it closes
  useEffect(() => {
    if (!isOpen || embedded) return;

    panelRef.current?.focus({ preventScroll: true });

    return () => {
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [isOpen, embedded, triggerRef]);

  if (!isOpen) return null;

  const sheet = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={embedded ? undefined : true}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={
        embedded ? NOTIFICATION_SHEET_EMBEDDED_CLASS : NOTIFICATION_SHEET_CLASS
      }
      data-testid="notification-panel"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary">
        <div className="flex items-center gap-2">
          <h2
            id={titleId}
            className="text-base font-semibold text-gray-900 dark:text-dark-text-primary"
          >
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
              {t("notifications.markAll", "Mark all")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="size-10 md:size-8 p-0 rounded-lg text-gray-400 dark:text-dark-text-tertiary hover:text-gray-600 dark:hover:text-dark-text-secondary hover:bg-gray-100 dark:hover:bg-dark-tertiary"
            onClick={onClose}
            aria-label={t("notifications.close", "Close notifications")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <NotificationListSkeleton density="compact" rows={4} />
        ) : error ? (
          <NotificationErrorState
            density="compact"
            onRetry={refresh}
            isRetrying={isFetching}
          />
        ) : notifications.length === 0 ? (
          <NotificationEmptyState
            filter="all"
            density="compact"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  navigate(settingsPath);
                }}
              >
                {t("notifications.settings", "Notification settings")}
              </Button>
            }
          />
        ) : (
          <NotificationGroups
            notifications={notifications}
            density="compact"
            onActivate={handleNotificationClick}
            onMarkAsRead={markAsRead}
            onDelete={deleteNotification}
          />
        )}
      </ScrollArea>

      {/* Footer. Always present: the full inbox holds read notifications the
          sheet's short list does not, so it stays reachable from an empty or
          failed sheet too. */}
      <div className="shrink-0 pb-[env(safe-area-inset-bottom)] border-t border-gray-200 dark:border-dark-border bg-gray-50 dark:bg-dark-tertiary">
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-11 text-sm font-medium text-gray-600 dark:text-dark-text-secondary hover:text-whatsapp-dark-green hover:bg-transparent rounded-none"
          onClick={() => {
            onClose();
            navigate(notificationsPath);
          }}
        >
          {t("notifications.viewAll", "View all notifications")}
        </Button>
      </div>
    </div>
  );

  if (embedded) return sheet;

  return (
    <>
      {/* Scrim: blocks the page behind the sheet. The document mousedown
          listener above turns a click here into a close. */}
      <div className={NOTIFICATION_SCRIM_CLASS} aria-hidden="true" />
      {sheet}
    </>
  );
}

/**
 * Main NotificationCenter component - Bell trigger + full panel overlay
 */
interface NotificationCenterProps {
  /** Optional trigger styling for navigation rails and compact headers. */
  className?: HTMLAttributes<HTMLButtonElement>["className"];
  /** When provided, the panel fills this element instead of floating. */
  panelContainer?: HTMLElement | null;
}

export const NotificationCenter = memo(function NotificationCenter({
  className,
  panelContainer,
}: NotificationCenterProps) {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const prevUnreadCountRef = useRef<number | null>(null);

  const controller = useNotificationCenter(undefined, { listEnabled: isOpen });
  const { unreadCount } = controller;

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
        newCount === 1
          ? t("notifications.new", "New notification")
          : `${newCount} new notifications`,
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
        ref={triggerRef}
        variant="ghost"
        size="sm"
        className={cn(
          "relative size-9 p-0 rounded-full",
          "hover:bg-whatsapp-green/10 hover:text-whatsapp-dark-green",
          isOpen && "bg-whatsapp-green/10 text-whatsapp-dark-green",
          className,
        )}
        onClick={() => setIsOpen((open) => !open)}
        title={t("notifications.title", "Notifications")}
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

      {panelContainer ? (
        createPortal(
          <NotificationPanel
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            controller={controller}
            triggerRef={triggerRef}
            embedded
          />,
          panelContainer,
        )
      ) : (
        <NotificationPanel
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          controller={controller}
          triggerRef={triggerRef}
        />
      )}
    </>
  );
});

export default NotificationCenter;
