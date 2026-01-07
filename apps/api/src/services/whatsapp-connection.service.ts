import type { Kysely } from "kysely";
import type { TenantDatabase } from "./tenant.service.js";
import { ServiceUnavailableError } from "../lib/errors.js";

export interface WhatsAppConnection {
  id: string;
  status: string;
}

/**
 * Get the active (connected) WhatsApp connection for a tenant.
 *
 * @throws {ServiceUnavailableError} When no connected WhatsApp account exists
 * @returns The active WhatsApp connection with id and status
 */
export async function getActiveWhatsAppConnection(
  tenantDb: Kysely<TenantDatabase>
): Promise<WhatsAppConnection> {
  const connection = await tenantDb
    .selectFrom("whatsapp_connections")
    .select(["id", "status"])
    .where("status", "=", "connected")
    .executeTakeFirst();

  if (!connection) {
    throw new ServiceUnavailableError(
      "WhatsApp is not connected. Please connect first."
    );
  }

  return connection;
}
