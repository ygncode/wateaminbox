import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import * as notificationPreferencesService from "../services/notification-preferences.service.js";

export const notificationRoutes = new Hono();

// All notification routes require authentication and tenant context
notificationRoutes.use("/*", authMiddleware);
notificationRoutes.use("/*", tenantMiddleware());

// Validation schemas
const soundChoiceSchema = z.enum(["default", "chime", "bell", "pop", "none"]);

const updatePreferencesSchema = z.object({
  soundEnabled: z.boolean().optional(),
  soundChoice: soundChoiceSchema.optional(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullable().optional(),
  mutedContacts: z.array(z.string()).optional(),
});

const muteContactSchema = z.object({
  contactJid: z.string().min(1),
});

/**
 * GET /notifications/preferences - Get notification preferences
 */
notificationRoutes.get("/preferences", async (c) => {
  const user = c.get("user");
  const companyId = c.get("companyId");

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
    const user = c.get("user");
    const companyId = c.get("companyId");
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
    const user = c.get("user");
    const companyId = c.get("companyId");
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
    const user = c.get("user");
    const companyId = c.get("companyId");
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
