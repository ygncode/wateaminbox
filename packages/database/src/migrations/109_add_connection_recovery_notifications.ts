import type { Kysely } from "kysely";
import { ensureConnectionAlertSchema } from "../connection-alert-schema.js";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Close a persisted WhatsApp outage notification when the connection heals.
 *
 * The alert trigger is the one observer shared by worker events, reconnect
 * commands, and older writers, so updating it keeps recovery atomic with the
 * status transition and avoids duplicate success notices across API replicas.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await ensureConnectionAlertSchema(db, schemaName);
  });
}

/**
 * Existing recovery notices are valid history and deliberately remain. A down
 * migration cannot distinguish them from later operator-authored system
 * notifications without deleting useful audit context.
 */
export async function down(): Promise<void> {}
