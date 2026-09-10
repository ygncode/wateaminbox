import { expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { sql } from "kysely";
import { getContactsWithLastMessage } from "./contact.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * The chat list resolves its newest message and its workflow state from the
 * conversation when the contact has one, and from the contact only when it
 * could never be bridged. The lifecycle and unread filters have to read the
 * same two sides.
 *
 * Nothing exercised this query with a filter applied, so renaming the state
 * alias in the list left every filter referencing an alias that no longer
 * existed - the unfiltered list kept working and only Open, Pending, Resolved
 * and Unread broke, which is the half a smoke test does not reach.
 */
integration(
  "filters the chat list by lifecycle and unread from the conversation",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const connectionId = crypto.randomUUID();
    const bridged = crypto.randomUUID();
    const unbridged = crypto.randomUUID();
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Chat list filters",
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
          name: "Line",
          phone_number: "60123456789",
          jid: "60123456789@s.whatsapp.net",
          status: "connected",
        })
        .execute();
      await tenantDb
        .insertInto("channel_accounts")
        .values({
          id: connectionId,
          channel: "whatsapp",
          provider: "whatsapp_linked_device",
          display_name: "Line",
          external_account_id: "60123456789@s.whatsapp.net",
          external_scope_id: connectionId,
          status: "connected",
          legacy_whatsapp_connection_id: connectionId,
        })
        .execute();

      // One contact the spine bridged, and one it never could - no connection
      // and no JID, so it has no conversation and must fall back to itself.
      await tenantDb
        .insertInto("contacts")
        .values([
          {
            id: bridged,
            whatsapp_connection_id: connectionId,
            jid: "60129999999@s.whatsapp.net",
            phone_number: "60129999999",
            push_name: "Bridged",
          },
          {
            id: unbridged,
            whatsapp_connection_id: null,
            jid: null,
            phone_number: "60128888888",
            push_name: "Unbridged",
          },
        ])
        .execute();
      await tenantDb
        .insertInto("conversations")
        .values({
          id: bridged,
          channel_account_id: connectionId,
          external_thread_id: "60129999999@s.whatsapp.net",
          client_thread_key: `legacy-contact:${bridged}`,
          kind: "direct",
          legacy_contact_id: bridged,
        })
        .execute();
      await tenantDb
        .insertInto("conversation_states")
        .values([
          {
            conversation_id: bridged,
            contact_id: bridged,
            status: "open",
            unread_count: 3,
          },
          {
            conversation_id: null,
            contact_id: unbridged,
            status: "resolved",
            unread_count: 0,
          },
        ])
        .execute();

      // Unfiltered: both are listed.
      expect(
        (await getContactsWithLastMessage(tenantDb, companyId, {})).contacts,
      ).toHaveLength(2);

      // Open reads the conversation's state, so only the bridged one matches.
      const open = await getContactsWithLastMessage(tenantDb, companyId, {
        conversationStatus: "open",
      });
      expect(open.contacts.map((row) => row.id)).toEqual([bridged]);

      // Unread reads the same two sides.
      const unread = await getContactsWithLastMessage(tenantDb, companyId, {
        unreadOnly: true,
      });
      expect(unread.contacts.map((row) => row.id)).toEqual([bridged]);

      // And the contact with no conversation is still reachable by its own
      // state rather than vanishing from every filtered view.
      const resolved = await getContactsWithLastMessage(tenantDb, companyId, {
        conversationStatus: "resolved",
      });
      expect(resolved.contacts.map((row) => row.id)).toEqual([unbridged]);
    } finally {
      clearTenantConnection(companyId);
      await sql
        .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
        .execute(db);
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  60_000,
);
