import type {
  ChannelActionIntent,
  OutboundMessageIntent,
  ProviderActionResult,
  ProviderSendResult,
} from "@wateaminbox/shared";
import { buildOutboundMediaColumns } from "../../../lib/message-formatters.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
} from "../../../lib/nats/index.js";
import { enqueueCommand } from "../../../services/command-outbox.service.js";
import { getTenantConnection } from "../../../services/tenant.service.js";
import { getActiveSessionId } from "../../../services/whatsapp/session.js";
import type { LinkedDeviceAdapterPort } from "./adapter.js";

export class LinkedDeviceNatsTransport implements LinkedDeviceAdapterPort {
  async send(intent: OutboundMessageIntent): Promise<ProviderSendResult> {
    try {
      const tenantDb = await getTenantConnection(intent.companyId);
      const target = await tenantDb
        .selectFrom("conversations as conversation")
        .innerJoin(
          "contacts as contact",
          "contact.id",
          "conversation.legacy_contact_id",
        )
        .innerJoin(
          "whatsapp_connections as connection",
          "connection.id",
          "contact.whatsapp_connection_id",
        )
        .select([
          "contact.id as contact_id",
          "contact.jid as contact_jid",
          "connection.id as connection_id",
          "connection.jid as connection_jid",
          "connection.status as connection_status",
        ])
        .where("conversation.id", "=", intent.conversationId)
        .where("conversation.channel_account_id", "=", intent.channelAccountId)
        .executeTakeFirst();
      if (
        !target?.contact_jid ||
        target.connection_status !== "connected" ||
        !intent.messageId
      ) {
        return {
          outcome: "transient_failure",
          errorCode: "linked_device_connection_unavailable",
          retryAfterMs: 5_000,
        };
      }
      const sessionId = await getActiveSessionId(
        tenantDb,
        target.connection_id,
      );
      const payload = intent.normalizedPayload;
      const messageType = stringValue(payload.messageType) ?? "text";
      const content = stringValue(payload.textContent) ?? "";
      const mediaUrl = firstStorageUri(payload.attachments);
      const pendingProviderId = `pending_${intent.messageId}`;
      const sentByUserId = stringValue(payload.sentByUserId);
      if (!sentByUserId) {
        return {
          outcome: "permanent_failure",
          errorCode: "linked_device_sender_missing",
        };
      }
      const command = await buildSendMessageCommand(
        intent.companyId,
        sessionId,
        target.contact_jid,
        content,
        legacyMessageType(messageType),
        sentByUserId,
        pendingProviderId,
        mediaUrl,
        stringValue(payload.replyToExternalMessageId),
        undefined,
        stringArray(payload.mentionedJids),
      );
      await tenantDb.transaction().execute(async (trx) => {
        const message = await trx
          .selectFrom("messages")
          .select("id")
          .where("id", "=", intent.messageId!)
          .where("channel_account_id", "=", intent.channelAccountId)
          .forUpdate()
          .executeTakeFirst();
        if (!message) throw new Error("linked_device_message_missing");
        await trx
          .updateTable("messages")
          .set({
            contact_id: target.contact_id,
            whatsapp_connection_id: target.connection_id,
            message_id: pendingProviderId,
            sender_jid: target.connection_jid,
            media_url: mediaUrl ?? null,
            ...buildOutboundMediaColumns(command),
          })
          .where("id", "=", message.id)
          .execute();
        await enqueueCommand(
          trx,
          buildCommandSubject(intent.companyId, sessionId),
          command,
        );
      });
      return { outcome: "accepted", providerRequestId: intent.id };
    } catch {
      return {
        outcome: "uncertain",
        errorCode: "linked_device_handoff_outcome_unknown",
      };
    }
  }

  async perform(_action: ChannelActionIntent): Promise<ProviderActionResult> {
    return { outcome: "unsupported", errorCode: "neutral_action_not_wired" };
  }
}

function firstStorageUri(value: unknown): string | undefined {
  if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object") {
    return undefined;
  }
  return stringValue((value[0] as Record<string, unknown>).storageUri);
}

/** Group mentions only reach the worker when every entry is a usable JID. */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return entries.length > 0 ? entries : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type LegacyMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "reaction"
  | "template";

function legacyMessageType(value: string): LegacyMessageType {
  return [
    "text",
    "image",
    "video",
    "audio",
    "document",
    "sticker",
    "location",
    "contact",
    "reaction",
    "template",
  ].includes(value)
    ? (value as LegacyMessageType)
    : "text";
}
