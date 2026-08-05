/**
 * Notifications API
 * Notification preferences and notification history API functions
 */

import { fetchWithAuth, buildQueryString } from "./client.js";
import { buildNotificationListQuery } from "./notification-query.js";
import type {
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesInput,
  InAppNotification,
  NotificationListParams,
  NotificationListResponse,
  CreateNotificationInput,
  PushStatusResponse,
  PushSubscriptionInput,
} from "./types.js";

// Notification Preferences
export async function getNotificationPreferences(): Promise<NotificationPreferencesResponse> {
  return fetchWithAuth<NotificationPreferencesResponse>(
    "/notifications/preferences",
  );
}

export async function updateNotificationPreferences(
  input: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferencesResponse> {
  return fetchWithAuth<NotificationPreferencesResponse>(
    "/notifications/preferences",
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function muteContactApi(
  contactJid: string,
): Promise<{ mutedContacts: string[] }> {
  return fetchWithAuth<{ mutedContacts: string[] }>("/notifications/mute", {
    method: "POST",
    body: JSON.stringify({ contactJid }),
  });
}

export async function unmuteContactApi(
  contactJid: string,
): Promise<{ mutedContacts: string[] }> {
  return fetchWithAuth<{ mutedContacts: string[] }>("/notifications/unmute", {
    method: "POST",
    body: JSON.stringify({ contactJid }),
  });
}

export async function getPushStatus(): Promise<PushStatusResponse> {
  return fetchWithAuth<PushStatusResponse>("/notifications/push/status");
}

export async function subscribeToPush(
  subscription: PushSubscriptionInput,
): Promise<{ subscribed: boolean }> {
  return fetchWithAuth<{ subscribed: boolean }>(
    "/notifications/push/subscribe",
    {
      method: "POST",
      body: JSON.stringify(subscription),
    },
  );
}

export async function unsubscribeAllPush(): Promise<{ deleted: number }> {
  return fetchWithAuth<{ deleted: number }>(
    "/notifications/push/subscriptions",
    {
      method: "DELETE",
    },
  );
}

export async function unsubscribeFromPush(
  endpoint: string,
): Promise<{ deleted: boolean }> {
  return fetchWithAuth<{ deleted: boolean }>("/notifications/push/subscribe", {
    method: "DELETE",
    body: JSON.stringify({ endpoint }),
  });
}

// Notification History (In-App Notification Center)
export async function getNotifications(
  params: NotificationListParams = {},
): Promise<NotificationListResponse> {
  const query = buildQueryString(buildNotificationListQuery(params));
  return fetchWithAuth<NotificationListResponse>(`/notifications${query}`);
}

export async function getNotificationById(
  notificationId: string,
): Promise<InAppNotification> {
  return fetchWithAuth<InAppNotification>(`/notifications/${notificationId}`);
}

export async function getUnreadNotificationCount(): Promise<number> {
  const response = await fetchWithAuth<{ unreadCount: number }>(
    "/notifications/count",
  );
  return response.unreadCount;
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<InAppNotification> {
  return fetchWithAuth<InAppNotification>("/notifications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function markNotificationAsRead(
  notificationId: string,
): Promise<InAppNotification> {
  return fetchWithAuth<InAppNotification>(
    `/notifications/${notificationId}/read`,
    {
      method: "PATCH",
    },
  );
}

export async function markAllNotificationsAsRead(): Promise<number> {
  const response = await fetchWithAuth<{ markedAsRead: number }>(
    "/notifications/read-all",
    {
      method: "POST",
    },
  );
  return response.markedAsRead;
}

export async function deleteNotification(
  notificationId: string,
): Promise<boolean> {
  const response = await fetchWithAuth<{ deleted: boolean }>(
    `/notifications/${notificationId}`,
    {
      method: "DELETE",
    },
  );
  return response.deleted;
}
