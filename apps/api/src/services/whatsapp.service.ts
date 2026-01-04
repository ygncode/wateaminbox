import type { Kysely } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";
import {
  publishSpawnCommand,
  publishKillCommand,
  publishSendMessage,
} from "../lib/nats.js";
import { env } from "../lib/env.js";
import { db } from "@whatsapp-web/database";

// Default max connections if not specified in company settings
const DEFAULT_MAX_CONNECTIONS = 5;

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
  constructor(connectionId: string) {
    super(`WhatsApp connection ${connectionId} not found`);
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

export class MaxConnectionsExceededError extends Error {
  currentCount: number;
  maxAllowed: number;

  constructor(currentCount: number, maxAllowed: number) {
    super(
      `Maximum WhatsApp connections exceeded. Current: ${currentCount}, Max allowed: ${maxAllowed}`,
    );
    this.name = "MaxConnectionsExceededError";
    this.currentCount = currentCount;
    this.maxAllowed = maxAllowed;
  }
}

/**
 * Gets the maximum allowed WhatsApp connections for a company
 */
async function getMaxConnections(companyId: string): Promise<number> {
  const company = await db
    .selectFrom("companies" as any)
    .select(["max_whatsapp_connections"])
    .where("id", "=", companyId)
    .executeTakeFirst();

  return company?.max_whatsapp_connections ?? DEFAULT_MAX_CONNECTIONS;
}

/**
 * Lists all WhatsApp connections for a company
 */
export async function listConnections(
  tenantDb: Kysely<TenantDatabase>,
): Promise<WhatsAppConnection[]> {
  const connections = await tenantDb
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
    .orderBy("created_at", "desc")
    .execute();

  return connections.map((conn) => ({
    id: conn.id,
    phoneNumber: conn.phone_number,
    jid: conn.jid,
    status: conn.status,
    connectedBy: conn.connected_by,
    connectedAt: conn.connected_at,
    lastSyncAt: conn.last_sync_at,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  }));
}

/**
 * Gets a specific WhatsApp connection by ID
 */
export async function getConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string,
): Promise<WhatsAppConnection> {
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
    .where("id", "=", connectionId)
    .executeTakeFirst();

  if (!connection) {
    throw new ConnectionNotFoundError(connectionId);
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

/**
 * Spawns a new WhatsApp connection for a company
 * Creates a pending connection record and publishes spawn command to NATS
 * Supports multiple connections per company up to max_whatsapp_connections limit
 */
export async function spawnConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  userId: string,
): Promise<{ connectionId: string; wsUrl: string }> {
  // Get max connections limit for this company
  const maxConnections = await getMaxConnections(companyId);

  // Count current active connections (connected or pending)
  const activeConnections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(({ fn }) => [fn.count<number>("id").as("count")])
    .where("status", "in", ["connected", "pending"])
    .executeTakeFirst();

  const currentCount = Number(activeConnections?.count ?? 0);

  // Check if we've reached the limit
  if (currentCount >= maxConnections) {
    throw new MaxConnectionsExceededError(currentCount, maxConnections);
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

  // Publish spawn command to NATS with connectionId
  await publishSpawnCommand(companyId, connectionId, env.DATABASE_URL);

  return {
    connectionId,
    wsUrl: `/ws?company=${companyId}&connection=${connectionId}`,
  };
}

/**
 * Kills/disconnects a specific WhatsApp connection
 */
export async function killConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  connectionId: string,
): Promise<void> {
  // Get connection to verify it exists and is active
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("id", "=", connectionId)
    .where("status", "in", ["connected", "pending"])
    .executeTakeFirst();

  if (!connection) {
    throw new ConnectionNotFoundError(connectionId);
  }

  // Update status to disconnected
  await tenantDb
    .updateTable("whatsapp_connections")
    .set({
      status: "disconnected",
      updated_at: new Date(),
    })
    .where("id", "=", connectionId)
    .execute();

  // Publish kill command to NATS with connectionId
  await publishKillCommand(companyId, connectionId);
}

/**
 * Gets the current connection status for a specific connection
 */
export async function getConnectionStatus(
  tenantDb: Kysely<TenantDatabase>,
  connectionId?: string,
): Promise<ConnectionStatus> {
  let query = tenantDb
    .selectFrom("whatsapp_connections")
    .select([
      "id",
      "phone_number",
      "jid",
      "status",
      "connected_at",
      "last_sync_at",
    ]);

  if (connectionId) {
    query = query.where("id", "=", connectionId);
  } else {
    // For backward compatibility, get the most recent connection
    query = query.orderBy("created_at", "desc").limit(1);
  }

  const connection = await query.executeTakeFirst();

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

  // Publish send command to NATS with connectionId
  await publishSendMessage(
    companyId,
    connection.id,
    input.jid,
    input.content,
    input.messageType,
    userId,
    input.mediaUrl,
  );

  return { messageId };
}

/**
 * Updates connection status (called from message handler)
 */
export async function updateConnectionStatus(
  tenantDb: Kysely<TenantDatabase>,
  status: "connected" | "disconnected" | "banned" | "pending",
  connectionId?: string,
  phoneNumber?: string,
  jid?: string,
): Promise<void> {
  let connection;

  if (connectionId) {
    connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id"])
      .where("id", "=", connectionId)
      .executeTakeFirst();
  } else {
    // For backward compatibility, get any pending connection
    connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id"])
      .where("status", "in", ["connected", "pending"])
      .executeTakeFirst();
  }

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
 * Updates last sync timestamp for a specific connection
 */
export async function updateLastSync(
  tenantDb: Kysely<TenantDatabase>,
  connectionId?: string,
): Promise<void> {
  let query = tenantDb.updateTable("whatsapp_connections").set({
    last_sync_at: new Date(),
    updated_at: new Date(),
  });

  if (connectionId) {
    query = query.where("id", "=", connectionId);
  } else {
    query = query.where("status", "=", "connected");
  }

  await query.execute();
}

/**
 * Gets the first active connection (for backward compatibility)
 */
export async function getActiveConnection(
  tenantDb: Kysely<TenantDatabase>,
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

/**
 * Gets all active connections for a company
 */
export async function getActiveConnections(
  tenantDb: Kysely<TenantDatabase>,
): Promise<WhatsAppConnection[]> {
  const connections = await tenantDb
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
    .orderBy("created_at", "asc")
    .execute();

  return connections.map((conn) => ({
    id: conn.id,
    phoneNumber: conn.phone_number,
    jid: conn.jid,
    status: conn.status,
    connectedBy: conn.connected_by,
    connectedAt: conn.connected_at,
    lastSyncAt: conn.last_sync_at,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  }));
}

/**
 * Gets connection limits info for a company
 */
export async function getConnectionLimits(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
): Promise<{ current: number; max: number; available: number }> {
  const maxConnections = await getMaxConnections(companyId);

  const activeConnections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(({ fn }) => [fn.count<number>("id").as("count")])
    .where("status", "in", ["connected", "pending"])
    .executeTakeFirst();

  const current = Number(activeConnections?.count ?? 0);

  return {
    current,
    max: maxConnections,
    available: Math.max(0, maxConnections - current),
  };
}
