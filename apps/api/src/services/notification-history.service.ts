import { getTenantConnection } from './tenant.service.js'

/**
 * Notification type enum
 */
export type NotificationType = 'message' | 'mention' | 'assignment' | 'team' | 'system'

/**
 * Notification interface
 */
export interface Notification {
  id: string
  userId: string
  notificationType: NotificationType
  title: string
  message: string | null
  actionUrl: string | null
  metadata: Record<string, unknown> | null
  isRead: boolean
  readAt: Date | null
  createdAt: Date
}

/**
 * Input for creating a notification
 */
export interface CreateNotificationInput {
  userId: string
  notificationType: NotificationType
  title: string
  message?: string
  actionUrl?: string
  metadata?: Record<string, unknown>
}

/**
 * Input for listing notifications
 */
export interface ListNotificationsInput {
  userId: string
  limit?: number
  offset?: number
  unreadOnly?: boolean
}

/**
 * Maps database row to Notification interface
 */
function mapRowToNotification(row: {
  id: string
  user_id: string
  notification_type: string
  title: string
  message: string | null
  action_url: string | null
  metadata: Record<string, unknown> | null
  is_read: boolean
  read_at: Date | null
  created_at: Date
}): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    notificationType: row.notification_type as NotificationType,
    title: row.title,
    message: row.message,
    actionUrl: row.action_url,
    metadata: row.metadata,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

/**
 * Creates a new notification
 */
export async function createNotification(
  companyId: string,
  input: CreateNotificationInput
): Promise<Notification> {
  const tenantDb = getTenantConnection(companyId)

  const created = await tenantDb
    .insertInto('notification_history')
    .values({
      user_id: input.userId,
      notification_type: input.notificationType,
      title: input.title,
      message: input.message || null,
      action_url: input.actionUrl || null,
      metadata: input.metadata || null,
    })
    .returningAll()
    .executeTakeFirst()

  if (!created) {
    throw new Error('Failed to create notification')
  }

  return mapRowToNotification(created)
}

/**
 * Gets notifications for a user
 */
export async function getNotifications(
  companyId: string,
  input: ListNotificationsInput
): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
  const tenantDb = getTenantConnection(companyId)
  const limit = input.limit || 20
  const offset = input.offset || 0

  // Build query for notifications
  let query = tenantDb
    .selectFrom('notification_history')
    .selectAll()
    .where('user_id', '=', input.userId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)

  if (input.unreadOnly) {
    query = query.where('is_read', '=', false)
  }

  const notifications = await query.execute()

  // Get total count
  let countQuery = tenantDb
    .selectFrom('notification_history')
    .select(({ fn }) => fn.count('id').as('count'))
    .where('user_id', '=', input.userId)

  if (input.unreadOnly) {
    countQuery = countQuery.where('is_read', '=', false)
  }

  const totalResult = await countQuery.executeTakeFirst()
  const total = Number(totalResult?.count || 0)

  // Get unread count
  const unreadResult = await tenantDb
    .selectFrom('notification_history')
    .select(({ fn }) => fn.count('id').as('count'))
    .where('user_id', '=', input.userId)
    .where('is_read', '=', false)
    .executeTakeFirst()

  const unreadCount = Number(unreadResult?.count || 0)

  return {
    notifications: notifications.map(mapRowToNotification),
    total,
    unreadCount,
  }
}

/**
 * Gets a single notification by ID
 */
export async function getNotificationById(
  companyId: string,
  notificationId: string,
  userId: string
): Promise<Notification | null> {
  const tenantDb = getTenantConnection(companyId)

  const notification = await tenantDb
    .selectFrom('notification_history')
    .selectAll()
    .where('id', '=', notificationId)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  return notification ? mapRowToNotification(notification) : null
}

/**
 * Marks a notification as read
 */
export async function markNotificationAsRead(
  companyId: string,
  notificationId: string,
  userId: string
): Promise<Notification | null> {
  const tenantDb = getTenantConnection(companyId)

  const updated = await tenantDb
    .updateTable('notification_history')
    .set({
      is_read: true,
      read_at: new Date(),
    })
    .where('id', '=', notificationId)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst()

  return updated ? mapRowToNotification(updated) : null
}

/**
 * Marks all notifications as read for a user
 */
export async function markAllNotificationsAsRead(
  companyId: string,
  userId: string
): Promise<number> {
  const tenantDb = getTenantConnection(companyId)

  const result = await tenantDb
    .updateTable('notification_history')
    .set({
      is_read: true,
      read_at: new Date(),
    })
    .where('user_id', '=', userId)
    .where('is_read', '=', false)
    .executeTakeFirst()

  return Number(result.numUpdatedRows || 0)
}

/**
 * Deletes a notification
 */
export async function deleteNotification(
  companyId: string,
  notificationId: string,
  userId: string
): Promise<boolean> {
  const tenantDb = getTenantConnection(companyId)

  const result = await tenantDb
    .deleteFrom('notification_history')
    .where('id', '=', notificationId)
    .where('user_id', '=', userId)
    .executeTakeFirst()

  return Number(result.numDeletedRows || 0) > 0
}

/**
 * Gets unread notification count for a user
 */
export async function getUnreadCount(
  companyId: string,
  userId: string
): Promise<number> {
  const tenantDb = getTenantConnection(companyId)

  const result = await tenantDb
    .selectFrom('notification_history')
    .select(({ fn }) => fn.count('id').as('count'))
    .where('user_id', '=', userId)
    .where('is_read', '=', false)
    .executeTakeFirst()

  return Number(result?.count || 0)
}

/**
 * Deletes old notifications (older than specified days)
 */
export async function deleteOldNotifications(
  companyId: string,
  userId: string,
  daysOld: number = 30
): Promise<number> {
  const tenantDb = getTenantConnection(companyId)
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)

  const result = await tenantDb
    .deleteFrom('notification_history')
    .where('user_id', '=', userId)
    .where('created_at', '<', cutoffDate)
    .executeTakeFirst()

  return Number(result.numDeletedRows || 0)
}
