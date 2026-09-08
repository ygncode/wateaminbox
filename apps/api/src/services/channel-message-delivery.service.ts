import { db, getTenantSchemaName } from "@wateaminbox/database";
import { sql, type Transaction } from "kysely";
import { broadcastToUsers } from "../lib/realtime.js";
import { createLogger, formatError } from "../lib/logger.js";
import { getCompanyMemberPermissions } from "./company-membership.service.js";
import { resolveContactViewerIds } from "./message-broadcast.service.js";
import { getPushMessagePreview } from "./message-push-preview.js";
import { sendPushToUsers } from "./notification-delivery.service.js";
import { resolveIncomingMessageRecipients } from "./notification-recipient.service.js";
import type { TenantDatabase } from "./tenant.service.js";

interface ChannelDeliveryJob {
  company_id: string;
  channel_account_id: string;
  conversation_id: string;
  message_id: string;
  kind: "realtime" | "push";
}

const logger = createLogger("ChannelMessageDelivery");
const lanes = {
  realtime: {
    timer: null as ReturnType<typeof setTimeout> | null,
    running: false,
  },
  push: { timer: null as ReturnType<typeof setTimeout> | null, running: false },
};
let stopping = false;

export async function dispatchChannelMessageDelivery(
  kind?: ChannelDeliveryJob["kind"],
): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const job = (
      await sql<ChannelDeliveryJob>`SELECT company_id, channel_account_id,
          conversation_id, message_id, kind
        FROM public.channel_message_delivery_outbox
        WHERE next_attempt_at <= statement_timestamp()
          AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null})
        ORDER BY next_attempt_at, created_at
        FOR UPDATE SKIP LOCKED LIMIT 1`.execute(trx)
    ).rows[0];
    if (!job) return 0;
    const tenant = trx.withSchema(
      getTenantSchemaName(job.company_id),
    ) as unknown as Transaction<TenantDatabase>;
    try {
      await deliver(job, tenant);
      await sql`DELETE FROM public.channel_message_delivery_outbox
        WHERE company_id = ${job.company_id}::uuid
          AND message_id = ${job.message_id}::uuid
          AND kind = ${job.kind}`.execute(trx);
    } catch (error) {
      await sql`UPDATE public.channel_message_delivery_outbox
        SET attempts = LEAST(attempts + 1, 30),
          next_attempt_at = statement_timestamp() + interval '1 second' *
            LEAST(300, power(2, LEAST(attempts + 1, 8)))
        WHERE company_id = ${job.company_id}::uuid
          AND message_id = ${job.message_id}::uuid
          AND kind = ${job.kind}`.execute(trx);
      logger.warn(
        { err: formatError(error), messageId: job.message_id, kind: job.kind },
        "Channel message delivery will retry",
      );
    }
    return 1;
  });
}

async function deliver(
  job: ChannelDeliveryJob,
  tenant: Transaction<TenantDatabase>,
): Promise<void> {
  const row = await tenant
    .selectFrom("messages as message")
    .innerJoin(
      "conversations as conversation",
      "conversation.id",
      "message.conversation_id",
    )
    .innerJoin(
      "channel_accounts as account",
      "account.id",
      "message.channel_account_id",
    )
    .select([
      "message.id",
      "message.external_message_id",
      "message.direction",
      "message.normalized_type",
      "message.text_content",
      "message.status",
      "message.timestamp",
      "message.deleted_by_sender",
      "message.sender_name",
      "conversation.id as conversation_id",
      "conversation.subject",
      "conversation.legacy_contact_id",
      "account.id as account_id",
      "account.channel",
      "account.provider",
      "account.display_name as account_name",
    ])
    .where("message.id", "=", job.message_id)
    .where("conversation.id", "=", job.conversation_id)
    .where("account.id", "=", job.channel_account_id)
    .executeTakeFirst();
  if (!row || row.deleted_by_sender) return;

  const viewerIds = row.legacy_contact_id
    ? await resolveContactViewerIds(
        job.company_id,
        row.legacy_contact_id,
        tenant,
      )
    : (await getCompanyMemberPermissions(job.company_id))
        .filter(({ permissions }) => permissions.can_view_all_chats)
        .map(({ userId }) => userId);
  if (job.kind === "realtime") {
    await broadcastToUsers(
      job.company_id,
      viewerIds,
      "channel_message:new",
      {
        message: {
          id: row.id,
          conversationId: row.conversation_id,
          channelAccountId: row.account_id,
          externalMessageId: row.external_message_id,
          direction: row.direction,
          messageType: row.normalized_type,
          textContent: row.text_content,
          status: row.status,
          senderName: row.sender_name,
          createdAt: row.timestamp,
        },
        conversation: {
          id: row.conversation_id,
          subject: row.subject,
          channel: row.channel,
          provider: row.provider,
          accountName: row.account_name,
        },
      },
      { requireDelivery: true },
    );
    return;
  }
  if (row.direction !== "inbound") return;
  const allowed = new Set(
    await resolveIncomingMessageRecipients({
      companyId: job.company_id,
      contactId: row.legacy_contact_id,
      conversationId: row.conversation_id,
      contactJid: "",
      fromMe: false,
      isHistorySync: false,
    }),
  );
  const recipients = viewerIds.filter((id) => allowed.has(id));
  if (recipients.length === 0) return;
  const push = await sendPushToUsers(job.company_id, recipients, {
    version: 1,
    type: "message",
    title: row.subject ?? row.sender_name ?? row.account_name ?? "New message",
    body: getPushMessagePreview(
      row.normalized_type ?? "text",
      row.text_content,
    ),
    tag: `channel-message-${row.id}`,
    actionUrl: `/chat/${row.legacy_contact_id ?? row.conversation_id}`,
    icon: "/apple-touch-icon.png",
    badge: "/favicon-96x96.png",
  });
  if (push.failed > 0) throw new Error("Channel message push delivery failed");
}

async function poll(kind: ChannelDeliveryJob["kind"]): Promise<void> {
  const lane = lanes[kind];
  if (lane.running || stopping) return;
  lane.running = true;
  let processed = 0;
  try {
    processed = await dispatchChannelMessageDelivery(kind);
  } catch (error) {
    logger.warn(
      { err: formatError(error), kind },
      "Channel delivery polling failed",
    );
  } finally {
    lane.running = false;
    if (!stopping)
      lane.timer = setTimeout(() => poll(kind), processed ? 25 : 1_000);
  }
}

export function initializeChannelMessageDelivery(): void {
  stopping = false;
  for (const kind of ["realtime", "push"] as const) {
    if (!lanes[kind].timer && !lanes[kind].running) {
      lanes[kind].timer = setTimeout(() => poll(kind), 0);
    }
  }
}

export async function shutdownChannelMessageDelivery(): Promise<void> {
  stopping = true;
  for (const lane of Object.values(lanes)) {
    if (lane.timer) clearTimeout(lane.timer);
    lane.timer = null;
  }
  while (Object.values(lanes).some(({ running }) => running)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
