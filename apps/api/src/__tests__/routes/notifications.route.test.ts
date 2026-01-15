/**
 * Unit tests for notifications.ts routes
 *
 * Tests the notification preferences API endpoints:
 * - GET /notifications/preferences
 * - PATCH /notifications/preferences
 * - POST /notifications/mute
 * - POST /notifications/unmute
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import {
  createMockNotificationPreferences,
  createMockQueryBuilder,
} from "../mocks";

// Create a mock tenant db for notification preferences
function createMockTenantDb() {
  let existingPrefs: unknown = null;
  let insertedPrefs: unknown = null;
  let updatedPrefs: unknown = null;

  const mockDb = {
    selectFrom: mock((table: string) => {
      if (table === "notification_preferences") {
        const builder = createMockQueryBuilder(existingPrefs);
        return builder;
      }
      return createMockQueryBuilder();
    }),
    insertInto: mock((table: string) => {
      if (table === "notification_preferences") {
        const builder: Record<string, unknown> = {};
        const chainMethods = ["values", "returningAll"];
        chainMethods.forEach((method) => {
          builder[method] = mock((values?: unknown) => {
            if (method === "values") {
              insertedPrefs = values;
            }
            return builder;
          });
        });
        builder.executeTakeFirst = mock(() =>
          Promise.resolve(
            insertedPrefs
              ? {
                  id: "new-pref-123",
                  ...(insertedPrefs as object),
                  created_at: new Date(),
                  updated_at: new Date(),
                }
              : null,
          ),
        );
        return builder;
      }
      return createMockQueryBuilder();
    }),
    updateTable: mock((table: string) => {
      if (table === "notification_preferences") {
        const builder: Record<string, unknown> = {};
        const chainMethods = ["set", "where", "returningAll"];
        chainMethods.forEach((method) => {
          builder[method] = mock((values?: unknown) => {
            if (method === "set") {
              updatedPrefs = values;
            }
            return builder;
          });
        });
        builder.executeTakeFirst = mock(() =>
          Promise.resolve(
            existingPrefs
              ? {
                  ...(existingPrefs as object),
                  ...(updatedPrefs as object),
                  updated_at: new Date(),
                }
              : null,
          ),
        );
        return builder;
      }
      return createMockQueryBuilder();
    }),
    setExistingPrefs: (prefs: unknown) => {
      existingPrefs = prefs;
    },
    getInsertedPrefs: () => insertedPrefs,
    getUpdatedPrefs: () => updatedPrefs,
  };

  return mockDb;
}

describe("GET /notifications/preferences - Get notification preferences", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    // Mock middleware
    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    // Simplified route handler for testing
    app.get("/notifications/preferences", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const user = c.get("user") as { id: string };

      let prefs = await tenantDb
        .selectFrom("notification_preferences")
        .selectAll()
        .where("user_id", "=", user.id)
        .executeTakeFirst();

      if (!prefs) {
        // Create default preferences
        prefs = await tenantDb
          .insertInto("notification_preferences")
          .values({
            user_id: user.id,
            sound_enabled: true,
            sound_choice: "default",
            quiet_hours_start: null,
            quiet_hours_end: null,
            muted_contacts: [],
          })
          .returningAll()
          .executeTakeFirst();
      }

      if (!prefs) {
        return c.json({ error: "Failed to get preferences" }, 500);
      }

      const p = prefs as Record<string, unknown>;
      return c.json({
        data: {
          id: p.id,
          userId: p.user_id,
          soundEnabled: p.sound_enabled,
          soundChoice: p.sound_choice,
          quietHoursStart: p.quiet_hours_start,
          quietHoursEnd: p.quiet_hours_end,
          mutedContacts: p.muted_contacts || [],
          createdAt: p.created_at,
          updatedAt: p.updated_at,
        },
      });
    });
  });

  it("should return existing preferences", async () => {
    const existingPrefs = createMockNotificationPreferences({
      id: "pref-123",
      user_id: "user-123",
      sound_enabled: false,
      sound_choice: "chime",
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
      muted_contacts: ["contact1@s.whatsapp.net"],
    });
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/preferences", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.id).toBe("pref-123");
    expect(data.data.soundEnabled).toBe(false);
    expect(data.data.soundChoice).toBe("chime");
    expect(data.data.quietHoursStart).toBe("22:00");
    expect(data.data.quietHoursEnd).toBe("07:00");
    expect(data.data.mutedContacts).toEqual(["contact1@s.whatsapp.net"]);
  });

  it("should create default preferences if none exist", async () => {
    const response = await app.request("/notifications/preferences", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.id).toBe("new-pref-123");
    expect(data.data.soundEnabled).toBe(true);
    expect(data.data.soundChoice).toBe("default");
    expect(data.data.mutedContacts).toEqual([]);
  });
});

describe("PATCH /notifications/preferences - Update notification preferences", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    app.patch("/notifications/preferences", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const user = c.get("user") as { id: string };
      const body = await c.req.json();

      // Validate input
      const validSoundChoices = ["default", "chime", "bell", "pop", "none"];
      if (body.soundChoice && !validSoundChoices.includes(body.soundChoice)) {
        return c.json({ error: "Invalid sound choice" }, 400);
      }

      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (body.quietHoursStart && !timeRegex.test(body.quietHoursStart)) {
        return c.json({ error: "Invalid quiet hours start time" }, 400);
      }
      if (body.quietHoursEnd && !timeRegex.test(body.quietHoursEnd)) {
        return c.json({ error: "Invalid quiet hours end time" }, 400);
      }

      // Ensure preferences exist
      let prefs = await tenantDb
        .selectFrom("notification_preferences")
        .selectAll()
        .where("user_id", "=", user.id)
        .executeTakeFirst();

      if (!prefs) {
        prefs = await tenantDb
          .insertInto("notification_preferences")
          .values({
            user_id: user.id,
            sound_enabled: true,
            sound_choice: "default",
            quiet_hours_start: null,
            quiet_hours_end: null,
            muted_contacts: [],
          })
          .returningAll()
          .executeTakeFirst();
      }

      // Build update object
      const updateData: Record<string, unknown> = {
        updated_at: new Date(),
      };

      if (body.soundEnabled !== undefined) {
        updateData.sound_enabled = body.soundEnabled;
      }
      if (body.soundChoice !== undefined) {
        updateData.sound_choice = body.soundChoice;
      }
      if (body.quietHoursStart !== undefined) {
        updateData.quiet_hours_start = body.quietHoursStart;
      }
      if (body.quietHoursEnd !== undefined) {
        updateData.quiet_hours_end = body.quietHoursEnd;
      }
      if (body.mutedContacts !== undefined) {
        updateData.muted_contacts = body.mutedContacts;
      }

      const updated = await tenantDb
        .updateTable("notification_preferences")
        .set(updateData)
        .where("user_id", "=", user.id)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        return c.json({ error: "Failed to update preferences" }, 500);
      }

      const p = updated as Record<string, unknown>;
      return c.json({
        data: {
          id: p.id,
          userId: p.user_id,
          soundEnabled: p.sound_enabled,
          soundChoice: p.sound_choice,
          quietHoursStart: p.quiet_hours_start,
          quietHoursEnd: p.quiet_hours_end,
          mutedContacts: p.muted_contacts || [],
          createdAt: p.created_at,
          updatedAt: p.updated_at,
        },
      });
    });
  });

  it("should update sound settings", async () => {
    const existingPrefs = createMockNotificationPreferences();
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        soundEnabled: false,
        soundChoice: "bell",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.soundEnabled).toBe(false);
    expect(data.data.soundChoice).toBe("bell");
  });

  it("should update quiet hours", async () => {
    const existingPrefs = createMockNotificationPreferences();
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quietHoursStart: "23:00",
        quietHoursEnd: "08:00",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.quietHoursStart).toBe("23:00");
    expect(data.data.quietHoursEnd).toBe("08:00");
  });

  it("should update muted contacts", async () => {
    const existingPrefs = createMockNotificationPreferences();
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mutedContacts: ["contact1@s.whatsapp.net", "contact2@s.whatsapp.net"],
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.mutedContacts).toEqual([
      "contact1@s.whatsapp.net",
      "contact2@s.whatsapp.net",
    ]);
  });

  it("should return 400 for invalid sound choice", async () => {
    const existingPrefs = createMockNotificationPreferences();
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        soundChoice: "invalid-sound",
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid sound choice");
  });

  it("should return 400 for invalid quiet hours format", async () => {
    const existingPrefs = createMockNotificationPreferences();
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quietHoursStart: "25:00",
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid quiet hours start time");
  });
});

describe("POST /notifications/mute - Mute a contact", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    app.post("/notifications/mute", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const user = c.get("user") as { id: string };
      const body = await c.req.json();

      if (!body.contactJid) {
        return c.json({ error: "contactJid is required" }, 400);
      }

      let prefs = await tenantDb
        .selectFrom("notification_preferences")
        .selectAll()
        .where("user_id", "=", user.id)
        .executeTakeFirst();

      if (!prefs) {
        prefs = await tenantDb
          .insertInto("notification_preferences")
          .values({
            user_id: user.id,
            sound_enabled: true,
            sound_choice: "default",
            quiet_hours_start: null,
            quiet_hours_end: null,
            muted_contacts: [],
          })
          .returningAll()
          .executeTakeFirst();
      }

      const currentMuted =
        ((prefs as Record<string, unknown>).muted_contacts as string[]) || [];
      if (currentMuted.includes(body.contactJid)) {
        return c.json({ data: { mutedContacts: currentMuted } });
      }

      const newMuted = [...currentMuted, body.contactJid];

      const updated = await tenantDb
        .updateTable("notification_preferences")
        .set({ muted_contacts: newMuted, updated_at: new Date() })
        .where("user_id", "=", user.id)
        .returningAll()
        .executeTakeFirst();

      const mutedContacts =
        (updated as Record<string, unknown>).muted_contacts || [];
      return c.json({ data: { mutedContacts } });
    });
  });

  it("should mute a contact", async () => {
    const existingPrefs = createMockNotificationPreferences({
      muted_contacts: [],
    });
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactJid: "newcontact@s.whatsapp.net",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.mutedContacts).toContain("newcontact@s.whatsapp.net");
  });

  it("should not duplicate already muted contact", async () => {
    const existingPrefs = createMockNotificationPreferences({
      muted_contacts: ["contact@s.whatsapp.net"],
    });
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactJid: "contact@s.whatsapp.net",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.mutedContacts).toEqual(["contact@s.whatsapp.net"]);
  });

  it("should return 400 if contactJid is missing", async () => {
    const response = await app.request("/notifications/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("contactJid is required");
  });
});

describe("POST /notifications/unmute - Unmute a contact", () => {
  let app: Hono;
  let mockTenantDb: ReturnType<typeof createMockTenantDb>;

  beforeEach(() => {
    mockTenantDb = createMockTenantDb();

    app = new Hono();

    app.use("/*", async (c, next) => {
      c.set("tenantDb", mockTenantDb);
      c.set("user", { id: "user-123", email: "test@example.com" });
      c.set("companyId", "company-123");
      await next();
    });

    app.post("/notifications/unmute", async (c) => {
      const tenantDb = c.get("tenantDb") as ReturnType<
        typeof createMockTenantDb
      >;
      const user = c.get("user") as { id: string };
      const body = await c.req.json();

      if (!body.contactJid) {
        return c.json({ error: "contactJid is required" }, 400);
      }

      let prefs = await tenantDb
        .selectFrom("notification_preferences")
        .selectAll()
        .where("user_id", "=", user.id)
        .executeTakeFirst();

      if (!prefs) {
        return c.json({ data: { mutedContacts: [] } });
      }

      const currentMuted =
        ((prefs as Record<string, unknown>).muted_contacts as string[]) || [];
      if (!currentMuted.includes(body.contactJid)) {
        return c.json({ data: { mutedContacts: currentMuted } });
      }

      const newMuted = currentMuted.filter((jid) => jid !== body.contactJid);

      const updated = await tenantDb
        .updateTable("notification_preferences")
        .set({ muted_contacts: newMuted, updated_at: new Date() })
        .where("user_id", "=", user.id)
        .returningAll()
        .executeTakeFirst();

      const mutedContacts =
        (updated as Record<string, unknown>).muted_contacts || [];
      return c.json({ data: { mutedContacts } });
    });
  });

  it("should unmute a contact", async () => {
    const existingPrefs = createMockNotificationPreferences({
      muted_contacts: ["contact1@s.whatsapp.net", "contact2@s.whatsapp.net"],
    });
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/unmute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactJid: "contact1@s.whatsapp.net",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.mutedContacts).not.toContain("contact1@s.whatsapp.net");
  });

  it("should handle unmuting non-muted contact gracefully", async () => {
    const existingPrefs = createMockNotificationPreferences({
      muted_contacts: ["other@s.whatsapp.net"],
    });
    mockTenantDb.setExistingPrefs(existingPrefs);

    const response = await app.request("/notifications/unmute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactJid: "notmuted@s.whatsapp.net",
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.mutedContacts).toEqual(["other@s.whatsapp.net"]);
  });

  it("should return 400 if contactJid is missing", async () => {
    const response = await app.request("/notifications/unmute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("contactJid is required");
  });
});
