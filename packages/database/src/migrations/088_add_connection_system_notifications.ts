import type { Kysely } from "kysely";
import { ensureConnectionSystemNotificationSchema } from "../connection-system-notification-schema.js";
import { getTenantSchemas } from "./migration-helpers.js";

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const schema of await getTenantSchemas(db)) {
    await ensureConnectionSystemNotificationSchema(db, schema);
  }
}

export async function down(): Promise<void> {
  throw new Error(
    "Connection system notifications are a forward-only migration",
  );
}
