/**
 * WhatsApp Status Tracking Module
 *
 * Handles connection status queries and updates.
 */

import type { WhatsAppConnectionStatus } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import type { TenantDatabase } from "../tenant.service.js";

// Types
export interface ConnectionStatus {
  status: WhatsAppConnectionStatus | "not_found";
  phoneNumber?: string;
  jid?: string;
  connectedAt?: Date;
  lastSyncAt?: Date;
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
 * Updates connection status (called from message handler)
 */
export async function updateConnectionStatus(
  tenantDb: Kysely<TenantDatabase>,
  status: WhatsAppConnectionStatus,
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
    updated_at: toDbDate(),
  };

  if (status === "connected") {
    updateData.connected_at = toDbDate();
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
    updated_at: toDbDate(),
  });

  if (connectionId) {
    query = query.where("id", "=", connectionId);
  } else {
    query = query.where("status", "=", "connected");
  }

  await query.execute();
}
