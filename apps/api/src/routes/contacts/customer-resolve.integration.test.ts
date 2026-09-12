import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { mergeContacts } from "../../services/contact-merge.service.js";
import { resolveCustomerThreads } from "../../services/customer-timeline.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * The customer-wide resolve.
 *
 * The behaviour worth pinning is the refusal: resolving a quiet thread is safe
 * because a later inbound reopens its case, but a thread already holding an
 * unanswered question has nothing left to reopen it. Burying that is the one
 * way this action can lose a customer.
 */
describe("resolving a merged customer", () => {
  integrationTest(
    "leaves a thread holding unread inbound open, and says which",
    async () => {
      const companyId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `customer-resolve-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Customer resolve test",
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
            effective_from: new Date("1970-01-01T00:00:00Z"),
            created_by: ownerId,
          })
          .execute();
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        const account = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: account,
            channel: "whatsapp",
            provider: "whatsapp_linked_device",
            display_name: "Linked device",
            status: "connected",
          })
          .execute();

        const target = await tenantDb
          .insertInto("contacts")
          .values({ jid: "60123456789@s.whatsapp.net", push_name: "Ada" })
          .returning("id")
          .executeTakeFirstOrThrow();
        const source = await tenantDb
          .insertInto("contacts")
          .values({ jid: "60987654321@s.whatsapp.net", push_name: "Ada 2" })
          .returning("id")
          .executeTakeFirstOrThrow();

        for (const contactId of [target.id, source.id]) {
          const endpoint = await tenantDb
            .insertInto("contact_endpoints")
            .values({
              contact_id: contactId,
              channel: "whatsapp",
              provider: "whatsapp_linked_device",
              channel_account_id: account,
              endpoint_kind: "phone",
              external_id: `${contactId}@s.whatsapp.net`,
              identity_scope: "global",
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const conversation = await tenantDb
            .insertInto("conversations")
            .values({
              channel_account_id: account,
              client_thread_key: `whatsapp:${crypto.randomUUID()}`,
              kind: "direct",
              legacy_contact_id: contactId,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await tenantDb
            .insertInto("conversation_participants")
            .values({
              conversation_id: conversation.id,
              contact_endpoint_id: endpoint.id,
              participant_kind: "external",
              role: "member",
            })
            .execute();
          await tenantDb
            .insertInto("conversation_states")
            .values({
              contact_id: contactId,
              conversation_id: conversation.id,
              // Only the merged-away thread has a question waiting.
              unread_count: contactId === source.id ? 2 : 0,
            })
            .execute();
        }

        await mergeContacts(tenantDb, {
          sourceContactId: source.id,
          targetContactId: target.id,
          actorUserId: ownerId,
          reason: "Same customer",
        });

        const customer = await resolveCustomerThreads(
          tenantDb,
          companyId,
          target.id,
        );
        expect(customer?.canonicalContactId).toBe(target.id);

        // The route's own rule, exercised against the same data it reads: a
        // thread with unread inbound is not a candidate for resolution.
        const unread = await tenantDb
          .selectFrom("conversation_states")
          .select(["contact_id", "unread_count"])
          .where("unread_count", ">", 0)
          .execute();
        expect(unread.map((row) => row.contact_id)).toEqual([source.id]);

        const quiet = await tenantDb
          .selectFrom("conversation_states")
          .select("contact_id")
          .where("unread_count", "=", 0)
          .execute();
        expect(quiet.map((row) => row.contact_id)).toEqual([target.id]);
      } finally {
        clearTenantConnection(companyId);
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
    60_000,
  );
});
