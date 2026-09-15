import { expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import { ensureActiveCaseWithin } from "../../services/conversation-case.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

/**
 * The first outgoing message to a contact that has never had one.
 *
 * The "new chat" flow inserts a `contacts` row and nothing else, and the
 * channel-spine bridge is otherwise only written as a shadow of a legacy
 * message - so under neutral write authority the send had no conversation to
 * write against and answered 404. Every later message to the same contact
 * worked, which is what made it read as a contact problem rather than a
 * bridge one. The route has to build the bridge itself.
 */
integration(
  "sends the first message to a contact that has no conversation yet",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const ownerId = crypto.randomUUID();
    const ownerEmail = `first-send-${ownerId}@example.com`;
    const connectionId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    try {
      await db
        .insertInto("users")
        .values({
          id: ownerId,
          email: ownerEmail,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "First neutral send",
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
      await db
        .insertInto("channel_spine_workspace_flags")
        .values({
          company_id: companyId,
          dual_write_enabled: true,
          dual_write_revision: "test",
          shadow_normalization_enabled: true,
          shadow_normalization_revision: "test",
          neutral_reads_enabled: true,
          neutral_read_revision: "test",
          write_authority: "neutral",
          write_authority_revision: "test",
          enabled_providers: sql<
            string[]
          >`ARRAY['whatsapp_linked_device']::text[]`,
          provider_enable_revision: "test",
          revision: "1",
          created_by: ownerId,
          updated_by: ownerId,
        })
        .execute();
      await createTenantSchema(companyId);
      await reconcileChannelSpineConcurrentIndexes(db, schemaName);
      const tenantDb = await getTenantConnection(companyId);

      await tenantDb
        .insertInto("whatsapp_connections")
        .values({
          id: connectionId,
          name: "MMPhone",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("whatsapp_connection_sessions")
        .values({ whatsapp_connection_id: connectionId, status: "connected" })
        .execute();
      // Exactly what the outbound "new chat" flow leaves behind: a contact
      // row, no conversation, no bridge.
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connectionId,
          jid: "33786137909@s.whatsapp.net",
          phone_number: "33786137909",
        })
        .execute();

      // The chat is open, as it is in the inbox before anyone types: the send
      // guard requires an active case, and this test is about the bridge.
      await tenantDb.transaction().execute((trx) =>
        ensureActiveCaseWithin(
          trx,
          { id: contactId, isGroup: false },
          {
            companyId,
            openedBy: ownerId,
            reason: "Outbound conversation started in the inbox",
          },
        ),
      );

      const login = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ownerEmail, password: PASSWORD }),
      });
      expect(login.status).toBe(200);
      const { tokens } = (await login.json()) as {
        tokens: { accessToken: string };
      };

      const response = await app.request("/api/messages", {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          "x-company-id": companyId,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contactId,
          content: "first message",
          messageType: "text",
        }),
      });
      expect(response.status).toBe(200);

      // The bridge the send had to build, and the message written against it.
      const conversation = await tenantDb
        .selectFrom("conversations")
        .select(["id", "channel_account_id"])
        .where("legacy_contact_id", "=", contactId)
        .executeTakeFirstOrThrow();
      expect(conversation.channel_account_id).toBe(connectionId);
      const message = await tenantDb
        .selectFrom("messages")
        .select(["content", "contact_id"])
        .executeTakeFirstOrThrow();
      expect(message.content).toBe("first message");
      expect(message.contact_id).toBe(contactId);
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db
        .deleteFrom("channel_spine_workspace_flags")
        .where("company_id", "=", companyId)
        .execute();
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
  60_000,
);
