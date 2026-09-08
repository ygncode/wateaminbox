import type { TenantDatabase } from "@wateaminbox/database";
import { createHash } from "node:crypto";
import type { Transaction } from "kysely";

export interface LinkedDeviceBridge {
  channelAccountId: string;
  contactEndpointId: string;
  conversationId: string;
  accountParticipantId: string;
  externalParticipantId: string;
}

export type LinkedDeviceBridgeResult =
  | { status: "ready"; bridge: LinkedDeviceBridge }
  | {
      status: "unresolved";
      errorCode:
        | "legacy_contact_missing"
        | "legacy_connection_missing"
        | "legacy_endpoint_missing";
    };

interface LegacyConnectionProjection {
  id: string;
  name: string | null;
  phone_number: string | null;
  jid: string | null;
  status:
    | "connected"
    | "connecting"
    | "disconnected"
    | "banned"
    | "pending"
    | "error";
  connected_by: string | null;
  connected_at: Date | null;
  last_sync_at: Date | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export async function ensureLinkedDeviceAccount(
  trx: Transaction<TenantDatabase>,
  legacyConnectionId: string,
): Promise<boolean> {
  const connection = await trx
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "name",
      "phone_number",
      "jid",
      "status",
      "connected_by",
      "connected_at",
      "last_sync_at",
      "created_at",
      "updated_at",
      "archived_at",
    ])
    .where("id", "=", legacyConnectionId)
    .executeTakeFirst();
  if (!connection) return false;
  await upsertLinkedDeviceAccount(trx, connection);
  return true;
}

