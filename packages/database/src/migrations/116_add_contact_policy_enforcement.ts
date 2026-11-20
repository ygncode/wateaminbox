import type { Kysely } from "kysely";
import { ensureChannelSpineTenantSchema } from "../channel-spine-schema.js";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Customer suppression enforcement (phase 2 of contact blocking).
 *
 * Adds, per tenant:
 *
 * - `contact_policy_settings`: one row deciding whether the workspace
 *   enforces suppressions. Absent or `false` means off, so this migration
 *   changes no behaviour until an operator enables a workspace.
 * - `contact_suppression_drops`: a per-person, per-channel, per-day counter
 *   of inbound messages dropped because the person is blocked. Content is
 *   never kept.
 *
 * Both are created through the idempotent spine reconciler, which new tenants
 * also run.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, (schemaName) =>
    ensureChannelSpineTenantSchema(db, schemaName),
  );
}

/** Forward-only: dropping the setting would silently stop enforcement. */
export async function down(): Promise<void> {
  throw new Error("migration 116 is forward-only");
}
