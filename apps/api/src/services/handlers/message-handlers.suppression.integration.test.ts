import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { applySuppression } from "../../channel-spine/application/contact-policy.js";
import type { MessageEvent } from "../../lib/nats/types/events.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../tenant.service.js";
import { handleMessageEvent } from "./message-handlers.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const CUSTOMER_JID = "15557770000@s.whatsapp.net";

/**
 * The WhatsApp (legacy NATS) inbound path honours customer suppression the
 * same way neutral ingress does. The phone's blocklist covers a contact
 * blocked on WhatsApp itself; this covers a merged customer blocked through
 * another channel, and a mute.
 */
describe("handleMessageEvent - customer suppression", () => {
  integrationTest(
    "drops a blocked customer's live message, silences a muted one, and leaves history sync alone",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const ownerId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `wa-suppress-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "WhatsApp suppression test",
            schema_name: schemaName,
            status: "active",
          })
          .execute();
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: ownerId, role: "owner" })
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
        const connection = await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            name: "Test connection",
            phone_number: "15550000000",
            status: "connected",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await tenantDb
          .insertInto("contact_policy_settings")
          .values({ id: 1, enforcement_enabled: true })
          .execute();

        const event = (
          content: string,
          extra: Partial<MessageEvent["payload"]> = {},
        ): MessageEvent => ({
          contractVersion: 1,
          type: "message",
          companyId,
          connectionId: connection.id,
          timestamp: new Date().toISOString(),
          payload: {
            messageId: crypto.randomUUID(),
            from: CUSTOMER_JID,
            to: "15550000000@s.whatsapp.net",
            fromMe: false,
            content,
            messageType: "text",
            timestamp: new Date().toISOString(),
            ...extra,
          },
        });
        const messages = async () =>
          (
            await tenantDb
              .selectFrom("messages")
              .select("content")
              .orderBy("created_at")
              .execute()
          ).map((row) => row.content);
        const unread = async () =>
          (
            await tenantDb
              .selectFrom("conversation_states")
              .select("unread_count")
              .executeTakeFirstOrThrow()
          ).unread_count;

        await handleMessageEvent(event("hello"));
        const contact = await tenantDb
          .selectFrom("contacts")
          .select("id")
          .where("jid", "=", CUSTOMER_JID)
          .executeTakeFirstOrThrow();

        // Mute: stored, but no unread increment and no push job.
        const mute = await tenantDb.transaction().execute((trx) =>
          applySuppression(trx, {
            contactId: contact.id,
            scope: "mute_inbound",
            reason: "manual",
            actorUserId: ownerId,
          }),
        );
        const unreadBeforeMute = await unread();
        await sql`DELETE FROM public.message_delivery_outbox
          WHERE company_id = ${companyId}::uuid`.execute(db);
        await handleMessageEvent(event("quiet one"));
        expect(await messages()).toEqual(["hello", "quiet one"]);
        expect(await unread()).toBe(unreadBeforeMute);
        const lanes = await sql<{ kind: string }>`
          SELECT kind FROM public.message_delivery_outbox
          WHERE company_id = ${companyId}::uuid ORDER BY kind`.execute(db);
        expect(lanes.rows.map((row) => row.kind)).toEqual(["realtime"]);
        await tenantDb
          .updateTable("contact_suppressions")
          .set({ revoked_at: new Date() })
          .where("id", "=", mute.suppressionId)
          .execute();

        // Block: a live message is dropped and counted.
        await tenantDb.transaction().execute((trx) =>
          applySuppression(trx, {
            contactId: contact.id,
            scope: "block",
            reason: "manual",
            actorUserId: ownerId,
          }),
        );
        await handleMessageEvent(event("spam"));
        expect(await messages()).toEqual(["hello", "quiet one"]);
        const drops = await tenantDb
          .selectFrom("contact_suppression_drops")
          .select(["channel", "dropped_count"])
          .execute();
        expect(drops).toEqual([{ channel: "whatsapp", dropped_count: 1 }]);

        // History sync is the past and is never gated.
        await handleMessageEvent(event("old history", { isHistorySync: true }));
        expect(await messages()).toContain("old history");
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await sql`DELETE FROM public.message_delivery_outbox
          WHERE company_id = ${companyId}::uuid`.execute(db);
        await clearTenantConnection(companyId);
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .execute(db);
        await db
          .deleteFrom("sla_policies")
          .where("company_id", "=", companyId)
          .execute();
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );
});