export async function ensureLinkedDeviceBridge(
  trx: Transaction<TenantDatabase>,
  legacyContactId: string,
): Promise<LinkedDeviceBridgeResult> {
  const contact = await trx
    .selectFrom("contacts")
    .select([
      "id",
      "whatsapp_connection_id",
      "jid",
      "phone_number",
      "push_name",
      "username",
      "custom_name",
      "profile_picture_url",
      "is_group",
      "is_blocked",
      "is_online",
      "last_seen",
      "remote_history_status",
      "remote_history_updated_at",
      "created_at",
      "updated_at",
    ])
    .where("id", "=", legacyContactId)
    .executeTakeFirst();
  if (!contact) {
    return { status: "unresolved", errorCode: "legacy_contact_missing" };
  }
  if (!contact.whatsapp_connection_id) {
    return { status: "unresolved", errorCode: "legacy_connection_missing" };
  }
  if (!contact.jid) {
    return { status: "unresolved", errorCode: "legacy_endpoint_missing" };
  }

  const connection = await trx
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "name",
      "phone_number",
      "jid",
      "status",
      "connected_by",
      "connected_at",
      "last_sync_at",
      "created_at",
      "updated_at",
      "archived_at",
    ])
    .where("id", "=", contact.whatsapp_connection_id)
    .executeTakeFirst();
  if (!connection) {
    return { status: "unresolved", errorCode: "legacy_connection_missing" };
  }

  const channelAccountId = connection.id;
  const conversationId = contact.id;
  const contactEndpointId = deterministicChannelUuid(
    "linked-device-endpoint",
    connection.id,
    contact.jid,
  );
  const accountParticipantId = deterministicChannelUuid(
    "linked-device-account-participant",
    conversationId,
    connection.id,
  );
  const externalParticipantId = deterministicChannelUuid(
    "linked-device-external-participant",
    conversationId,
    contactEndpointId,
  );

  await upsertLinkedDeviceAccount(trx, connection);

  await trx
    .updateTable("contacts")
    .set({
      display_name:
        contact.custom_name ??
        contact.push_name ??
        contact.username ??
        contact.phone_number,
      avatar_url: contact.profile_picture_url,
      record_kind: contact.is_group ? "legacy_group_projection" : "customer",
    })
    .where("id", "=", contact.id)
    .execute();

  await trx
    .insertInto("contact_endpoints")
    .values({
      id: contactEndpointId,
      contact_id: contact.is_group ? null : contact.id,
      channel: "whatsapp",
      provider: "whatsapp_linked_device",
      channel_account_id: channelAccountId,
      endpoint_kind: contact.is_group ? "group" : "person",
      external_id: contact.jid,
      identity_scope: linkedDeviceIdentityScope(connection.id),
      normalized_address: contact.phone_number,
      address_display: contact.phone_number ?? contact.jid,
      display_name:
        contact.custom_name ?? contact.push_name ?? contact.username ?? null,
      verification_state: "provider_verified",
      provider_metadata: {},
      first_seen_at: contact.created_at,
      last_seen_at: contact.updated_at,
      created_at: contact.created_at,
      updated_at: contact.updated_at,
    })
    .onConflict((conflict) =>
      conflict.column("id").doUpdateSet({
        contact_id: contact.is_group ? null : contact.id,
        normalized_address: contact.phone_number,
        address_display: contact.phone_number ?? contact.jid,
        display_name:
          contact.custom_name ?? contact.push_name ?? contact.username ?? null,
        last_seen_at: contact.updated_at,
        updated_at: contact.updated_at,
      }),
    )
    .execute();

  await trx
    .insertInto("endpoint_account_states")
    .values({
      channel_account_id: channelAccountId,
      contact_endpoint_id: contactEndpointId,
      provider_block_state: contact.is_blocked ? "blocked" : "allowed",
      provider_status: null,
      updated_at: contact.updated_at,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["channel_account_id", "contact_endpoint_id"])
        .doUpdateSet({
          provider_block_state: contact.is_blocked ? "blocked" : "allowed",
          updated_at: contact.updated_at,
        }),
    )
    .execute();

  await trx
    .insertInto("endpoint_presence")
    .values({
      channel_account_id: channelAccountId,
      contact_endpoint_id: contactEndpointId,
      availability: contact.is_online ? "online" : "offline",
      last_seen_at: contact.last_seen,
      observed_at: contact.updated_at,
      expires_at: null,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["channel_account_id", "contact_endpoint_id"])
        .doUpdateSet({
          availability: contact.is_online ? "online" : "offline",
          last_seen_at: contact.last_seen,
          observed_at: contact.updated_at,
        }),
    )
    .execute();

  await trx
    .insertInto("conversations")
    .values({
      id: conversationId,
      channel_account_id: channelAccountId,
      external_thread_id: contact.jid,
      client_thread_key: `legacy-contact:${contact.id}`,
      kind: contact.is_group ? "group" : "direct",
      subject: contact.is_group
        ? (contact.custom_name ?? contact.push_name)
        : null,
      provider_status: null,
      provider_metadata: {},
      legacy_contact_id: contact.id,
      created_at: contact.created_at,
      updated_at: contact.updated_at,
    })
    .onConflict((conflict) =>
      conflict.column("id").doUpdateSet({
        external_thread_id: contact.jid,
        kind: contact.is_group ? "group" : "direct",
        subject: contact.is_group
          ? (contact.custom_name ?? contact.push_name)
          : null,
        updated_at: contact.updated_at,
      }),
    )
    .execute();

  await trx
    .insertInto("conversation_sync_states")
    .values({
      conversation_id: conversationId,
      provider: "whatsapp_linked_device",
      status: contact.remote_history_status,
      cursor_or_anchor: null,
      request_generation: "0",
      last_requested_at:
        contact.remote_history_status === "requesting"
          ? contact.remote_history_updated_at
          : null,
      last_completed_at:
        contact.remote_history_status === "exhausted"
          ? contact.remote_history_updated_at
          : null,
      error_code:
        contact.remote_history_status === "failed"
          ? "legacy_history_failed"
          : null,
      updated_at: contact.remote_history_updated_at ?? contact.updated_at,
    })
    .onConflict((conflict) =>
      conflict.columns(["conversation_id", "provider"]).doUpdateSet({
        status: contact.remote_history_status,
        last_requested_at:
          contact.remote_history_status === "requesting"
            ? contact.remote_history_updated_at
            : null,
        last_completed_at:
          contact.remote_history_status === "exhausted"
            ? contact.remote_history_updated_at
            : null,
        error_code:
          contact.remote_history_status === "failed"
            ? "legacy_history_failed"
            : null,
        updated_at: contact.remote_history_updated_at ?? contact.updated_at,
      }),
    )
    .execute();

  await trx
    .insertInto("conversation_participants")
    .values([
      {
        id: accountParticipantId,
        conversation_id: conversationId,
        participant_kind: "account",
        role: "account",
        is_self: true,
        provider_metadata: {},
        created_at: contact.created_at,
        updated_at: contact.updated_at,
      },
      {
        id: externalParticipantId,
        conversation_id: conversationId,
        contact_endpoint_id: contactEndpointId,
        participant_kind: "external",
        role: contact.is_group ? "member" : "guest",
        is_self: false,
        provider_metadata: {},
        created_at: contact.created_at,
        updated_at: contact.updated_at,
      },
    ])
    .onConflict((conflict) =>
      conflict.column("id").doUpdateSet({ updated_at: contact.updated_at }),
    )
    .execute();

  return {
    status: "ready",
    bridge: {
      channelAccountId,
      contactEndpointId,
      conversationId,
      accountParticipantId,
      externalParticipantId,
    },
  };
}

