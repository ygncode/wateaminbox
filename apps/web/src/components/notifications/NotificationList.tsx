import {
  AtSign,
  Bell,
  Check,
  Info,
  MessageSquare,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { InAppNotification, NotificationType } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  formatNotificationTime,
  formatNotificationTimestamp,
  getNotificationEmptyState,
  getNotificationVisual,
  groupNotificationsByDay,
  type NotificationFilter,
} from "./notification-presentation";

/**
 * Row scale. `compact` fits the 400px sheet, `comfortable` is the full-page
 * Activity Inbox. Everything else about a row is identical between the two so
 * a notification reads the same wherever it is seen.
 */
export type NotificationDensity = "compact" | "comfortable";

/** Icon for a notification type. */
function NotificationTypeIcon({
  type,
  className,
}: {
  type: NotificationType;
  className?: string;
}) {
  const Icon =
    type === "message"
      ? MessageSquare
      : type === "mention"
        ? AtSign
        : type === "assignment"
          ? UserPlus
          : type === "team"
            ? Users
            : type === "system"
              ? Info
              : Bell;
  return <Icon className={cn("size-4", className)} aria-hidden="true" />;
}

interface NotificationRowProps {
  notification: InAppNotification;
  density?: NotificationDensity;
  /** Open the notification's target and mark it read. */
  onActivate: (notification: InAppNotification) => void;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * One notification.
 *
 * Read state is carried by four signals rather than colour alone: a type-tinted
 * left accent, a raised surface, a heavier title, and text only a screen reader
 * hears.
 */
function NotificationRow({
  notification,
  density = "comfortable",
  onActivate,
  onMarkAsRead,
  onDelete,
}: NotificationRowProps) {
  const visual = getNotificationVisual(notification.notificationType);
  const isCompact = density === "compact";
  const isUnread = !notification.isRead;

  const activate = () => onActivate(notification);

  return (
    <li
      className={cn(
        "group relative border-l-2 transition-colors",
        isUnread
          ? cn(visual.accent, "bg-white dark:bg-dark-elevated")
          : "border-l-transparent bg-transparent",
      )}
      data-unread={isUnread ? "true" : "false"}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate();
        }}
        className={cn(
          "flex w-full cursor-pointer items-start text-left outline-none transition-colors",
          "hover:bg-gray-50 focus-visible:bg-gray-50 dark:hover:bg-dark-tertiary/70 dark:focus-visible:bg-dark-tertiary/70",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-whatsapp-teal-green",
          isCompact ? "gap-3 px-3 py-3" : "gap-3.5 px-4 py-4 sm:px-5",
        )}
        data-testid="notification-item"
      >
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded-xl",
            visual.tile,
            isCompact ? "size-9" : "size-10",
          )}
        >
          <NotificationTypeIcon
            type={notification.notificationType}
            className={isCompact ? "size-4" : "size-[18px]"}
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 text-sm leading-snug",
                isUnread
                  ? "font-semibold text-gray-900 dark:text-dark-text-primary"
                  : "font-medium text-gray-600 dark:text-dark-text-secondary",
              )}
            >
              {notification.title}
              {isUnread && <span className="sr-only"> (unread)</span>}
            </span>
          </span>

          {notification.message && (
            <span
              className={cn(
                "mt-1 block text-sm leading-snug text-gray-500 dark:text-dark-text-secondary",
                isCompact ? "truncate" : "line-clamp-2",
              )}
            >
              {notification.message}
            </span>
          )}

          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-gray-400 dark:text-dark-text-tertiary">
            <span className="uppercase tracking-[0.08em]">{visual.label}</span>
            <span aria-hidden="true">·</span>
            <time
              dateTime={notification.createdAt}
              title={formatNotificationTimestamp(notification.createdAt)}
              className="tabular-nums"
            >
              {formatNotificationTime(notification.createdAt)}
            </time>
          </span>
        </span>

        {/* Reserved column: the controls hold their space so revealing them on
            hover never reflows the row. */}
        <span
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity",
            "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 sm:focus-within:opacity-100",
          )}
        >
          {isUnread && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Mark "${notification.title}" as read`}
              className={cn(
                "rounded-full text-gray-400 hover:bg-whatsapp-green/10 hover:text-whatsapp-dark-green dark:text-dark-text-tertiary",
                isCompact ? "size-7" : "size-8",
              )}
              onClick={(event) => {
                event.stopPropagation();
                onMarkAsRead(notification.id);
              }}
            >
              <Check className={isCompact ? "size-3.5" : "size-4"} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete "${notification.title}"`}
            className={cn(
              "rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600 dark:text-dark-text-tertiary dark:hover:bg-red-900/30 dark:hover:text-red-400",
              isCompact ? "size-7" : "size-8",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(notification.id);
            }}
          >
            <Trash2 className={isCompact ? "size-3.5" : "size-4"} />
          </Button>
        </span>

        {/* Always rendered so read and unread rows keep the same right edge. */}
        <span
          aria-hidden="true"
          className={cn(
            "mt-2 size-2 shrink-0 self-start rounded-full",
            isUnread ? "bg-whatsapp-green" : "invisible",
          )}
        />
      </div>
    </li>
  );
}

