import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { getRouteContext } from "../middleware/context.js";
import * as notificationPreferencesService from "../services/notification-preferences.service.js";
import * as notificationHistoryService from "../services/notification-history.service.js";
import { createAndPublishNotification } from "../services/notification-delivery.service.js";
import * as webPushService from "../services/web-push.service.js";
import { isTableNotFoundError, notFound } from "../lib/errors.js";
import { successData, created } from "../lib/response.js";
import {
  updatePreferencesSchema,
  muteContactSchema,
  listNotificationsQuerySchema,
  createNotificationSchema,
  deletePushSubscriptionSchema,
  pushSubscriptionSchema,
} from "../lib/schemas/index.js";

export const notificationRoutes = new Hono();

// All notification routes require authentication and tenant context
notificationRoutes.use("/*", authMiddleware);
notificationRoutes.use("/*", tenantMiddleware());

/**
 * GET /notifications/preferences - Get notification preferences
 */
notificationRoutes.get("/preferences", async (c) => {
  const { user, companyId } = getRouteContext(c);

  const preferences =
    await notificationPreferencesService.getNotificationPreferences(
      companyId,
      user.id,
    );

  return successData(c, {
    id: preferences.id,
    userId: preferences.userId,
    notificationsEnabled: preferences.notificationsEnabled,
    timezone: preferences.timezone,
    soundEnabled: preferences.soundEnabled,
    soundChoice: preferences.soundChoice,
    quietHoursStart: preferences.quietHoursStart,
    quietHoursEnd: preferences.quietHoursEnd,
    mutedContacts: preferences.mutedContacts,
    createdAt: preferences.createdAt,
    updatedAt: preferences.updatedAt,
  });
});

/**
 * PATCH /notifications/preferences - Update notification preferences
 */
notificationRoutes.patch(
  "/preferences",
  zValidator("json", updatePreferencesSchema),
  async (c) => {
    const { user, companyId } = getRouteContext(c);
    const input = c.req.valid("json");

    const preferences =
      await notificationPreferencesService.updateNotificationPreferences(
        companyId,
        user.id,
        input,
      );

    return successData(c, {
      id: preferences.id,
      userId: preferences.userId,
      notificationsEnabled: preferences.notificationsEnabled,
      timezone: preferences.timezone,
      soundEnabled: preferences.soundEnabled,
      soundChoice: preferences.soundChoice,
      quietHoursStart: preferences.quietHoursStart,
      quietHoursEnd: preferences.quietHoursEnd,
      mutedContacts: preferences.mutedContacts,
      createdAt: preferences.createdAt,
      updatedAt: preferences.updatedAt,
    });
  },
);

/**
 * POST /notifications/mute - Mute a contact
 */
notificationRoutes.post(
  "/mute",
  zValidator("json", muteContactSchema),
  async (c) => {
    const { user, companyId } = getRouteContext(c);
    const { contactJid } = c.req.valid("json");

    const preferences = await notificationPreferencesService.muteContact(
      companyId,
      user.id,
      contactJid,
    );

    return successData(c, {
      mutedContacts: preferences.mutedContacts,
    });
  },
);

/**
 * POST /notifications/unmute - Unmute a contact
 */
notificationRoutes.post(
  "/unmute",
  zValidator("json", muteContactSchema),
  async (c) => {
    const { user, companyId } = getRouteContext(c);
    const { contactJid } = c.req.valid("json");

    const preferences = await notificationPreferencesService.unmuteContact(
      companyId,
      user.id,
      contactJid,
    );

    return successData(c, {
      mutedContacts: preferences.mutedContacts,
    });
  },
);

// ============================================================================
// Web Push subscription routes
// ============================================================================

notificationRoutes.get("/push/status", async (c) => {
  const { user, companyId } = getRouteContext(c);
  return successData(c, await webPushService.getPushStatus(companyId, user.id));
});

notificationRoutes.post(
  "/push/subscribe",
  zValidator("json", pushSubscriptionSchema),
  async (c) => {
    const { user, companyId } = getRouteContext(c);
    await webPushService.upsertPushSubscription(companyId, user.id, {
      ...c.req.valid("json"),
      userAgent: c.req.header("user-agent") ?? null,
    });
    return successData(c, { subscribed: true });
  },
);

