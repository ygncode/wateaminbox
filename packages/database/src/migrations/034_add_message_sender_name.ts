import type { Kysely } from "kysely";
import { sql } from "kysely";
import {
  addColumnToAllTenants,
  dropColumnFromAllTenants,
  executeOnAllTenants,
} from "./migration-helpers.js";

/** Preserve the WhatsApp participant push name on group messages. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await addColumnToAllTenants(db, "messages", "sender_name", "TEXT");

  // Older history imports stored the group JID as every sender. Whatsmeow's
  // message-secret store still retains the participant for those message IDs,
  // allowing existing conversations to be repaired without another QR sync.
  await executeOnAllTenants(db, async (schemaName) => {
    const tenant = sql.raw(`"${schemaName}"`);
    await sql`
      WITH resolved AS (
        SELECT DISTINCT ON (m.id)
          m.id,
          regexp_replace(
            coalesce(lm.jid, secrets.sender_jid),
            ':[0-9]+@',
            '@'
          ) AS sender_jid,
          coalesce(
            nullif(contact.custom_name, ''),
            nullif(contact.push_name, ''),
            nullif(stored_contact.full_name, ''),
            nullif(stored_contact.push_name, ''),
            nullif(stored_contact.first_name, ''),
            split_part(
              regexp_replace(
                coalesce(lm.jid, secrets.sender_jid),
                ':[0-9]+@',
                '@'
              ),
              '@',
              1
            )
          ) AS sender_name
        FROM ${tenant}.messages AS m
        INNER JOIN ${tenant}.contacts AS group_contact
          ON group_contact.id = m.contact_id
          AND group_contact.is_group = true
        INNER JOIN whatsapp_sessions.whatsmeow_message_secrets AS secrets
          ON secrets.connection_id::text = m.whatsapp_connection_id::text
          AND secrets.message_id = m.message_id
        LEFT JOIN whatsapp_sessions.whatsmeow_lid_mappings AS lm
          ON lm.connection_id::text = secrets.connection_id::text
          AND regexp_replace(lm.lid, ':[0-9]+@', '@') =
              regexp_replace(secrets.sender_jid, ':[0-9]+@', '@')
        LEFT JOIN whatsapp_sessions.whatsmeow_contacts AS stored_contact
          ON stored_contact.connection_id::text = secrets.connection_id::text
          AND regexp_replace(stored_contact.their_jid, ':[0-9]+@', '@') =
              regexp_replace(
                coalesce(lm.jid, secrets.sender_jid),
                ':[0-9]+@',
                '@'
              )
        LEFT JOIN ${tenant}.contacts AS contact
          ON contact.jid = regexp_replace(
            coalesce(lm.jid, secrets.sender_jid),
            ':[0-9]+@',
            '@'
          )
        ORDER BY m.id, lm.created_at DESC NULLS LAST
      )
      UPDATE ${tenant}.messages AS message
      SET sender_jid = resolved.sender_jid,
          sender_name = resolved.sender_name
      FROM resolved
      WHERE message.id = resolved.id
    `.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await dropColumnFromAllTenants(db, "messages", "sender_name");
}
