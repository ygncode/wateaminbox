import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { getRouteContext } from "../middleware/context.js";
import * as notificationPreferencesService from "../services/notification-preferences.service.js";
import * as notificationHistoryService from "../services/notification-history.service.js";
import { isTableNotFoundError, notFound } from "../lib/errors.js";
import {
  updatePreferencesSchema,
  muteContactSchema,
  listNotificationsQuerySchema,
  createNotificationSchema,
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

  return c.json({
    data: {
      id: preferences.id,
      userId: preferences.userId,
      soundEnabled: preferences.soundEnabled,
      soundChoice: preferences.soundChoice,
      quietHoursStart: preferences.quietHoursStart,
      quietHoursEnd: preferences.quietHoursEnd,
      mutedContacts: preferences.mutedContacts,
      createdAt: preferences.createdAt,
      updatedAt: preferences.updatedAt,
    },
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

    return c.json({
      data: {
        id: preferences.id,
        userId: preferences.userId,
        soundEnabled: preferences.soundEnabled,
        soundChoice: preferences.soundChoice,
        quietHoursStart: preferences.quietHoursStart,
        quietHoursEnd: preferences.quietHoursEnd,
        mutedContacts: preferences.mutedContacts,
        createdAt: preferences.createdAt,
        updatedAt: preferences.updatedAt,
      },
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

    return c.json({
      data: {
        mutedContacts: preferences.mutedContacts,
      },
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

    return c.json({
      data: {
        mutedContacts: preferences.mutedContacts,
      },
    });
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

    return c.json({
      data: {
        unreadCount,
      },
    });
  } catch (error) {
    // Handle missing table gracefully - return zero count
    if (isTableNotFoundError(error)) {
      return c.json({
        data: {
          unreadCount: 0,
        },
      });
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

  return c.json({
    data: notification,
  });
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

    const notification = await notificationHistoryService.createNotification(
      companyId,
      {
        userId: user.id,
        ...input,
      },
    );

    return c.json(
      {
        data: notification,
      },
      201,
    );
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

  return c.json({
    data: notification,
  });
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

  return c.json({
    data: {
      markedAsRead: count,
    },
  });
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

  return c.json({
    data: {
      deleted: true,
    },
  });
});
