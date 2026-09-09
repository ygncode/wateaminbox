import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { resolveConversationDisplayNames } from "./conversation-display-name.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("resolveConversationDisplayNames", () => {
  integrationTest(
    "names a subject-less direct conversation after the other party, never the connected account",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const ownerId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `convo-name-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Conversation naming test",
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

        const accountId = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: accountId,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Support bot",
            status: "connected",
          })
          .execute();

        const makeConversation = async (subject: string | null) =>
          tenantDb
            .insertInto("conversations")
            .values({
              channel_account_id: accountId,
              client_thread_key: `telegram:${crypto.randomUUID()}`,
              kind: subject ? "group" : "direct",
              subject,
              legacy_contact_id: null,
            })
            .returning("id")
            .executeTakeFirstOrThrow();

        const direct = await makeConversation(null);
        const group = await makeConversation("Ops room");
        const unnamed = await makeConversation(null);

        const endpoint = async (
          externalId: string,
          displayName: string | null,
        ) =>
          tenantDb
            .insertInto("contact_endpoints")
            .values({
              contact_id: null,
              channel: "telegram",
              provider: "telegram_bot",
              channel_account_id: accountId,
              endpoint_kind: "person",
              external_id: externalId,
              identity_scope: "account",
              display_name: displayName,
            })
            .returning("id")
            .executeTakeFirstOrThrow();

        const them = await endpoint("117408724", "Universe");
        const us = await endpoint("bot-self", "Support bot");
        const anonymous = await endpoint("990001", null);

        await tenantDb
          .insertInto("conversation_participants")
          .values([
            {
              conversation_id: direct.id,
              contact_endpoint_id: them.id,
              participant_kind: "external",
              role: "member",
              is_self: false,
            },
            // The workspace's own endpoint must never name the thread.
            {
              conversation_id: direct.id,
              contact_endpoint_id: us.id,
              participant_kind: "account",
              role: "member",
              is_self: true,
            },
            {
              conversation_id: unnamed.id,
              contact_endpoint_id: anonymous.id,
              participant_kind: "external",
              role: "member",
              is_self: false,
            },
          ])
          .execute();

        const names = await resolveConversationDisplayNames(tenantDb, [
          direct.id,
          group.id,
          unnamed.id,
        ]);
        expect(names.get(direct.id)).toBe("Universe");
        // A participant with no name still identifies the thread better than
        // a generic placeholder, so the external id is used.
        expect(names.get(unnamed.id)).toBe("990001");
        // A conversation with a real subject is not looked up at all; the
        // caller keeps the subject and never consults this map.
        expect(names.has(group.id)).toBe(false);

        expect(await resolveConversationDisplayNames(tenantDb, [])).toEqual(
          new Map(),
        );
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
