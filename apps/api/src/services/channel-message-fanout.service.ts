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
