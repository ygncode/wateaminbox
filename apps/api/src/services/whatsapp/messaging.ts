/**
 * WhatsApp Messaging Module
 *
 * Handles sending messages via WhatsApp connections.
 */

import { toDbDate } from "@whatsapp-web/shared";
import type { Kysely } from "kysely";
import {
  ConnectionNotFoundError,
  InvalidConnectionStateError,
} from "../../lib/errors.js";
import { publishSendMessage } from "../../lib/nats/index.js";
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

  // Create a pending message record
  const messageId = crypto.randomUUID();

  // Get or create contact for this JID
  let contact = await tenantDb
    .selectFrom("contacts")
    .select(["id"])
    .where("jid", "=", input.jid)
    .executeTakeFirst();

  if (!contact) {
    const contactId = crypto.randomUUID();
    await tenantDb
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connection.id,
        jid: input.jid,
        is_group: input.jid.includes("@g.us"),
        created_at: new Date(),
        updated_at: toDbDate(),
      })
      .execute();
    contact = { id: contactId };
  }

  // Create the message record
  await tenantDb
    .insertInto("messages")
    .values({
      id: messageId,
      whatsapp_connection_id: connection.id,
      contact_id: contact.id,
      from_me: true,
      sender_jid: null, // Will be filled by worker
      message_type: input.messageType,
      content: input.content,
      media_url: input.mediaUrl || null,
      is_forwarded: false,
      is_starred: false,
      deleted_by_sender: false,
      sent_by_user_id: userId,
      timestamp: toDbDate(),
      created_at: toDbDate(),
    })
    .execute();

  // Publish send command to NATS with connectionId
  await publishSendMessage(
    companyId,
    connection.id,
    input.jid,
    input.content,
    input.messageType,
    userId,
    messageId, // Pass the pending message ID so worker can update correct record
    input.mediaUrl,
  );

  return { messageId };
}