export async function shadowLinkedDeviceMessage(
  trx: Transaction<TenantDatabase>,
  messageId: string,
): Promise<LinkedDeviceBridgeResult> {
  const message = await trx
    .selectFrom("messages")
    .selectAll()
    .where("id", "=", messageId)
    .executeTakeFirst();
  if (!message?.contact_id) {
    return { status: "unresolved", errorCode: "legacy_contact_missing" };
  }
  const result = await ensureLinkedDeviceBridge(trx, message.contact_id);
  if (result.status !== "ready") return result;

  const { bridge } = result;
  const confirmedProviderId =
    message.message_id && !message.message_id.startsWith("pending_")
      ? message.message_id
      : null;
  let replyToMessageId: string | null = null;
  if (message.quoted_message_id) {
    const reply = await trx
      .selectFrom("messages")
      .select("id")
      .where("whatsapp_connection_id", "=", bridge.channelAccountId)
      .where("message_id", "=", message.quoted_message_id)
      .executeTakeFirst();
    replyToMessageId = reply?.id ?? null;
  }

  await trx
    .updateTable("messages")
    .set({
      channel_account_id: bridge.channelAccountId,
      conversation_id: bridge.conversationId,
      external_message_id: confirmedProviderId,
      external_identity_scope: confirmedProviderId
        ? linkedDeviceMessageScope(bridge.conversationId)
        : null,
      client_idempotency_key: confirmedProviderId ? null : message.message_id,
      direction: message.from_me ? "outbound" : "inbound",
      sender_participant_id: message.from_me
        ? bridge.accountParticipantId
        : bridge.externalParticipantId,
      reply_to_message_id: replyToMessageId,
      provider_occurred_at: message.timestamp,
      normalized_type: message.message_type,
      text_content: message.content,
      provider_metadata: {},
    })
    .where("id", "=", message.id)
    .execute();

  if (
    message.media_url ||
    message.media_direct_path ||
    message.media_mime_type ||
    message.media_key
  ) {
    const attachmentId = deterministicChannelUuid(
      "linked-device-attachment",
      message.id,
      "0",
    );
    await trx
      .insertInto("message_attachments")
      .values({
        id: attachmentId,
        message_id: message.id,
        ordinal: 0,
        kind: message.message_type,
        file_name: null,
        content_type: message.media_mime_type,
        byte_size:
          message.media_size === null ? null : String(message.media_size),
        storage_uri: message.media_url,
        status:
          message.media_download_status === "failed"
            ? "failed"
            : message.media_url
              ? "available"
              : "pending",
        error_code: message.media_download_error,
        provider_metadata: {},
      })
      .onConflict((conflict) =>
        conflict.columns(["message_id", "ordinal"]).doUpdateSet({
          content_type: message.media_mime_type,
          byte_size:
            message.media_size === null ? null : String(message.media_size),
          storage_uri: message.media_url,
          status:
            message.media_download_status === "failed"
              ? "failed"
              : message.media_url
                ? "available"
                : "pending",
          error_code: message.media_download_error,
          updated_at: new Date(),
        }),
      )
      .execute();

    if (
      message.media_direct_path ||
      message.media_key ||
      message.media_file_sha256 ||
      message.media_file_enc_sha256
    ) {
      await trx
        .insertInto("whatsapp_attachment_fetch_state")
        .values({
          attachment_id: attachmentId,
          direct_path: message.media_direct_path,
          media_key: message.media_key,
          file_sha256: message.media_file_sha256,
          file_enc_sha256: message.media_file_enc_sha256,
        })
        .onConflict((conflict) =>
          conflict.column("attachment_id").doUpdateSet({
            direct_path: message.media_direct_path,
            media_key: message.media_key,
            file_sha256: message.media_file_sha256,
            file_enc_sha256: message.media_file_enc_sha256,
            updated_at: new Date(),
          }),
        )
        .execute();
    }
  }

  return result;
}

