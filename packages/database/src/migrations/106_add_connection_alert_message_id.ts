import type { Kysely } from "kysely";
import { ensureConnectionAlertMessageIdSchema } from "../connection-alert-message-id-schema.js";
import { getTenantSchemas } from "./migration-helpers.js";

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const schema of await getTenantSchemas(db)) {
    await ensureConnectionAlertMessageIdSchema(db, schema);
  }
}

export async function down(): Promise<void> {
  throw new Error("Connection alert message ids are a forward-only migration");
}
