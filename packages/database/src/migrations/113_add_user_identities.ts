import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * External sign-in identities (for example "Sign in with Google").
 *
 * A row binds one provider account, identified by the provider's stable
 * subject (`sub`), to one WATeamInbox user. The subject - never the email - is
 * the lookup key: a provider email can change or be reassigned, the subject
 * cannot. `(provider, subject)` is unique so one provider account can never
 * sign in as two users, and `(user_id, provider)` is unique so a user links at
 * most one account per provider.
 *
 * `email` records the address the provider asserted when the link was made,
 * for support and audit only; authorization never reads it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS user_identities (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(32) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT user_identities_provider_subject_key UNIQUE (provider, subject),
      CONSTRAINT user_identities_user_provider_key UNIQUE (user_id, provider)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS user_identities`.execute(db);
}
