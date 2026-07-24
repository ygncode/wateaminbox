/**
 * WhatsApp Messaging Module
 *
 * Handles sending messages via WhatsApp connections.
 */

import { toDbDate } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import {
  ConnectionNotFoundError,
  InvalidConnectionStateError,
} from "../../lib/errors.js";
import {
  buildCommandSubject,
  buildSendMessageCommand,
} from "../../lib/nats/index.js";
import { enqueueCommand } from "../command-outbox.service.js";
import type { TenantDatabase } from "../tenant.service.js";

// Types
export interface SendMessageInput {
  jid: string;
  content: string;
  messageType: "text" | "image" | "video" | "audio" | "document" | "sticker";
  mediaUrl?: string;
}

/**
 * Sends a message via a specific WhatsApp connection
 */
export async function sendMessage(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  userId: string,
  input: SendMessageInput,
  connectionId?: string,
): Promise<{ messageId: string }> {
  // Get the connection to use
  let connection;

  if (connectionId) {
    // Use specific connection
    connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "status"])
      .where("id", "=", connectionId)
      .where("status", "=", "connected")
      .executeTakeFirst();

    if (!connection) {
      throw new ConnectionNotFoundError(connectionId);
    }
  } else {
    // For backward compatibility, use any connected connection
    connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "status"])
      .where("status", "=", "connected")
      .executeTakeFirst();

    if (!connection) {
      throw new InvalidConnectionStateError("disconnected", "connected");
    }
  }

  const messageId = crypto.randomUUID();
  const pendingMessageId = `pending_${messageId}`;
  const sendCommand = await buildSendMessageCommand(
    connection.id,
    input.jid,
    input.content,
    input.messageType,
    userId,
    pendingMessageId,
    input.mediaUrl,
  );

  await tenantDb.transaction().execute(async (trx) => {
    let contact = await trx
      .selectFrom("contacts")
      .select(["id"])
      .where("jid", "=", input.jid)
      .where("whatsapp_connection_id", "=", connection.id)
      .executeTakeFirst();

    if (!contact) {
      const contactId = crypto.randomUUID();
      await trx
        .insertInto("contacts")
        .values({
          id: contactId,
          whatsapp_connection_id: connection.id,
          jid: input.jid,
          is_group: input.jid.includes("@g.us"),
          created_at: toDbDate(),
          updated_at: toDbDate(),
        })
        .execute();
      contact = { id: contactId };
    }

    await trx
      .insertInto("messages")
      .values({
        id: messageId,
        whatsapp_connection_id: connection.id,
        contact_id: contact.id,
        message_id: pendingMessageId,
        from_me: true,
        sender_jid: null,
        message_type: input.messageType,
        content: input.content,
        media_url: input.mediaUrl || null,
        is_forwarded: false,
        is_starred: false,
        deleted_by_sender: false,
        sent_by_user_id: userId,
        status: "pending",
        timestamp: toDbDate(),
        created_at: toDbDate(),
      })
      .execute();

    await enqueueCommand(
      trx,
      buildCommandSubject(companyId, connection.id),
      sendCommand,
    );
  });

  return { messageId };
}
