import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { mergeContacts } from "./contact-merge.service.js";
import { purgeArchivedChannelAccount } from "./channel-account-purge.service.js";
import { purgeArchivedConnection } from "./whatsapp/connection.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * Purging a connection whose customers were merged.
 *
 * Merge history carries RESTRICT foreign keys to the customers it describes,
 * so it pins them: a single merge on a connection made that connection
 * impossible to purge, and the operator saw only "Internal Server Error".
 */
describe("purging a connection after a merge", () => {
  integrationTest(
    "erases the customers and the merge history that described them",
    async () => {
      const companyId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `purge-merge-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Purge after merge test",
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

        const connectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Test",
            status: "disconnected",
            archived_at: new Date(),
          })
          .execute();
        // The WhatsApp mirror account shares the connection's id, which is
        // what the purge deletes it by.
        const account = connectionId;
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: account,
            channel: "whatsapp",
            provider: "whatsapp_linked_device",
            display_name: "Test",
            status: "disconnected",
            legacy_whatsapp_connection_id: connectionId,
          })
          .execute();

        const target = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: "60123456789@s.whatsapp.net",
            push_name: "Ada",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const source = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: "60987654321@s.whatsapp.net",
            push_name: "Ada 2",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        for (const contactId of [target.id, source.id]) {
          await tenantDb
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
            .execute();
        }

        await mergeContacts(tenantDb, {
          sourceContactId: source.id,
          targetContactId: target.id,
          actorUserId: ownerId,
          reason: "Same customer",
        });
        expect(
          await tenantDb
            .selectFrom("contact_merge_events")
            .select("id")
            .executeTakeFirst(),
        ).toBeDefined();

        // Before this fix the RESTRICT foreign key rejected the delete and the
        // whole purge failed.
        await purgeArchivedConnection(tenantDb, connectionId);

        expect(
          await tenantDb.selectFrom("contacts").select("id").execute(),
        ).toEqual([]);
        expect(
          await tenantDb
            .selectFrom("contact_merge_events")
            .select("id")
            .execute(),
        ).toEqual([]);
        expect(
          await tenantDb
            .selectFrom("contact_endpoint_reassignment_events")
            .select("id")
            .execute(),
        ).toEqual([]);
        // The channel-account purge deletes contacts the same way and had the
        // same trap. Proven on a second account so the two paths cannot drift.
        const neutralAccount = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: neutralAccount,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Bot",
            status: "archived",
            archived_at: new Date(),
          })
          .execute();
        const first = await tenantDb
          .insertInto("contacts")
          .values({ push_name: "Bo" })
          .returning("id")
          .executeTakeFirstOrThrow();
        const second = await tenantDb
          .insertInto("contacts")
          .values({ push_name: "Bo 2" })
          .returning("id")
          .executeTakeFirstOrThrow();
        for (const contactId of [first.id, second.id]) {
          const endpoint = await tenantDb
            .insertInto("contact_endpoints")
            .values({
              contact_id: contactId,
              channel: "telegram",
              provider: "telegram_bot",
              channel_account_id: neutralAccount,
              endpoint_kind: "person",
              external_id: `tg-${contactId}`,
              identity_scope: "account",
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          const conversation = await tenantDb
            .insertInto("conversations")
            .values({
              channel_account_id: neutralAccount,
              client_thread_key: `telegram:${crypto.randomUUID()}`,
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
        }
        await mergeContacts(tenantDb, {
          sourceContactId: second.id,
          targetContactId: first.id,
          actorUserId: ownerId,
          reason: "Same customer",
        });

        // A customer living on another account, merged into one this purge is
        // about to delete. It must come back as its own contact rather than
        // pointing at a deleted row, and the purge has to name it: the merge
        // record explaining the separation is deleted with the target.
        const survivingAccount = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: survivingAccount,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Other bot",
            status: "connected",
          })
          .execute();
        const outsider = await tenantDb
          .insertInto("contacts")
          .values({ push_name: "Outsider" })
          .returning("id")
          .executeTakeFirstOrThrow();
        await tenantDb
          .insertInto("contact_endpoints")
          .values({
            contact_id: outsider.id,
            channel: "telegram",
            provider: "telegram_bot",
            channel_account_id: survivingAccount,
            endpoint_kind: "person",
            external_id: `tg-outsider-${outsider.id}`,
            identity_scope: "account",
          })
          .execute();
        await mergeContacts(tenantDb, {
          sourceContactId: outsider.id,
          targetContactId: first.id,
          actorUserId: ownerId,
          reason: "Same customer",
        });

        const purged = await purgeArchivedChannelAccount(
          tenantDb,
          neutralAccount,
        );
        expect(purged.contactIds.sort()).toEqual([first.id, second.id].sort());
        expect(purged.separatedContacts).toEqual([
          { id: outsider.id, name: "Outsider" },
        ]);
        expect(
          await tenantDb
            .selectFrom("contacts")
            .select("merged_into_contact_id")
            .where("id", "=", outsider.id)
            .executeTakeFirstOrThrow(),
        ).toEqual({ merged_into_contact_id: null });
        await tenantDb
          .deleteFrom("contacts")
          .where("id", "=", outsider.id)
          .execute();
        expect(
          await tenantDb.selectFrom("contacts").select("id").execute(),
        ).toEqual([]);
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
