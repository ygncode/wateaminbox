import type { TenantDatabase } from "@wateaminbox/database";
import type { NormalizedChannelEvent } from "@wateaminbox/shared";
import type { Kysely } from "kysely";

export type LinkedDeviceShadowMismatch =
  | "message_missing"
  | "channel_account"
  | "conversation"
  | "external_message_id"
  | "external_identity_scope"
  | "direction"
  | "normalized_type"
  | "text_content"
  | "attachment_count"
  | "attachment_content_type"
  | "attachment_byte_size"
  | "attachment_storage";

/** Read-only parity check. It never ACKs, mutates domain state, or fans out. */
export async function compareLinkedDeviceMessageShadow(
  tenantDb: Kysely<TenantDatabase>,
  event: Extract<NormalizedChannelEvent, { kind: "message.upsert" }>,
): Promise<LinkedDeviceShadowMismatch[]> {
  const message = await tenantDb
    .selectFrom("messages")
    .select([
      "id",
      "channel_account_id",
      "conversation_id",
      "external_message_id",
      "external_identity_scope",
      "direction",
      "normalized_type",
      "text_content",
    ])
    .where("whatsapp_connection_id", "=", event.channelAccountId)
    .where("message_id", "=", event.payload.externalMessageId)
    .executeTakeFirst();
  if (!message) return ["message_missing"];

  const conversation = message.conversation_id
    ? await tenantDb
        .selectFrom("conversations")
        .select("external_thread_id")
        .where("id", "=", message.conversation_id)
        .executeTakeFirst()
    : undefined;
  const mismatches: LinkedDeviceShadowMismatch[] = [];
  if (message.channel_account_id !== event.channelAccountId) {
    mismatches.push("channel_account");
  }
  if (
    !conversation ||
    conversation.external_thread_id !==
      event.payload.conversation.externalThreadId
  ) {
    mismatches.push("conversation");
  }
  if (message.external_message_id !== event.payload.externalMessageId) {
    mismatches.push("external_message_id");
  }
  if (message.external_identity_scope !== event.payload.externalIdentityScope) {
    mismatches.push("external_identity_scope");
  }
  if (message.direction !== event.payload.direction)
    mismatches.push("direction");
  if (message.normalized_type !== event.payload.normalizedType) {
    mismatches.push("normalized_type");
  }
  if ((message.text_content ?? undefined) !== event.payload.textContent) {
    mismatches.push("text_content");
  }

  const attachments = await tenantDb
    .selectFrom("message_attachments")
    .select(["ordinal", "content_type", "byte_size", "storage_uri"])
    .where("message_id", "=", message.id)
    .orderBy("ordinal")
    .execute();
  const expectedAttachments = event.payload.attachments ?? [];
  if (attachments.length !== expectedAttachments.length) {
    mismatches.push("attachment_count");
  } else {
    for (let index = 0; index < attachments.length; index += 1) {
      const actual = attachments[index]!;
      const expected = expectedAttachments[index]!;
      if ((actual.content_type ?? undefined) !== expected.contentType) {
        mismatches.push("attachment_content_type");
      }
      if (
        (actual.byte_size === null ? undefined : Number(actual.byte_size)) !==
        expected.byteSize
      ) {
        mismatches.push("attachment_byte_size");
      }
      if ((actual.storage_uri ?? undefined) !== expected.storageUri) {
        mismatches.push("attachment_storage");
      }
    }
  }
  return [...new Set(mismatches)];
}
