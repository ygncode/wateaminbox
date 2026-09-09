import type { Kysely } from "kysely";
import { sql } from "kysely";

const ddlLockTimeout = "5s";

/**
 * Reconcile the additive tenant-local channel spine. This function creates no
 * rows and never changes legacy column authority.
 */
export async function ensureChannelSpineTenantSchema<Database>(
  db: Kysely<Database>,
  schemaName: string,
): Promise<void> {
  const table = (name: string) => sql.table(`${schemaName}.${name}`);

  await sql`SET lock_timeout = ${sql.lit(ddlLockTimeout)}`.execute(db);
  try {
    await addColumnsIfMissing(db, schemaName, "contacts", [
      ["display_name", "TEXT"],
      ["organization_name", "TEXT"],
      ["avatar_url", "TEXT"],
      ["record_kind", "TEXT"],
      ["merged_into_contact_id", "UUID"],
      ["archived_at", "TIMESTAMPTZ"],
    ]);

    await sql`CREATE TABLE IF NOT EXISTS ${table("channel_accounts")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      display_name TEXT,
      external_account_id TEXT,
      external_scope_id TEXT,
      status TEXT NOT NULL DEFAULT 'disconnected' CHECK (
        status IN ('connecting', 'connected', 'degraded', 'disconnected', 'disabled', 'error', 'archived')
      ),
      provider_status TEXT,
      capabilities_revision TEXT,
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      legacy_whatsapp_connection_id UUID UNIQUE
        REFERENCES ${table("whatsapp_connections")}(id) ON DELETE RESTRICT,
      connected_by UUID,
      connected_at TIMESTAMPTZ,
      last_sync_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      CHECK (length(trim(channel)) > 0),
      CHECK (length(trim(provider)) > 0),
      CHECK (jsonb_typeof(provider_metadata) = 'object')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("channel_account_credentials")} (
      channel_account_id UUID NOT NULL REFERENCES ${table("channel_accounts")}(id) ON DELETE CASCADE,
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

    await sql`CREATE TABLE IF NOT EXISTS ${table("contact_endpoints")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID REFERENCES ${table("contacts")}(id) ON DELETE SET NULL,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      channel_account_id UUID REFERENCES ${table("channel_accounts")}(id) ON DELETE CASCADE,
      endpoint_kind TEXT NOT NULL,
      external_id TEXT NOT NULL,
      identity_scope TEXT NOT NULL,
      normalized_address TEXT,
      address_display TEXT,
      display_name TEXT,
      verification_state TEXT NOT NULL DEFAULT 'unverified' CHECK (
        verification_state IN ('unverified', 'provider_verified', 'user_verified', 'invalid')
      ),
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (length(trim(channel)) > 0),
      CHECK (length(trim(provider)) > 0),
      CHECK (length(trim(endpoint_kind)) > 0),
      CHECK (length(trim(external_id)) > 0),
      CHECK (length(trim(identity_scope)) > 0),
      CHECK (jsonb_typeof(provider_metadata) = 'object')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("endpoint_account_states")} (
      channel_account_id UUID NOT NULL REFERENCES ${table("channel_accounts")}(id) ON DELETE CASCADE,
      contact_endpoint_id UUID NOT NULL REFERENCES ${table("contact_endpoints")}(id) ON DELETE CASCADE,
      provider_block_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        provider_block_state IN ('unknown', 'allowed', 'blocked')
      ),
      provider_status TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_account_id, contact_endpoint_id)
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("endpoint_presence")} (
      channel_account_id UUID NOT NULL REFERENCES ${table("channel_accounts")}(id) ON DELETE CASCADE,
      contact_endpoint_id UUID NOT NULL REFERENCES ${table("contact_endpoints")}(id) ON DELETE CASCADE,
      availability TEXT NOT NULL DEFAULT 'unknown' CHECK (
        availability IN ('unknown', 'offline', 'online', 'away', 'unavailable')
      ),
      last_seen_at TIMESTAMPTZ,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ,
      PRIMARY KEY (channel_account_id, contact_endpoint_id),
      CHECK (expires_at IS NULL OR expires_at >= observed_at)
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("contact_suppressions")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL REFERENCES ${table("contacts")}(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ,
      CHECK (length(trim(scope)) > 0),
      CHECK (length(trim(reason)) > 0)
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("conversations")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_account_id UUID NOT NULL REFERENCES ${table("channel_accounts")}(id) ON DELETE RESTRICT,
      external_thread_id TEXT,
      client_thread_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('direct', 'group', 'thread')),
      subject TEXT,
      provider_status TEXT,
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      legacy_contact_id UUID UNIQUE REFERENCES ${table("contacts")}(id) ON DELETE RESTRICT,
      first_message_at TIMESTAMPTZ,
      last_message_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ,
      UNIQUE (channel_account_id, client_thread_key),
      CHECK (length(trim(client_thread_key)) > 0),
      CHECK (jsonb_typeof(provider_metadata) = 'object')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("conversation_notes")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ${table("conversations")}(id) ON DELETE CASCADE,
      author_user_id UUID NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('shared', 'private')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (length(trim(content)) > 0)
    )`.execute(db);
    await sql`CREATE INDEX IF NOT EXISTS ${sql.ref(`${schemaName}_conversation_notes_list_idx`)}
      ON ${table("conversation_notes")} (conversation_id, created_at DESC, id DESC)`.execute(
      db,
    );

    await sql`CREATE TABLE IF NOT EXISTS ${table("conversation_sync_states")} (
      conversation_id UUID NOT NULL REFERENCES ${table("conversations")}(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      cursor_or_anchor TEXT,
      request_generation BIGINT NOT NULL DEFAULT 0 CHECK (request_generation >= 0),
      last_requested_at TIMESTAMPTZ,
      last_completed_at TIMESTAMPTZ,
      error_code TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (conversation_id, provider)
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("conversation_participants")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID NOT NULL REFERENCES ${table("conversations")}(id) ON DELETE CASCADE,
      contact_endpoint_id UUID REFERENCES ${table("contact_endpoints")}(id) ON DELETE SET NULL,
      workspace_user_id UUID,
      participant_kind TEXT NOT NULL CHECK (
        participant_kind IN ('external', 'workspace_user', 'account')
      ),
      role TEXT NOT NULL,
      is_self BOOLEAN NOT NULL DEFAULT false,
      joined_at TIMESTAMPTZ,
      left_at TIMESTAMPTZ,
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (contact_endpoint_id IS NOT NULL OR workspace_user_id IS NOT NULL OR participant_kind = 'account'),
      CHECK (jsonb_typeof(provider_metadata) = 'object')
    )`.execute(db);

    await addColumnsIfMissing(db, schemaName, "messages", [
      ["channel_account_id", "UUID"],
      ["conversation_id", "UUID"],
      ["external_message_id", "TEXT"],
      ["external_identity_scope", "TEXT"],
      ["client_idempotency_key", "TEXT"],
      ["direction", "TEXT"],
      ["sender_participant_id", "UUID"],
      ["reply_to_message_id", "UUID"],
      ["provider_occurred_at", "TIMESTAMPTZ"],
      ["normalized_type", "TEXT"],
      ["subject", "TEXT"],
      ["text_content", "TEXT"],
      ["sanitized_html_content", "TEXT"],
      ["provider_metadata", "JSONB"],
    ]);

    await sql`CREATE TABLE IF NOT EXISTS ${table("message_participants")} (
      message_id UUID NOT NULL REFERENCES ${table("messages")}(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      role TEXT NOT NULL CHECK (role IN ('from', 'sender', 'reply_to', 'to', 'cc', 'bcc')),
      contact_endpoint_id UUID REFERENCES ${table("contact_endpoints")}(id) ON DELETE SET NULL,
      address_snapshot TEXT NOT NULL,
      display_name_snapshot TEXT,
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (message_id, role, ordinal),
      CHECK (length(trim(address_snapshot)) > 0),
      CHECK (jsonb_typeof(provider_metadata) = 'object')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("message_attachments")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id UUID NOT NULL REFERENCES ${table("messages")}(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      kind TEXT NOT NULL,
      provider_attachment_id TEXT,
      file_name TEXT,
      content_type TEXT,
      byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
      storage_uri TEXT,
      provider_locator JSONB,
      content_id TEXT,
      content_disposition TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'available', 'failed', 'deleted')
      ),
      error_code TEXT,
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      fetch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (fetch_attempts >= 0),
      next_fetch_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      fetch_lease_token UUID,
      fetch_lease_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (message_id, ordinal),
      CHECK (provider_locator IS NULL OR jsonb_typeof(provider_locator) = 'object'),
      CHECK (jsonb_typeof(provider_metadata) = 'object'),
      CHECK ((fetch_lease_token IS NULL) = (fetch_lease_expires_at IS NULL))
    )`.execute(db);

    await addColumnsIfMissing(db, schemaName, "message_attachments", [
      ["fetch_attempts", "INTEGER NOT NULL DEFAULT 0"],
      ["next_fetch_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"],
      ["fetch_lease_token", "UUID"],
      ["fetch_lease_expires_at", "TIMESTAMPTZ"],
    ]);
    await sql`CREATE TABLE IF NOT EXISTS ${table("whatsapp_attachment_fetch_state")} (
      attachment_id UUID PRIMARY KEY REFERENCES ${table("message_attachments")}(id) ON DELETE CASCADE,
      direct_path TEXT,
      media_key BYTEA,
      file_sha256 BYTEA,
      file_enc_sha256 BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("message_delivery_events")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_account_id UUID NOT NULL REFERENCES ${table("channel_accounts")}(id) ON DELETE CASCADE,
      message_id UUID NOT NULL REFERENCES ${table("messages")}(id) ON DELETE CASCADE,
      recipient_endpoint_id UUID REFERENCES ${table("contact_endpoints")}(id) ON DELETE SET NULL,
      external_event_scope TEXT,
      external_event_id TEXT,
      status TEXT NOT NULL,
      provider_occurred_at TIMESTAMPTZ,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      error_code TEXT,
      error_detail TEXT,
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      CHECK (jsonb_typeof(provider_metadata) = 'object')
    )`.execute(db);

    await addColumnsIfMissing(db, schemaName, "message_reactions", [
      ["reactor_endpoint_id", "UUID"],
      ["channel_account_id", "UUID"],
      ["external_reaction_id", "TEXT"],
      ["external_event_scope", "TEXT"],
      ["provider_occurred_at", "TIMESTAMPTZ"],
      ["provider_metadata", "JSONB"],
    ]);

    await sql`CREATE TABLE IF NOT EXISTS ${table("channel_event_inbox")} (
      channel_account_id UUID NOT NULL REFERENCES ${table("channel_accounts")}(id) ON DELETE CASCADE,
      external_event_scope TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_digest VARCHAR(64) NOT NULL,
      normalized_event JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'applied', 'quarantined')
      ),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_error_code TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      applied_at TIMESTAMPTZ,
      PRIMARY KEY (channel_account_id, external_event_scope, external_event_id),
      CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
      CHECK (jsonb_typeof(normalized_event) = 'object')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("outbound_message_intents")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_account_id UUID NOT NULL REFERENCES ${table("channel_accounts")}(id) ON DELETE RESTRICT,
      conversation_id UUID NOT NULL REFERENCES ${table("conversations")}(id) ON DELETE RESTRICT,
      message_id UUID REFERENCES ${table("messages")}(id) ON DELETE RESTRICT,
      scheduled_message_id UUID REFERENCES ${table("scheduled_messages")}(id) ON DELETE RESTRICT,
      operation TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_fingerprint VARCHAR(64) NOT NULL,
      normalized_payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'dispatching', 'handed_off', 'confirmed', 'failed', 'uncertain')
      ),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      lease_token UUID,
      lease_expires_at TIMESTAMPTZ,
      provider_request_id TEXT,
      last_error_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (channel_account_id, operation, idempotency_key),
      CHECK (message_id IS NOT NULL OR scheduled_message_id IS NOT NULL),
      CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
      CHECK (jsonb_typeof(normalized_payload) = 'object'),
      CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("outbound_intent_attachments")} (
      intent_id UUID NOT NULL REFERENCES ${table("outbound_message_intents")}(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      storage_uri TEXT NOT NULL,
      file_name TEXT,
      content_type TEXT,
      byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
      provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (intent_id, ordinal),
      CHECK (jsonb_typeof(provider_metadata) = 'object')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("channel_account_capabilities")} (
      channel_account_id UUID NOT NULL REFERENCES ${table("channel_accounts")}(id) ON DELETE CASCADE,
      capability_key TEXT NOT NULL,
      support_state TEXT NOT NULL CHECK (
        support_state IN ('supported', 'unsupported', 'conditional')
      ),
      configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
      revision TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_account_id, capability_key),
      CHECK (jsonb_typeof(configuration) = 'object')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("conversation_tags")} (
      conversation_id UUID NOT NULL REFERENCES ${table("conversations")}(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES ${table("tags")}(id) ON DELETE CASCADE,
      PRIMARY KEY (conversation_id, tag_id)
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("contact_merge_events")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source_contact_id UUID NOT NULL REFERENCES ${table("contacts")}(id) ON DELETE RESTRICT,
      target_contact_id UUID NOT NULL REFERENCES ${table("contacts")}(id) ON DELETE RESTRICT,
      actor_user_id UUID NOT NULL,
      reason TEXT NOT NULL,
      endpoint_snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (source_contact_id <> target_contact_id),
      CHECK (jsonb_typeof(endpoint_snapshot) = 'array')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("contact_endpoint_reassignment_events")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      merge_event_id UUID REFERENCES ${table("contact_merge_events")}(id) ON DELETE RESTRICT,
      contact_endpoint_id UUID NOT NULL REFERENCES ${table("contact_endpoints")}(id) ON DELETE RESTRICT,
      previous_contact_id UUID REFERENCES ${table("contacts")}(id) ON DELETE RESTRICT,
      new_contact_id UUID REFERENCES ${table("contacts")}(id) ON DELETE RESTRICT,
      actor_user_id UUID NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (previous_contact_id IS DISTINCT FROM new_contact_id)
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("channel_spine_reconciliation_journal")} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind TEXT NOT NULL,
      legacy_table TEXT NOT NULL,
      legacy_id TEXT NOT NULL,
      error_code TEXT NOT NULL,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'repaired', 'quarantined')
      ),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (kind, legacy_table, legacy_id),
      CHECK (jsonb_typeof(detail) = 'object')
    )`.execute(db);

    await sql`CREATE TABLE IF NOT EXISTS ${table("channel_spine_backfill_checkpoints")} (
      job_key TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
      rows_processed BIGINT NOT NULL DEFAULT 0 CHECK (rows_processed >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'running', 'complete', 'blocked')
      ),
      last_error_code TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (jsonb_typeof(cursor) = 'object')
    )`.execute(db);

    for (const [legacyTable, constraintName] of [
      ["conversation_states", "conversation_states_conversation_fk"],
      ["conversation_cases", "conversation_cases_conversation_fk"],
      ["contact_assignments", "contact_assignments_conversation_fk"],
      ["contact_notes_private", "contact_notes_private_conversation_fk"],
      ["contact_notes_shared", "contact_notes_shared_conversation_fk"],
      ["scheduled_messages", "scheduled_messages_conversation_fk"],
    ] as const) {
      await addColumnsIfMissing(
        db,
        schemaName,
        legacyTable,
        legacyTable === "conversation_cases"
          ? [
              ["contact_id", "UUID"],
              ["conversation_id", "UUID"],
              ["company_id", "UUID"],
              ["status", "TEXT"],
            ]
          : legacyTable === "contact_assignments"
            ? [
                ["contact_id", "UUID"],
                ["conversation_id", "UUID"],
                ["unassigned_at", "TIMESTAMPTZ"],
              ]
            : [
                ["contact_id", "UUID"],
                ["conversation_id", "UUID"],
              ],
      );
      await addConstraintIfMissing(
        db,
        schemaName,
        legacyTable,
        constraintName,
        sql`ALTER TABLE ${table(legacyTable)}
          ADD CONSTRAINT ${sql.ref(constraintName)}
          FOREIGN KEY (conversation_id) REFERENCES ${table("conversations")}(id)
          ON DELETE CASCADE NOT VALID`,
      );
    }

    await addColumnsIfMissing(db, schemaName, "messages", [
      ["contact_id", "UUID"],
      ["conversation_id", "UUID"],
    ]);
    await dropNotNullIfNeeded(db, schemaName, "messages", "contact_id");
    await addConstraintIfMissing(
      db,
      schemaName,
      "messages",
      "messages_contact_or_conversation_check",
      sql`ALTER TABLE ${table("messages")}
        ADD CONSTRAINT messages_contact_or_conversation_check
        CHECK (contact_id IS NOT NULL OR conversation_id IS NOT NULL) NOT VALID`,
    );

    await dropNotNullIfNeeded(
      db,
      schemaName,
      "scheduled_messages",
      "contact_id",
    );
    await addConstraintIfMissing(
      db,
      schemaName,
      "scheduled_messages",
      "scheduled_messages_contact_or_conversation_check",
      sql`ALTER TABLE ${table("scheduled_messages")}
        ADD CONSTRAINT scheduled_messages_contact_or_conversation_check
        CHECK (contact_id IS NOT NULL OR conversation_id IS NOT NULL) NOT VALID`,
    );

    for (const workflowTable of [
      "conversation_cases",
      "conversation_states",
      "contact_assignments",
    ] as const) {
      await addColumnsIfMissing(db, schemaName, workflowTable, [
        ["contact_id", "UUID"],
      ]);
      await dropNotNullIfNeeded(db, schemaName, workflowTable, "contact_id");
      await addConstraintIfMissing(
        db,
        schemaName,
        workflowTable,
        `${workflowTable}_contact_or_conversation_check`,
        sql`ALTER TABLE ${table(workflowTable)}
          ADD CONSTRAINT ${sql.ref(`${workflowTable}_contact_or_conversation_check`)}
          CHECK (contact_id IS NOT NULL OR conversation_id IS NOT NULL) NOT VALID`,
      );
    }

    await addConstraintIfMissing(
      db,
      schemaName,
      "conversation_cases",
      "conversation_cases_company_policy_fk",
      sql`ALTER TABLE ${table("conversation_cases")}
        ADD CONSTRAINT conversation_cases_company_policy_fk
        FOREIGN KEY (company_id, policy_id)
        REFERENCES public.sla_policies(company_id, id)
        ON DELETE RESTRICT NOT VALID`,
    );

    await addConstraintIfMissing(
      db,
      schemaName,
      "contacts",
      "contacts_merged_into_contact_fk",
      sql`ALTER TABLE ${table("contacts")}
        ADD CONSTRAINT contacts_merged_into_contact_fk
        FOREIGN KEY (merged_into_contact_id) REFERENCES ${table("contacts")}(id)
        ON DELETE RESTRICT NOT VALID`,
    );
    await addConstraintIfMissing(
      db,
      schemaName,
      "contacts",
      "contacts_record_kind_check",
      sql`ALTER TABLE ${table("contacts")}
        ADD CONSTRAINT contacts_record_kind_check
        CHECK (record_kind IS NULL OR record_kind IN ('customer', 'legacy_group_projection'))
        NOT VALID`,
    );

    for (const [constraintName, definition] of [
      [
        "messages_channel_account_fk",
        sql`ALTER TABLE ${table("messages")} ADD CONSTRAINT messages_channel_account_fk
          FOREIGN KEY (channel_account_id) REFERENCES ${table("channel_accounts")}(id)
          ON DELETE RESTRICT NOT VALID`,
      ],
      [
        "messages_conversation_fk",
        sql`ALTER TABLE ${table("messages")} ADD CONSTRAINT messages_conversation_fk
          FOREIGN KEY (conversation_id) REFERENCES ${table("conversations")}(id)
          ON DELETE RESTRICT NOT VALID`,
      ],
      [
        "messages_sender_participant_fk",
        sql`ALTER TABLE ${table("messages")} ADD CONSTRAINT messages_sender_participant_fk
          FOREIGN KEY (sender_participant_id) REFERENCES ${table("conversation_participants")}(id)
          ON DELETE SET NULL NOT VALID`,
      ],
      [
        "messages_reply_to_fk",
        sql`ALTER TABLE ${table("messages")} ADD CONSTRAINT messages_reply_to_fk
          FOREIGN KEY (reply_to_message_id) REFERENCES ${table("messages")}(id)
          ON DELETE SET NULL NOT VALID`,
      ],
      [
        "messages_direction_check",
        sql`ALTER TABLE ${table("messages")} ADD CONSTRAINT messages_direction_check
          CHECK (direction IS NULL OR direction IN ('inbound', 'outbound', 'system')) NOT VALID`,
      ],
    ] as const) {
      await addConstraintIfMissing(
        db,
        schemaName,
        "messages",
        constraintName,
        definition,
      );
    }

    for (const [constraintName, definition] of [
      [
        "message_reactions_endpoint_fk",
        sql`ALTER TABLE ${table("message_reactions")} ADD CONSTRAINT message_reactions_endpoint_fk
          FOREIGN KEY (reactor_endpoint_id) REFERENCES ${table("contact_endpoints")}(id)
          ON DELETE SET NULL NOT VALID`,
      ],
      [
        "message_reactions_account_fk",
        sql`ALTER TABLE ${table("message_reactions")} ADD CONSTRAINT message_reactions_account_fk
          FOREIGN KEY (channel_account_id) REFERENCES ${table("channel_accounts")}(id)
          ON DELETE RESTRICT NOT VALID`,
      ],
    ] as const) {
      await addConstraintIfMissing(
        db,
        schemaName,
        "message_reactions",
        constraintName,
        definition,
      );
    }

    await ensureIndexes(db, schemaName);
  } finally {
    await sql`SET lock_timeout = DEFAULT`.execute(db);
  }
}

async function ensureIndexes<Database>(
  db: Kysely<Database>,
  schemaName: string,
): Promise<void> {
  const table = (name: string) => sql.table(`${schemaName}.${name}`);
  const definitions: ReadonlyArray<readonly [string, ReturnType<typeof sql>]> =
    [
      [
        // One send intent per message. Actions (reactions, edits, deletes)
        // target a message that may already own its send intent, so they are
        // excluded here and bounded by the operation/idempotency-key UNIQUE.
        "outbound_intents_send_message_uidx",
        sql`CREATE UNIQUE INDEX ${sql.ref(`${schemaName}_omi_send_msg_uidx`)}
        ON ${table("outbound_message_intents")} (message_id)
        WHERE message_id IS NOT NULL AND operation NOT LIKE 'action:%'`,
      ],
      [
        "channel_accounts_external_uidx",
        sql`CREATE UNIQUE INDEX ${sql.ref(`${schemaName}_ca_external_uidx`)}
        ON ${table("channel_accounts")} (channel, provider, external_scope_id, external_account_id)
        WHERE external_scope_id IS NOT NULL AND external_account_id IS NOT NULL AND archived_at IS NULL`,
      ],
      [
        "contact_endpoints_scoped_uidx",
        sql`CREATE UNIQUE INDEX ${sql.ref(`${schemaName}_ce_scoped_uidx`)}
        ON ${table("contact_endpoints")} (channel, provider, channel_account_id, identity_scope, external_id)
        WHERE channel_account_id IS NOT NULL`,
      ],
      [
        "contact_endpoints_global_uidx",
        sql`CREATE UNIQUE INDEX ${sql.ref(`${schemaName}_ce_global_uidx`)}
        ON ${table("contact_endpoints")} (channel, provider, identity_scope, external_id)
        WHERE channel_account_id IS NULL`,
      ],
      [
        "conversations_external_uidx",
        sql`CREATE UNIQUE INDEX ${sql.ref(`${schemaName}_conv_external_uidx`)}
        ON ${table("conversations")} (channel_account_id, external_thread_id)
        WHERE external_thread_id IS NOT NULL`,
      ],
      [
        "message_attachments_provider_uidx",
        sql`CREATE UNIQUE INDEX ${sql.ref(`${schemaName}_ma_provider_uidx`)}
        ON ${table("message_attachments")} (message_id, provider_attachment_id)
        WHERE provider_attachment_id IS NOT NULL`,
      ],
      [
        "message_delivery_events_external_uidx",
        sql`CREATE UNIQUE INDEX ${sql.ref(`${schemaName}_mde_external_uidx`)}
        ON ${table("message_delivery_events")} (channel_account_id, external_event_scope, external_event_id)
        WHERE external_event_scope IS NOT NULL AND external_event_id IS NOT NULL`,
      ],
      [
        "channel_event_inbox_due_idx",
        sql`CREATE INDEX ${sql.ref(`${schemaName}_cei_due_idx`)}
        ON ${table("channel_event_inbox")} (status, next_attempt_at, received_at)`,
      ],
      [
        "outbound_message_intents_due_idx",
        sql`CREATE INDEX ${sql.ref(`${schemaName}_omi_due_idx`)}
        ON ${table("outbound_message_intents")} (status, next_attempt_at, created_at)`,
      ],
      [
        "contact_suppressions_active_idx",
        sql`CREATE INDEX ${sql.ref(`${schemaName}_csup_active_idx`)}
        ON ${table("contact_suppressions")} (contact_id, scope)
        WHERE revoked_at IS NULL`,
      ],
      [
        "channel_spine_reconciliation_due_idx",
        sql`CREATE INDEX ${sql.ref(`${schemaName}_csrj_due_idx`)}
        ON ${table("channel_spine_reconciliation_journal")} (status, next_attempt_at, created_at)`,
      ],
    ];

  const existing = await sql<{ indexname: string }>`
    SELECT indexname FROM pg_indexes WHERE schemaname = ${schemaName}
  `.execute(db);
  const names = new Set(existing.rows.map((row) => row.indexname));
  for (const [logicalName, statement] of definitions) {
    const expectedName = indexNameFor(logicalName, schemaName);
    if (names.has(expectedName)) continue;
    await statement.execute(db);
    names.add(expectedName);
  }
}

function indexNameFor(logicalName: string, schemaName: string): string {
  const suffixes: Record<string, string> = {
    channel_accounts_external_uidx: "ca_external_uidx",
    contact_endpoints_scoped_uidx: "ce_scoped_uidx",
    contact_endpoints_global_uidx: "ce_global_uidx",
    conversations_external_uidx: "conv_external_uidx",
    message_attachments_provider_uidx: "ma_provider_uidx",
    message_delivery_events_external_uidx: "mde_external_uidx",
    channel_event_inbox_due_idx: "cei_due_idx",
    outbound_message_intents_due_idx: "omi_due_idx",
    outbound_intents_send_message_uidx: "omi_send_msg_uidx",
    contact_suppressions_active_idx: "csup_active_idx",
    channel_spine_reconciliation_due_idx: "csrj_due_idx",
  };
  return `${schemaName}_${suffixes[logicalName]}`;
}

async function addColumnsIfMissing<Database>(
  db: Kysely<Database>,
  schemaName: string,
  tableName: string,
  columns: ReadonlyArray<readonly [string, string]>,
): Promise<void> {
  const existing = await sql<{ column_name: string }>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = ${schemaName} AND table_name = ${tableName}
  `.execute(db);
  const names = new Set(existing.rows.map((row) => row.column_name));
  const missing = columns.filter(([name]) => !names.has(name));
  if (missing.length === 0) return;
  const additions = missing
    .map(
      ([name, definition]) =>
        `ADD COLUMN IF NOT EXISTS ${quoteIdentifier(name)} ${definition}`,
    )
    .join(", ");
  await sql
    .raw(
      `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ${additions}`,
    )
    .execute(db);
}