export async function shadowLinkedDeviceWorkflow(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  legacyContactId: string,
): Promise<LinkedDeviceBridgeResult> {
  const result = await ensureLinkedDeviceBridge(trx, legacyContactId);
  if (result.status !== "ready") return result;
  const conversationId = result.bridge.conversationId;
  for (const tableName of [
    "conversation_states",
    "contact_assignments",
    "contact_notes_private",
    "contact_notes_shared",
    "scheduled_messages",
  ] as const) {
    await trx
      .updateTable(tableName)
      .set({ conversation_id: conversationId })
      .where("contact_id", "=", legacyContactId)
      .where("conversation_id", "is", null)
      .execute();
  }
  await trx
    .updateTable("conversation_cases")
    .set({ conversation_id: conversationId, company_id: companyId })
    .where("contact_id", "=", legacyContactId)
    .execute();
  await trx
    .insertInto("conversation_tags")
    .columns(["conversation_id", "tag_id"])
    .expression((expression) =>
      expression
        .selectFrom("contact_tags")
        .select([
          expression.val(conversationId).as("conversation_id"),
          "tag_id",
        ])
        .where("contact_id", "=", legacyContactId),
    )
    .onConflict((conflict) => conflict.doNothing())
    .execute();
  return result;
}

export async function shadowLinkedDeviceLegacyMutation(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  legacyContactId: string,
  messageId?: string,
): Promise<boolean> {
  let errorCode: string | null = null;
  try {
    await trx.transaction().execute(async (savepoint) => {
      if (messageId) {
        const message = await shadowLinkedDeviceMessage(savepoint, messageId);
        if (message.status === "unresolved") errorCode = message.errorCode;
      }
      const workflow = await shadowLinkedDeviceWorkflow(
        savepoint,
        companyId,
        legacyContactId,
      );
      if (workflow.status === "unresolved") errorCode = workflow.errorCode;
    });
  } catch {
    errorCode = "shadow_write_failed";
  }
  if (!errorCode) return true;
  await journalLinkedDeviceShadowFailure(
    trx,
    messageId ? "message" : "workflow",
    messageId ? "messages" : "contacts",
    messageId ?? legacyContactId,
    errorCode,
  );
  return false;
}

export async function journalLinkedDeviceShadowFailure(
  trx: Transaction<TenantDatabase>,
  kind: "graph" | "message" | "workflow",
  legacyTable: string,
  legacyId: string,
  errorCode: string,
): Promise<void> {
  await trx
    .insertInto("channel_spine_reconciliation_journal")
    .values({
      kind,
      legacy_table: legacyTable,
      legacy_id: legacyId,
      error_code: errorCode,
      detail: {},
      status: "pending",
      next_attempt_at: new Date(),
    })
    .onConflict((conflict) =>
      conflict.columns(["kind", "legacy_table", "legacy_id"]).doUpdateSet({
        error_code: errorCode,
        status: "pending",
        next_attempt_at: new Date(),
        updated_at: new Date(),
      }),
    )
    .execute();
}

async function upsertLinkedDeviceAccount(
  trx: Transaction<TenantDatabase>,
  connection: LegacyConnectionProjection,
): Promise<void> {
  await trx
    .insertInto("channel_accounts")
    .values({
      id: connection.id,
      channel: "whatsapp",
      provider: "whatsapp_linked_device",
      display_name: connection.name,
      external_account_id: connection.jid ?? connection.phone_number,
      external_scope_id: connection.id,
      status: mapLegacyConnectionStatus(connection.status),
      provider_status: connection.status,
      provider_metadata: {},
      legacy_whatsapp_connection_id: connection.id,
      connected_by: connection.connected_by,
      connected_at: connection.connected_at,
      last_sync_at: connection.last_sync_at,
      created_at: connection.created_at,
      updated_at: connection.updated_at,
      archived_at: connection.archived_at,
    })
    .onConflict((conflict) =>
      conflict.column("id").doUpdateSet({
        display_name: connection.name,
        external_account_id: connection.jid ?? connection.phone_number,
        status: mapLegacyConnectionStatus(connection.status),
        provider_status: connection.status,
        connected_by: connection.connected_by,
        connected_at: connection.connected_at,
        last_sync_at: connection.last_sync_at,
        updated_at: connection.updated_at,
        archived_at: connection.archived_at,
      }),
    )
    .execute();
}

export function deterministicChannelUuid(
  purpose: string,
  ...parts: string[]
): string {
  const bytes = createHash("sha256")
    .update(["wateaminbox-channel-spine-v1", purpose, ...parts].join("\u001f"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function linkedDeviceIdentityScope(connectionId: string): string {
  return `linked-device-account:${connectionId}`;
}

function linkedDeviceMessageScope(conversationId: string): string {
  return `linked-device-conversation:${conversationId}`;
}

function mapLegacyConnectionStatus(
  status:
    | "connected"
    | "connecting"
    | "disconnected"
    | "banned"
    | "pending"
    | "error",
): "connecting" | "connected" | "disconnected" | "disabled" | "error" {
  if (status === "pending") return "connecting";
  if (status === "banned") return "disabled";
  return status;
}
