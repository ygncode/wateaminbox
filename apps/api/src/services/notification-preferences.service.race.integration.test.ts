import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  DEFAULT_PREFERENCES,
  getNotificationPreferences,
} from "./notification-preferences.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function withTenant(
  run: (companyId: string) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  try {
    await createTenantSchema(companyId);
    await run(companyId);
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
  }
}

describe("getNotificationPreferences concurrent first-call race (real Postgres)", () => {
  integrationTest(
    "concurrent first-time calls for the same user: all fulfill, no 23505, exactly one default row",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        let raceDetected = false;

        for (let attempt = 0; attempt < 50; attempt++) {
          const userId = crypto.randomUUID();

          const results = await Promise.allSettled(
            Array.from({ length: 10 }, () =>
              getNotificationPreferences(companyId, userId),
            ),
          );

          const rejected = results.filter((r) => r.status === "rejected");

          for (const r of rejected) {
            const reason = (r as PromiseRejectedResult).reason as {
              code?: string;
            };
            if (reason instanceof Error && reason.code === "23505") {
              raceDetected = true;
            }
          }

          expect(rejected).toHaveLength(0);

          const fulfilled = results.filter((r) => r.status === "fulfilled");
          expect(fulfilled).toHaveLength(10);

          const rows = await tenantDb
            .selectFrom("notification_preferences")
            .selectAll()
            .where("user_id", "=", userId)
            .execute();
          expect(rows).toHaveLength(1);

          const row = rows[0];
          expect(row.user_id).toBe(userId);
          expect(row.notifications_enabled).toBe(
            DEFAULT_PREFERENCES.notificationsEnabled,
          );
          expect(row.timezone).toBe(DEFAULT_PREFERENCES.timezone);
          expect(row.sound_enabled).toBe(DEFAULT_PREFERENCES.soundEnabled);
          expect(row.sound_choice).toBe(DEFAULT_PREFERENCES.soundChoice);
          expect(row.quiet_hours_start).toBe(
            DEFAULT_PREFERENCES.quietHoursStart,
          );
          expect(row.quiet_hours_end).toBe(DEFAULT_PREFERENCES.quietHoursEnd);
          expect(row.muted_contacts).toEqual(DEFAULT_PREFERENCES.mutedContacts);
          expect(row.id).toBeTruthy();
          expect(row.created_at).toBeTruthy();
          expect(row.updated_at).toBeTruthy();
        }

        // If the race resurfaced, we expect this to flip.
        expect(raceDetected).toBe(false);
      });
    },
    60_000,
  );

  integrationTest(
    "single (non-concurrent) first-touch creates exactly one default row",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const userId = crypto.randomUUID();

        const prefs = await getNotificationPreferences(companyId, userId);
        expect(prefs.userId).toBe(userId);
        expect(prefs.notificationsEnabled).toBe(true);
        expect(prefs.timezone).toBeNull();
        expect(prefs.mutedContacts).toEqual([]);

        const rows = await tenantDb
          .selectFrom("notification_preferences")
          .selectAll()
          .where("user_id", "=", userId)
          .execute();
        expect(rows).toHaveLength(1);
      });
    },
  );

  integrationTest(
    "existing-user fast path is deterministic and does not insert",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const userId = crypto.randomUUID();
        await tenantDb
          .insertInto("notification_preferences")
          .values({
            user_id: userId,
            notifications_enabled: false,
            timezone: "Asia/Yangon",
            sound_enabled: false,
            sound_choice: "bell",
            muted_contacts: ["15551234567@s.whatsapp.net"],
          })
          .execute();

        const before = await tenantDb
          .selectFrom("notification_preferences")
          .select(["id", "updated_at"])
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow();

        for (let i = 0; i < 3; i++) {
          const prefs = await getNotificationPreferences(companyId, userId);
          expect(prefs.id).toBe(before.id);
          expect(prefs.notificationsEnabled).toBe(false);
          expect(prefs.timezone).toBe("Asia/Yangon");
          expect(prefs.soundChoice).toBe("bell");
          expect(prefs.mutedContacts).toEqual(["15551234567@s.whatsapp.net"]);
        }

        const count = await tenantDb
          .selectFrom("notification_preferences")
          .select(sql<string>`count(*)`.as("n"))
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow();
        expect(Number(count.n)).toBe(1);
      });
    },
  );
});