notificationRoutes.delete("/push/subscriptions", async (c) => {
  const { user, companyId } = getRouteContext(c);
  const deleted = await webPushService.deleteAllPushSubscriptionsForUser(
    companyId,
    user.id,
  );
  return successData(c, { deleted });
});

notificationRoutes.delete(
  "/push/subscribe",
  zValidator("json", deletePushSubscriptionSchema),
  async (c) => {
    const { user, companyId } = getRouteContext(c);
    const deleted = await webPushService.deletePushSubscription(
      companyId,
      user.id,
      c.req.valid("json").endpoint,
    );
    return successData(c, { deleted });
  },
);

// ============================================================================
// Notification History Routes (In-App Notification Center)
// ============================================================================

/**
 * GET /notifications - List notifications for the current user
 */
notificationRoutes.get(
  "/",
  zValidator("query", listNotificationsQuerySchema),
  async (c) => {
    const { user, companyId } = getRouteContext(c);
    const { limit, offset, unreadOnly } = c.req.valid("query");

    try {
      const result = await notificationHistoryService.getNotifications(
        companyId,
        {
          userId: user.id,
          limit,
          offset,
          unreadOnly,
        },
      );

      return c.json({
        data: result.notifications,
        meta: {
          total: result.total,
          unreadCount: result.unreadCount,
          limit,
          offset,
        },
      });
    } catch (error) {
      // Handle missing table gracefully - return empty array
      if (isTableNotFoundError(error)) {
        return c.json({
          data: [],
          meta: {
            total: 0,
            unreadCount: 0,
            limit,
            offset,
          },
        });
      }
      throw error;
    }
  },
);

/**
 * GET /notifications/count - Get unread notification count
 */
notificationRoutes.get("/count", async (c) => {
  const { user, companyId } = getRouteContext(c);

  try {
    const unreadCount = await notificationHistoryService.getUnreadCount(
      companyId,
      user.id,
    );

    return successData(c, { unreadCount });
  } catch (error) {
    // Handle missing table gracefully - return zero count
    if (isTableNotFoundError(error)) {
      return successData(c, { unreadCount: 0 });
    }
    throw error;
  }
});

/**
 * GET /notifications/:id - Get a single notification
 */
notificationRoutes.get("/:id", async (c) => {
  const { user, companyId } = getRouteContext(c);
  const notificationId = c.req.param("id");

  const notification = await notificationHistoryService.getNotificationById(
    companyId,
    notificationId,
    user.id,
  );

  if (!notification) {
    return notFound(c, "Notification");
  }

  return successData(c, notification);
});

/**
 * POST /notifications - Create a notification (for system/internal use)
 */
notificationRoutes.post(
  "/",
  zValidator("json", createNotificationSchema),
  async (c) => {
    const { user, companyId } = getRouteContext(c);
    const input = c.req.valid("json");

    const notification = await createAndPublishNotification(companyId, {
      userId: user.id,
      ...input,
    });

    return created(c, notification);
  },
);

/**
 * PATCH /notifications/:id/read - Mark a notification as read
 */
notificationRoutes.patch("/:id/read", async (c) => {
  const { user, companyId } = getRouteContext(c);
  const notificationId = c.req.param("id");

  const notification = await notificationHistoryService.markNotificationAsRead(
    companyId,
    notificationId,
    user.id,
  );

  if (!notification) {
    return notFound(c, "Notification");
  }

  return successData(c, notification);
});

/**
 * POST /notifications/read-all - Mark all notifications as read
 */
notificationRoutes.post("/read-all", async (c) => {
  const { user, companyId } = getRouteContext(c);

  const count = await notificationHistoryService.markAllNotificationsAsRead(
    companyId,
    user.id,
  );

  return successData(c, { markedAsRead: count });
});

/**
 * DELETE /notifications/:id - Delete a notification
 */
notificationRoutes.delete("/:id", async (c) => {
  const { user, companyId } = getRouteContext(c);
  const notificationId = c.req.param("id");

  const deleted = await notificationHistoryService.deleteNotification(
    companyId,
    notificationId,
    user.id,
  );

  if (!deleted) {
    return notFound(c, "Notification");
  }

  return successData(c, { deleted: true });
});
