import type { Kysely } from "kysely";
import { reconcileTenantSchema } from "../tenant-schema.js";
import { executeOnAllTenants } from "./migration-helpers.js";

/**
 * Repair schema drift introduced by historical setup_tenant_schema rewrites.
 * Future tenant changes should use the same additive reconciliation path.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await executeOnAllTenants(db, async (schemaName) => {
    await reconcileTenantSchema(db, schemaName);
  });
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Additive compatibility changes intentionally remain in place.
}
