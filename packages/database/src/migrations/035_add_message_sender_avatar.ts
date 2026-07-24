import type { Kysely } from "kysely";
import {
  addColumnToAllTenants,
  dropColumnFromAllTenants,
} from "./migration-helpers.js";

/** Cache group participant profile pictures with their messages. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await addColumnToAllTenants(db, "messages", "sender_avatar_url", "TEXT");
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await dropColumnFromAllTenants(db, "messages", "sender_avatar_url");
}