/**
 * The notifications of one view, split into day groups with sticky headings.
 */
export function NotificationGroups({
  notifications,
  density = "comfortable",
  onActivate,
  onMarkAsRead,
  onDelete,
  className,
}: {
  notifications: readonly InAppNotification[];
  density?: NotificationDensity;
  onActivate: (notification: InAppNotification) => void;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  className?: string;
}) {
  const groups = groupNotificationsByDay(notifications);

  return (
    <div className={className}>
      {groups.map((group) => (
        <section
          key={group.key}
          aria-labelledby={`notification-day-${group.key}`}
        >
          <h3
            id={`notification-day-${group.key}`}
            className={cn(
              "sticky top-0 z-10 border-b border-gray-100 bg-gray-50/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500 backdrop-blur",
              "dark:border-dark-border dark:bg-dark-tertiary/95 dark:text-dark-text-secondary",
              density === "comfortable" && "sm:px-5",
            )}
          >
            {group.label}
          </h3>
          <ul className="divide-y divide-gray-100 dark:divide-dark-border/70">
            {group.items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                density={density}
                onActivate={onActivate}
                onMarkAsRead={onMarkAsRead}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Placeholder rows shaped like the real ones, to avoid a load-time jump. */
export function NotificationListSkeleton({
  density = "comfortable",
  rows = 5,
}: {
  density?: NotificationDensity;
  rows?: number;
}) {
  const isCompact = density === "compact";
  return (
    <div
      className="divide-y divide-gray-100 dark:divide-dark-border/70"
      aria-hidden="true"
      data-testid="notification-skeleton"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            "flex items-start",
            isCompact ? "gap-3 px-3 py-3" : "gap-3.5 px-4 py-4 sm:px-5",
          )}
        >
          <Skeleton
            className={cn(
              "shrink-0 rounded-xl",
              isCompact ? "size-9" : "size-10",
            )}
          />
          <div className="min-w-0 flex-1 space-y-2 py-0.5">
            <Skeleton className="h-3.5 w-2/5 rounded" />
            <Skeleton className="h-3 w-4/5 rounded" />
            <Skeleton className="h-2.5 w-24 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Nothing to show, phrased by why the view is empty. */
export function NotificationEmptyState({
  filter,
  density = "comfortable",
  beyondFirstPage = false,
  action,
}: {
  filter: NotificationFilter;
  density?: NotificationDensity;
  /** The view is a later page that no longer holds rows. */
  beyondFirstPage?: boolean;
  action?: React.ReactNode;
}) {
  const { title, description } = getNotificationEmptyState(filter, {
    beyondFirstPage,
  });
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        // The full-page card runs the height of the viewport, so the message
        // centres in it rather than clinging to the top of a tall void.
        density === "compact" ? "py-14" : "min-h-full py-16 sm:py-20",
      )}
      data-testid="notification-empty"
    >
      <div className="relative mb-5">
        <div className="grid size-16 place-items-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-dark-tertiary dark:text-dark-text-tertiary">
          <Bell className="size-7" aria-hidden="true" />
        </div>
        {filter === "unread" && !beyondFirstPage && (
          <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-whatsapp-green text-white shadow-sm">
            <Check className="size-3.5" aria-hidden="true" />
          </span>
        )}
      </div>
      <p className="text-balance text-base font-semibold text-gray-900 dark:text-dark-text-primary">
        {title}
      </p>
      <p className="mt-1.5 max-w-xs text-pretty text-sm text-gray-500 dark:text-dark-text-secondary">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** The list could not be loaded. Always offers the way back. */
export function NotificationErrorState({
  onRetry,
  isRetrying = false,
  density = "comfortable",
}: {
  onRetry: () => void;
  isRetrying?: boolean;
  density?: NotificationDensity;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center px-6 text-center",
        density === "compact" ? "py-14" : "min-h-full py-16 sm:py-20",
      )}
      data-testid="notification-error"
    >
      <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400">
        <TriangleAlert className="size-7" aria-hidden="true" />
      </div>
      <p className="text-base font-semibold text-gray-900 dark:text-dark-text-primary">
        Notifications could not be loaded
      </p>
      <p className="mt-1.5 max-w-xs text-pretty text-sm text-gray-500 dark:text-dark-text-secondary">
        The connection to your workspace failed. Your notifications are safe.
      </p>
      <Button
        variant="outline"
        className="mt-5"
        onClick={onRetry}
        disabled={isRetrying}
      >
        <RefreshCw
          className={cn("mr-2 size-4", isRetrying && "animate-spin")}
        />
        {isRetrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
