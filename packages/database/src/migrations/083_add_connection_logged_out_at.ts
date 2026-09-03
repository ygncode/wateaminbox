import type { Kysely } from "kysely";
import {
  addColumnToAllTenants,
  dropColumnFromAllTenants,
} from "./migration-helpers.js";

/**
 * Separates a permanent logout from an ordinary disconnect.
 *
 * Terminal status events are already persisted rather than dead-lettered, but
 * `logged_out` shares the disconnect path and so lands as plain
 * `status = 'disconnected'`. That is true of a logged-out connection, and the
 * status is deliberately left alone: the difference is not the state but
 * whether it can recover. The orchestrator retries an ordinary drop with
 * backoff and it usually heals with nobody watching, while a logout means
 * whatsmeow deleted its credentials after terminal 401/403 session loss — no
 * retry restores it, and reconnecting needs a person holding the phone to scan
 * a fresh QR code.
 *
 * A nullable timestamp records that without widening
 * `whatsapp_connection_status`, which every status consumer in the web client
 * switches on exhaustively. Cleared on the next successful connect.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await addColumnToAllTenants(
    db,
    "whatsapp_connections",
    "logged_out_at",
    "TIMESTAMPTZ",
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await dropColumnFromAllTenants(db, "whatsapp_connections", "logged_out_at");
}
