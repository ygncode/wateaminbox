import type { TenantDatabase } from "@wateaminbox/database";
import {
  assertNormalizedChannelEvent,
  isDurableChannelEvent,
  type ExternalConversationReference,
  type ExternalEndpointReference,
  type MessageUpsertEventPayload,
  type NormalizedChannelEvent,
} from "@wateaminbox/shared";
import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import { createHash } from "node:crypto";
import {
  openOrReopenCaseForInboundMessage,
  resolveActiveCaseIdForContact,
} from "../../services/conversation-case.service.js";
import { enqueueMessageSearch } from "../../services/message-search-outbox.service.js";

export interface AppliedChannelEvent {
  outcome: "applied" | "duplicate" | "transient";
  conversationId?: string;
  messageId?: string;
}

export class ChannelEventIdentityCollisionError extends Error {}
export class ChannelEventAccountMismatchError extends Error {}

/**
 * Durable, idempotent application of one minimized normalized event. Reserving
 * the inbox identity is intentionally a separate commit: a crash leaves due
 * work behind instead of losing the event with the domain transaction.
 */
export async function applyNormalizedChannelEvent(
  tenantDb: Kysely<TenantDatabase>,
  event: NormalizedChannelEvent,
): Promise<AppliedChannelEvent> {
  assertNormalizedChannelEvent(event);
  if (!isDurableChannelEvent(event)) return { outcome: "transient" };

  const digest = channelEventPayloadDigest(event);
  const reserved = await reserveInboxEvent(tenantDb, event, digest);
  if (reserved === "duplicate") return { outcome: "duplicate" };

  try {
    return await tenantDb.transaction().execute(async (trx) => {
      const inbox = await trx
        .selectFrom("channel_event_inbox")
        .select(["status", "payload_digest"])
        .where("channel_account_id", "=", event.channelAccountId)
        .where("external_event_scope", "=", event.provider)
        .where("external_event_id", "=", event.eventId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (inbox.payload_digest !== digest) {
        throw new ChannelEventIdentityCollisionError(
          "event identity was reused with another payload",
        );
      }
      if (inbox.status === "applied") return { outcome: "duplicate" };
      if (inbox.status === "quarantined") {
        throw new ChannelEventIdentityCollisionError("event is quarantined");
      }

      await requireMatchingAccount(trx, event);
      const applied = await applyDurableEvent(trx, event);
      await trx
        .updateTable("channel_event_inbox")
        .set({
          status: "applied",
          applied_at: new Date(),
          last_error_code: null,
          attempts: sql`attempts + 1`,
        })
        .where("channel_account_id", "=", event.channelAccountId)
        .where("external_event_scope", "=", event.provider)
        .where("external_event_id", "=", event.eventId)
        .execute();
      return { outcome: "applied", ...applied };
    });
  } catch (error) {
    await recordApplicationFailure(tenantDb, event, error);
    throw error;
  }
}

async function reserveInboxEvent(
  db: Kysely<TenantDatabase>,
  event: NormalizedChannelEvent,
  digest: string,
): Promise<"reserved" | "duplicate"> {
  const inserted = await db
    .insertInto("channel_event_inbox")
    .values({
      channel_account_id: event.channelAccountId,
      external_event_scope: event.provider,
      external_event_id: event.eventId,
      kind: event.kind,
      payload_digest: digest,
      normalized_event: event as unknown as Record<string, unknown>,
      last_error_code: null,
      applied_at: null,
    })
    .onConflict((oc) => oc.doNothing())
    .returning("external_event_id")
    .executeTakeFirst();
  if (inserted) return "reserved";

  const existing = await db
    .selectFrom("channel_event_inbox")
    .select(["status", "payload_digest"])
    .where("channel_account_id", "=", event.channelAccountId)
    .where("external_event_scope", "=", event.provider)
    .where("external_event_id", "=", event.eventId)
    .executeTakeFirstOrThrow();
  if (existing.payload_digest !== digest) {
    await db
      .updateTable("channel_event_inbox")
      .set({
        status: "quarantined",
        last_error_code: "event_identity_collision",
      })
      .where("channel_account_id", "=", event.channelAccountId)
      .where("external_event_scope", "=", event.provider)
      .where("external_event_id", "=", event.eventId)
      .execute();
    throw new ChannelEventIdentityCollisionError(
      "event identity was reused with another payload",
    );
  }
  return existing.status === "applied" ? "duplicate" : "reserved";
}

async function requireMatchingAccount(
  trx: Transaction<TenantDatabase>,
  event: NormalizedChannelEvent,
): Promise<void> {
  const account = await trx
    .selectFrom("channel_accounts")
    .select(["channel", "provider", "archived_at"])
    .where("id", "=", event.channelAccountId)
    .executeTakeFirst();
  if (
    !account ||
    account.archived_at ||
    account.channel !== event.channel ||
    account.provider !== event.provider
  ) {
    throw new ChannelEventAccountMismatchError(
      "event does not match an active channel account",
    );
  }
}

async function applyDurableEvent(
  trx: Transaction<TenantDatabase>,
  event: NormalizedChannelEvent,
): Promise<{ conversationId?: string; messageId?: string }> {
  switch (event.kind) {
    case "account.status":
      await trx
        .updateTable("channel_accounts")
        .set({
          status: event.payload.status,
          provider_status: event.payload.providerStatus ?? null,
          last_sync_at: new Date(),
          updated_at: new Date(),
        })
        .where("id", "=", event.channelAccountId)
        .execute();
      return {};
    case "endpoint.upsert":
      await ensureEndpoint(trx, event, event.payload.endpoint);
      return {};
    case "conversation.upsert": {
      const conversationId = await ensureConversation(
        trx,
        event,
        event.payload.conversation,
        event.payload.providerStatus,
        event.payload.providerMetadata,
      );
      return { conversationId };
    }
    case "participant.upsert":
    case "participant.remove":
      return applyParticipantMutation(trx, event);
    case "message.upsert":
      return applyMessageUpsert(trx, event);
    case "message.edit":
    case "message.delete":
      return applyMessageMutation(trx, event);
    case "reaction.upsert":
    case "reaction.delete":
      return applyReactionMutation(trx, event);
    case "delivery.update":
      return applyDeliveryUpdate(trx, event);
    case "attachment.available":
    case "attachment.failed":
      return applyAttachmentEvent(trx, event);
    case "sync.checkpoint":
      return applySyncCheckpoint(trx, event);
    default:
      throw new Error(`unsupported_durable_event:${event.kind}`);
  }
}

async function applyParticipantMutation(
  trx: Transaction<TenantDatabase>,
  event: Extract<
    NormalizedChannelEvent,
    { kind: "participant.upsert" | "participant.remove" }
  >,
): Promise<{ conversationId: string }> {
  const conversationId = await ensureConversation(
    trx,
    event,
    event.payload.conversation,
  );
  const endpointId = event.payload.endpoint
    ? await ensureEndpoint(trx, event, event.payload.endpoint)
    : null;
  if (!endpointId && !event.payload.workspaceUserId) {
    throw new Error("participant_identity_missing");
  }
  if (event.kind === "participant.remove") {
    await trx
      .updateTable("conversation_participants")
      .set({
        left_at: new Date(
          event.payload.leftAt ?? event.providerOccurredAt ?? event.receivedAt,
        ),
        updated_at: new Date(),
      })
      .where("conversation_id", "=", conversationId)
      .$if(Boolean(endpointId), (qb) =>
        qb.where("contact_endpoint_id", "=", endpointId!),
      )
      .$if(Boolean(event.payload.workspaceUserId), (qb) =>
        qb.where("workspace_user_id", "=", event.payload.workspaceUserId!),
      )
      .execute();
    return { conversationId };
  }
  const existing = await trx
    .selectFrom("conversation_participants")
    .select("id")
    .where("conversation_id", "=", conversationId)
    .$if(Boolean(endpointId), (qb) =>
      qb.where("contact_endpoint_id", "=", endpointId!),
    )
    .$if(Boolean(event.payload.workspaceUserId), (qb) =>
      qb.where("workspace_user_id", "=", event.payload.workspaceUserId!),
    )
    .where("participant_kind", "=", event.payload.participantKind)
    .executeTakeFirst();
  if (existing) {
    await trx
      .updateTable("conversation_participants")
      .set({
        role: event.payload.role,
        is_self: event.payload.isSelf,
        left_at: null,
        provider_metadata: event.payload.providerMetadata ?? {},
        updated_at: new Date(),
      })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await trx
      .insertInto("conversation_participants")
      .values({
        conversation_id: conversationId,
        contact_endpoint_id: endpointId,
        workspace_user_id: event.payload.workspaceUserId ?? null,
        participant_kind: event.payload.participantKind,
        role: event.payload.role,
        is_self: event.payload.isSelf,
        joined_at: event.payload.joinedAt
          ? new Date(event.payload.joinedAt)
          : null,
        left_at: null,
        provider_metadata: event.payload.providerMetadata ?? {},
      })
      .execute();
  }
  return { conversationId };
}

async function applyMessageUpsert(
  trx: Transaction<TenantDatabase>,
  event: Extract<NormalizedChannelEvent, { kind: "message.upsert" }>,
): Promise<{ conversationId: string; messageId: string }> {
  const payload = event.payload;
  const conversationId = await ensureConversation(
    trx,
    event,
    payload.conversation,
  );
  const senderEndpointId = payload.sender
    ? await ensureEndpoint(trx, event, payload.sender)
    : null;
  const contactId = await attachWorkflowContact(
    trx,
    conversationId,
    payload.conversation,
    senderEndpointId,
  );
  const occurredAt = new Date(event.providerOccurredAt ?? event.receivedAt);
  const existing = await trx
    .selectFrom("messages")
    .select(["id", "provider_occurred_at"])
    .where("channel_account_id", "=", event.channelAccountId)
    .where("external_identity_scope", "=", payload.externalIdentityScope)
    .where("external_message_id", "=", payload.externalMessageId)
    .executeTakeFirst();

  if (
    existing?.provider_occurred_at &&
    occurredAt.getTime() < existing.provider_occurred_at.getTime()
  ) {
    return { conversationId, messageId: existing.id };
  }

  const values = {
    whatsapp_connection_id: null,
    contact_id: contactId,
    message_id: payload.externalMessageId,
    from_me: payload.direction === "outbound",
    sender_jid: payload.sender?.externalId ?? null,
    sender_name: payload.sender?.displayName ?? null,
    sender_avatar_url: null,
    message_type: legacyMessageType(payload.normalizedType),
    content: payload.textContent ?? payload.sanitizedHtmlContent ?? "",
    media_url: payload.attachments?.[0]?.storageUri ?? null,
    media_mime_type: payload.attachments?.[0]?.contentType ?? null,
    media_size: payload.attachments?.[0]?.byteSize ?? null,
    media_direct_path: null,
    media_key: null,
    media_file_sha256: null,
    media_file_enc_sha256: null,
    media_download_status: null,
    media_download_error: null,
    media_downloaded_at: null,
    quoted_message_id: payload.replyToExternalMessageId ?? null,
    sent_by_user_id: payload.sentByUserId ?? null,
    status:
      payload.direction === "outbound"
        ? ("sent" as const)
        : ("delivered" as const),
    metadata: {},
    timestamp: occurredAt,
    case_id: null,
    channel_account_id: event.channelAccountId,
    conversation_id: conversationId,
    external_message_id: payload.externalMessageId,
    external_identity_scope: payload.externalIdentityScope,
    client_idempotency_key: null,
    direction: payload.direction,
    sender_participant_id: null,
    reply_to_message_id: null,
    provider_occurred_at: occurredAt,
    normalized_type: payload.normalizedType,
    subject: payload.subject ?? null,
    text_content: payload.textContent ?? null,
    sanitized_html_content: payload.sanitizedHtmlContent ?? null,
    provider_metadata: payload.providerMetadata ?? {},
  };
  const messageId = existing
    ? existing.id
    : (
        await trx
          .insertInto("messages")
          .values(values)
          .returning("id")
          .executeTakeFirstOrThrow()
      ).id;
  if (existing) {
    await trx
      .updateTable("messages")
      .set({
        conversation_id: conversationId,
        sender_jid: payload.sender?.externalId ?? null,
        sender_name: payload.sender?.displayName ?? null,
        message_type: legacyMessageType(payload.normalizedType),
        content: payload.textContent ?? payload.sanitizedHtmlContent ?? "",
        quoted_message_id: payload.replyToExternalMessageId ?? null,
        sent_by_user_id: payload.sentByUserId ?? null,
        timestamp: occurredAt,
        direction: payload.direction,
        provider_occurred_at: occurredAt,
        normalized_type: payload.normalizedType,
        subject: payload.subject ?? null,
        text_content: payload.textContent ?? null,
        sanitized_html_content: payload.sanitizedHtmlContent ?? null,
        provider_metadata: payload.providerMetadata ?? {},
      })
      .where("id", "=", messageId)
      .execute();
  }

  if (senderEndpointId && payload.sender) {
    const participantId = await ensureParticipant(
      trx,
      conversationId,
      senderEndpointId,
      payload.sender,
    );
    await trx
      .updateTable("messages")
      .set({ sender_participant_id: participantId })
      .where("id", "=", messageId)
      .execute();
    await trx
      .insertInto("message_participants")
      .values({
        message_id: messageId,
        ordinal: 0,
        role: "from",
        contact_endpoint_id: senderEndpointId,
        address_snapshot:
          payload.sender.addressDisplay ?? payload.sender.externalId,
        display_name_snapshot: payload.sender.displayName ?? null,
      })
      .onConflict((oc) =>
        oc.columns(["message_id", "role", "ordinal"]).doNothing(),
      )
      .execute();
  }
  if (!existing && payload.direction === "inbound" && contactId) {
    const conversation = await trx
      .selectFrom("conversations")
      .select("kind")
      .where("id", "=", conversationId)
      .executeTakeFirstOrThrow();
    const caseResult = await openOrReopenCaseForInboundMessage(
      trx,
      event.companyId,
      { id: contactId, isGroup: conversation.kind !== "direct" },
      { id: messageId, timestamp: occurredAt },
    );
    const caseId =
      caseResult?.case.id ??
      (await resolveActiveCaseIdForContact(trx, contactId));
    if (caseId) {
      await trx
        .updateTable("messages")
        .set({ case_id: caseId })
        .where("id", "=", messageId)
        .execute();
    }
    const preview = (payload.textContent ?? "").slice(0, 100) || null;
    const unreadUpdate = await trx
      .updateTable("conversation_states")
      .set((eb) => ({
        unread_count: eb("unread_count", "+", 1),
        last_message_at: occurredAt,
        last_message_preview: preview,
        updated_at: new Date(),
      }))
      .where("contact_id", "=", contactId)
      .executeTakeFirst();
    if (Number(unreadUpdate.numUpdatedRows ?? 0) === 0) {
      await trx
        .insertInto("conversation_states")
        .values({
          contact_id: contactId,
          conversation_id: conversationId,
          unread_count: 1,
          last_message_at: occurredAt,
          last_message_preview: preview,
          status: "open",
        })
        .execute();
    }
  }
  await enqueueMessageSearch(
    trx,
    event.companyId,
    event.channelAccountId,
    messageId,
  );
  await replaceAttachments(trx, messageId, payload);
  await trx
    .updateTable("conversations")
    .set({
      first_message_at: sql`LEAST(COALESCE(first_message_at, ${occurredAt}), ${occurredAt})`,
      last_message_at: sql`GREATEST(COALESCE(last_message_at, ${occurredAt}), ${occurredAt})`,
      updated_at: new Date(),
    })
    .where("id", "=", conversationId)
    .execute();
  await enqueueFanout(
    trx,
    event.companyId,
    event.channelAccountId,
    conversationId,
    messageId,
  );
  return { conversationId, messageId };
}

async function applyMessageMutation(
  trx: Transaction<TenantDatabase>,
  event: Extract<
    NormalizedChannelEvent,
    { kind: "message.edit" | "message.delete" }
  >,
): Promise<{ messageId: string }> {
  const message = await findMessage(
    trx,
    event.channelAccountId,
    event.payload.externalIdentityScope,
    event.payload.externalMessageId,
  );
  if (!message) throw new Error("message_dependency_missing");
  const occurredAt = new Date(event.providerOccurredAt ?? event.receivedAt);
  if (
    message.provider_occurred_at &&
    occurredAt.getTime() < message.provider_occurred_at.getTime()
  ) {
    return { messageId: message.id };
  }
  await trx
    .updateTable("messages")
    .set(
      event.kind === "message.delete"
        ? {
            deleted_by_sender: true,
            deleted_at: occurredAt,
            provider_occurred_at: occurredAt,
          }
        : {
            content:
              event.payload.textContent ??
              event.payload.sanitizedHtmlContent ??
              "",
            text_content: event.payload.textContent ?? null,
            sanitized_html_content: event.payload.sanitizedHtmlContent ?? null,
            provider_metadata: event.payload.providerMetadata ?? {},
            provider_occurred_at: occurredAt,
          },
    )
    .where("id", "=", message.id)
    .execute();
  return { messageId: message.id };
}

async function applyReactionMutation(
  trx: Transaction<TenantDatabase>,
  event: Extract<
    NormalizedChannelEvent,
    { kind: "reaction.upsert" | "reaction.delete" }
  >,
): Promise<{ messageId: string }> {
  const payload = event.payload;
  const message = await findMessage(
    trx,
    event.channelAccountId,
    payload.messageIdentityScope,
    payload.messageExternalId,
  );
  if (!message) throw new Error("message_dependency_missing");
  const reactorEndpointId = await ensureEndpoint(trx, event, payload.reactor);
  const eventScope = payload.externalEventScope ?? event.provider;
  const reactionId = payload.externalReactionId ?? event.eventId;
  if (event.kind === "reaction.delete") {
    await trx
      .deleteFrom("message_reactions")
      .where("message_id", "=", message.id)
      .where("channel_account_id", "=", event.channelAccountId)
      .where("external_event_scope", "=", eventScope)
      .where("external_reaction_id", "=", reactionId)
      .execute();
    return { messageId: message.id };
  }
  const existing = await trx
    .selectFrom("message_reactions")
    .select("id")
    .where("channel_account_id", "=", event.channelAccountId)
    .where("external_event_scope", "=", eventScope)
    .where("external_reaction_id", "=", reactionId)
    .executeTakeFirst();
  if (existing) {
    await trx
      .updateTable("message_reactions")
      .set({
        emoji: payload.emoji,
        provider_occurred_at: event.providerOccurredAt
          ? new Date(event.providerOccurredAt)
          : null,
      })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await trx
      .insertInto("message_reactions")
      .values({
        message_id: message.id,
        reactor_jid: payload.reactor.externalId,
        emoji: payload.emoji,
        reactor_endpoint_id: reactorEndpointId,
        channel_account_id: event.channelAccountId,
        external_reaction_id: reactionId,
        external_event_scope: eventScope,
        provider_occurred_at: event.providerOccurredAt
          ? new Date(event.providerOccurredAt)
          : null,
        provider_metadata: {},
      })
      .execute();
  }
  return { messageId: message.id };
}

async function applyAttachmentEvent(
  trx: Transaction<TenantDatabase>,
  event: Extract<
    NormalizedChannelEvent,
    { kind: "attachment.available" | "attachment.failed" }
  >,
): Promise<{ messageId: string }> {
  const message = await findMessage(
    trx,
    event.channelAccountId,
    event.payload.messageIdentityScope,
    event.payload.messageExternalId,
  );
  if (!message) throw new Error("message_dependency_missing");
  const attachment = event.payload.attachment;
  await trx
    .insertInto("message_attachments")
    .values({
      message_id: message.id,
      ordinal: attachment.ordinal,
      kind: attachment.kind,
      provider_attachment_id: attachment.providerAttachmentId ?? null,
      file_name: attachment.fileName ?? null,
      content_type: attachment.contentType ?? null,
      byte_size: attachment.byteSize?.toString() ?? null,
      storage_uri: attachment.storageUri ?? null,
      provider_locator: null,
      content_id: null,
      content_disposition: null,
      status: event.kind === "attachment.failed" ? "failed" : "available",
      error_code: attachment.errorCode ?? null,
      provider_metadata: attachment.providerMetadata ?? {},
    })
    .onConflict((oc) =>
      oc.columns(["message_id", "ordinal"]).doUpdateSet({
        storage_uri: attachment.storageUri
          ? attachment.storageUri
          : sql`message_attachments.storage_uri`,
        status: event.kind === "attachment.failed" ? "failed" : "available",
        error_code: attachment.errorCode ?? null,
        updated_at: new Date(),
      }),
    )
    .execute();
  return { messageId: message.id };
}

async function applyDeliveryUpdate(
  trx: Transaction<TenantDatabase>,
  event: Extract<NormalizedChannelEvent, { kind: "delivery.update" }>,
): Promise<{ messageId: string }> {
  const payload = event.payload;
  const message = await findMessage(
    trx,
    event.channelAccountId,
    payload.messageIdentityScope,
    payload.messageExternalId,
  );
  if (!message) throw new Error("message_dependency_missing");
  const recipientEndpointId = payload.recipient
    ? await ensureEndpoint(trx, event, payload.recipient)
    : null;
  await trx
    .insertInto("message_delivery_events")
    .values({
      channel_account_id: event.channelAccountId,
      message_id: message.id,
      recipient_endpoint_id: recipientEndpointId,
      external_event_scope: payload.externalEventScope ?? event.provider,
      external_event_id: payload.externalEventId ?? event.eventId,
      status: payload.status,
      provider_occurred_at: event.providerOccurredAt
        ? new Date(event.providerOccurredAt)
        : null,
      error_code: payload.errorCode ?? null,
      error_detail: payload.errorDetail ?? null,
      provider_metadata: payload.providerMetadata ?? {},
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  if (
    ["pending", "sent", "delivered", "read", "failed"].includes(payload.status)
  ) {
    await trx
      .updateTable("messages")
      .set({
        status: sql`CASE
          WHEN ${payload.status} = 'read' THEN 'read'
          WHEN ${payload.status} = 'delivered' AND status IN ('pending', 'sent') THEN 'delivered'
          WHEN ${payload.status} = 'sent' AND status = 'pending' THEN 'sent'
          WHEN ${payload.status} = 'failed' AND status = 'pending' THEN 'failed'
          ELSE status
        END`,
      })
      .where("id", "=", message.id)
      .execute();
  }
  return { messageId: message.id };
}

async function applySyncCheckpoint(
  trx: Transaction<TenantDatabase>,
  event: Extract<NormalizedChannelEvent, { kind: "sync.checkpoint" }>,
): Promise<{ conversationId?: string }> {
  if (!event.payload.conversation) return {};
  const conversationId = await ensureConversation(
    trx,
    event,
    event.payload.conversation,
  );
  await trx
    .insertInto("conversation_sync_states")
    .values({
      conversation_id: conversationId,
      provider: event.provider,
      status: event.payload.status,
      cursor_or_anchor: event.payload.cursorOrAnchor ?? null,
      request_generation: String(event.payload.requestGeneration ?? 0),
      last_requested_at: null,
      last_completed_at: new Date(event.providerOccurredAt ?? event.receivedAt),
      error_code: event.payload.errorCode ?? null,
    })
    .onConflict((oc) =>
      oc.columns(["conversation_id", "provider"]).doUpdateSet({
        status: event.payload.status,
        cursor_or_anchor: event.payload.cursorOrAnchor ?? null,
        request_generation: String(event.payload.requestGeneration ?? 0),
        last_completed_at: new Date(
          event.providerOccurredAt ?? event.receivedAt,
        ),
        error_code: event.payload.errorCode ?? null,
        updated_at: new Date(),
      }),
    )
    .execute();
  return { conversationId };
}

async function attachWorkflowContact(
  trx: Transaction<TenantDatabase>,
  conversationId: string,
  reference: ExternalConversationReference,
  senderEndpointId: string | null,
): Promise<string | null> {
  const conversation = await trx
    .selectFrom("conversations")
    .select(["id", "kind", "legacy_contact_id", "subject"])
    .where("id", "=", conversationId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (conversation.legacy_contact_id) return conversation.legacy_contact_id;

  let contactId: string | null = null;
  if (conversation.kind === "direct" && senderEndpointId) {
    const endpoint = await trx
      .selectFrom("contact_endpoints")
      .select(["id", "contact_id", "display_name", "address_display"])
      .where("id", "=", senderEndpointId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (endpoint.contact_id) {
      contactId = endpoint.contact_id;
    } else {
      contactId = crypto.randomUUID();
      await trx
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: null,
          jid: null,
          custom_name: endpoint.display_name,
          display_name: endpoint.display_name ?? endpoint.address_display,
          record_kind: "customer",
          is_group: false,
        })
        .execute();
      await trx
        .updateTable("contact_endpoints")
        .set({ contact_id: contactId, updated_at: new Date() })
        .where("id", "=", endpoint.id)
        .execute();
    }
  } else if (conversation.kind !== "direct") {
    contactId = crypto.randomUUID();
    await trx
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: null,
        jid: null,
        custom_name: reference.subject ?? conversation.subject,
        display_name: reference.subject ?? conversation.subject,
        record_kind: "legacy_group_projection",
        is_group: true,
      })
      .execute();
  }
  if (!contactId) return null;
  await trx
    .updateTable("conversations")
    .set({ legacy_contact_id: contactId, updated_at: new Date() })
    .where("id", "=", conversationId)
    .execute();
  return contactId;
}

async function ensureConversation(
  trx: Transaction<TenantDatabase>,
  event: NormalizedChannelEvent,
  reference: ExternalConversationReference,
  providerStatus?: string,
  providerMetadata?: Record<string, unknown>,
): Promise<string> {
  const existing = await trx
    .selectFrom("conversations")
    .select("id")
    .where("channel_account_id", "=", event.channelAccountId)
    .where("client_thread_key", "=", reference.clientThreadKey)
    .executeTakeFirst();
  if (existing) {
    await trx
      .updateTable("conversations")
      .set({
        external_thread_id: reference.externalThreadId ?? null,
        kind: reference.kind,
        subject: reference.subject ?? null,
        provider_status: providerStatus ?? null,
        provider_metadata: providerMetadata ?? {},
        updated_at: new Date(),
      })
      .where("id", "=", existing.id)
      .execute();
    return existing.id;
  }
  const inserted = await trx
    .insertInto("conversations")
    .values({
      channel_account_id: event.channelAccountId,
      external_thread_id: reference.externalThreadId ?? null,
      client_thread_key: reference.clientThreadKey,
      kind: reference.kind,
      subject: reference.subject ?? null,
      provider_status: providerStatus ?? null,
      provider_metadata: providerMetadata ?? {},
      legacy_contact_id: null,
      first_message_at: null,
      last_message_at: null,
      archived_at: null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function ensureEndpoint(
  trx: Transaction<TenantDatabase>,
  event: NormalizedChannelEvent,
  endpoint: ExternalEndpointReference,
): Promise<string> {
  const existing = await trx
    .selectFrom("contact_endpoints")
    .select("id")
    .where("channel", "=", event.channel)
    .where("provider", "=", event.provider)
    .where("channel_account_id", "=", event.channelAccountId)
    .where("identity_scope", "=", endpoint.identityScope)
    .where("external_id", "=", endpoint.externalId)
    .executeTakeFirst();
  if (existing) {
    await trx
      .updateTable("contact_endpoints")
      .set({
        endpoint_kind: endpoint.endpointKind,
        normalized_address: endpoint.normalizedAddress ?? null,
        address_display: endpoint.addressDisplay ?? null,
        display_name: endpoint.displayName ?? null,
        last_seen_at: new Date(),
        updated_at: new Date(),
      })
      .where("id", "=", existing.id)
      .execute();
    return existing.id;
  }
  return (
    await trx
      .insertInto("contact_endpoints")
      .values({
        contact_id: null,
        channel: event.channel,
        provider: event.provider,
        channel_account_id: event.channelAccountId,
        endpoint_kind: endpoint.endpointKind,
        external_id: endpoint.externalId,
        identity_scope: endpoint.identityScope,
        normalized_address: endpoint.normalizedAddress ?? null,
        address_display: endpoint.addressDisplay ?? null,
        display_name: endpoint.displayName ?? null,
        verification_state: "provider_verified",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}

async function ensureParticipant(
  trx: Transaction<TenantDatabase>,
  conversationId: string,
  endpointId: string,
  endpoint: ExternalEndpointReference,
): Promise<string> {
  const existing = await trx
    .selectFrom("conversation_participants")
    .select("id")
    .where("conversation_id", "=", conversationId)
    .where("contact_endpoint_id", "=", endpointId)
    .where("left_at", "is", null)
    .executeTakeFirst();
  if (existing) return existing.id;
  return (
    await trx
      .insertInto("conversation_participants")
      .values({
        conversation_id: conversationId,
        contact_endpoint_id: endpointId,
        workspace_user_id: null,
        participant_kind: "external",
        role: endpoint.endpointKind,
        is_self: false,
        joined_at: null,
        left_at: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}

async function replaceAttachments(
  trx: Transaction<TenantDatabase>,
  messageId: string,
  payload: MessageUpsertEventPayload,
): Promise<void> {
  for (const attachment of payload.attachments ?? []) {
    await trx
      .insertInto("message_attachments")
      .values({
        message_id: messageId,
        ordinal: attachment.ordinal,
        kind: attachment.kind,
        provider_attachment_id: attachment.providerAttachmentId ?? null,
        file_name: attachment.fileName ?? null,
        content_type: attachment.contentType ?? null,
        byte_size: attachment.byteSize?.toString() ?? null,
        storage_uri: attachment.storageUri ?? null,
        provider_locator: null,
        content_id: null,
        content_disposition: null,
        status: attachment.status,
        error_code: attachment.errorCode ?? null,
        provider_metadata: attachment.providerMetadata ?? {},
      })
      .onConflict((oc) =>
        oc.columns(["message_id", "ordinal"]).doUpdateSet({
          kind: attachment.kind,
          provider_attachment_id: attachment.providerAttachmentId ?? null,
          file_name: attachment.fileName ?? null,
          content_type: attachment.contentType ?? null,
          byte_size: attachment.byteSize?.toString() ?? null,
          storage_uri: attachment.storageUri
            ? attachment.storageUri
            : sql`message_attachments.storage_uri`,
          status: sql`CASE
            WHEN message_attachments.status = 'available' AND ${attachment.status} = 'pending'
              THEN message_attachments.status
            ELSE ${attachment.status}
          END`,
          error_code: attachment.errorCode
            ? attachment.errorCode
            : sql`message_attachments.error_code`,
          provider_metadata: attachment.providerMetadata ?? {},
          updated_at: new Date(),
        }),
      )
      .execute();
  }
}

async function findMessage(
  trx: Transaction<TenantDatabase>,
  channelAccountId: string,
  scope: string,
  externalId: string,
): Promise<{ id: string; provider_occurred_at: Date | null } | undefined> {
  return trx
    .selectFrom("messages")
    .select(["id", "provider_occurred_at"])
    .where("channel_account_id", "=", channelAccountId)
    .where("external_identity_scope", "=", scope)
    .where("external_message_id", "=", externalId)
    .executeTakeFirst();
}

async function enqueueFanout(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  channelAccountId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await sql`INSERT INTO public.channel_message_delivery_outbox
      (company_id, channel_account_id, conversation_id, message_id, kind, case_event)
    VALUES
      (${companyId}::uuid, ${channelAccountId}::uuid, ${conversationId}::uuid, ${messageId}::uuid, 'realtime', NULL),
      (${companyId}::uuid, ${channelAccountId}::uuid, ${conversationId}::uuid, ${messageId}::uuid, 'push', NULL)
    ON CONFLICT DO NOTHING`.execute(trx);
}

async function recordApplicationFailure(
  db: Kysely<TenantDatabase>,
  event: NormalizedChannelEvent,
  error: unknown,
): Promise<void> {
  const code =
    error instanceof Error ? error.message.slice(0, 200) : "unknown_error";
  const quarantined =
    error instanceof ChannelEventIdentityCollisionError ||
    error instanceof ChannelEventAccountMismatchError;
  await db
    .updateTable("channel_event_inbox")
    .set({
      status: quarantined ? "quarantined" : "pending",
      attempts: sql`LEAST(attempts + 1, 30)`,
      next_attempt_at: sql`statement_timestamp() + LEAST(INTERVAL '15 minutes', INTERVAL '5 seconds' * power(2, LEAST(attempts, 8)))`,
      last_error_code: code,
    })
    .where("channel_account_id", "=", event.channelAccountId)
    .where("external_event_scope", "=", event.provider)
    .where("external_event_id", "=", event.eventId)
    .execute();
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
  const supported = new Set([
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
  ]);
  return supported.has(value) ? (value as LegacyMessageType) : "text";
}

export function channelEventPayloadDigest(
  event: NormalizedChannelEvent,
): string {
  // receivedAt is local transport metadata and changes on every provider
  // redelivery. It cannot participate in the provider event identity digest.
  const { receivedAt: _receivedAt, ...providerEvent } = event;
  return createHash("sha256").update(stableJson(providerEvent)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
