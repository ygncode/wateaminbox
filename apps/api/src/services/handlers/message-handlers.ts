/**
 * Message event handlers - incoming messages, receipts, send confirmations
 */

import { type MessageStatus, type MessageType } from "@wateaminbox/database";
import {
  extractPhoneFromJid,
  normalizeJid,
  toDbDate,
} from "@wateaminbox/shared";
import { sql } from "kysely";
import { normalizeLinkedDeviceMessageEvent } from "../../channel-spine/providers/whatsapp-linked-device/normalize.js";
import { compareLinkedDeviceMessageShadow } from "../../channel-spine/providers/whatsapp-linked-device/shadow-compare.js";
import { shadowLinkedDeviceLegacyMutation } from "../../channel-spine/providers/whatsapp-linked-device/shadow.js";
import { formatError } from "../../lib/logger.js";
import { buildInboundMessageMetadata } from "../../lib/message-formatters.js";
import {
  buildCommandSubject,
  type MessageEvent,
  type NatsCommand,
  PermanentEventError,
  publishCommand,
  type ReceiptEvent,
  type SendConfirmationEvent,
  type SendFailedEvent,
} from "../../lib/nats/index.js";
import { broadcastToCompany } from "../../lib/realtime.js";
import {
  getAutoReplyCandidate,
  scheduleFirstContactAutoReply,
} from "../auto-reply.service.js";
import { getChannelSpineWorkspaceAuthority } from "../channel-spine-authority.service.js";
import {
  openOrReopenCaseForInboundMessage,
  resolveActiveCaseIdForContact,
} from "../conversation-case.service.js";
import { broadcastToContactViewers } from "../message-broadcast.service.js";
import { enqueueMessageDelivery } from "../message-delivery-outbox.service.js";
import { enqueueMessageSearch } from "../message-search-outbox.service.js";
import { getSchemaName, getTenantConnection } from "../tenant.service.js";
import { lockActiveConnectionForEvent } from "./connection-event-guard.js";
import { buildIncomingMessageMetadata } from "./message-metadata.js";
import { getProfilePictureRequestJid } from "./profile-picture-request.js";
import { handlerLogger as logger } from "./types.js";

const profilePictureRequestTimes = new Map<string, number>();
const profilePictureRequestCooldownMs = 10 * 60 * 1000;

async function requestProfilePicture(
  companyId: string,
  connectionId: string,
  jid: string,
): Promise<void> {
  const requestKey = `${connectionId}:${jid}`;
  const lastRequestedAt = profilePictureRequestTimes.get(requestKey) || 0;
  if (Date.now() - lastRequestedAt < profilePictureRequestCooldownMs) {
    return;
  }
  profilePictureRequestTimes.set(requestKey, Date.now());

  await publishCommand(buildCommandSubject(companyId, connectionId), {
    type: "fetch_profile_picture",
    company_id: companyId,
    connection_id: connectionId,
    jid,
  } as NatsCommand & { jid: string });
}

/**
 * Handles incoming WhatsApp messages
 */
