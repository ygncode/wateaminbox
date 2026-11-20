import type { Kysely } from "kysely";
import { ensureChannelSpineTenantSchema } from "../channel-spine-schema.js";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Per-sender inbound flood windows (contact blocking, phase 5).
 *
 * Adds `inbound_flood_windows` to every tenant: a count of one customer's
 * inbound messages per channel per one-minute window. It only takes effect in
 * workspaces where customer suppression enforcement is switched on. Created
 * through the idempotent spine reconciler, which new tenants also run.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, (schemaName) =>
    ensureChannelSpineTenantSchema(db, schemaName),
  );
}

/** Forward-only, like the rest of the spine schema. */
export async function down(): Promise<void> {
  throw new Error("migration 117 is forward-only");
}
