import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";

/**
 * Regression test for the "unread tab shows stale subtitle/range counts after
 * marking notifications as read" bug. Renders the real `NotificationsPage`
 * through `react-dom/server` and greps the HTML for the user-visible
 * contradiction. Hooks/providers are stubbed via `bun:test`'s `mock.module` so
 * no React Query / React Router / i18n provider is needed.
 */

let controllerState: {
  notifications: Array<{
    id: string;
    title: string;
    notificationType: string;
    isRead: boolean;
    readAt: string | null;
    createdAt: string;
  }>;
  total: number;
  unreadCount: number;
  hasMore: boolean;
  error: unknown;
  isLoadingNotifications: boolean;
  isFetching: boolean;
  isMarkingAllAsRead: boolean;
} = {
  notifications: [],
  total: 0,
  unreadCount: 0,
  hasMore: false,
  error: null,
  isLoadingNotifications: false,
  isFetching: false,
  isMarkingAllAsRead: false,
};

mock.module("@/hooks/notification", () => ({
  useNotificationCenter: () => ({
    notifications: controllerState.notifications,
    total: controllerState.total,
    unreadCount: controllerState.unreadCount,
    hasMore: controllerState.hasMore,
    error: controllerState.error,
    isLoading: controllerState.isLoadingNotifications,
    isLoadingNotifications: controllerState.isLoadingNotifications,
    isLoadingCount: false,
    isFetching: controllerState.isFetching,
    markAsRead: () => {},
    markAllAsRead: () => {},
    deleteNotification: () => {},
    refresh: () => {},
    isMarkingAsRead: false,
    isMarkingAllAsRead: controllerState.isMarkingAllAsRead,
    isDeleting: false,
  }),
}));

mock.module("@/contexts/workspace-context", () => ({
  useWorkspace: () => ({ activeWorkspaceId: "ws-1" }),
}));

mock.module("react-router", () => ({
  useNavigate: () => () => {},
  useSearchParams: () => {
    const params = new URLSearchParams();
    params.set("filter", "unread");
    const setter = () => {};
    return [params, setter];
  },
}));

// `react-i18next` `useTranslation` returns a `t` that uses its second arg as
// the fallback string, or — for the interpolation form — an options object
// with `defaultValue` and `{{key}}` placeholders. Both patterns are used by
// the page and NotificationList.
mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === "string") return fallback;
      if (fallback && typeof fallback === "object") {
        let text = (fallback.defaultValue as string) ?? key;
        for (const [k, v] of Object.entries(fallback)) {
          text = text.replace(new RegExp(`{{${k}}}`, "g"), String(v));
        }
        return text;
      }
      return key;
    },
  }),
}));

let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let NotificationsPage: typeof import("@/pages/NotificationsPage").NotificationsPage;

describe("SSR regression: unread tab post-mutation coherence", () => {
  test("post-markAllAsRead — subtitle says caught up and range says No results", async () => {
    controllerState = {
      notifications: [],
      total: 0,
      unreadCount: 0,
      hasMore: false,
      error: null,
      isLoadingNotifications: false,
      isFetching: false,
      isMarkingAllAsRead: false,
    };

    const server = await import("react-dom/server");
    renderToStaticMarkup = server.renderToStaticMarkup;
    const page = await import("@/pages/NotificationsPage");
    NotificationsPage = page.NotificationsPage;

    const html = renderToStaticMarkup(createElement(NotificationsPage));

    // FIXED: subtitle resolves off the now-zero meta.total.
    expect(html).toContain("No unread notifications in this workspace.");
    // FIXED: the stale pre-fix subtitle must not appear.
    expect(html).not.toContain("Showing 3 unread notifications.");

    // FIXED: range counter reports No results since total === 0.
    expect(html).toContain("No results");
    expect(html).not.toContain("Showing 1\u20133 of 3");

    // Rail card flips to all-read (driven by unreadCount === 0).
    expect(html).toContain(
      "Every notification in this workspace has been read.",
    );

    // "Mark all as read" buttons (header + rail) — gated by unreadCount > 0.
    expect(html).not.toContain("Mark all as read");

    // No header badge.
    expect(html.match(/>\s*\d+\s*unread\s*</)).toBeNull();

    // Empty state renders for the unread filter (apostrophe is HTML-escaped).
    expect(html).toContain("all caught up");
  });

  test("post-markAsRead (single) — subtitle, range, and badge all agree on 2", async () => {
    const remaining = [
      {
        id: "b",
        title: "b",
        notificationType: "system",
        isRead: false,
        readAt: null,
        createdAt: "2026-08-05T09:00:00Z",
      },
      {
        id: "c",
        title: "c",
        notificationType: "system",
        isRead: false,
        readAt: null,
        createdAt: "2026-08-05T08:00:00Z",
      },
    ];
    controllerState = {
      notifications: remaining,
      total: remaining.length,
      unreadCount: remaining.length,
      hasMore: false,
      error: null,
      isLoadingNotifications: false,
      isFetching: false,
      isMarkingAllAsRead: false,
    };

    const html = renderToStaticMarkup(createElement(NotificationsPage));

    // FIXED: subtitle says 2, not the stale 3.
    expect(html).toContain("Showing 2 unread notifications.");
    expect(html).not.toContain("Showing 3 unread notifications.");

    // FIXED: range says 1–2 of 2.
    expect(html).toContain("Showing 1\u20132 of 2");
    expect(html).not.toContain("Showing 1\u20133 of 3");

    // Header badge reads 2 unread (the count-query value — coherent now).
    expect(html).toContain("2 unread");

    // "Mark all as read" still visible (unreadCount > 0).
    expect(html).toContain("Mark all as read");
  });
});
