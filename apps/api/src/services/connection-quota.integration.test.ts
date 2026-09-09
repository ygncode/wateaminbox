import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { countUsedConnectionSlots } from "./connection-quota.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("countUsedConnectionSlots", () => {
  integrationTest(
    "counts every channel against the one paid pool, without double counting a bridge",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const ownerId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `quota-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Quota test",
            schema_name: schemaName,
            status: "active",
          })
          .execute();
        await db
          .insertInto("sla_policies")
          .values({
            company_id: companyId,
            target_minutes: 60,
            direct_resolution_target_minutes: 480,
            group_response_target_minutes: 120,
            group_resolution_target_minutes: 960,
            timezone: "UTC",
            weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
            exceptions: JSON.stringify([]),
            effective_from: new Date("1970-01-01T00:00:00Z"),
            created_by: ownerId,
          })
          .execute();
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        expect(await countUsedConnectionSlots(tenantDb)).toBe(0);

        const whatsappId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({ id: whatsappId, status: "connected" })
          .execute();
        expect(await countUsedConnectionSlots(tenantDb)).toBe(1);

        // A Telegram bot occupies a slot exactly like a linked device: before
        // this, it was invisible to the plan and a workspace could add any
        // number outside what it paid for.
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Bot",
            status: "connected",
          })
          .execute();
        expect(await countUsedConnectionSlots(tenantDb)).toBe(2);

        // The shadow row that mirrors a linked device is the same connection
        // seen through the neutral model, so it must not be charged twice.
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            channel: "whatsapp",
            provider: "whatsapp_linked_device",
            display_name: "Mirror of the linked device",
            status: "connected",
            legacy_whatsapp_connection_id: whatsappId,
          })
          .execute();
        expect(await countUsedConnectionSlots(tenantDb)).toBe(2);

        // Archiving frees the slot, matching how a removed WhatsApp row does.
        await tenantDb
          .updateTable("channel_accounts")
          .set({ archived_at: new Date(), status: "archived" })
          .where("provider", "=", "telegram_bot")
          .execute();
        expect(await countUsedConnectionSlots(tenantDb)).toBe(1);
      } finally {
        await clearTenantConnection(companyId);
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .execute(db);
        await db
          .deleteFrom("sla_policies")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
    120_000,
  );
});
