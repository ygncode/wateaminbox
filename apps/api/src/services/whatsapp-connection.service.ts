import type { Kysely } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";
import {
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../lib/errors.js";

export interface WhatsAppConnection {
  id: string;
  status: string;
}

async function resolveWhatsAppConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId?: string,
): Promise<WhatsAppConnection> {
  if (connectionId) {
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "status"])
      .where("id", "=", connectionId)
      .where("archived_at", "is", null)
      .executeTakeFirst();

    if (!connection) {
      throw new NotFoundError("WhatsApp connection");
    }
    return connection;
  }

  const connections = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("archived_at", "is", null)
    .orderBy("created_at", "asc")
    .limit(2)
    .execute();

  if (connections.length === 0) {
    throw new ServiceUnavailableError(
      "No WhatsApp account is available. Please connect one first.",
    );
  }
  if (connections.length > 1) {
    throw new ValidationError(
      "connectionId is required when multiple WhatsApp accounts are available.",
    );
  }
  return connections[0]!;
}

export async function getWhatsAppConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId?: string,
): Promise<WhatsAppConnection> {
  return resolveWhatsAppConnection(tenantDb, connectionId);
}

/**
 * Get the active (connected) WhatsApp connection for a tenant.
 *
 * @throws {ServiceUnavailableError} When no connected WhatsApp account exists
 * @returns The active WhatsApp connection with id and status
 */
export async function getActiveWhatsAppConnection(
  tenantDb: Kysely<TenantDatabase>,
  connectionId?: string,
): Promise<WhatsAppConnection> {
  const connection = connectionId
    ? await resolveWhatsAppConnection(tenantDb, connectionId)
    : await tenantDb
        .selectFrom("whatsapp_connections")
        .select(["id", "status"])
        .where("status", "=", "connected")
        .where("archived_at", "is", null)
        .orderBy("created_at", "asc")
        .executeTakeFirst();

  if (!connection || connection.status !== "connected") {
    throw new ServiceUnavailableError(
      "The selected WhatsApp account is not connected.",
    );
  }

  return connection;
}
