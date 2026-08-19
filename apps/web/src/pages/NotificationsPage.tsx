import {
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import {
  NotificationEmptyState,
  NotificationErrorState,
  NotificationGroups,
  NotificationListSkeleton,
} from "@/components/notifications/NotificationList";
import {
  describeNotificationView,
  getNotificationPageRange,
  getNotificationVisual,
  type NotificationFilter,
  parseNotificationFilter,
  summarizeNotificationTypes,
} from "@/components/notifications/notification-presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/contexts/workspace-context";
import { useNotificationCenter } from "@/hooks/notification";
import type { InAppNotification } from "@/lib/api/types";
import { navigateToNotificationTarget } from "@/lib/notification-navigation";
import { cn } from "@/lib/utils";
import { workspacePath } from "@/lib/workspace-routes";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 25;

const FILTER_TABS: {
  id: NotificationFilter;
  labelKey: string;
  label: string;
}[] = [
  { id: "all", labelKey: "notifications.filterAll", label: "All" },
  { id: "unread", labelKey: "notifications.filterUnread", label: "Unread" },
];

/**
 * Activity Inbox: the full-page view of workspace notifications.
 *
 * The list is unfiltered by default — read notifications included — and the
 * unread view is an explicit, server-backed filter kept in the URL alongside
 * the page number, so a view can be linked and restored.
 */
export function NotificationsPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const { activeWorkspaceId } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  const filter = parseNotificationFilter(searchParams.get("filter"));
  const page = Math.max(0, Math.floor(Number(searchParams.get("page")) || 0));
  const offset = page * PAGE_SIZE;

  const controller = useNotificationCenter({
    limit: PAGE_SIZE,
    offset,
    // Absent unless the unread view is chosen: "all" must never be a filter.
    unreadOnly: filter === "unread" ? true : undefined,
  });

  const {
    notifications,
    total,
    unreadCount,
    hasMore,
    error,
    isLoadingNotifications,
    isFetching,
    isMarkingAllAsRead,
  } = controller;

  const range = getNotificationPageRange(offset, notifications.length, total);
  const typeCounts = summarizeNotificationTypes(notifications);
  const settingsPath = activeWorkspaceId
    ? workspacePath(activeWorkspaceId, "settings", "notifications")
    : "/settings/notifications";

  const updateParams = (
    apply: (next: URLSearchParams) => void,
    { resetPage = false } = {},
  ) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        apply(next);
        if (resetPage) next.delete("page");
        return next;
      },
      { replace: true },
    );
  };

  const setFilter = (next: NotificationFilter) => {
    updateParams(
      (params) => {
        if (next === "all") params.delete("filter");
        else params.set("filter", next);
      },
      { resetPage: true },
    );
  };

  const setPage = (next: number) => {
    updateParams((params) => {
      if (next <= 0) params.delete("page");
      else params.set("page", String(next));
    });
  };

  const openNotification = (notification: InAppNotification) => {
    if (!notification.isRead) controller.markAsRead(notification.id);
    navigateToNotificationTarget(
      notification.actionUrl,
      navigate,
      activeWorkspaceId,
    );
  };

  const showSkeleton = isLoadingNotifications;
  const showEmpty = !showSkeleton && !error && notifications.length === 0;

  // The page is a container: every width decision below is made against the
  // shell's content area rather than the viewport, so collapsing the workspace
  // rail actually widens the inbox instead of opening dead gutters beside a
  // fixed-width column.
  return (
    <div className="@container flex h-full min-h-0 flex-col overflow-hidden bg-[#f5f7f4] dark:bg-dark-primary">
      <header className="shrink-0 border-b border-[#dce3de] bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-secondary sm:px-6">
        <div className="flex w-full flex-wrap items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-[#075c41] dark:bg-emerald-950/60 dark:text-emerald-300">
            <Bell className="size-[18px]" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold leading-none text-[#10211b] dark:text-dark-text-primary">
                Notifications
              </h1>
              {unreadCount > 0 && (
                <Badge
                  variant="outline"
                  className="px-2 py-0 text-[10px] tabular-nums"
                >
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
              {describeNotificationView({
                filter,
                total,
                unreadCount,
                isLoading: showSkeleton,
              })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={controller.markAllAsRead}
                disabled={isMarkingAllAsRead}
              >
                <CheckCheck className="mr-1.5 size-4" />
                <span className="hidden sm:inline">
                  {isMarkingAllAsRead
                    ? t("notifications.marking", "Marking…")
                    : t("notifications.markAllAsRead", "Mark all as read")}
                </span>
                <span className="sm:hidden">
                  {t("notifications.markAll", "Mark all")}
                </span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(
                "notifications.openSettings",
                "Open notification settings",
              )}
              className="size-9 rounded-lg text-[#65736d] dark:text-dark-text-secondary"
              onClick={() => navigate(settingsPath)}
            >
              <Settings2 className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Padding matches the header's so the list card and the page title share
          one left edge at every width. */}
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex h-full min-h-0 w-full gap-4">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#dce3de] bg-white shadow-sm dark:border-dark-border dark:bg-dark-secondary">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#e6ebe7] px-3 py-2.5 dark:border-dark-border sm:px-4">
              <div
                role="group"
                aria-label={t("notifications.filter", "Filter notifications")}
                className="flex items-center gap-0.5 rounded-lg border border-[#d7e0da] bg-white p-0.5 shadow-sm dark:border-dark-border dark:bg-dark-elevated"
              >
                {FILTER_TABS.map((tab) => {
                  const active = filter === tab.id;
                  return (
                    <Button
                      key={tab.id}
                      variant="ghost"
                      size="sm"
                      aria-pressed={active}
                      onClick={() => setFilter(tab.id)}
                      className={cn(
                        "h-8 rounded-md px-3 text-xs font-medium",
                        active &&
                          "bg-[#e8f1ec] text-[#075c41] dark:bg-dark-tertiary dark:text-emerald-300",
                      )}
                    >
                      {t(tab.labelKey, tab.label)}
                      {tab.id === "unread" && unreadCount > 0 && (
                        <span className="ml-1.5 grid min-w-4 place-items-center rounded-full bg-[#0b7a55] px-1 py-0.5 text-[9px] font-bold leading-none tabular-nums text-white">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <p
                  className="hidden text-[11px] text-[#7a8881] tabular-nums dark:text-dark-text-secondary sm:block"
                  aria-live="polite"
                >
                  {range.end === 0
                    ? t("search.noResultsShort", "No results")
                    : t("notifications.showingRange", {
                        defaultValue: "Showing {{start}}–{{end}} of {{total}}",
                        start: range.start,
                        end: range.end,
                        total,
                      })}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t(
                    "notifications.refresh",
                    "Refresh notifications",
                  )}
                  className="size-8 rounded-lg text-[#65736d] dark:text-dark-text-secondary"
                  onClick={controller.refresh}
                  disabled={isFetching}
                >
                  <RefreshCw
                    className={cn("size-4", isFetching && "animate-spin")}
                  />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {showSkeleton ? (
                <NotificationListSkeleton rows={6} />
              ) : error ? (
                <NotificationErrorState
                  onRetry={controller.refresh}
                  isRetrying={isFetching}
                />
              ) : showEmpty ? (
                <NotificationEmptyState
                  filter={filter}
                  beyondFirstPage={page > 0}
                  action={
                    page > 0 ? (
                      <Button variant="outline" onClick={() => setPage(0)}>
                        {t(
                          "notifications.backToFirstPage",
                          "Back to the first page",
                        )}
                      </Button>
                    ) : filter === "unread" ? (
                      <Button
                        variant="outline"
                        onClick={() => setFilter("all")}
                      >
                        {t("notifications.viewAll", "View all notifications")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => navigate(settingsPath)}
                      >
                        {t("notifications.settings", "Notification settings")}
                      </Button>
                    )
                  }
                />
              ) : (
                <NotificationGroups
                  notifications={notifications}
                  onActivate={openNotification}
                  onMarkAsRead={controller.markAsRead}
                  onDelete={controller.deleteNotification}
                />
              )}
            </div>

            {(page > 0 || hasMore) && (
              <nav
                aria-label={t("notifications.pages", "Notification pages")}
                className="flex shrink-0 items-center justify-between gap-3 border-t border-[#e6ebe7] px-3 py-2.5 dark:border-dark-border sm:px-4"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="mr-1 size-4" />
                  Previous
                </Button>
                <span className="text-[11px] font-medium text-[#7a8881] tabular-nums dark:text-dark-text-secondary">
                  Page {page + 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!hasMore}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              </nav>
            )}
          </section>

          {/* Keyed to the content area, not the viewport: the summary rail
              appears when there is genuinely room for it beside the list. */}
          <aside className="@5xl:flex hidden w-72 shrink-0 flex-col gap-4">
            <div className="rounded-xl border border-[#dce3de] bg-white p-4 shadow-sm dark:border-dark-border dark:bg-dark-secondary">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7a8881] dark:text-dark-text-secondary">
                {t("notifications.waitingOnYou", "Waiting on you")}
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums text-[#10211b] dark:text-dark-text-primary">
                {unreadCount}
              </p>
              <p className="mt-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
                {unreadCount === 0
                  ? t(
                      "notifications.allRead",
                      "Every notification in this workspace has been read.",
                    )
                  : t("notifications.unreadAcrossWorkspace", {
                      defaultValue:
                        "Unread notifications across this workspace.",
                      count: unreadCount,
                    })}
              </p>
              {unreadCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={controller.markAllAsRead}
                  disabled={isMarkingAllAsRead}
                >
                  <CheckCheck className="mr-1.5 size-4" />
                  {t("notifications.markAllAsRead", "Mark all as read")}
                </Button>
              )}
            </div>

            {typeCounts.length > 0 && (
              <div className="rounded-xl border border-[#dce3de] bg-white p-4 shadow-sm dark:border-dark-border dark:bg-dark-secondary">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7a8881] dark:text-dark-text-secondary">
                  {t("notifications.onThisPage", "On this page")}
                </p>
                <ul className="mt-3 space-y-2.5">
                  {typeCounts.map((entry) => (
                    <li
                      key={entry.type}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            getNotificationVisual(entry.type).dot,
                          )}
                        />
                        <span className="truncate text-[#31463e] dark:text-dark-text-primary">
                          {entry.label}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-[#7a8881] dark:text-dark-text-secondary">
                        {entry.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
