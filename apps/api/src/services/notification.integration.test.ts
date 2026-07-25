import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";
import {
  createNotification,
  deleteNotification,
  getNotifications,
  markAllNotificationsAsRead,
} from "./notification-history.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("notification database isolation", () => {
  integrationTest(
    "stores JIDs and scopes history and push subscriptions by user",
    async () => {
      const companyId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const userA = crypto.randomUUID();
        const userB = crypto.randomUUID();
        await tenantDb
          .insertInto("notification_preferences")
          .values({
            user_id: userA,
            muted_contacts: ["15551234567@s.whatsapp.net"],
          })
          .execute();
        expect(
          (
            await tenantDb
              .selectFrom("notification_preferences")
              .select("muted_contacts")
              .where("user_id", "=", userA)
              .executeTakeFirstOrThrow()
          ).muted_contacts,
        ).toEqual(["15551234567@s.whatsapp.net"]);

        const notificationA = await createNotification(companyId, {
          userId: userA,
          notificationType: "system",
          title: "A",
        });
        await createNotification(companyId, {
          userId: userB,
          notificationType: "system",
          title: "B",
        });
        expect(
          (
            await getNotifications(companyId, { userId: userA })
          ).notifications.map((item) => item.title),
        ).toEqual(["A"]);
        expect(await markAllNotificationsAsRead(companyId, userA)).toBe(1);
        expect(
          await deleteNotification(companyId, notificationA.id, userB),
        ).toBe(false);

        await tenantDb
          .insertInto("push_subscriptions")
          .values([
            {
              id: crypto.randomUUID(),
              user_id: userA,
              endpoint: "https://push.example/a",
              p256dh: "a",
              auth: "a",
            },
            {
              id: crypto.randomUUID(),
              user_id: userB,
              endpoint: "https://push.example/b",
              p256dh: "b",
              auth: "b",
            },
          ])
          .execute();
        expect(
          (
            await tenantDb
              .selectFrom("push_subscriptions")
              .select("endpoint")
              .where("user_id", "=", userA)
              .execute()
          ).map((item) => item.endpoint),
        ).toEqual(["https://push.example/a"]);
      } finally {
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
});
