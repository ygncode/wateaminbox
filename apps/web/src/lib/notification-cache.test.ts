import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  describeNotificationView,
  getNotificationPageRange,
} from "@/components/notifications/notification-presentation";
import { queryKeys } from "../hooks/query-keys";
import type { InAppNotification, NotificationListResponse } from "./api/types";
import {
  deleteNotificationFromResponse,
  isUnreadOnlyListQuery,
  markAllNotificationsReadInResponse,
  markNotificationReadInResponse,
} from "./notification-cache";

const notification: InAppNotification = {
  id: "one",
  userId: "user",
  notificationType: "system",
  title: "One",
  message: null,
  actionUrl: null,
  metadata: null,
  isRead: false,
  readAt: null,
  createdAt: "2025-01-01T00:00:00Z",
};
const response: NotificationListResponse = {
  data: [notification],
  meta: { total: 1, unreadCount: 1, limit: 20, offset: 0 },
};

function makeNotification(
  id: string,
  overrides: Partial<InAppNotification> = {},
): InAppNotification {
  return {
    ...notification,
    id,
    title: id,
    createdAt: "2026-08-05T09:00:00Z",
    ...overrides,
  };
}

/** A server-shaped unread-filter response: every row is unread. */
function unreadResponse(
  ids: string[],
  total = ids.length,
): NotificationListResponse {
  return {
    data: ids.map((id) => makeNotification(id)),
    meta: { total, unreadCount: total, limit: 25, offset: 0 },
  };
}

/** A server-shaped unfiltered ("all") response mixing read and unread rows. */
function allResponse(
  rows: { id: string; isRead: boolean }[],
  unreadCount: number,
): NotificationListResponse {
  return {
    data: rows.map((row) =>
      makeNotification(row.id, {
        isRead: row.isRead,
        readAt: row.isRead ? "2026-08-04T00:00:00Z" : null,
      }),
    ),
    meta: { total: rows.length, unreadCount, limit: 25, offset: 0 },
  };
}

describe("notification cache updates", () => {
  test("marks read and clamps unread counts", () => {
    const result = markNotificationReadInResponse(
      { ...response, meta: { ...response.meta, unreadCount: 0 } },
      { ...notification, isRead: true, readAt: "2025-01-01T00:01:00Z" },
    );
    expect(result.changedUnread).toBe(true);
    expect(result.response.meta.unreadCount).toBe(0);
  });
  test("deletes from every list shape without negative totals", () => {
    const result = deleteNotificationFromResponse(response, "one");
    expect(result.deletedUnread).toBe(true);
    expect(result.response.data).toEqual([]);
    expect(result.response.meta).toMatchObject({ total: 0, unreadCount: 0 });
  });
});

describe("markAllNotificationsReadInResponse", () => {
  test("the unread-filter view is emptied: no rows, total 0, unreadCount 0", () => {
    const before = unreadResponse(["a", "b", "c"], 3);
    const after = markAllNotificationsReadInResponse(before, true);
    expect(after.data).toEqual([]);
    expect(after.meta.total).toBe(0);
    expect(after.meta.unreadCount).toBe(0);
    expect(after.meta.limit).toBe(25);
    expect(after.meta.offset).toBe(0);
  });

  test("the unread-filter branch also zeroes a view that already reported 0 unread", () => {
    const before = unreadResponse([], 0);
    const after = markAllNotificationsReadInResponse(before, true);
    expect(after.data).toEqual([]);
    expect(after.meta.total).toBe(0);
    expect(after.meta.unreadCount).toBe(0);
  });

  test("the all view keeps every row, marks it read, and leaves total unchanged", () => {
    const before = allResponse(
      [
        { id: "a", isRead: true },
        { id: "b", isRead: false },
        { id: "c", isRead: false },
      ],
      2,
    );
    const after = markAllNotificationsReadInResponse(before);
    expect(after.data).toHaveLength(3);
    expect(after.data.every((item) => item.isRead)).toBe(true);
    expect(after.meta.total).toBe(3);
    expect(after.meta.unreadCount).toBe(0);
    expect(after.meta.limit).toBe(25);
  });

  test("the all view fills readAt for rows that had none and keeps an existing readAt", () => {
    const before = allResponse(
      [
        { id: "a", isRead: true },
        { id: "b", isRead: false },
      ],
      1,
    );
    const after = markAllNotificationsReadInResponse(before);
    const readA = after.data.find((item) => item.id === "a");
    const readB = after.data.find((item) => item.id === "b");
    expect(readA?.readAt).toBe("2026-08-04T00:00:00Z");
    expect(readB?.readAt).toBeTruthy();
    expect(() => new Date(readB!.readAt as string).toISOString()).not.toThrow();
  });

  test("reading the default (no flag) behaves like the all view — rows stay, total unchanged", () => {
    const before = unreadResponse(["a", "b"], 2);
    const after = markAllNotificationsReadInResponse(before);
    expect(after.data).toHaveLength(2);
    expect(after.meta.total).toBe(2);
    expect(after.meta.unreadCount).toBe(0);
  });
});

