/**
 * Notifications API
 * Notification preferences and notification history API functions
 */

import { fetchWithAuth, buildQueryString } from "./client.js"
import type {
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesInput,
  InAppNotification,
  NotificationListParams,
  NotificationListResponse,
  CreateNotificationInput,
} from "./types.js"

// Notification Preferences
export async function getNotificationPreferences(): Promise<NotificationPreferencesResponse> {
  const response = await fetchWithAuth<{
    data: NotificationPreferencesResponse
  }>("/notifications/preferences")
  return response.data
}

export async function updateNotificationPreferences(
  input: UpdateNotificationPreferencesInput
): Promise<NotificationPreferencesResponse> {
  const response = await fetchWithAuth<{
    data: NotificationPreferencesResponse
  }>("/notifications/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  })
  return response.data
}

export async function muteContactApi(
  contactJid: string
): Promise<{ mutedContacts: string[] }> {
  const response = await fetchWithAuth<{ data: { mutedContacts: string[] } }>(
    "/notifications/mute",
    {
      method: "POST",
      body: JSON.stringify({ contactJid }),
    }
  )
  return response.data
}

export async function unmuteContactApi(
  contactJid: string
): Promise<{ mutedContacts: string[] }> {
  const response = await fetchWithAuth<{ data: { mutedContacts: string[] } }>(
    "/notifications/unmute",
    {
      method: "POST",
      body: JSON.stringify({ contactJid }),
    }
  )
  return response.data
}

// Notification History (In-App Notification Center)
export async function getNotifications(
  params: NotificationListParams = {}
): Promise<NotificationListResponse> {
  const query = buildQueryString(params as Record<string, unknown>)
  return fetchWithAuth<NotificationListResponse>(`/notifications${query}`)
}

export async function getNotificationById(
  notificationId: string
): Promise<InAppNotification> {
  const response = await fetchWithAuth<{ data: InAppNotification }>(
    `/notifications/${notificationId}`
  )
  return response.data
}

export async function getUnreadNotificationCount(): Promise<number> {
  const response = await fetchWithAuth<{ data: { unreadCount: number } }>(
    "/notifications/count"
  )
  return response.data.unreadCount
}

export async function createNotification(
  input: CreateNotificationInput
): Promise<InAppNotification> {
  const response = await fetchWithAuth<{ data: InAppNotification }>(
    "/notifications",
    {
      method: "POST",
      body: JSON.stringify(input),
    }
  )
  return response.data
}

export async function markNotificationAsRead(
  notificationId: string
): Promise<InAppNotification> {
  const response = await fetchWithAuth<{ data: InAppNotification }>(
    `/notifications/${notificationId}/read`,
    {
      method: "PATCH",
    }
  )
  return response.data
}

export async function markAllNotificationsAsRead(): Promise<number> {
  const response = await fetchWithAuth<{ data: { markedAsRead: number } }>(
    "/notifications/read-all",
    {
      method: "POST",
    }
  )
  return response.data.markedAsRead
}

export async function deleteNotification(
  notificationId: string
): Promise<boolean> {
  const response = await fetchWithAuth<{ data: { deleted: boolean } }>(
    `/notifications/${notificationId}`,
    {
      method: "DELETE",
    }
  )
  return response.data.deleted
}
