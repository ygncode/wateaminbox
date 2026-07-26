import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../services/tenant.service.js";
import { loadMessageReactions } from "./message-reactions.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("reaction participant identities", () => {
  integrationTest(
    "resolves a group reactor LID through WhatsApp's saved contact name",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const contactId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const schema = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            jid: "999@s.whatsapp.net",
            status: "connected",
          })
          .execute();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: contactId,
            whatsapp_connection_id: connectionId,
            jid: "123@g.us",
            is_group: true,
          })
          .execute();
        await tenantDb
          .insertInto("messages")
          .values({
            id: messageId,
            whatsapp_connection_id: connectionId,
            contact_id: contactId,
            message_id: "remote-message",
            from_me: false,
            message_type: "text",
            content: "hello",
            timestamp: new Date(),
          })
          .execute();
        await tenantDb
          .insertInto("message_reactions")
          .values({
            message_id: messageId,
            reactor_jid: "333@lid",
            emoji: "👍",
          })
          .execute();

        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts (
            connection_id,
            our_jid,
            their_jid,
            full_name
          ) VALUES (
            ${connectionId},
            '999@s.whatsapp.net',
            '1555333@s.whatsapp.net',
            'Charlie from WhatsApp'
          )
        `.execute(db);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_lid_mappings (
            connection_id,
            lid,
            jid
          ) VALUES (
            ${connectionId},
            '333@lid',
            '1555333@s.whatsapp.net'
          )
        `.execute(db);

        const reactions = await loadMessageReactions(tenantDb, [
          {
            id: messageId,
            contact_id: contactId,
            whatsapp_connection_id: connectionId,
          },
        ]);
        expect(reactions.get(messageId)?.[0]).toMatchObject({
          reactorJid: "333@lid",
          reactorPhoneNumber: "+1555333",
          reactorName: "Charlie from WhatsApp",
          isOwn: false,
        });
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id = ${connectionId}
        `.execute(db);
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_lid_mappings
          WHERE connection_id = ${connectionId}
        `.execute(db);
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
});
