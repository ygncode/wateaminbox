/**
 * WhatsApp Connection Management Module
 *
 * Handles listing, creating, and managing WhatsApp connections.
 * Supports multiple connections per company with configurable limits.
 */

import { db, type WhatsAppConnectionStatus } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import { env } from "../../lib/env.js";
import {
  ConnectionNotFoundError,
  MaxConnectionsExceededError,
} from "../../lib/errors.js";
import {
  publishKillCommand,
  publishSpawnCommand,
} from "../../lib/nats/index.js";
import type { TenantDatabase } from "../tenant.service.js";

// Default max connections if not specified in company settings
const DEFAULT_MAX_CONNECTIONS = 5;

// Types
export interface WhatsAppConnection {
  id: string;
  name: string | null;
  phoneNumber: string | null;
  jid: string | null;
  status: WhatsAppConnectionStatus;
  connectedBy: string | null;
  connectedAt: Date | null;
  lastSyncAt: Date | null;
  qrCode: string | null;
  qrExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps database row to WhatsAppConnection interface
 */
function mapConnectionRow(conn: {
  id: string;
  name: string | null;
  phone_number: string | null;
  jid: string | null;
  status: WhatsAppConnectionStatus;
  connected_by: string | null;
  connected_at: Date | null;
  last_sync_at: Date | null;
  qr_code?: string | null;
  qr_expires_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}): WhatsAppConnection {
  return {
    id: conn.id,
    name: conn.name,
    phoneNumber: conn.phone_number,
    jid: conn.jid,
    status: conn.status,
    connectedBy: conn.connected_by,
    connectedAt: conn.connected_at,
    lastSyncAt: conn.last_sync_at,
    qrCode: conn.qr_code ?? null,
    qrExpiresAt: conn.qr_expires_at ?? null,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  };
}

/**
 * Gets the maximum allowed WhatsApp connections for a company
 */
export async function getMaxConnections(companyId: string): Promise<number> {
  const company = await db
    .selectFrom("companies")
    .select(["max_whatsapp_connections"])
    .where("id", "=", companyId)
    .executeTakeFirst();

  return company?.max_whatsapp_connections ?? DEFAULT_MAX_CONNECTIONS;
}

// Pending connection timeout (2 minutes) - if pending longer, mark as disconnected
const PENDING_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Lists all WhatsApp connections for a company
 * Also cleans up stale pending connections (older than 2 minutes)
 */
export async function listConnections(
  tenantDb: Kysely<TenantDatabase>,
): Promise<WhatsAppConnection[]> {
  // Clean up stale pending connections (pending for more than 2 minutes)
  const staleThreshold = new Date(Date.now() - PENDING_TIMEOUT_MS);
  await tenantDb
    .updateTable("whatsapp_connections")
    .set({
      status: "disconnected",
      updated_at: toDbDate(),
    })
    .where("status", "=", "pending")
    .where("updated_at", "<", staleThreshold)
    .execute();

  const connections = await tenantDb
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
      "qr_code",
      "qr_expires_at",
      "created_at",
      "updated_at",
    ])
    .orderBy("created_at", "desc")
    .execute();

  return connections.map(mapConnectionRow);
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
      "name",
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

  return mapConnectionRow(connection);
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
  name?: string,
): Promise<{ connectionId: string }> {
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
      name: name || null,
      status: "pending",
      connected_by: userId,
      created_at: toDbDate(),
      updated_at: toDbDate(),
    })
    .execute();

  // Publish spawn command to NATS with connectionId
  await publishSpawnCommand(companyId, connectionId, env.DATABASE_URL);

  return { connectionId };
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
      updated_at: toDbDate(),
    })
    .where("id", "=", connectionId)
    .execute();

  // Publish kill command to NATS with connectionId
  await publishKillCommand(companyId, connectionId);
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
      "name",
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

  return mapConnectionRow(connection);
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
      "name",
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

  return connections.map(mapConnectionRow);
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
