import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely, Transaction } from "kysely";

type ConversationDb = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

/**
 * What a conversation should be called in a list, a header, or a notification.
 *
 * A subject is authoritative when the provider gives one - a group title, an
 * email thread subject. Direct conversations usually have none: the identity
 * lives on the counterpart's endpoint, which is where a provider puts a
 * person's name. Without this fallback such a thread rendered under a generic
 * placeholder, so every Telegram chat in the inbox looked identically named.
 *
 * `is_self` marks the workspace's own endpoint in the thread and is excluded,
 * or a direct conversation would be named after the connected bot rather than
 * the person writing to it.
 */
export async function resolveConversationDisplayNames(
  db: ConversationDb,
  conversationIds: readonly string[],
): Promise<Map<string, string>> {
  const counterparts = await resolveConversationCounterparts(
    db,
    conversationIds,
  );
  const names = new Map<string, string>();
  for (const [conversationId, counterpart] of counterparts) {
    if (counterpart.displayName)
      names.set(conversationId, counterpart.displayName);
  }
  return names;
}

/**
 * The other party of each conversation, in one query.
 *
 * Used by the inbox list, which needs a name and a picture per row; resolving
 * these one conversation at a time would reintroduce an N+1 on the hottest
 * read in the product.
 */
export async function resolveConversationCounterparts(
  db: ConversationDb,
  conversationIds: readonly string[],
): Promise<Map<string, ConversationCounterpart>> {
  const counterparts = new Map<string, ConversationCounterpart>();
  if (conversationIds.length === 0) return counterparts;
  const rows = await db
    .selectFrom("conversation_participants as participant")
    .innerJoin(
      "contact_endpoints as endpoint",
      "endpoint.id",
      "participant.contact_endpoint_id",
    )
    .select([
      "participant.conversation_id",
      "endpoint.display_name",
      "endpoint.address_display",
      "endpoint.normalized_address",
      "endpoint.external_id",
      "endpoint.avatar_url",
    ])
    .where("participant.conversation_id", "in", [...conversationIds])
    .where("participant.is_self", "=", false)
    // Deterministic across calls, so a two-party thread cannot alternate
    // between names when both participants carry one.
    .orderBy("participant.contact_endpoint_id", "asc")
    .execute();
  for (const row of rows) {
    if (counterparts.has(row.conversation_id)) continue;
    counterparts.set(row.conversation_id, {
      displayName:
        row.display_name?.trim() ||
        row.address_display?.trim() ||
        row.normalized_address?.trim() ||
        row.external_id.trim() ||
        null,
      addressDisplay: row.address_display?.trim() || null,
      avatarUrl: row.avatar_url,
    });
  }
  return counterparts;
}

export interface ConversationCounterpart {
  displayName: string | null;
  /** Provider-native handle, e.g. a Telegram "@username". */
  addressDisplay: string | null;
  /** Storage reference, not a URL; the route signs it before returning. */
  avatarUrl: string | null;
}

/**
 * The other party's identity for a direct conversation, for the profile pane.
 *
 * What a provider discloses varies: Telegram gives a username only when the
 * person set one, and never a phone number - a bot cannot request one, so the
 * absence here is a provider limit rather than missing data to backfill.
 */
export async function resolveConversationCounterpart(
  db: ConversationDb,
  conversationId: string,
): Promise<ConversationCounterpart | null> {
  const row = await db
    .selectFrom("conversation_participants as participant")
    .innerJoin(
      "contact_endpoints as endpoint",
      "endpoint.id",
      "participant.contact_endpoint_id",
    )
    .select([
      "endpoint.display_name",
      "endpoint.address_display",
      "endpoint.avatar_url",
    ])
    .where("participant.conversation_id", "=", conversationId)
    .where("participant.is_self", "=", false)
    .orderBy("participant.contact_endpoint_id", "asc")
    .executeTakeFirst();
  if (!row) return null;
  return {
    displayName: row.display_name?.trim() || null,
    addressDisplay: row.address_display?.trim() || null,
    avatarUrl: row.avatar_url,
  };
}

/** Single-conversation convenience over the batch lookup. */
export async function resolveConversationDisplayName(
  db: ConversationDb,
  conversationId: string,
  subject: string | null,
): Promise<string | null> {
  const trimmed = subject?.trim();
  if (trimmed) return trimmed;
  const names = await resolveConversationDisplayNames(db, [conversationId]);
  return names.get(conversationId) ?? null;
}
