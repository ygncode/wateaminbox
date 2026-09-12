import type { TenantDatabase } from "@wateaminbox/database";
import type { Kysely, Transaction } from "kysely";
import { resolveWorkflowContactId } from "./channel-workflow.service.js";
import { resolveCanonicalContactId } from "./contact-merge.service.js";

type ChatsDb = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

/**
 * One reachable thread belonging to a customer.
 *
 * `chatId` is what the web router addresses, and it is deliberately the same
 * overloaded value the chat list emits: the legacy contact ID when the thread
 * still has one, the conversation ID otherwise. Emitting the conversation ID
 * for a bridged WhatsApp thread would route to a chat the list cannot select.
 */
export interface CustomerChat {
  chatId: string;
  conversationId: string | null;
  contactId: string | null;
  channel: string;
  provider: string;
  accountId: string | null;
  accountName: string | null;
  /** Display address of the endpoint this thread reaches, never a raw secret. */
  address: string | null;
  displayName: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
}

/**
 * Every contact row that now resolves to `canonicalId`.
 *
 * Merges chain, so this walks the alias graph downward - canonical first, then
 * the rows merged into it, then rows merged into those. The depth bound is the
 * same one `resolveCanonicalContactId` uses walking upward; a cycle or an
 * unexpectedly deep chain stops the walk rather than looping.
 *
 * Exported because the chat list needs the same grouping the chat switcher
 * shows. Two different answers to "who is this customer" would let a thread be
 * hidden from the list without appearing behind the switcher.
 */
export async function resolveMergedContactIds(
  db: ChatsDb,
  canonicalId: string,
  maxDepth = 8,
): Promise<string[]> {
  const collected = new Set<string>([canonicalId]);
  let frontier = [canonicalId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const rows = await db
      .selectFrom("contacts")
      .select("id")
      .where("merged_into_contact_id", "in", frontier)
      .execute();
    frontier = rows.map((row) => row.id).filter((id) => !collected.has(id));
    for (const id of frontier) collected.add(id);
  }
  return [...collected];
}

/**
 * The threads a customer can be reached on, newest activity first.
 *
 * Resolved through endpoints rather than by walking merge aliases: endpoints
 * are what a merge actually moves, every conversation carries exactly one
 * endpoint-linked participant, and that path also covers a neutral thread that
 * has no `legacy_contact_id` to walk back from.
 *
 * The merged contact rows are still unioned in, because a contact that predates
 * the spine - no endpoint, no conversation - has a chat in the inbox that the
 * endpoint path cannot see. Dropping it would hide a real thread.
 */
export async function listCustomerChats(
  db: ChatsDb,
  requestedContactId: string,
): Promise<CustomerChat[]> {
  // The chat list addresses a thread by whichever id it has - the legacy
  // contact for a bridged WhatsApp chat, the conversation for a neutral one -
  // so the switcher is asked with either. Mapping the conversation back to its
  // customer first is what the contact profile does; without it a Telegram
  // chat answered "no other chats" and the switcher hid itself on exactly the
  // merged customer it exists for.
  const workflowContactId =
    (await resolveWorkflowContactId(db, requestedContactId)) ??
    requestedContactId;
  const canonicalId =
    (await resolveCanonicalContactId(db, workflowContactId)) ??
    workflowContactId;
  const contactIds = await resolveMergedContactIds(db, canonicalId);

  const [viaEndpoint, viaContact] = await Promise.all([
    db
      .selectFrom("contact_endpoints as endpoint")
      .innerJoin(
        "conversation_participants as participant",
        "participant.contact_endpoint_id",
        "endpoint.id",
      )
      .innerJoin(
        "conversations as conversation",
        "conversation.id",
        "participant.conversation_id",
      )
      .leftJoin(
        "channel_accounts as account",
        "account.id",
        "conversation.channel_account_id",
      )
      .leftJoin("conversation_states as state", (join) =>
        join.onRef("state.conversation_id", "=", "conversation.id"),
      )
      .select([
        "conversation.id as conversation_id",
        "conversation.legacy_contact_id as legacy_contact_id",
        "conversation.last_message_at as last_message_at",
        "endpoint.channel as channel",
        "endpoint.provider as provider",
        "endpoint.address_display as address_display",
        "endpoint.normalized_address as normalized_address",
        "endpoint.display_name as display_name",
        "account.id as account_id",
        "account.display_name as account_name",
        "state.unread_count as unread_count",
      ])
      .where("endpoint.contact_id", "in", contactIds)
      .where("conversation.archived_at", "is", null)
      .where("participant.left_at", "is", null)
      .execute(),
    db
      .selectFrom("contacts as contact")
      .leftJoin("whatsapp_connections as connection", (join) =>
        join.onRef("connection.id", "=", "contact.whatsapp_connection_id"),
      )
      .leftJoin("conversation_states as state", (join) =>
        join.onRef("state.contact_id", "=", "contact.id"),
      )
      .select([
        "contact.id as contact_id",
        "contact.jid as jid",
        "contact.phone_number as phone_number",
        "contact.push_name as push_name",
        "contact.custom_name as custom_name",
        "connection.id as connection_id",
        "connection.name as connection_name",
        "state.unread_count as unread_count",
        "state.last_message_at as last_message_at",
      ])
      .where("contact.id", "in", contactIds)
      .execute(),
  ]);

  const chats = new Map<string, CustomerChat>();
  for (const row of viaEndpoint) {
    const chatId = row.legacy_contact_id ?? row.conversation_id;
    chats.set(chatId, {
      chatId,
      conversationId: row.conversation_id,
      contactId: row.legacy_contact_id,
      channel: row.channel,
      provider: row.provider,
      accountId: row.account_id,
      accountName: row.account_name,
      address: row.address_display ?? row.normalized_address,
      displayName: row.display_name,
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.unread_count ?? 0),
    });
  }
  for (const row of viaContact) {
    // A contact whose thread the endpoint pass already described is the same
    // chat, not a second one; the endpoint row carries the better identity.
    if (chats.has(row.contact_id)) continue;
    chats.set(row.contact_id, {
      chatId: row.contact_id,
      conversationId: null,
      contactId: row.contact_id,
      channel: "whatsapp",
      provider: "whatsapp_linked_device",
      accountId: row.connection_id,
      accountName: row.connection_name,
      address: row.phone_number ?? row.jid,
      displayName: row.custom_name ?? row.push_name,
      lastMessageAt: row.last_message_at,
      unreadCount: Number(row.unread_count ?? 0),
    });
  }

  return [...chats.values()].sort((a, b) => {
    const left = a.lastMessageAt?.getTime() ?? 0;
    const right = b.lastMessageAt?.getTime() ?? 0;
    if (left !== right) return right - left;
    return a.chatId.localeCompare(b.chatId);
  });
}
