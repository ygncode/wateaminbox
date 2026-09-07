import type { Kysely } from "kysely";
import { ensureConnectionAlertSchema } from "../connection-alert-schema.js";
import { getTenantSchemas } from "./migration-helpers.js";

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const schema of await getTenantSchemas(db)) {
    await ensureConnectionAlertSchema(db, schema);
  }
}

export async function down(): Promise<void> {
  throw new Error("Connection email alerts are a forward-only migration");
}
