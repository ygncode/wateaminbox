import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  createNotification,
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "./notification-history.service.js";
import { createTenantSchema, getSchemaName } from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * Server contract: after markAllNotificationsAsRead, GET ?unreadOnly=true
 * deterministically returns { notifications: [], total: 0, unreadCount: 0 }.
 * This is the exact empty shape the client's optimistic update now mirrors, so
 * the next refetch does not visually re-populate the unread view.
 */
describe("notification unread-filter server contract", () => {
  integrationTest(
    "GET ?unreadOnly=true returns empty after markAllNotificationsAsRead",
    async () => {
      const companyId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        const userId = crypto.randomUUID();

        await createNotification(companyId, {
          userId,
          notificationType: "system",
          title: "A",
        });
        await createNotification(companyId, {
          userId,
          notificationType: "system",
          title: "B",
        });
        await createNotification(companyId, {
          userId,
          notificationType: "system",
          title: "C",
        });

        const before = await getNotifications(companyId, {
          userId,
          unreadOnly: true,
        });
        expect(before.notifications).toHaveLength(3);
        expect(before.total).toBe(3);
        expect(before.unreadCount).toBe(3);

        const updated = await markAllNotificationsAsRead(companyId, userId);
        expect(updated).toBe(3);

        const after = await getNotifications(companyId, {
          userId,
          unreadOnly: true,
        });
        expect(after.notifications).toHaveLength(0);
        expect(after.total).toBe(0);
        expect(after.unreadCount).toBe(0);

        const allAfter = await getNotifications(companyId, { userId });
        expect(allAfter.notifications).toHaveLength(3);
        expect(allAfter.total).toBe(3);
        expect(allAfter.unreadCount).toBe(0);
      } finally {
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    10_000,
  );

  integrationTest(
    "GET ?unreadOnly=true drops one row after a single markNotificationAsRead",
    async () => {
      const companyId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        const userId = crypto.randomUUID();

        await createNotification(companyId, {
          userId,
          notificationType: "system",
          title: "A",
        });
        await createNotification(companyId, {
          userId,
          notificationType: "system",
          title: "B",
        });
        await createNotification(companyId, {
          userId,
          notificationType: "system",
          title: "C",
        });

        // getNotifications returns newest-first: [C, B, A]. Mark the newest read.
        const all = await getNotifications(companyId, { userId });
        const newest = all.notifications[0];
        const updated = await markNotificationAsRead(
          companyId,
          newest.id,
          userId,
        );
        expect(updated).not.toBeNull();
        expect(updated?.isRead).toBe(true);

        // Unread-filter now shows 2 (the two we didn't touch).
        const after = await getNotifications(companyId, {
          userId,
          unreadOnly: true,
        });
        expect(after.notifications).toHaveLength(2);
        expect(after.total).toBe(2);
        expect(after.unreadCount).toBe(2);
        expect(after.notifications.map((n) => n.title).sort()).toEqual([
          "A",
          "B",
        ]);
      } finally {
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    10_000,
  );
});
