import {
  normalizeJid,
  toDbDate,
  type RemoteHistoryStatus,
} from "@wateaminbox/shared";
import type { HistorySyncPageEvent } from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import { getTenantConnection } from "../tenant.service.js";
import { handlerLogger as logger } from "./types.js";

const supportedStatuses = new Set<RemoteHistoryStatus>([
  "unknown",
  "available",
  "exhausted",
  "unavailable",
]);

export async function handleHistorySyncPageEvent(
  event: HistorySyncPageEvent,
): Promise<void> {
  const tenantDb = getTenantConnection(event.companyId);
  const chatJid = normalizeJid(event.payload.chatJid);
  const status = supportedStatuses.has(event.payload.status)
    ? event.payload.status
    : "unknown";
  const contact = await tenantDb
    .selectFrom("contacts")
    .select("id")
    .where("whatsapp_connection_id", "=", event.connectionId)
    .where("jid", "=", chatJid)
    .executeTakeFirst();

  if (!contact) {
    logger.warn(
      {
        companyId: event.companyId,
        connectionId: event.connectionId,
        chatJid,
      },
      "Ignoring history page for an unknown conversation",
    );
    return;
  }

  const now = toDbDate();
  await tenantDb
    .updateTable("contacts")
    .set({
      remote_history_status: status,
      remote_history_updated_at: now,
      updated_at: now,
    })
    .where("id", "=", contact.id)
    .execute();

  await broadcastToCompany(
    event.companyId,
    "history:loaded",
    {
      conversationId: contact.id,
      messageCount: Math.max(0, event.payload.messageCount),
      status,
    },
    event.connectionId,
  );
}
