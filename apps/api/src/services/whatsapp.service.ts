import type { Kysely } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";
import {
  publishSpawnCommand,
  publishKillCommand,
  publishSendMessage,
} from "../lib/nats.js";
import { env } from "../lib/env.js";

// Types
export interface WhatsAppConnection {
  id: string;
  phoneNumber: string | null;
  jid: string | null;
  status: "connected" | "disconnected" | "banned" | "pending";
  connectedBy: string | null;
  connectedAt: Date | null;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionStatus {
  status: "connected" | "disconnected" | "banned" | "pending" | "not_found";
  phoneNumber?: string;
  jid?: string;
  connectedAt?: Date;
  lastSyncAt?: Date;
}

export interface SendMessageInput {
  jid: string;
  content: string;
  messageType: "text" | "image" | "video" | "audio" | "document";
  mediaUrl?: string;
}

// Error classes
export class ConnectionNotFoundError extends Error {
  constructor(companyId: string) {
    super(`WhatsApp connection not found for company ${companyId}`);
    this.name = "ConnectionNotFoundError";
  }
}

export class ConnectionAlreadyExistsError extends Error {
  constructor(companyId: string) {
    super(`WhatsApp connection already exists for company ${companyId}`);
    this.name = "ConnectionAlreadyExistsError";
  }
}

export class InvalidConnectionStateError extends Error {
  constructor(currentState: string, requiredState: string) {
    super(`Connection is ${currentState}, but must be ${requiredState}`);
    this.name = "InvalidConnectionStateError";
  }
}

/**
 * Spawns a new WhatsApp connection for a company
 * Creates a pending connection record and publishes spawn command to NATS
 */
export async function spawnConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  userId: string
): Promise<{ connectionId: string; wsUrl: string }> {
  // Check if there's already an active connection
  const existing = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("status", "in", ["connected", "pending"])
    .executeTakeFirst();

  if (existing) {
    if (existing.status === "connected") {
      throw new ConnectionAlreadyExistsError(companyId);
    }
    // If pending, republish spawn command and return existing connection info
    // This handles retries when the previous spawn didn't complete
    await publishSpawnCommand(companyId, env.DATABASE_URL);
    return {
      connectionId: existing.id,
      wsUrl: `/ws?company=${companyId}`,
    };
  }

  // Create a new pending connection record
  const connectionId = crypto.randomUUID();

  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      status: "pending",
      connected_by: userId,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();

  // Publish spawn command to NATS
  await publishSpawnCommand(companyId, env.DATABASE_URL);

  return {
    connectionId,
    wsUrl: `/ws?company=${companyId}`,
  };
}

/**
 * Kills/disconnects a WhatsApp connection for a company
 */
export async function killConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string
): Promise<void> {
  // Get current connection
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("status", "in", ["connected", "pending"])
    .executeTakeFirst();

  if (!connection) {
    throw new ConnectionNotFoundError(companyId);
  }

  // Update status to disconnected
  await tenantDb
    .updateTable("whatsapp_connections")
    .set({
      status: "disconnected",
      updated_at: new Date(),
    })
    .where("id", "=", connection.id)
    .execute();

  // Publish kill command to NATS
  await publishKillCommand(companyId);
}

/**
 * Gets the current connection status for a company
 */
export async function getConnectionStatus(
  tenantDb: Kysely<TenantDatabase>
): Promise<ConnectionStatus> {
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "phone_number",
      "jid",
      "status",
      "connected_at",
      "last_sync_at",
    ])
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!connection) {
    return { status: "not_found" };
  }

  return {
    status: connection.status,
    phoneNumber: connection.phone_number || undefined,
    jid: connection.jid || undefined,
    connectedAt: connection.connected_at || undefined,
    lastSyncAt: connection.last_sync_at || undefined,
  };
}

/**
 * Sends a message via WhatsApp
 */
export async function sendMessage(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  userId: string,
  input: SendMessageInput
): Promise<{ messageId: string }> {
  // Verify connection is active
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  if (!connection) {
    throw new InvalidConnectionStateError("disconnected", "connected");
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
        updated_at: new Date(),
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
      timestamp: new Date(),
      created_at: new Date(),
    })
    .execute();

  // Publish send command to NATS
  await publishSendMessage(
    companyId,
    input.jid,
    input.content,
    input.messageType,
    userId,
    input.mediaUrl
  );

  return { messageId };
}

/**
 * Updates connection status (called from message handler)
 */
export async function updateConnectionStatus(
  tenantDb: Kysely<TenantDatabase>,
  status: "connected" | "disconnected" | "banned" | "pending",
  phoneNumber?: string,
  jid?: string
): Promise<void> {
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id"])
    .where("status", "in", ["connected", "pending"])
    .executeTakeFirst();

  if (!connection) {
    // No connection to update
    return;
  }

  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date(),
  };

  if (status === "connected") {
    updateData.connected_at = new Date();
  }

  if (phoneNumber) {
    updateData.phone_number = phoneNumber;
  }

  if (jid) {
    updateData.jid = jid;
  }

  await tenantDb
    .updateTable("whatsapp_connections")
    .set(updateData)
    .where("id", "=", connection.id)
    .execute();
}

/**
 * Updates last sync timestamp
 */
export async function updateLastSync(
  tenantDb: Kysely<TenantDatabase>
): Promise<void> {
  await tenantDb
    .updateTable("whatsapp_connections")
    .set({
      last_sync_at: new Date(),
      updated_at: new Date(),
    })
    .where("status", "=", "connected")
    .execute();
}

/**
 * Gets all active connections (for message handler startup)
 */
export async function getActiveConnection(
  tenantDb: Kysely<TenantDatabase>
): Promise<WhatsAppConnection | null> {
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "phone_number",
      "jid",
      "status",
      "connected_by",
      "connected_at",
      "last_sync_at",
      "created_at",
      "updated_at",
    ])
    .where("status", "=", "connected")
    .executeTakeFirst();

  if (!connection) {
    return null;
  }

  return {
    id: connection.id,
    phoneNumber: connection.phone_number,
    jid: connection.jid,
    status: connection.status,
    connectedBy: connection.connected_by,
    connectedAt: connection.connected_at,
    lastSyncAt: connection.last_sync_at,
    createdAt: connection.created_at,
    updatedAt: connection.updated_at,
  };
}