/**
 * `ALTER TABLE ... DROP NOT NULL` takes ACCESS EXCLUSIVE on its target even
 * when the column is already nullable and the statement is a no-op. Issuing it
 * unconditionally made every reconciliation run queue behind - and then block -
 * all traffic on `messages`, the busiest table in a tenant, until the 5s DDL
 * `lock_timeout` cancelled the run. Decide from the catalog first.
 */
async function dropNotNullIfNeeded<Database>(
  db: Kysely<Database>,
  schemaName: string,
  tableName: string,
  columnName: string,
): Promise<void> {
  const result = await sql<{ is_nullable: string }>`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = ${schemaName}
      AND table_name = ${tableName}
      AND column_name = ${columnName}
  `.execute(db);
  const column = result.rows[0];
  if (!column || column.is_nullable === "YES") return;
  await sql`ALTER TABLE ${sql.raw(`${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`)}
    ALTER COLUMN ${sql.ref(columnName)} DROP NOT NULL`.execute(db);
}

async function addConstraintIfMissing<Database>(
  db: Kysely<Database>,
  schemaName: string,
  tableName: string,
  constraintName: string,
  statement: ReturnType<typeof sql>,
): Promise<void> {
  const result = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_record
      JOIN pg_class AS table_record ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace AS schema_record ON schema_record.oid = table_record.relnamespace
      WHERE schema_record.nspname = ${schemaName}
        AND table_record.relname = ${tableName}
        AND constraint_record.conname = ${constraintName}
    ) AS exists
  `.execute(db);
  if (!result.rows[0]?.exists) await statement.execute(db);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
