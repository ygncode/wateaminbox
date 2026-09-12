import type { Kysely } from "kysely";
import { sql } from "kysely";
import { executeOnAllTenants } from "./migration-helpers.js";

interface ResolvableRow {
  conversation_id: string;
  endpoint_id: string;
  display_name: string | null;
  address_display: string | null;
  normalized_address: string | null;
}

/**
 * Give existing non-WhatsApp people a customer record.
 *
 * The neutral event processor used to create conversations and endpoints that
 * belonged to nobody: `conversations.legacy_contact_id` and
 * `contact_endpoints.contact_id` both stayed null, and only the WhatsApp
 * mirror ever wrote a `contacts` row. It now resolves a customer on ingest;
 * this applies the same rule once to what already arrived, so an existing
 * Telegram chat does not have to wait for its next inbound message.
 *
 * The rule is deliberately the narrow one the processor uses:
 *
 * - direct conversations only - a group is a thread, not a person;
 * - exactly one external, person-like participant endpoint, because guessing
 *   which of several parties is "the customer" is the wrong decision to make
 *   in a migration;
 * - the endpoint must not already belong to a customer, and the conversation
 *   must not already name one.
 *
 * Written as a row-at-a-time loop rather than one set-based statement: each
 * new contact has to be paired back to the endpoint that produced it, and
 * `contacts` carries no unique key to join on when `whatsapp_connection_id`
 * is null - matching on name and address would mispair two people who share
 * both. The volume this walks is the number of unresolved neutral threads,
 * which is small by construction.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    const table = (name: string) => sql.raw(`"${schemaName}"."${name}"`);
    const resolvable = await sql<ResolvableRow>`
      SELECT conversation.id AS conversation_id,
             min(endpoint.id::text)::uuid AS endpoint_id,
             min(endpoint.display_name) AS display_name,
             min(endpoint.address_display) AS address_display,
             min(endpoint.normalized_address) AS normalized_address
      FROM ${table("conversations")} conversation
      JOIN ${table("conversation_participants")} participant
        ON participant.conversation_id = conversation.id
       AND participant.participant_kind = 'external'
       AND participant.is_self = false
       AND participant.left_at IS NULL
      JOIN ${table("contact_endpoints")} endpoint
        ON endpoint.id = participant.contact_endpoint_id
       AND endpoint.contact_id IS NULL
       AND endpoint.endpoint_kind IN ('person', 'user', 'phone', 'email')
      WHERE conversation.legacy_contact_id IS NULL
        AND conversation.kind = 'direct'
        AND conversation.archived_at IS NULL
      GROUP BY conversation.id
      HAVING count(DISTINCT endpoint.id) = 1
    `.execute(db);

    for (const row of resolvable.rows) {
      // `push_name`/`username` carry the identity rather than `display_name`
      // alone, because the contact list renders and searches those columns.
      const inserted = await sql<{ id: string }>`
        INSERT INTO ${table("contacts")}
          (whatsapp_connection_id, jid, phone_number, push_name, username,
           display_name, is_group, record_kind)
        VALUES (NULL, NULL, NULL,
                ${row.display_name ?? row.address_display},
                ${row.normalized_address},
                ${row.display_name},
                false, 'customer')
        RETURNING id
      `.execute(db);
      const contactId = inserted.rows[0]!.id;

      await sql`
        UPDATE ${table("contact_endpoints")}
        SET contact_id = ${contactId}::uuid, updated_at = now()
        WHERE id = ${row.endpoint_id}::uuid AND contact_id IS NULL
      `.execute(db);
      await sql`
        UPDATE ${table("conversations")}
        SET legacy_contact_id = ${contactId}::uuid, updated_at = now()
        WHERE id = ${row.conversation_id}::uuid AND legacy_contact_id IS NULL
      `.execute(db);

      // The workflow rows already exist, keyed only by conversation, because
      // they were written while the thread belonged to nobody. Routes that
      // resolve a workflow identity prefer the contact key once a conversation
      // names one: leaving these null makes such a route match no row and then
      // insert a second one, which the unique index on conversation_id
      // rejects. Marking one of these threads read failed exactly that way.
      for (const workflowTable of [
        "conversation_states",
        "contact_assignments",
        "conversation_cases",
      ]) {
        await sql`
          UPDATE ${table(workflowTable)}
          SET contact_id = ${contactId}::uuid
          WHERE conversation_id = ${row.conversation_id}::uuid
            AND contact_id IS NULL
        `.execute(db);
      }
    }
  });
}

/**
 * Irreversible by design.
 *
 * Down would have to delete customer rows that operators may since have
 * renamed, tagged, assigned, or merged. Unlinking them instead would leave
 * orphan contacts behind, which is worse than leaving the link in place: the
 * link is the correct state, and re-running the forward migration skips a
 * conversation that already has it.
 */
export async function down(): Promise<void> {}
