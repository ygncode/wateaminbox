import { expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { sql } from "kysely";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../../services/tenant.service.js";
import { shadowLinkedDeviceLegacyMutation } from "./shadow.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * The shadow write runs inside the caller's already-open tenant transaction.
 * Kysely's `Transaction.transaction()` throws rather than nesting, so an
 * earlier version of this code failed on every single message and reported
 * it only as a swallowed `shadow_write_failed` journal row. Both cases below
 * exercise the real Kysely transaction object; a hand-rolled fake would not
 * have caught that.
 */
integration(
  "mirrors a legacy WhatsApp message into the spine from inside the caller's transaction",
  async () => {
    const companyId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Linked-device shadow test",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      await createTenantSchema(companyId);
      await reconcileChannelSpineConcurrentIndexes(db, schemaName);
      const tenantDb = await getTenantConnection(companyId);
      await tenantDb
        .insertInto("whatsapp_connections")
        .values({
          id: connectionId,
          name: "Support line",
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
          push_name: "Ada",
        })
        .execute();
      await tenantDb
        .insertInto("messages")
        .values({
          id: messageId,
          whatsapp_connection_id: connectionId,
          contact_id: contactId,
          message_id: "3EB0PROVIDERID",
          from_me: false,
          message_type: "text",
          content: "hello",
          timestamp: new Date("2026-09-09T12:00:00Z"),
        })
        .execute();

      const mirrored = await tenantDb
        .transaction()
        .execute((trx) =>
          shadowLinkedDeviceLegacyMutation(
            trx,
            companyId,
            contactId,
            messageId,
          ),
        );
      expect(mirrored).toBe(true);

      // The parent graph exists and the message is attached to it.
      expect(
        (
          await tenantDb
            .selectFrom("channel_accounts")
            .select(["provider", "legacy_whatsapp_connection_id"])
            .where("id", "=", connectionId)
            .executeTakeFirstOrThrow()
        ).provider,
      ).toBe("whatsapp_linked_device");
      const stored = await tenantDb
        .selectFrom("messages")
        .select([
          "conversation_id",
          "channel_account_id",
          "external_message_id",
          "direction",
        ])
        .where("id", "=", messageId)
        .executeTakeFirstOrThrow();
      expect(stored.conversation_id).toBe(contactId);
      expect(stored.channel_account_id).toBe(connectionId);
      expect(stored.external_message_id).toBe("3EB0PROVIDERID");
      expect(stored.direction).toBe("inbound");
      // Nothing to repair, so nothing journaled.
      expect(
        Number(
          (
            await tenantDb
              .selectFrom("channel_spine_reconciliation_journal")
              .select((eb) => eb.fn.countAll<string>().as("count"))
              .executeTakeFirstOrThrow()
          ).count,
        ),
      ).toBe(0);
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  30_000,
);

integration(
  "mirrors a group chat without inventing a customer contact for it",
  async () => {
    const companyId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const groupContactId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Linked-device group shadow test",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      await createTenantSchema(companyId);
      await reconcileChannelSpineConcurrentIndexes(db, schemaName);
      const tenantDb = await getTenantConnection(companyId);
      await tenantDb
        .insertInto("whatsapp_connections")
        .values({
          id: connectionId,
          name: "Support line",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("contacts")
        .values({
          id: groupContactId,
          whatsapp_connection_id: connectionId,
          jid: "966537250388-1609402116@g.us",
          phone_number: null,
          push_name: "Ops room",
          is_group: true,
        })
        .execute();
      await tenantDb
        .insertInto("messages")
        .values({
          id: messageId,
          whatsapp_connection_id: connectionId,
          contact_id: groupContactId,
          message_id: "3EB0GROUPID",
          from_me: false,
          message_type: "text",
          content: "standup in 5",
          timestamp: new Date("2026-09-09T12:00:00Z"),
        })
        .execute();

      expect(
        await tenantDb
          .transaction()
          .execute((trx) =>
            shadowLinkedDeviceLegacyMutation(
              trx,
              companyId,
              groupContactId,
              messageId,
            ),
          ),
      ).toBe(true);

      expect(
        (
          await tenantDb
            .selectFrom("conversations")
            .select("kind")
            .where("id", "=", groupContactId)
            .executeTakeFirstOrThrow()
        ).kind,
      ).toBe("group");
      // A group is a thread, not a customer: its endpoint owns no contact and
      // the legacy row stays a projection rather than becoming a person.
      const endpoint = await tenantDb
        .selectFrom("contact_endpoints")
        .select(["contact_id", "endpoint_kind"])
        .where("channel_account_id", "=", connectionId)
        .executeTakeFirstOrThrow();
      expect(endpoint.endpoint_kind).toBe("group");
      expect(endpoint.contact_id).toBeNull();
      expect(
        (
          await tenantDb
            .selectFrom("contacts")
            .select("record_kind")
            .where("id", "=", groupContactId)
            .executeTakeFirstOrThrow()
        ).record_kind,
      ).toBe("legacy_group_projection");
      expect(
        (
          await tenantDb
            .selectFrom("messages")
            .select("conversation_id")
            .where("id", "=", messageId)
            .executeTakeFirstOrThrow()
        ).conversation_id,
      ).toBe(groupContactId);
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  30_000,
);

integration(
  "a failed shadow write journals and still lets the legacy transaction commit",
  async () => {
    const companyId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Linked-device shadow failure test",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      await createTenantSchema(companyId);
      await reconcileChannelSpineConcurrentIndexes(db, schemaName);
      const tenantDb = await getTenantConnection(companyId);
      // No connection on the contact, so the bridge cannot resolve an account.
      await tenantDb
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: null,
          jid: "60129999999@s.whatsapp.net",
          phone_number: "60129999999",
        })
        .execute();

      const mirrored = await tenantDb.transaction().execute(async (trx) => {
        const result = await shadowLinkedDeviceLegacyMutation(
          trx,
          companyId,
          contactId,
          messageId,
        );
        // The legacy write is authoritative and must survive a shadow failure,
        // which is only possible if the transaction is still usable here.
        await trx
          .updateTable("contacts")
          .set({ push_name: "committed after the shadow failed" })
          .where("id", "=", contactId)
          .execute();
        return result;
      });

      expect(mirrored).toBe(false);
      expect(
        (
          await tenantDb
            .selectFrom("contacts")
            .select("push_name")
            .where("id", "=", contactId)
            .executeTakeFirstOrThrow()
        ).push_name,
      ).toBe("committed after the shadow failed");
      expect(
        (
          await tenantDb
            .selectFrom("channel_spine_reconciliation_journal")
            .select(["kind", "error_code", "status"])
            .executeTakeFirstOrThrow()
        ).status,
      ).toBe("pending");
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  30_000,
);
