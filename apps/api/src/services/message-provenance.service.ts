import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely, Transaction } from "kysely";

type ProvenanceDb = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

/**
 * Which thread a message arrived on, and over which channel.
 *
 * A merged customer is reachable on several threads at once, so a message
 * shown next to another customer's - or next to the same customer's other
 * channel - has to say where it came from. The conversation alone cannot:
 * `channel` and `provider` live on the channel account one hop away.
 */
export interface ThreadProvenance {
  /**
   * The id the chat route addresses for this thread: the legacy contact when
   * the thread still has one, the conversation otherwise. The same overloaded
   * value the chat list and the switcher emit, so a client can navigate to it
   * without a second lookup.
   */
  threadId: string;
  channel: string;
  provider: string;
}

/**
 * Provenance for a set of conversations, keyed by conversation id.
 *
 * One query for the whole page rather than one per message: a merged timeline
 * page can span every thread a customer has, and the alternative is a lookup
 * per row on the hottest read in the product.
 *
 * A legacy WhatsApp row that never reached the spine has no conversation to
 * look up and is answered by `legacyProvenance` instead.
 */
export async function resolveThreadProvenance(
  db: ProvenanceDb,
  conversationIds: readonly string[],
): Promise<Map<string, ThreadProvenance>> {
  const unique = [...new Set(conversationIds)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .selectFrom("conversations as conversation")
    .leftJoin(
      "channel_accounts as account",
      "account.id",
      "conversation.channel_account_id",
    )
    .select([
      "conversation.id as conversation_id",
      "conversation.legacy_contact_id as legacy_contact_id",
      "account.channel as channel",
      "account.provider as provider",
    ])
    .where("conversation.id", "in", unique)
    .execute();
  return new Map(
    rows.map((row) => [
      row.conversation_id,
      {
        threadId: row.legacy_contact_id ?? row.conversation_id,
        // An account row is required by the schema, so a missing channel means
        // a conversation whose account was removed out from under it. Naming
        // the thread is still better than dropping it from the page.
        channel: row.channel ?? "whatsapp",
        provider: row.provider ?? "whatsapp_linked_device",
      },
    ]),
  );
}

/**
 * Provenance for a message that predates the spine.
 *
 * Such a row carries only `contact_id` and a WhatsApp connection, which is the
 * one channel that could have produced it.
 */
export function legacyProvenance(contactId: string): ThreadProvenance {
  return {
    threadId: contactId,
    channel: "whatsapp",
    provider: "whatsapp_linked_device",
  };
}
