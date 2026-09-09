import type { TenantDatabase } from "@wateaminbox/database";
import { sql } from "kysely";
import type { Transaction } from "kysely";

/**
 * Queue realtime fanout for a message that this workspace just wrote.
 *
 * Enqueued in the same transaction as the message row, so a message can never
 * be committed without its fanout, and the delivery worker can never observe
 * a job whose message does not exist yet.
 *
 * Only `realtime` is queued: a push notification tells someone about a message
 * they have not seen, which is meaningless for a message they just sent
 * themselves. Inbound events queue both.
 */
export async function enqueueOutboundRealtimeFanout(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  channelAccountId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await sql`INSERT INTO public.channel_message_delivery_outbox
      (company_id, channel_account_id, conversation_id, message_id, kind, case_event)
    VALUES
      (${companyId}::uuid, ${channelAccountId}::uuid, ${conversationId}::uuid, ${messageId}::uuid, 'realtime', NULL)
    ON CONFLICT DO NOTHING`.execute(trx);
}

/**
 * Advance a conversation's list projection for a message this workspace sent.
 *
 * The inbox list reads `conversation_states`, not `messages`, so a send that
 * does not touch it leaves the row frozen at the last inbound message: the
 * chat keeps an older preview and sorts below conversations that have been
 * quiet for longer. Only the inbound event processor ever wrote this, so
 * every outgoing message was invisible to the list.
 *
 * `unread_count` is deliberately untouched. A message the workspace sent is
 * by definition already read by the person who sent it, and incrementing it
 * would badge the sender's own conversation.
 */
export async function recordOutboundConversationActivity(
  trx: Transaction<TenantDatabase>,
  input: {
    conversationId: string;
    contactId: string | null;
    textContent: string | null;
    occurredAt: Date;
  },
): Promise<void> {
  const preview = (input.textContent ?? "").slice(0, 100) || null;
  const updated = await trx
    .updateTable("conversation_states")
    .set({
      last_message_at: input.occurredAt,
      last_message_preview: preview,
      updated_at: new Date(),
    })
    .where("conversation_id", "=", input.conversationId)
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows ?? 0) === 0) {
    await trx
      .insertInto("conversation_states")
      .values({
        contact_id: input.contactId,
        conversation_id: input.conversationId,
        unread_count: 0,
        last_message_at: input.occurredAt,
        last_message_preview: preview,
        status: "open",
      })
      .execute();
  }
  // GREATEST/LEAST so an out-of-order or retried send cannot move the
  // conversation's own bounds backwards.
  await trx
    .updateTable("conversations")
    .set({
      first_message_at: sql`LEAST(COALESCE(first_message_at, ${input.occurredAt}), ${input.occurredAt})`,
      last_message_at: sql`GREATEST(COALESCE(last_message_at, ${input.occurredAt}), ${input.occurredAt})`,
      updated_at: new Date(),
    })
    .where("id", "=", input.conversationId)
    .execute();
}