export async function handleMessageEvent(event: MessageEvent): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

  logger.debug(
    { companyId, connectionId, from: payload.from },
    "Message received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Durable events must identify their owning connection. Falling back to a
    // different active account can corrupt contacts/messages when IDs collide.
    if (!connectionId) {
      logger.error({ companyId }, "Quarantining message without connection ID");
      throw new PermanentEventError(
        `Message event for company ${companyId} has no connection ID`,
      );
    }
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "name", "phone_number", "archived_at"])
      .where("id", "=", connectionId)
      .executeTakeFirst();

    if (!connection || connection.archived_at) {
      logger.error(
        { companyId, connectionId },
        "Quarantining message for inactive connection",
      );
      throw new PermanentEventError(
        `Message event references inactive connection ${connectionId}`,
      );
    }

    // Group messages belong to the group conversation, while `from` identifies
    // the participant who authored the message. Direct chats continue to use
    // the remote party as the conversation identity.
    const isGroupMessage =
      payload.isGroup === true ||
      Boolean(payload.groupId) ||
      payload.to?.includes("@g.us");
    const rawContactJid = isGroupMessage
      ? payload.groupId || payload.to
      : payload.fromMe
        ? payload.to
        : payload.from;
    if (!rawContactJid) {
      logger.warn(
        { companyId, messageId: payload.messageId },
        "Message has no contact JID",
      );
      throw new PermanentEventError(
        `Message ${payload.messageId} has no contact JID`,
      );
    }
    const contactJid = normalizeJid(rawContactJid);
    if (!contactJid) {
      logger.warn(
        { companyId, rawContactJid },
        "Message contact JID is invalid",
      );
      throw new PermanentEventError(
        `Message ${payload.messageId} has invalid contact JID ${rawContactJid}`,
      );
    }
    let contact = await tenantDb
      .selectFrom("contacts")
      .select(["id", "profile_picture_url"])
      .where("jid", "=", contactJid)
      .where("whatsapp_connection_id", "=", connection.id)
      .executeTakeFirst();

    if (!contact) {
      const contactId = crypto.randomUUID();
      // Extract phone number from JID (removes device suffix like ":3")
      const phoneNumber = extractPhoneFromJid(contactJid);
      contact = await tenantDb.transaction().execute(async (trx) => {
        if (!(await lockActiveConnectionForEvent(trx, connection.id))) {
          throw new PermanentEventError(
            `Message event references inactive connection ${connection.id}`,
          );
        }
        const inserted = await trx
          .insertInto("contacts")
          .values({
            id: contactId,
            whatsapp_connection_id: connection.id,
            jid: contactJid,
            phone_number: phoneNumber,
            is_group: isGroupMessage || contactJid.includes("@g.us"),
            created_at: toDbDate(),
            updated_at: toDbDate(),
          })
          .onConflict((oc) =>
            oc
              .columns(["whatsapp_connection_id", "jid"])
              .where("whatsapp_connection_id", "is not", null)
              .where("jid", "is not", null)
              .doNothing(),
          )
          .returning(["id", "profile_picture_url"])
          .executeTakeFirst();
        if (inserted) return inserted;

        // Another API replica may have created the contact after our initial
        // lookup. Read the winner instead of redelivering the whole event.
        return trx
          .selectFrom("contacts")
          .select(["id", "profile_picture_url"])
          .where("jid", "=", contactJid)
          .where("whatsapp_connection_id", "=", connection.id)
          .executeTakeFirstOrThrow();
      });
    }

    // Preserve the participant separately from the group conversation. Push
    // names are carried by WhatsApp history/live events; fall back to an
    // existing contact name when WhatsApp omits one.
    let normalizedSenderJid = normalizeJid(payload.from);
    let senderName = payload.senderName?.trim() || null;

    // Some history syncs omit MessageKey.Participant and report the group as
    // `from`. Whatsmeow's message-secret store still retains the actual author.
    if (isGroupMessage && normalizedSenderJid?.includes("@g.us")) {
      const resolvedParticipant = await sql<{
        sender_jid: string;
        sender_name: string | null;
      }>`
        SELECT
          regexp_replace(
            coalesce(mapping.jid, secret.sender_jid),
            ':[0-9]+@',
            '@'
          ) AS sender_jid,
          coalesce(
            nullif(stored_contact.full_name, ''),
            nullif(stored_contact.push_name, ''),
            nullif(stored_contact.first_name, '')
          ) AS sender_name
        FROM whatsapp_sessions.whatsmeow_message_secrets AS secret
        LEFT JOIN whatsapp_sessions.whatsmeow_lid_mappings AS mapping
          ON mapping.connection_id::text = secret.connection_id::text
          AND regexp_replace(mapping.lid, ':[0-9]+@', '@') =
              regexp_replace(secret.sender_jid, ':[0-9]+@', '@')
        LEFT JOIN whatsapp_sessions.whatsmeow_contacts AS stored_contact
          ON stored_contact.connection_id::text = secret.connection_id::text
          AND regexp_replace(stored_contact.their_jid, ':[0-9]+@', '@') =
              regexp_replace(
                coalesce(mapping.jid, secret.sender_jid),
                ':[0-9]+@',
                '@'
              )
        WHERE secret.connection_id::text = ${connection.id}
          AND secret.message_id = ${payload.messageId}
        ORDER BY mapping.created_at DESC NULLS LAST
        LIMIT 1
      `.execute(tenantDb);
      const participant = resolvedParticipant.rows[0];
      if (participant) {
        normalizedSenderJid = participant.sender_jid;
        senderName ||= participant.sender_name;
      }
    }

    if (
      isGroupMessage &&
      !payload.fromMe &&
      !senderName &&
      normalizedSenderJid &&
      !normalizedSenderJid.includes("@g.us")
    ) {
      const storedWhatsAppContact = await sql<{
        full_name: string | null;
        push_name: string | null;
        first_name: string | null;
      }>`
        SELECT full_name, push_name, first_name
        FROM whatsapp_sessions.whatsmeow_contacts
        WHERE connection_id::text = ${connection.id}
          AND regexp_replace(their_jid, ':[0-9]+@', '@') = ${normalizedSenderJid}
        LIMIT 1
      `.execute(tenantDb);
      const whatsappName = storedWhatsAppContact.rows[0];

      const senderContact = await tenantDb
        .selectFrom("contacts")
        .select(["custom_name", "push_name", "phone_number"])
        .where("jid", "=", normalizedSenderJid)
        .where("whatsapp_connection_id", "=", connection.id)
        .executeTakeFirst();
      senderName =
        senderContact?.custom_name ||
        senderContact?.push_name ||
        whatsappName?.full_name ||
        whatsappName?.push_name ||
        whatsappName?.first_name ||
        senderContact?.phone_number ||
        extractPhoneFromJid(normalizedSenderJid) ||
        null;
    }

    // Store the message - also normalize sender_jid
    // Determine media download status based on whether it's a history sync with deferred media
    const hasMediaReference = Boolean(
      payload.mediaDirectPath && payload.mediaKey,
    );
    const mediaDownloadStatus = payload.mediaUrl
      ? "completed"
      : hasMediaReference
        ? "pending"
        : null;
    const messageStatus: MessageStatus = payload.fromMe
      ? (payload.status ?? "sent")
      : "delivered";
    const albumMetadata = buildIncomingMessageMetadata(payload);
    const documentMetadata = buildInboundMessageMetadata(payload);
    const incomingMetadata =
      albumMetadata || documentMetadata
        ? { ...(albumMetadata ?? {}), ...(documentMetadata ?? {}) }
        : null;

    const messageId = crypto.randomUUID();
    const messageReceivedAt = toDbDate(payload.timestamp);
    const autoReplyCandidate =
      !payload.fromMe && !payload.isHistorySync && !isGroupMessage
        ? await getAutoReplyCandidate(companyId, toDbDate())
        : null;
    const spineAuthority = await getChannelSpineWorkspaceAuthority(companyId);
    const normalizedShadowEvent = spineAuthority.shadowNormalizationEnabled
      ? (() => {
          try {
            return normalizeLinkedDeviceMessageEvent(event);
          } catch (error) {
            logger.warn(
              { companyId, connectionId, error: formatError(error) },
              "Linked-device normalization shadow rejected an event",
            );
            return null;
          }
        })()
      : null;

    // The message insert, unread-count/last-message projection update, and
    // conversation-case open/reopen must succeed or fail together: a case
    // opening without its triggering message being durably stored (or vice
    // versa) would corrupt the SLA clock. See conversation-case.service.ts
    // for why the case-open step itself is additionally safe under retries
    // and concurrent events (partial unique index + ON CONFLICT DO NOTHING).
    const { insertResult } = await tenantDb
      .transaction()
      .execute(async (trx) => {
        if (!(await lockActiveConnectionForEvent(trx, connection.id))) {
          throw new PermanentEventError(
            `Message event references inactive connection ${connection.id}`,
          );
        }
        // Linked-device outbound messages use the same contact lock as API and
        // automatic sends, so an auto reply cannot pass its unanswered check
        // while a human reply is concurrently being persisted.
        if (payload.fromMe && !payload.isHistorySync) {
          await trx
            .selectFrom("contacts")
            .select("id")
            .where("id", "=", contact.id)
            .forUpdate()
            .executeTakeFirstOrThrow();
        }
        const insertQuery = trx.insertInto("messages").values({
          id: messageId,
          whatsapp_connection_id: connection.id,
          contact_id: contact.id,
          message_id: payload.messageId,
          from_me: payload.fromMe,
          sender_jid: normalizedSenderJid,
          sender_name: senderName,
          sender_avatar_url: null,
          message_type: payload.messageType as MessageType,
          content: payload.content,
          search_vector: sql`to_tsvector('english', ${payload.content ?? ""})`,
          metadata: incomingMetadata,
          media_url: payload.mediaUrl || null,
          media_mime_type: payload.mediaType || null,
          media_size: payload.mediaSize || null,
          // Deferred media download fields
          media_direct_path: payload.mediaDirectPath || null,
          media_key: payload.mediaKey
            ? Buffer.from(payload.mediaKey, "base64")
            : null,
          media_file_sha256: payload.mediaFileSha256
            ? Buffer.from(payload.mediaFileSha256, "base64")
            : null,
          media_file_enc_sha256: payload.mediaFileEncSha256
            ? Buffer.from(payload.mediaFileEncSha256, "base64")
            : null,
          media_download_status: mediaDownloadStatus,
          quoted_message_id: payload.quotedMessageId || null,
          is_forwarded: false,
          is_starred: false,
          deleted_by_sender: false,
          status: messageStatus,
          timestamp: messageReceivedAt,
          created_at: toDbDate(),
        });

        // A reconnect can resend history that was previously imported without
        // its group participant. Repair sender fields when the replay is more
        // complete, but never let a replay that names the group itself erase a
        // participant identity the live/original import already preserved.
        const insertResult = payload.isHistorySync
          ? await insertQuery
              .onConflict((oc) =>
                oc
                  .columns(["whatsapp_connection_id", "message_id"])
                  .doUpdateSet({
                    from_me: payload.fromMe,
                    sender_jid: sql<string | null>`CASE
                WHEN excluded.sender_jid LIKE '%@g.us'
                  AND messages.sender_jid IS NOT NULL
                  AND messages.sender_jid NOT LIKE '%@g.us'
                  THEN messages.sender_jid
                ELSE excluded.sender_jid
              END`,
                    sender_name: sql<string | null>`CASE
                WHEN excluded.sender_jid LIKE '%@g.us'
                  AND messages.sender_jid IS NOT NULL
                  AND messages.sender_jid NOT LIKE '%@g.us'
                  THEN messages.sender_name
                ELSE COALESCE(excluded.sender_name, messages.sender_name)
              END`,
                    // Merge rather than replace. History replay can omit a
                    // filename or other metadata that the original event
                    // carried, so retain existing keys while accepting new
                    // album/document metadata from the replay.
                    metadata: sql<Record<string, unknown> | null>`NULLIF(
                COALESCE(messages.metadata, '{}'::jsonb)
                  || COALESCE(excluded.metadata, '{}'::jsonb),
                '{}'::jsonb
              )`,
                    quoted_message_id: payload.quotedMessageId || null,
                    // History sync contains the original WhatsApp status. Merge
                    // it monotonically so imported messages get their old
                    // double ticks without regressing newer realtime receipt
                    // state.
                    status: sql<MessageStatus>`CASE
                WHEN messages.status = 'read' OR excluded.status = 'read'
                  THEN 'read'::message_status
                WHEN messages.status = 'delivered' OR excluded.status = 'delivered'
                  THEN 'delivered'::message_status
                WHEN messages.status = 'sent' OR excluded.status = 'sent'
                  THEN 'sent'::message_status
                WHEN messages.status = 'pending' OR excluded.status = 'pending'
                  THEN 'pending'::message_status
                ELSE 'failed'::message_status
              END`,
                  }),
              )
              .returning("id")
              .executeTakeFirst()
          : await insertQuery
              .onConflict((oc) =>
                oc
                  .columns(["whatsapp_connection_id", "message_id"])
                  .doNothing(),
              )
              .returning("id")
              .executeTakeFirst();

        // If insert was skipped due to duplicate, skip all downstream
        // processing - including opening/reopening a case, which must never
        // happen for a message that was already processed.
        if (!insertResult) {
          return { insertResult: null, caseResult: null };
        }

        // Open/reopen the contact's conversation case FIRST, before any
        // other write to conversation_states in this transaction - it reads
        // the projection's CURRENT status to decide "opened" vs
        // "auto_reopened", and that read must see reality, not a row this
        // same transaction is about to create (see message-handlers bug:
        // running the unread-count upsert first could insert a
        // conversation_states row - defaulting to 'resolved' since 061 -
        // for a brand-new contact, making its own first-ever message look
        // like a reopen). Skip entirely for history sync - imported history
        // must never open cases or affect either SLA.
        let caseResult: Awaited<
          ReturnType<typeof openOrReopenCaseForInboundMessage>
        > = null;
        if (!payload.fromMe && !payload.isHistorySync) {
          caseResult = await openOrReopenCaseForInboundMessage(
            trx,
            companyId,
            { id: contact.id, isGroup: isGroupMessage },
            { id: messageId, timestamp: toDbDate(payload.timestamp) },
          );

          // Increment unread count for the incoming message. The case-open
          // step above already upserts a conversation_states row via
          // syncProjection in every reachable path, so this is normally an
          // UPDATE; the INSERT fallback only matters for the unreachable
          // defensive case where case-open found no active case at all -
          // explicitly `status: "open"` there rather than relying on the
          // column default, since we know a live inbound just arrived.
          const updateResult = await trx
            .updateTable("conversation_states")
            .set((eb) => ({
              unread_count: eb("unread_count", "+", 1),
              last_message_at: toDbDate(payload.timestamp),
              last_message_preview: payload.content?.substring(0, 100) || null,
              updated_at: toDbDate(),
            }))
            .where("contact_id", "=", contact.id)
            .executeTakeFirst();

          if (updateResult.numUpdatedRows === BigInt(0)) {
            await trx
              .insertInto("conversation_states")
              .values({
                contact_id: contact.id,
                status: "open",
                unread_count: 1,
                last_message_at: toDbDate(payload.timestamp),
                last_message_preview:
                  payload.content?.substring(0, 100) || null,
              })
              .execute();
          }

          if (autoReplyCandidate) {
            await scheduleFirstContactAutoReply(
              trx,
              contact.id,
              messageId,
              autoReplyCandidate,
            );
          }

          // Note: We don't create notification_history entries for regular
          // messages because the chat UI already shows unread counts via
          // conversation_states and new messages appear in real-time via the
          // message:new realtime event. notification_history is reserved for:
          // assignments, mentions, team, system events
        } else if (payload.fromMe && !payload.isHistorySync) {
          // Live outbound (e.g. relayed from another linked device): stamp
          // durable case membership from whatever is currently active, if
          // anything. Never opens/mutates a case - only inbound does that.
          const activeCaseId = await resolveActiveCaseIdForContact(
            trx,
            contact.id,
          );
          if (activeCaseId) {
            await trx
              .updateTable("messages")
              .set({ case_id: activeCaseId })
              .where("id", "=", messageId)
              .execute();
          }
        }

        if (!payload.isHistorySync) {
          await enqueueMessageDelivery(
            trx,
            companyId,
            connection.id,
            insertResult.id,
            !payload.fromMe,
            caseResult,
          );
          if (caseResult?.unassignedPreviousAssignee) {
            await trx
              .insertInto("audit_logs")
              .values({
                user_id: null,
                action: "contact.unassigned",
                entity_type: "contact",
                entity_id: contact.id,
                details: {
                  previousAssignee: caseResult.unassignedPreviousAssignee,
                  reason: "auto_reopen",
                  caseId: caseResult.case.id,
                },
              })
              .execute();
          }
        }

        await enqueueMessageSearch(
          trx,
          companyId,
          connection.id,
          insertResult.id,
        );
        if (spineAuthority.dualWriteEnabled) {
          await shadowLinkedDeviceLegacyMutation(
            trx,
            companyId,
            contact.id,
            insertResult.id,
          );
        }
        return { insertResult, caseResult };
      });

    // If insert was skipped due to duplicate, skip all downstream processing.
    if (!insertResult) {
      logger.debug(
        { messageId: payload.messageId, companyId },
        "Skipped duplicate message",
      );
      return;
    }

    if (normalizedShadowEvent) {
      try {
        const mismatches = await compareLinkedDeviceMessageShadow(
          tenantDb,
          normalizedShadowEvent,
        );
        if (mismatches.length > 0) {
          logger.warn(
            {
              companyId,
              connectionId,
              eventId: normalizedShadowEvent.eventId,
              mismatches,
            },
            "Linked-device normalization shadow mismatch",
          );
        }
      } catch (error) {
        logger.warn(
          { companyId, connectionId, error: formatError(error) },
          "Linked-device normalization shadow comparison failed",
        );
      }
    }

    const profilePictureRequestJid = getProfilePictureRequestJid({
      isGroupMessage,
      isHistorySync: payload.isHistorySync === true,
      fromMe: payload.fromMe,
      contactJid,
      contactProfilePictureUrl: contact.profile_picture_url,
      senderJid: normalizedSenderJid,
    });
    if (profilePictureRequestJid) {
      requestProfilePicture(
        companyId,
        sessionId ?? connection.id,
        profilePictureRequestJid,
      ).catch((error) => {
        logger.warn(
          { error: formatError(error), jid: profilePictureRequestJid },
          "Failed to request contact profile picture",
        );
      });
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to store message");
    throw error;
  }
}