describe("markNotificationReadInResponse — filter awareness", () => {
  test("the unread-filter view drops the just-read row and decrements total and unreadCount", () => {
    const before = unreadResponse(["a", "b", "c"], 3);
    const updated = makeNotification("b", {
      isRead: true,
      readAt: "2026-08-05T10:00:00Z",
    });
    const { response: after, changedUnread } = markNotificationReadInResponse(
      before,
      updated,
      true,
    );
    expect(changedUnread).toBe(true);
    expect(after.data.map((item) => item.id)).toEqual(["a", "c"]);
    expect(after.meta.total).toBe(2);
    expect(after.meta.unreadCount).toBe(2);
  });

  test("the unread-filter view does not go negative when the last row is marked read", () => {
    const before = unreadResponse(["only"], 1);
    const updated = makeNotification("only", {
      isRead: true,
      readAt: "2026-08-05T10:00:00Z",
    });
    const { response: after } = markNotificationReadInResponse(
      before,
      updated,
      true,
    );
    expect(after.data).toEqual([]);
    expect(after.meta.total).toBe(0);
    expect(after.meta.unreadCount).toBe(0);
  });

  test("the unread-filter view leaves total and unreadCount untouched for an off-page row", () => {
    const before = unreadResponse(["a", "c"], 2);
    const updated = makeNotification("off-page", {
      isRead: true,
      readAt: "2026-08-05T10:00:00Z",
    });
    const { response: after, changedUnread } = markNotificationReadInResponse(
      before,
      updated,
      true,
    );
    expect(changedUnread).toBe(false);
    expect(after.data.map((item) => item.id)).toEqual(["a", "c"]);
    expect(after.meta.total).toBe(2);
    expect(after.meta.unreadCount).toBe(2);
  });

  test("the all view patches the row in place and leaves total unchanged", () => {
    const before = allResponse(
      [
        { id: "a", isRead: true },
        { id: "b", isRead: false },
        { id: "c", isRead: false },
      ],
      2,
    );
    const updated = makeNotification("b", {
      isRead: true,
      readAt: "2026-08-05T10:00:00Z",
    });
    const { response: after, changedUnread } = markNotificationReadInResponse(
      before,
      updated,
      false,
    );
    expect(changedUnread).toBe(true);
    expect(after.data.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(after.data.find((item) => item.id === "b")?.isRead).toBe(true);
    expect(after.meta.total).toBe(3);
    expect(after.meta.unreadCount).toBe(1);
  });

  test("the all view reports no change when an already-read row is marked read again", () => {
    const before = allResponse(
      [
        { id: "a", isRead: true },
        { id: "b", isRead: false },
      ],
      1,
    );
    const updated = makeNotification("a", {
      isRead: true,
      readAt: "2026-08-04T00:00:00Z",
    });
    const { response: after, changedUnread } = markNotificationReadInResponse(
      before,
      updated,
      false,
    );
    expect(changedUnread).toBe(false);
    expect(after.meta.total).toBe(2);
    expect(after.meta.unreadCount).toBe(1);
  });

  test("the default (no flag) behaves like the all view — patches in place, total unchanged", () => {
    const before = allResponse(
      [
        { id: "a", isRead: false },
        { id: "b", isRead: false },
      ],
      2,
    );
    const updated = makeNotification("a", {
      isRead: true,
      readAt: "2026-08-05T10:00:00Z",
    });
    const { response: after, changedUnread } = markNotificationReadInResponse(
      before,
      updated,
    );
    expect(changedUnread).toBe(true);
    expect(after.data.map((item) => item.id)).toEqual(["a", "b"]);
    expect(after.meta.total).toBe(2);
    expect(after.meta.unreadCount).toBe(1);
  });
});

describe("isUnreadOnlyListQuery", () => {
  test("true only when the cached list's params carry unreadOnly: true", () => {
    expect(
      isUnreadOnlyListQuery([
        "notifications",
        "company-1",
        "list",
        { limit: 25, offset: 0, unreadOnly: true },
      ]),
    ).toBe(true);
  });

  test("false for the all-view shapes used by the inbox and the slide-out sheet", () => {
    expect(
      isUnreadOnlyListQuery([
        "notifications",
        "company-1",
        "list",
        { limit: 25, offset: 0, unreadOnly: undefined },
      ]),
    ).toBe(false);
    expect(
      isUnreadOnlyListQuery(["notifications", "company-1", "list", {}]),
    ).toBe(false);
    expect(
      isUnreadOnlyListQuery([
        "notifications",
        "company-1",
        "list",
        { limit: 25, offset: 25, unreadOnly: false },
      ]),
    ).toBe(false);
  });

  test("false for keys that are not list params (count / detail) or non-object tails", () => {
    expect(isUnreadOnlyListQuery(["notifications", "company-1", "count"])).toBe(
      false,
    );
    expect(isUnreadOnlyListQuery(["notifications", "company-1", "list"])).toBe(
      false,
    );
    expect(isUnreadOnlyListQuery([])).toBe(false);
    expect(isUnreadOnlyListQuery(["notifications"])).toBe(false);
  });
});

/**
 * Mirrors the optimistic loop in `useNotificationCenter`'s `useCallbackForLists`:
 * iterate every cached list entry, derive its filter from its key, and apply an
 * unread-aware updater. Keeping it here (rather than importing the hook helper)
 * lets the cache-layer test prove the real composition over a live QueryClient.
 */
function applyToLists(
  queryClient: QueryClient,
  updater: (
    old: NotificationListResponse,
    unreadOnly: boolean,
  ) => NotificationListResponse,
): void {
  const entries = queryClient.getQueriesData<NotificationListResponse>({
    queryKey: queryKeys.notifications.lists(),
  });
  for (const [queryKey, old] of entries) {
    if (!old) continue;
    queryClient.setQueryData<NotificationListResponse>(
      queryKey,
      updater(old, isUnreadOnlyListQuery(queryKey)),
    );
  }
}

describe("optimistic update composition over a real QueryClient", () => {
  test("markAllAsRead empties the unread-view cache and patches the all-view in place", () => {
    const qc = new QueryClient();
    const unreadKey = queryKeys.notifications.list({
      limit: 25,
      offset: 0,
      unreadOnly: true,
    });
    const allKey = queryKeys.notifications.list({ limit: 25, offset: 0 });
    qc.setQueryData(unreadKey, unreadResponse(["a", "b", "c"], 3));
    qc.setQueryData(
      allKey,
      allResponse(
        [
          { id: "a", isRead: true },
          { id: "b", isRead: false },
          { id: "c", isRead: false },
        ],
        2,
      ),
    );

    applyToLists(qc, (old, unreadOnly) =>
      markAllNotificationsReadInResponse(old, unreadOnly),
    );

    const unreadAfter = qc.getQueryData<NotificationListResponse>(unreadKey);
    expect(unreadAfter?.data).toEqual([]);
    expect(unreadAfter?.meta.total).toBe(0);
    expect(unreadAfter?.meta.unreadCount).toBe(0);

    const allAfter = qc.getQueryData<NotificationListResponse>(allKey);
    expect(allAfter?.data).toHaveLength(3);
    expect(allAfter?.data.every((item) => item.isRead)).toBe(true);
    expect(allAfter?.meta.total).toBe(3);
    expect(allAfter?.meta.unreadCount).toBe(0);
  });

  test("markAsRead removes the row from the unread view and patches it in the all view", () => {
    const qc = new QueryClient();
    const unreadKey = queryKeys.notifications.list({
      limit: 25,
      offset: 0,
      unreadOnly: true,
    });
    const allKey = queryKeys.notifications.list({ limit: 25, offset: 0 });
    qc.setQueryData(unreadKey, unreadResponse(["a", "b", "c"], 3));
    qc.setQueryData(
      allKey,
      allResponse(
        [
          { id: "a", isRead: false },
          { id: "b", isRead: false },
          { id: "c", isRead: false },
        ],
        3,
      ),
    );

    const updated = makeNotification("b", {
      isRead: true,
      readAt: "2026-08-05T10:00:00Z",
    });
    applyToLists(
      qc,
      (old, unreadOnly) =>
        markNotificationReadInResponse(old, updated, unreadOnly).response,
    );

    const unreadAfter = qc.getQueryData<NotificationListResponse>(unreadKey);
    expect(unreadAfter?.data.map((item) => item.id)).toEqual(["a", "c"]);
    expect(unreadAfter?.meta.total).toBe(2);
    expect(unreadAfter?.meta.unreadCount).toBe(2);

    const allAfter = qc.getQueryData<NotificationListResponse>(allKey);
    expect(allAfter?.data.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(allAfter?.data.find((item) => item.id === "b")?.isRead).toBe(true);
    expect(allAfter?.meta.total).toBe(3);
    expect(allAfter?.meta.unreadCount).toBe(2);
  });

  test("after markAllAsRead, the unread view renders the caught-up copy, not a stale total", () => {
    const fixedCache = markAllNotificationsReadInResponse(
      unreadResponse(["a", "b", "c"], 3),
      true,
    );
    expect(
      describeNotificationView({
        filter: "unread",
        total: fixedCache.meta.total,
        unreadCount: 0,
      }),
    ).toBe("No unread notifications in this workspace.");
    expect(
      getNotificationPageRange(
        0,
        fixedCache.data.length,
        fixedCache.meta.total,
      ),
    ).toEqual({ start: 0, end: 0 });
  });

  test("after a single markAsRead, the unread view no longer contradicts the count", () => {
    const fixedCache = markNotificationReadInResponse(
      unreadResponse(["a", "b", "c"], 3),
      makeNotification("a", { isRead: true, readAt: "2026-08-05T10:00:00Z" }),
      true,
    ).response;
    expect(
      describeNotificationView({
        filter: "unread",
        total: fixedCache.meta.total,
        unreadCount: 2,
      }),
    ).toBe("Showing 2 unread notifications.");
    expect(
      getNotificationPageRange(
        0,
        fixedCache.data.length,
        fixedCache.meta.total,
      ),
    ).toEqual({ start: 1, end: 2 });
  });
});
