/**
 * Presentation logic shared by the notification sheet and the Activity Inbox
 * page: type styling, day grouping, and the copy for summaries and empty
 * states.
 *
 * Kept free of JSX so both surfaces read from one source of truth and the
 * behaviour stays directly assertable.
 */

import { dayjs } from "@wateaminbox/shared";
import type { InAppNotification, NotificationType } from "@/lib/api/types";

/** Server-backed views of the list. */
export type NotificationFilter = "all" | "unread";

/** Reads a filter out of URL state, falling back to the unfiltered view. */
export function parseNotificationFilter(
  value: string | null | undefined,
): NotificationFilter {
  return value === "unread" ? "unread" : "all";
}

export interface NotificationTypeVisual {
  /** Human label used in the row's meta line and the type breakdown. */
  label: string;
  /** Icon tile background and foreground. */
  tile: string;
  /** Left accent shown while the notification is unread. */
  accent: string;
  /** Saturated swatch for legends, where a tile tint is too faint to read. */
  dot: string;
}

/**
 * Per-type palette. Each type keeps a stable hue across the sheet and the page
 * so a notification is recognisable in either surface.
 */
const NOTIFICATION_TYPE_VISUALS: Record<
  NotificationType,
  NotificationTypeVisual
> = {
  message: {
    label: "Message",
    tile: "bg-info-soft text-info",
    accent: "border-s-info",
    dot: "bg-info",
  },
  mention: {
    label: "Mention",
    tile: "bg-id-3-soft text-id-3",
    accent: "border-s-id-3",
    dot: "bg-id-3",
  },
  assignment: {
    label: "Assignment",
    tile: "bg-accent-soft text-accent",
    accent: "border-s-accent",
    dot: "bg-accent",
  },
  team: {
    label: "Team",
    tile: "bg-warning-soft text-warning",
    accent: "border-s-warning",
    dot: "bg-warning",
  },
  system: {
    label: "System",
    tile: "bg-muted text-fg",
    accent: "border-s-line-strong",
    dot: "bg-fg-subtle",
  },
};

const FALLBACK_VISUAL: NotificationTypeVisual = {
  label: "Update",
  tile: "bg-muted text-fg-muted",
  accent: "border-s-line-strong",
  dot: "bg-fg-subtle",
};

/** Styling for a type, tolerating types added by a newer server. */
export function getNotificationVisual(
  type: NotificationType,
): NotificationTypeVisual {
  return NOTIFICATION_TYPE_VISUALS[type] ?? FALLBACK_VISUAL;
}

export interface NotificationDayGroup {
  /** Stable local calendar day, e.g. `2026-08-05`. */
  key: string;
  /** Heading shown above the group. */
  label: string;
  items: InAppNotification[];
}

/**
 * Buckets notifications into local calendar days, preserving the server's
 * newest-first order both between and within groups.
 *
 * `reference` is injectable so "Today" and "Yesterday" are testable.
 */
export function groupNotificationsByDay(
  notifications: readonly InAppNotification[],
  reference: Date | string | number = new Date(),
): NotificationDayGroup[] {
  const today = dayjs(reference).startOf("day");
  const groups = new Map<string, NotificationDayGroup>();

  for (const notification of notifications) {
    const createdAt = dayjs(notification.createdAt);
    // An unparseable timestamp must not drop the row from the list.
    const day = createdAt.isValid() ? createdAt.startOf("day") : today;
    const key = day.format("YYYY-MM-DD");

    const existing = groups.get(key);
    if (existing) {
      existing.items.push(notification);
      continue;
    }

    groups.set(key, {
      key,
      label: formatDayLabel(day, today),
      items: [notification],
    });
  }

  return [...groups.values()];
}

function formatDayLabel(
  day: ReturnType<typeof dayjs>,
  today: ReturnType<typeof dayjs>,
): string {
  // Rounding hours keeps the label correct across daylight-saving boundaries,
  // where a calendar day is not 24 hours long.
  const daysAgo = Math.round(today.diff(day, "hour") / 24);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo > 1 && daysAgo < 7) return day.format("dddd");
  return day.year() === today.year()
    ? day.format("D MMMM")
    : day.format("D MMMM YYYY");
}

/** Clock time for a row, since the group heading already carries the date. */
export function formatNotificationTime(value: string): string {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("HH:mm") : "";
}

/** Full timestamp for the row's tooltip and `<time>` label. */
export function formatNotificationTimestamp(value: string): string {
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("D MMMM YYYY [at] HH:mm") : "";
}

/**
 * Sentence under the page title. It states what the current view contains, so
 * an empty unread view never reads as an empty inbox.
 */
export function describeNotificationView({
  filter,
  total,
  unreadCount,
  isLoading = false,
}: {
  filter: NotificationFilter;
  total: number;
  unreadCount: number;
  isLoading?: boolean;
}): string {
  if (isLoading) return "Loading your workspace activity…";

  const unread = `${unreadCount} unread`;
  if (filter === "unread") {
    return total === 0
      ? "No unread notifications in this workspace."
      : `Showing ${pluralize(total, "unread notification")}.`;
  }
  return total === 0
    ? "No notifications in this workspace yet."
    : `${pluralize(total, "notification")} · ${unread}.`;
}

/** Copy for the empty list, differentiated by why it is empty. */
export function getNotificationEmptyState(
  filter: NotificationFilter,
  { beyondFirstPage = false }: { beyondFirstPage?: boolean } = {},
): {
  title: string;
  description: string;
} {
  // A later page can empty out while it is open, after the rows on it were
  // read or deleted. That is not an empty inbox.
  if (beyondFirstPage) {
    return {
      title: "Nothing on this page",
      description:
        "These notifications are gone or this page is past the end of the list.",
    };
  }
  if (filter === "unread") {
    return {
      title: "You're all caught up",
      description:
        "Nothing is waiting on you. Switch to All to revisit notifications you have already read.",
    };
  }
  return {
    title: "No notifications yet",
    description:
      "Mentions, assignments and team activity from this workspace will land here.",
  };
}

export interface NotificationTypeCount {
  type: NotificationType;
  label: string;
  count: number;
}

/**
 * Type breakdown for the notifications currently loaded, largest first with a
 * stable tie-break so the list does not reshuffle between renders.
 */
export function summarizeNotificationTypes(
  notifications: readonly InAppNotification[],
): NotificationTypeCount[] {
  const counts = new Map<NotificationType, number>();
  for (const notification of notifications) {
    const type = notification.notificationType;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([type, count]) => ({
      type,
      label: getNotificationVisual(type).label,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * One-based range of the rows on screen, for "Showing 1–25 of 60".
 * Returns a zeroed range when the page holds nothing.
 */
export function getNotificationPageRange(
  offset: number,
  pageCount: number,
  total: number,
): { start: number; end: number } {
  if (pageCount <= 0 || total <= 0) return { start: 0, end: 0 };
  const start = offset + 1;
  return { start, end: Math.min(offset + pageCount, total) };
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
