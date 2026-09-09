import { expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { sql } from "kysely";
import { reconcileWorkspace } from "./channel-spine-reconciler.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function setupWorkspace(name: string) {
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  await db
    .insertInto("companies")
    .values({ id: companyId, name, schema_name: schemaName, status: "active" })
    .execute();
  await db
    .insertInto("users")
    .values({
      id: userId,
      name: "Reconciler operator",
      email: `${userId}@example.test`,
      password_hash: "not-a-real-hash",
    })
    .execute();
  await createTenantSchema(companyId);
  await reconcileChannelSpineConcurrentIndexes(db, schemaName);
  return { companyId, schemaName, userId };
}

async function teardown(companyId: string, schemaName: string, userId: string) {
  clearTenantConnection(companyId);
  await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
  await db
    .deleteFrom("channel_spine_workspace_flags")
    .where("company_id", "=", companyId)
    .execute();
  await db.deleteFrom("companies").where("id", "=", companyId).execute();
  await db.deleteFrom("users").where("id", "=", userId).execute();
}

async function enableDualWrite(companyId: string, userId: string) {
  await db
    .insertInto("channel_spine_workspace_flags")
    .values({
      company_id: companyId,
      dual_write_enabled: true,
      dual_write_revision: "test",
      shadow_normalization_enabled: false,
      neutral_reads_enabled: false,
      write_authority: "legacy",
      enabled_providers: sql<string[]>`ARRAY[]::text[]`,
      revision: "1",
      created_by: userId,
      updated_by: userId,
    })
    .execute();
}

integration(
  "repairs a journaled shadow failure and clears the backlog",
  async () => {
    const { companyId, schemaName, userId } =
      await setupWorkspace("Reconciler repair");
    try {
      await enableDualWrite(companyId, userId);
      const tenantDb = await getTenantConnection(companyId);
      const connectionId = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      await tenantDb
        .insertInto("whatsapp_connections")
        .values({
          id: connectionId,
          name: "Line",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connectionId,
          jid: "60129999999@s.whatsapp.net",
          phone_number: "60129999999",
        })
        .execute();
      await tenantDb
        .insertInto("messages")
        .values({
          id: messageId,
          whatsapp_connection_id: connectionId,
          contact_id: contactId,
          message_id: "3EBREPAIR",
          from_me: false,
          message_type: "text",
          content: "repair me",
          timestamp: new Date("2026-09-09T12:00:00Z"),
        })
        .execute();
      // Exactly what a failed dual write leaves behind.
      await tenantDb
        .insertInto("channel_spine_reconciliation_journal")
        .values({
          kind: "message",
          legacy_table: "messages",
          legacy_id: messageId,
          error_code: "shadow_write_failed",
          status: "pending",
          next_attempt_at: new Date(Date.now() - 1000),
        })
        .execute();

      const result = await reconcileWorkspace(companyId);
      expect(result.repaired).toBe(1);
      expect(result.quarantined).toBe(0);

      expect(
        (
          await tenantDb
            .selectFrom("channel_spine_reconciliation_journal")
            .select("status")
            .where("legacy_id", "=", messageId)
            .executeTakeFirstOrThrow()
        ).status,
      ).toBe("repaired");
      expect(
        (
          await tenantDb
            .selectFrom("messages")
            .select(["conversation_id", "channel_account_id"])
            .where("id", "=", messageId)
            .executeTakeFirstOrThrow()
        ).conversation_id,
      ).toBe(contactId);
    } finally {
      await teardown(companyId, schemaName, userId);
    }
  },
  30_000,
);

integration(
  "sweeps a message no writer ever journaled",
  async () => {
    const { companyId, schemaName, userId } =
      await setupWorkspace("Reconciler sweep");
    try {
      await enableDualWrite(companyId, userId);
      const tenantDb = await getTenantConnection(companyId);
      const connectionId = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      await tenantDb
        .insertInto("whatsapp_connections")
        .values({
          id: connectionId,
          name: "Line",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connectionId,
          jid: "60128888888@s.whatsapp.net",
          phone_number: "60128888888",
        })
        .execute();
      // No journal row at all: this is the row an old or crashed writer left,
      // which is the case a journal drain alone can never converge.
      await tenantDb
        .insertInto("messages")
        .values({
          id: messageId,
          whatsapp_connection_id: connectionId,
          contact_id: contactId,
          message_id: "3EBSWEEP",
          from_me: false,
          message_type: "text",
          content: "never journaled",
          timestamp: new Date("2026-09-09T12:00:00Z"),
        })
        .execute();

      const result = await reconcileWorkspace(companyId);
      expect(result.swept).toBe(1);
      expect(
        (
          await tenantDb
            .selectFrom("messages")
            .select("conversation_id")
            .where("id", "=", messageId)
            .executeTakeFirstOrThrow()
        ).conversation_id,
      ).toBe(contactId);
    } finally {
      await teardown(companyId, schemaName, userId);
    }
  },
  30_000,
);

integration(
  "does nothing for a workspace that is not dual-writing",
  async () => {
    const { companyId, schemaName, userId } =
      await setupWorkspace("Reconciler off");
    try {
      // No flags row at all: the fail-closed state must stay untouched.
      const tenantDb = await getTenantConnection(companyId);
      const connectionId = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      await tenantDb
        .insertInto("whatsapp_connections")
        .values({
          id: connectionId,
          name: "Line",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connectionId,
          jid: "60127777777@s.whatsapp.net",
          phone_number: "60127777777",
        })
        .execute();
      await tenantDb
        .insertInto("messages")
        .values({
          id: crypto.randomUUID(),
          whatsapp_connection_id: connectionId,
          contact_id: contactId,
          message_id: "3EBOFF",
          from_me: false,
          message_type: "text",
          content: "legacy only",
          timestamp: new Date("2026-09-09T12:00:00Z"),
        })
        .execute();

      expect(await reconcileWorkspace(companyId)).toEqual({
        repaired: 0,
        quarantined: 0,
        stillFailing: 0,
        swept: 0,
      });
      expect(
        Number(
          (
            await tenantDb
              .selectFrom("channel_accounts")
              .select((eb) => eb.fn.countAll<string>().as("count"))
              .executeTakeFirstOrThrow()
          ).count,
        ),
      ).toBe(0);
    } finally {
      await teardown(companyId, schemaName, userId);
    }
  },
  30_000,
);
