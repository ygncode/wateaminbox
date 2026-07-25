import { describe, expect, test } from "bun:test";
import type { InAppNotification, NotificationListResponse } from "./api/types";
import {
  deleteNotificationFromResponse,
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
