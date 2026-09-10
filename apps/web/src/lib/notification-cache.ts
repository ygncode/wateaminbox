import { toISOString } from "@wateaminbox/shared";
import type {
  InAppNotification,
  NotificationListParams,
  NotificationListResponse,
} from "./api/types";

export function markNotificationReadInResponse(
  response: NotificationListResponse,
  updated: InAppNotification,
  unreadOnly?: boolean,
): { response: NotificationListResponse; changedUnread: boolean } {
  const existing = response.data.find((item) => item.id === updated.id);
  const changedUnread = Boolean(existing && !existing.isRead);
  const unreadCount = changedUnread
    ? Math.max(0, response.meta.unreadCount - 1)
    : response.meta.unreadCount;

  if (unreadOnly) {
    return {
      changedUnread,
      response: {
        ...response,
        data: response.data.filter((item) => item.id !== updated.id),
        meta: {
          ...response.meta,
          total: existing
            ? Math.max(0, response.meta.total - 1)
            : response.meta.total,
          unreadCount,
        },
      },
    };
  }

  return {
    changedUnread,
    response: {
      ...response,
      data: response.data.map((item) =>
        item.id === updated.id ? updated : item,
      ),
      meta: {
        ...response.meta,
        unreadCount,
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

export function markAllNotificationsReadInResponse(
  response: NotificationListResponse,
  unreadOnly?: boolean,
): NotificationListResponse {
  if (unreadOnly) {
    return {
      ...response,
      data: [],
      meta: { ...response.meta, total: 0, unreadCount: 0 },
    };
  }

  return {
    ...response,
    data: response.data.map((item) => ({
      ...item,
      isRead: true,
      readAt: item.readAt ?? toISOString(),
    })),
    meta: { ...response.meta, unreadCount: 0 },
  };
}

export function isUnreadOnlyListQuery(queryKey: readonly unknown[]): boolean {
  const params = queryKey[queryKey.length - 1];
  return Boolean(
    params != null &&
      typeof params === "object" &&
      (params as NotificationListParams).unreadOnly === true,
  );
}
