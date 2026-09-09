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
  const names = new Map<string, string>();
  if (conversationIds.length === 0) return names;
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
    ])
    .where("participant.conversation_id", "in", [...conversationIds])
    .where("participant.is_self", "=", false)
    // Deterministic across calls, so a two-party thread cannot alternate
    // between names when both participants carry one.
    .orderBy("participant.contact_endpoint_id", "asc")
    .execute();
  for (const row of rows) {
    if (names.has(row.conversation_id)) continue;
    const candidate =
      row.display_name?.trim() ||
      row.address_display?.trim() ||
      row.normalized_address?.trim() ||
      row.external_id.trim();
    if (candidate) names.set(row.conversation_id, candidate);
  }
  return names;
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
