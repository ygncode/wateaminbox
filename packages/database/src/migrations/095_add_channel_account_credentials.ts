import { type Kysely, sql } from "kysely";
import { forEachTenant } from "./migration-helpers.js";

/** Ciphertext-only provider credentials; plaintext never enters PostgreSQL. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    const table = sql.table(`${schema}.channel_account_credentials`);
    const accounts = sql.table(`${schema}.channel_accounts`);
    await sql`CREATE TABLE IF NOT EXISTS ${table} (
      channel_account_id UUID NOT NULL REFERENCES ${accounts}(id) ON DELETE CASCADE,
      credential_kind TEXT NOT NULL,
      encrypted_value BYTEA NOT NULL,
      nonce BYTEA NOT NULL,
      auth_tag BYTEA NOT NULL,
      key_version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_account_id, credential_kind),
      CHECK (length(trim(credential_kind)) > 0),
      CHECK (octet_length(nonce) = 12),
      CHECK (octet_length(auth_tag) = 16),
      CHECK (length(trim(key_version)) > 0)
    )`.execute(db);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await forEachTenant(db, async (schema) => {
    await sql`DROP TABLE IF EXISTS ${sql.table(`${schema}.channel_account_credentials`)}`.execute(
      db,
    );
  });
}
