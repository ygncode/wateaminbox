import { expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { getContactsWithLastMessage } from "./contact.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

integration(
  "aggregates merge groups independently and coalesces only identical pending reads",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const [first, second, untouched, firstSource, secondSource, legacySource] =
      Array.from({ length: 6 }, () => crypto.randomUUID());
    const account = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const firstActivity = new Date("2026-01-03T00:00:00Z");
    const secondActivity = new Date("2026-01-04T00:00:00Z");
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Inbox query regression",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      await createTenantSchema(companyId);
      const tenantDb = getTenantConnection(companyId);
      await tenantDb
        .insertInto("channel_accounts")
        .values({
          id: account,
          channel: "whatsapp",
          provider: "whatsapp_linked_device",
          display_name: "Test account",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("contacts")
        .values([first, second, untouched].map((id) => ({ id, push_name: id })))
        .execute();
      await tenantDb
        .insertInto("contacts")
        .values([
          { id: firstSource, merged_into_contact_id: first },
          { id: secondSource, merged_into_contact_id: second },
          { id: legacySource, merged_into_contact_id: first },
        ])
        .execute();
      await tenantDb
        .insertInto("conversations")
        .values([
          {
            id: firstSource,
            channel_account_id: account,
            external_thread_id: firstSource,
            client_thread_key: `test:${firstSource}`,
            kind: "direct",
            legacy_contact_id: firstSource,
            last_message_at: firstActivity,
          },
          {
            id: secondSource,
            channel_account_id: account,
            external_thread_id: secondSource,
            client_thread_key: `test:${secondSource}`,
            kind: "direct",
            legacy_contact_id: secondSource,
            last_message_at: secondActivity,
          },
        ])
        .execute();
      await tenantDb
        .insertInto("conversation_states")
        .values([
          {
            contact_id: firstSource,
            conversation_id: firstSource,
            unread_count: 3,
          },
          {
            contact_id: secondSource,
            conversation_id: secondSource,
            unread_count: 7,
          },
          {
            contact_id: legacySource,
            unread_count: 2,
            last_message_at: firstActivity,
          },
        ])
        .execute();

      const pending = getContactsWithLastMessage(tenantDb, companyId, {
        userId,
      });
      const duplicate = getContactsWithLastMessage(tenantDb, companyId, {
        userId,
      });
      expect(duplicate).toBe(pending);
      const restricted = getContactsWithLastMessage(tenantDb, companyId, {
        userId,
        restrictToAssigned: true,
      });
      expect(restricted).not.toBe(pending);
      expect((await restricted).contacts).toEqual([]);

      const result = await pending;
      expect(result.total).toBe(3);
      expect(result.contacts.map((row) => row.id)).toEqual([
        second,
        first,
        untouched,
      ]);
      expect(
        result.contacts.map((row) => ({
          unread: Number(row.unread_count),
          chats: row.chat_count,
          accounts: row.account_ids,
          activity: row.last_message_at,
        })),
      ).toEqual([
        { unread: 7, chats: 2, accounts: [account], activity: secondActivity },
        { unread: 5, chats: 3, accounts: [account], activity: firstActivity },
        { unread: 0, chats: 1, accounts: [], activity: null },
      ]);
      const unread = await getContactsWithLastMessage(tenantDb, companyId, {
        unreadOnly: true,
      });
      expect(unread.total).toBe(2);
      expect(unread.contacts.map((row) => row.id)).toEqual([second, first]);
      const page = await getContactsWithLastMessage(tenantDb, companyId, {
        offset: 1,
        limit: 1,
      });
      expect(page.total).toBe(3);
      expect(page.contacts.map((row) => row.id)).toEqual([first]);

      // A new request after a mutation must observe it, not a retained response.
      await tenantDb
        .updateTable("conversation_states")
        .set({ unread_count: 0 })
        .where("contact_id", "=", secondSource)
        .execute();
      const refreshed = await getContactsWithLastMessage(tenantDb, companyId, {
        userId,
      });
      expect(Number(refreshed.contacts[0].unread_count)).toBe(0);
    } finally {
      await clearTenantConnection(companyId);
      await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(
        db,
      );
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  60_000,
);
