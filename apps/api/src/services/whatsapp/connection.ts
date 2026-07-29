/**
 * WhatsApp Connection Management Module
 *
 * Handles listing, creating, and managing WhatsApp connections.
 * Supports multiple connections per company with configurable limits.
 */

import { db, type WhatsAppConnectionStatus } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  ConnectionNotFoundError,
  MaxConnectionsExceededError,
} from "../../lib/errors.js";
import {
  enqueueConnectionCommand,
  enqueueSessionCommand,
} from "../command-outbox.service.js";
import type { TenantDatabase } from "../tenant.service.js";
import {
  createConnectionSession,
  getActiveSessionId,
  updateSessionStatus,
} from "./session.js";

export async function archiveConnectionWithUnlink(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  connectionId: string,
  enqueueKill: typeof enqueueConnectionCommand = enqueueConnectionCommand,
): Promise<boolean> {
  const connection = await trx
    .selectFrom("whatsapp_connections")
    .select(["id", "status", "archived_at"])
    .where("id", "=", connectionId)
    .forUpdate()
    .executeTakeFirst();
  if (!connection) return false;
  if (connection.archived_at) return false;

  const sessionId = await getActiveSessionId(trx, connectionId);
  await enqueueKill(trx, companyId, connectionId, (publisher) =>
    publisher.kill("connection archived and unlinked", true),
  );
  const now = toDbDate();
  await trx
    .updateTable("whatsapp_connections")
    .set({
      status: "disconnected",
      qr_code: null,
      qr_expires_at: null,
      archived_at: now,
      updated_at: now,
    })
    .where("id", "=", connectionId)
    .execute();
  await updateSessionStatus(
    trx,
    sessionId,
    "ended",
    "connection archived and unlinked",
  );
  return true;
}

/** @deprecated Use archiveConnectionWithUnlink. */
export const deleteConnectionWithKill = archiveConnectionWithUnlink;

/**
 * Permanently delete a previously archived account and all inbox data owned by
 * it. This is deliberately separate from archive/unlink.
 */
export async function purgeArchivedConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string,
): Promise<{ contactIds: string[]; messageIds: string[] }> {
  return tenantDb.transaction().execute(async (trx) => {
    const connection = await trx
      .selectFrom("whatsapp_connections")
      .select(["id", "archived_at"])
      .where("id", "=", connectionId)
      .forUpdate()
      .executeTakeFirst();
    if (!connection) throw new ConnectionNotFoundError(connectionId);
    if (!connection.archived_at) {
      throw new Error("Connection must be archived before permanent deletion");
    }

    const contactIds = trx
      .selectFrom("contacts")
      .select("id")
      .where("whatsapp_connection_id", "=", connectionId);
    const messageIds = trx
      .selectFrom("messages")
      .select("id")
      .where("whatsapp_connection_id", "=", connectionId);
    const groupIds = trx
      .selectFrom("groups")
      .select("id")
      .where("contact_id", "in", contactIds);
    const contactRows = await contactIds.execute();
    const messageRows = await messageIds.execute();

    await trx
      .deleteFrom("message_reactions")
      .where("message_id", "in", messageIds)
      .execute();
    await trx
      .deleteFrom("group_participants")
      .where("group_id", "in", groupIds)
      .execute();
    await trx.deleteFrom("groups").where("id", "in", groupIds).execute();
    await trx
      .deleteFrom("contact_tags")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("contact_assignments")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("contact_notes_private")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("contact_notes_shared")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("conversation_states")
      .where("contact_id", "in", contactIds)
      .execute();
    await trx
      .deleteFrom("messages")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("status_updates")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("contacts")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("whatsapp_connection_sessions")
      .where("whatsapp_connection_id", "=", connectionId)
      .execute();
    await trx
      .deleteFrom("whatsapp_connections")
      .where("id", "=", connectionId)
      .execute();
    return {
      contactIds: contactRows.map((row) => row.id),
      messageIds: messageRows.map((row) => row.id),
    };
  });
}

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
  archivedAt: Date | null;
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
  archived_at: Date | null;
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
    archivedAt: conn.archived_at,
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
      qr_code: null,
      qr_expires_at: null,
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
      "archived_at",
      "created_at",
      "updated_at",
    ])
    .where("archived_at", "is", null)
    .orderBy("created_at", "desc")
    .execute();

  return connections.map(mapConnectionRow);
}

export async function listArchivedConnections(
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
      "qr_code",
      "qr_expires_at",
      "archived_at",
      "created_at",
      "updated_at",
    ])
    .where("archived_at", "is not", null)
    .orderBy("archived_at", "desc")
    .execute();
  return connections.map(mapConnectionRow);
}

export async function relinkArchivedConnection(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  connectionId: string,
  userId: string,
): Promise<void> {
  await tenantDb.transaction().execute(async (trx) => {
    const connection = await trx
      .selectFrom("whatsapp_connections")
      .select(["id", "phone_number", "archived_at"])
      .where("id", "=", connectionId)
      .forUpdate()
      .executeTakeFirst();
    if (!connection) throw new ConnectionNotFoundError(connectionId);
    if (!connection.archived_at) {
      throw new Error("Only archived connections can be linked again");
    }

    const sessionId = await createConnectionSession(
      trx,
      connectionId,
      userId,
      connection.phone_number,
    );
    await trx
      .updateTable("whatsapp_connections")
      .set({
        status: "pending",
        archived_at: null,
        qr_code: null,
        qr_expires_at: null,
        updated_at: toDbDate(),
      })
      .where("id", "=", connectionId)
      .execute();
    await enqueueSessionCommand(trx, companyId, sessionId, (publisher) =>
      publisher.spawn(),
    );
  });
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
      "archived_at",
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

  // Create a new pending connection record. A company-scoped transaction
  // advisory lock serializes the count+insert sequence across API replicas.
  const connectionId = crypto.randomUUID();

  await tenantDb.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${companyId}, 0))`.execute(
      trx,
    );

    const activeConnections = await trx
      .selectFrom("whatsapp_connections")
      .select(({ fn }) => [fn.count<number>("id").as("count")])
      .where("status", "in", ["connected", "pending"])
      .executeTakeFirst();
    const currentCount = Number(activeConnections?.count ?? 0);
    if (currentCount >= maxConnections) {
      throw new MaxConnectionsExceededError(currentCount, maxConnections);
    }

    await trx
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

    const sessionId = await createConnectionSession(trx, connectionId, userId);
    await enqueueSessionCommand(trx, companyId, sessionId, (publisher) =>
      publisher.spawn(),
    );
  });

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

  await tenantDb.transaction().execute(async (trx) => {
    const sessionId = await getActiveSessionId(trx, connectionId);
    await trx
      .updateTable("whatsapp_connections")
      .set({
        status: "disconnected",
        qr_code: null,
        qr_expires_at: null,
        updated_at: toDbDate(),
      })
      .where("id", "=", connectionId)
      .execute();

    await updateSessionStatus(trx, sessionId, "disconnected");
    await enqueueSessionCommand(trx, companyId, sessionId, (publisher) =>
      publisher.kill(),
    );
  });
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
      "archived_at",
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
      "archived_at",
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
