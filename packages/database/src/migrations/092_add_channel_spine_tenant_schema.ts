import { type Kysely, sql } from "kysely";
import { ensureChannelSpineTenantSchema } from "../channel-spine-schema.js";
import { executeOnAllTenants } from "./migration-helpers.js";

/** Add neutral tenant tables and nullable compatibility columns without data. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS sla_policies_company_id_id_uidx
    ON public.sla_policies (company_id, id)`.execute(db);
  await executeOnAllTenants(db, (schemaName) =>
    ensureChannelSpineTenantSchema(db, schemaName),
  );
}

/**
 * Production migrations are forward-only. The down path is intentionally
 * blocked because dropping additive inbox/outbox data would be destructive.
 */
export async function down(): Promise<void> {
  throw new Error("migration 092 is forward-only");
}