export { getPushMessagePreview } from "../message-push-preview.js";

/**
 * Maps WhatsApp receipt types to database message_status enum values
 * WhatsApp types: "sender", "delivered", "read", "played", ""
 * DB enum: "pending", "sent", "delivered", "read", "failed"
 */
function mapReceiptStatus(
  waStatus: string,
): "sent" | "delivered" | "read" | null {
  switch (waStatus) {
    case "sender":
    case "sent":
      return "sent";
    case "":
    case "delivered":
      // WhatsApp represents a normal delivery receipt as an empty string.
      return "delivered";
    case "read":
    case "played":
      return "read";
    default:
      // Unknown or empty status - skip update
      return null;
  }
}

/**
 * Handles message receipt/status updates
 */
export async function handleReceiptEvent(event: ReceiptEvent): Promise<void> {
  const { companyId, connectionId, sessionId, payload } = event;

  logger.debug(
    { status: payload.status, messageId: payload.messageId, connectionId },
    "Receipt received",
  );

  // Map WhatsApp receipt type to database enum
  const dbStatus = mapReceiptStatus(payload.status);
  if (!dbStatus) {
    logger.debug({ status: payload.status }, "Skipping unknown receipt status");
    return;
  }

  try {
    const tenantDb = getTenantConnection(companyId);

    // Delivery receipts can arrive out of order. In particular, WhatsApp may
    // emit a "sender" receipt after a "read" receipt when a linked device
    // receives a new message. Only advance the persisted status so read ticks
    // never regress to sent/delivered.
    const eligibleCurrentStatuses: MessageStatus[] =
      dbStatus === "sent"
        ? ["pending", "failed"]
        : dbStatus === "delivered"
          ? ["pending", "sent", "failed"]
          : ["pending", "sent", "delivered", "failed"];

    const applyReceipt = (candidateMessageIds: string[]) =>
      tenantDb
        .updateTable("messages")
        .set({
          status: dbStatus,
          message_id: payload.messageId,
          // A delayed receipt can prove that a cleanup timeout was a false
          // failure. Preserve unrelated metadata (document names, protocol
          // sender identity, etc.) while removing only the stale timeout marker.
          metadata: sql<Record<string, unknown> | null>`CASE
          WHEN metadata->>'error' IN ('delivery_timeout', 'send_outcome_unknown') THEN NULLIF(
            metadata - ARRAY['error', 'error_message', 'failed_at'],
            '{}'::jsonb
          )
          ELSE metadata
        END`,
        })
        .where("message_id", "in", candidateMessageIds)
        .where("whatsapp_connection_id", "=", connectionId)
        .where("from_me", "=", true)
        .where((eb) =>
          eb.or([
            eb("status", "in", eligibleCurrentStatuses),
            eb("status", "is", null),
          ]),
        )
        .returning(["id", "contact_id", "status"])
        .executeTakeFirst();

    // Usually the send confirmation has already replaced the temporary ID.
    // If a fast receipt wins that race, the worker command ledger maps the
    // final WhatsApp ID back to the pending row so the status is not lost.
    let updatedMessage = await applyReceipt([payload.messageId]);
    if (!updatedMessage && sessionId) {
      const outbox = sql.table(`${getSchemaName(companyId)}.nats_outbox`);
      const mapped = await sql<{ pending_message_id: string }>`
        SELECT pc.result->>'pending_message_id' AS pending_message_id
        FROM ${outbox} AS command
        INNER JOIN whatsapp_sessions.processed_commands AS pc
          ON pc.connection_id::text = split_part(command.subject, '.', 4)
         AND pc.command_id::text = command.payload->>'command_id'
        WHERE split_part(command.subject, '.', 3) = ${companyId}
          AND split_part(command.subject, '.', 4) = ${sessionId}
          AND COALESCE(NULLIF(pc.result->'response'->>'ID', ''), pc.result->>'whatsapp_message_id') = ${payload.messageId}
        ORDER BY pc.processed_at DESC
        LIMIT 1
      `.execute(tenantDb);
      const pendingMessageId = mapped.rows[0]?.pending_message_id;
      // Include the final ID again: a concurrent confirmation may have
      // committed while the ledger lookup was running.
      updatedMessage = await applyReceipt(
        pendingMessageId
          ? [payload.messageId, pendingMessageId]
          : [payload.messageId],
      );
    }

    logger.debug(
      {
        status: dbStatus,
        waMessageId: payload.messageId,
        internalId: updatedMessage?.id,
        contactId: updatedMessage?.contact_id,
      },
      "Updated message status",
    );

    // Broadcast to clients with correct message:status format
    // Frontend expects: { conversationId, messageId (internal), status }
    if (updatedMessage?.id && updatedMessage?.contact_id) {
      await broadcastToContactViewers(
        companyId,
        updatedMessage.contact_id,
        "message:status",
        {
          conversationId: updatedMessage.contact_id,
          messageId: updatedMessage.id,
          status: dbStatus,
        },
        { connectionId },
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle receipt");
    throw error;
  }
}

/**
 * Handles send confirmation events
 * Updates a message from pending status with its real WhatsApp message ID
 */
export async function handleSendConfirmationEvent(
  event: SendConfirmationEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.debug(
    {
      pendingMessageId: payload.pendingMessageId,
      messageId: payload.messageId,
      connectionId,
    },
    "Send confirmation received",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    // Always replace the temporary WhatsApp ID, but preserve a higher status
    // if an unusually fast delivery/read receipt was processed first.
    const updatedMessage = await tenantDb
      .updateTable("messages")
      .set({
        message_id: payload.messageId,
        status: sql<MessageStatus>`CASE
          WHEN status IN ('delivered', 'read') THEN status
          ELSE 'sent'::message_status
        END`,
        // The worker result is authoritative: WhatsApp accepted the send.
        // Clear a timeout written while its confirmation was waiting behind
        // other events, without discarding unrelated message metadata.
        metadata: sql<Record<string, unknown> | null>`CASE
          WHEN metadata->>'error' IN ('delivery_timeout', 'send_outcome_unknown') THEN NULLIF(
            metadata - ARRAY['error', 'error_message', 'failed_at'],
            '{}'::jsonb
          )
          ELSE metadata
        END`,
      })
      .where("message_id", "in", [payload.pendingMessageId, payload.messageId])
      .where("whatsapp_connection_id", "=", connectionId)
      .returning(["id", "contact_id", "status"])
      .executeTakeFirst();

    logger.debug(
      {
        pendingMessageId: payload.pendingMessageId,
        messageId: payload.messageId,
        internalId: updatedMessage?.id,
        contactId: updatedMessage?.contact_id,
      },
      "Updated message with real ID",
    );

    // Broadcast to clients with the correct payload format
    // Frontend expects: { conversationId, messageId (internal), status }
    if (updatedMessage?.id && updatedMessage?.contact_id) {
      await broadcastToContactViewers(
        companyId,
        updatedMessage.contact_id,
        "message:status",
        {
          conversationId: updatedMessage.contact_id,
          messageId: updatedMessage.id,
          status: updatedMessage.status ?? "sent",
        },
        { connectionId },
      );
    }
  } catch (error) {
    logger.error(formatError(error), "Failed to handle send confirmation");
    throw error;
  }
}

/**
 * Handles send failed events
 * Updates a message to failed status when max delivery attempts exceeded
 */
export async function handleSendFailedEvent(
  event: SendFailedEvent,
): Promise<void> {
  const { companyId, connectionId, payload } = event;

  logger.warn(
    {
      pendingMessageId: payload.pendingMessageId,
      reason: payload.reason,
      connectionId,
    },
    payload.outcome === "unknown"
      ? "Message send outcome unconfirmed"
      : "Message send failed after max retries",
  );

  try {
    const tenantDb = getTenantConnection(companyId);

    if (payload.outcome === "unknown") {
      const metadata = {
        error: "send_outcome_unknown",
        error_message: payload.reason,
      };
      const message = await tenantDb
        .updateTable("messages")
        .set({
          ...(payload.messageId ? { message_id: payload.messageId } : {}),
          status: "pending",
          metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb`,
        })
        .where("message_id", "=", payload.pendingMessageId)
        .where("whatsapp_connection_id", "=", connectionId)
        .where((eb) =>
          eb.or([
            eb("status", "=", "pending"),
            eb.and([
              eb("status", "=", "failed"),
              sql<boolean>`metadata->>'error' = 'delivery_timeout'`,
            ]),
          ]),
        )
        .returning(["id", "contact_id"])
        .executeTakeFirst();
      if (message?.contact_id) {
        await broadcastToContactViewers(
          companyId,
          message.contact_id,
          "message:status",
          {
            conversationId: message.contact_id,
            messageId: message.id,
            status: "pending",
            metadata: { error: metadata.error, errorMessage: payload.reason },
          },
          { connectionId },
        );
      }
      return;
    }

    // A late failure must not overwrite a confirmed delivery/read status.
    const updatedMessage = await tenantDb
      .updateTable("messages")
      .set({ status: "failed" })
      .where("message_id", "=", payload.pendingMessageId)
      .where("whatsapp_connection_id", "=", connectionId)
      .where("status", "=", "pending")
      .returning(["id", "contact_id"])
      .executeTakeFirst();

    if (!updatedMessage) {
      logger.warn(
        { pendingMessageId: payload.pendingMessageId },
        "Message not found for send_failed event",
      );
      return;
    }

    logger.debug(
      {
        pendingMessageId: payload.pendingMessageId,
        internalId: updatedMessage.id,
        contactId: updatedMessage.contact_id,
      },
      "Marked message as failed",
    );

    // Broadcast message:failed event to clients
    // Frontend can show retry option
    await broadcastToContactViewers(
      companyId,
      updatedMessage.contact_id,
      "message:failed",
      {
        conversationId: updatedMessage.contact_id,
        messageId: updatedMessage.id,
        reason: payload.reason,
      },
      { connectionId },
    );

    // Also broadcast a toast notification for user visibility
    await broadcastToCompany(
      companyId,
      "notification:toast",
      {
        type: "error",
        title: "Message failed",
        message: `Failed to send message: ${payload.reason}`,
      },
      connectionId,
    );
  } catch (error) {
    logger.error(formatError(error), "Failed to handle send_failed event");
    throw error;
  }
}
