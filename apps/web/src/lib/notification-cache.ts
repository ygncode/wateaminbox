import type { InAppNotification, NotificationListResponse } from "./api/types";

export function markNotificationReadInResponse(
  response: NotificationListResponse,
  updated: InAppNotification,
): { response: NotificationListResponse; changedUnread: boolean } {
  const existing = response.data.find((item) => item.id === updated.id);
  const changedUnread = Boolean(existing && !existing.isRead);
  return {
    changedUnread,
    response: {
      ...response,
      data: response.data.map((item) =>
        item.id === updated.id ? updated : item,
      ),
      meta: {
        ...response.meta,
        unreadCount: changedUnread
          ? Math.max(0, response.meta.unreadCount - 1)
          : response.meta.unreadCount,
      },
    },
  };
}

export function deleteNotificationFromResponse(
  response: NotificationListResponse,
  notificationId: string,
): { response: NotificationListResponse; deletedUnread: boolean } {
  const existing = response.data.find((item) => item.id === notificationId);
  const deletedUnread = Boolean(existing && !existing.isRead);
  return {
    deletedUnread,
    response: {
      ...response,
      data: response.data.filter((item) => item.id !== notificationId),
      meta: {
        ...response.meta,
        total: existing
          ? Math.max(0, response.meta.total - 1)
          : response.meta.total,
        unreadCount: deletedUnread
          ? Math.max(0, response.meta.unreadCount - 1)
          : response.meta.unreadCount,
      },
    },
  };
}
