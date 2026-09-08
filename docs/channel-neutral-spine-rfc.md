# RFC: Channel-neutral messaging spine

- **Status:** Proposed — ready for review
- **Scope:** OSS application architecture and migration plan
- **Production change:** None. This RFC does not authorize a migration, deployment, provider credential change, webhook registration, or traffic cutover.

## Summary

WATeamInbox should add a channel-neutral messaging spine rather than generalize the existing WhatsApp tables in place.

The current model makes one tenant `contacts.id` serve as all of the following:

- the ID of a row representing a WhatsApp JID/address;
- the ID of a row representing a person or group;
- a conversation/thread identifier;
- the partition key for messages;
- the target for assignment, unread state, notes, tags, case lifecycle, and SLA.

That model cannot safely represent one person with several channel identities, an email thread with changing recipients, multiple conversations with the same person, or a group with several participants. Renaming `whatsapp_connections` to `connections` would retain those problems and blur the difference between a channel and a provider.

This RFC introduces these explicit concepts:

```text
Provider adapters
├── WhatsApp linked device
├── WhatsApp Cloud API
├── Facebook Messenger
├── Instagram Messaging
├── Telegram Bot
├── LINE Messaging
├── Viber Bot
└── Email
          │
          ▼
Normalized channel layer
├── channel accounts
├── contacts and external endpoints
├── conversations and participants
├── messages and attachments
├── delivery events
└── capabilities
          │
          ▼
Shared inbox
assignments · cases · SLA · notes · tags
notifications · search · analytics · realtime
```

The migration posture is deliberate and heavy on purpose. Live linked-device WhatsApp traffic, NATS subjects and durable consumers, session recovery without QR re-pairing, case and SLA history, and send/idempotency semantics make in-place rename or “add a channel column to contacts and messages” unsafe. Renaming `whatsapp_connections` to a vague `connections` table, or rewriting existing WhatsApp rows in one release, is the cheaper-looking disaster: it blurs channel versus provider, creates outage-sized lock and rollback risk, and cannot represent several endpoints or threads per person.

Instead, the program uses additive schema, dual-write with continuous reconciliation, shadow normalize-and-compare, neutral reads behind flags, then a fenced single-writer authority handoff. The early schema, shadow-write, and shadow-read phases are reversible at the application level by disabling flags while retaining new data. Existing linked-device WhatsApp remains authoritative while neutral rows are shadow-written and verified. Existing IDs and APIs remain valid during the compatibility window. No destructive rename or table removal occurs in the initial program. Neutral-only provider writes, executed contact merges, authority cutover, and legacy retirement are later forward-only compatibility boundaries with separate recovery plans.

The most important product decision is:

> Assignment, unread state, cases, SLA, operational notes, and inbox tags belong to `conversation_id`, not `contact_id`.

A contact merge combines customer identity and endpoints. It must not combine conversations, message histories, assignments, unread counters, or SLA cases.

The most important migration decision is:

> Prefer additive dual-write, shadow validation, and a fenced cutover over renaming or rewriting live WhatsApp state in place.

That choice costs more engineering time up front and is the load-bearing safety property of this program.

## Motivation

The product is expected to support:

- WhatsApp linked devices;
- WhatsApp Cloud API;
- Facebook Messenger;
- Instagram Messaging;
- Telegram bots;
- LINE Messaging;
- Viber bots;
- email;
- customer identity resolution and controlled contact merging.

These systems differ materially:

- WhatsApp linked devices require the Go worker, whatsmeow session state, QR pairing, NATS, and the orchestrator.
- WhatsApp Cloud API, Messenger, and Instagram share parts of Meta OAuth and webhook infrastructure but have distinct channel behavior and policy.
- Telegram, LINE, and Viber have bot/webhook lifecycles but different identity scopes, message types, and limits.
- Email has subjects, MIME bodies, HTML, threading headers, per-message recipients, quoted content, sync cursors, and provider-specific OAuth.

A lowest-common-denominator interface would either lose capabilities or spread checks such as `if (channel === "whatsapp")` throughout the API and UI. The spine must normalize durable concepts while preserving provider-specific features and constraints.

## Goals

1. Represent channel, provider, account, customer, endpoint, conversation, participant, message, attachment, and delivery as separate concepts.
2. Keep linked-device WhatsApp behavior unchanged until a separately approved cutover.
3. Preserve tenant isolation, idempotency, event ordering, delivery uncertainty, case history, and SLA semantics.
4. Let inbox features operate on conversations regardless of provider.
5. Make capabilities explicit so the composer and message actions are data-driven.
6. Support controlled cross-channel contact merging without merging conversation history.
7. Provide stable adapter contracts for inbound events, outbound commands, and provider actions.
8. Allow incremental rollout, shadow verification, application rollback, and later removal of legacy coupling.
9. Preserve the OSS/private boundary: generic single-host runtime and protocol correctness remain OSS; hosted fleet operations and commercial policy remain private.

## Non-goals

This RFC does not:

- implement any provider;
- rename or remove `whatsapp_connections`;
- move whatsmeow credentials or linked-device sessions;
- change pricing, quotas, Stripe behavior, or commercial entitlements;
- add hosted multi-host placement, provisioning, fleet rollout, or provider automation to OSS;
- promise HA or an SLA;
- automatically merge contacts based on weak identity signals;
- force every provider feature into one universal message format;
- authorize a production migration or deployment.

## Current codebase findings

### Data model

The current tenant schema is defined by `packages/database/src/client.ts` and reconciled by `packages/database/src/tenant-schema.ts`.

There is no `conversations` table. The effective relationship is:

```text
whatsapp_connections.id
        │
        ├── contacts.whatsapp_connection_id
        └── messages.whatsapp_connection_id

contacts.id
        ├── messages.contact_id
        ├── conversation_states.contact_id
        ├── conversation_cases.contact_id
        ├── contact_assignments.contact_id
        ├── contact_notes_private.contact_id
        ├── contact_notes_shared.contact_id
        ├── contact_tags.contact_id
        ├── scheduled_messages.contact_id
        └── groups.contact_id
```

`contacts` contains channel endpoint, person/group, presence, remote-history, and conversation attributes in one row:

```text
whatsapp_connection_id · jid · phone_number · push_name · username
is_group · is_online · last_seen · is_blocked · remote_history_status
```

`messages` combines normalized content and WhatsApp transport state:

```text
whatsapp_connection_id · contact_id · message_id · from_me · sender_jid
message_type · content · media_* · quoted_message_id · status · metadata
case_id · seq
```

Important existing guarantees include:

- contact identity is unique by `(whatsapp_connection_id, jid)` from migration 038;
- message deduplication is scoped by `(whatsapp_connection_id, message_id)` from migration 027;
- `messages.case_id` is durable case membership and must never be inferred from timestamps;
- pre-migration-061 messages intentionally keep both `case_id` and `seq` null;
- one active assignment and one active case are protected by partial unique indexes;
- linked-device account/session separation was introduced by migration 052;
- WhatsApp labels/catalogs/products are connection-scoped by migration 054;
- public `message_delivery_outbox` from migration 089 durably fans a stored message out to realtime and push delivery.

The new design must update all schema surfaces together:

1. a numbered migration for existing tenants;
2. `reconcileTenantSchema()` for new and drifted tenants;
3. `TENANT_SCHEMA_CONTRACT`;
4. `TenantDatabase` types.

New public routing, flag, and fanout tables also update the typed public `Database` surface, least-privilege grants, migration tests, backup/restore inventory, and cleanup paths.

Raw SQL must continue to schema-qualify tenant tables. `withSchema()` does not protect raw SQL, and tenant tables do not contain a row-level `company_id` fallback.

### API and service coupling

`POST /api/messages` in `apps/api/src/routes/messages/send.ts`:

1. accepts `contactId`;
2. reads the contact's JID and `whatsapp_connection_id`;
3. resolves an active WhatsApp session;
4. constructs a WhatsApp/NATS command;
5. stores a pending message and command outbox row atomically;
6. returns `conversationId: contactId`.

Inbound events follow the inverse path in `apps/api/src/services/message-handler.ts` and `apps/api/src/services/handlers/message-handlers.ts`: a WhatsApp session event is resolved to a connection, the contact is found by account/JID, a message is inserted, and contact-scoped conversation state/cases are updated.

Other high-coupling areas include:

- `apps/api/src/services/contact.service.ts` — conversation list is a contact query joined to messages, state, assignment, and WhatsApp account;
- `apps/api/src/services/conversation-case.service.ts` — all lifecycle locking and uniqueness use `contact_id`;
- `apps/api/src/services/send-access.service.ts` — assignment and active-case checks use `contact_id`;
- `apps/api/src/services/scheduled-message.service.ts` — scheduled dispatch resolves JID and connection through a contact;
- `apps/api/src/services/message-broadcast.service.ts` — realtime visibility is contact-scoped;
- `apps/api/src/services/search.service.ts` and `meilisearch.service.ts` — message documents and visibility filters use `contactId` and `contactJid`;
- `apps/api/src/services/analytics/*` — response and resolution measurements are contact/case keyed;
- `apps/api/src/routes/contacts/*` — assignments, notes, and tags are presented as contact resources;
- `apps/api/src/routes/conversations/*` — route `:id` is documented and implemented as a contact ID;
- exports, bulk jobs, MCP tools, notification URLs, and resource-visibility middleware inherit the same assumption.

### Shared types, realtime, and web

`packages/shared/src/types/message.ts` exposes both nominally generic and WhatsApp-specific fields (`conversationId`, `whatsappMessageId`, `senderJid`, `reactorJid`, and `ScheduledMessage.contactId`).

`packages/shared/src/websocket-types.ts` mixes generic event names with JID-bearing payloads. `conversation:read` even carries `contactId`, while several other events carry `conversationId` whose value is the same contact ID.

In `apps/web/src/pages/ChatPage.tsx`, `selectedChatId` is a contact ID. The composer receives both that ID and a WhatsApp JID: REST/lifecycle actions use the former while typing uses the latter. Notification navigation uses `/chat/:contactId`, and mute preferences store JIDs in `notification_preferences.muted_contacts`.

The UI therefore needs a compatibility view model before it can become channel-neutral; changing database names alone is insufficient.

### Runtime protocol

The Go contracts in `services/shared/nats/subjects.go` and `services/shared/nats/events.go` are explicitly WhatsApp-oriented:

```text
WHATSAPP.commands.{companyId}.{sessionId}
WHATSAPP.events.{companyId}.{sessionId}.{eventType}
WHATSAPP.download.{companyId}.{sessionId}.request
```

The API's durable consumers split critical, history, and transient traffic. NATS uses interest retention, so consumer coverage must exist before a publisher emits an event. Existing linked-device subjects, durable names, event envelopes, and worker command semantics must not be renamed in place.

The channel-neutral seam belongs above this protocol: a linked-device adapter translates the existing WhatsApp event/command contract to and from the normalized domain contract. The Go worker and orchestrator do not need to change during the initial spine migration.

## Terminology and invariants

### Channel versus provider

A **channel** is the user-facing communication medium, such as `whatsapp`, `messenger`, `instagram`, `telegram`, `line`, `viber`, or `email`.

A **provider** is the concrete integration and credential/runtime implementation, such as `whatsapp_linked_device`, `meta_cloud`, `telegram_bot`, `gmail`, `microsoft_graph`, or `imap_smtp`.

Two accounts on the same channel can use different providers. Provider names are stable namespaced strings, not display labels.

### Account

A **channel account** is one tenant-owned sending/receiving identity and provider configuration. It is not a customer contact and not a short-lived linked-device pairing session.

### Contact and endpoint

A **contact** is a tenant-local human or organization record. It contains customer-level profile data only.

A **contact endpoint** is an address or provider-scoped identity: email address, WhatsApp JID, Instagram scoped ID, Telegram user/chat ID, LINE user ID, and so on. Endpoints may initially be unresolved and may represent a person, organization, mailbox, group, or bot. Only person/organization endpoints are eligible for customer contact merges.

### Conversation

A **conversation** is a provider thread/chat owned by exactly one channel account. It is independent of a contact and can contain any number of participants.

### Invariants

1. Every conversation belongs to exactly one channel account.
2. Provider thread identity is unique within its provider-defined account/scope when assigned; locally initiated threads use an immutable client key until then.
3. Every durable message belongs to exactly one conversation.
4. A provider message ID is deduplicated in its adapter-defined identity scope; pending outbound messages also have an account/operation-scoped application idempotency key and request fingerprint.
5. A contact endpoint has at most one canonical contact at a time.
6. Contact merges never move or combine conversations or case histories.
7. Assignment, unread state, active case, SLA, and operational inbox metadata are keyed by conversation.
8. Provider credentials and webhook secrets never enter generic metadata, client payloads, logs, or search indexes.
9. Provider payload retention is allowlisted and minimized; raw payloads are not a substitute for normalized columns.
10. Provider timestamps do not determine ingestion order or case membership.
11. Provider capability support and current action availability are separate concepts.
12. Commercial entitlement checks remain authoritative outside the generic OSS capability model.

## Proposed architecture

```text
                    provider webhook / sync / linked-device event
                                      │
                                      ▼
                         provider-specific ingress
                    verify · dedupe · resolve account · parse
                                      │
                                      ▼
                        NormalizedChannelEvent v1
                                      │
                                      ▼
                  channel event application transaction
 endpoints ─ conversations ─ participants ─ messages ─ deliveries
                                      │
                     ┌────────────────┼─────────────────┐
                     ▼                ▼                 ▼
               search outbox   realtime/push outbox   analytics

UI/API outbound request
          │
          ▼
capability + policy evaluation
          │
          ▼
message + outbound intent transaction
          │
          ▼
provider adapter dispatcher
          │
          ├── legacy WhatsApp NATS command
          ├── Meta/Telegram/LINE/Viber HTTP API
          └── email API/SMTP
```

Provider I/O must not occur inside the transaction that stores the pending message. The transaction creates a durable outbound intent; a dispatcher calls the adapter after commit. This retains the current outbox safety property and supports provider retries and uncertain outcomes.

## Target tenant data model

The names below describe the final logical model. The physical rollout is additive and keeps compatibility columns and tables until retirement.

### `channel_accounts`

```text
id uuid primary key
channel text not null
provider text not null
display_name text
external_account_id text
external_scope_id text
status text not null
provider_status text
capabilities_revision text
provider_metadata jsonb not null default '{}'
legacy_whatsapp_connection_id uuid unique null
connected_by uuid null
connected_at timestamptz null
last_sync_at timestamptz null
created_at timestamptz not null
updated_at timestamptz not null
archived_at timestamptz null
```

Recommended uniqueness is `(channel, provider, external_scope_id, external_account_id)` where all values are present. Exact scope semantics come from the adapter. Text values should be validated by the adapter registry rather than encoded as hard-to-extend PostgreSQL enums.

For the initial backfill, linked-device rows use `channel_accounts.id = whatsapp_connections.id` and set `legacy_whatsapp_connection_id` to the same value. `whatsapp_connections` remains the authoritative linked-device provider table during compatibility.

Credential material, OAuth refresh tokens, webhook secrets, sync cursors, and provider-specific status live in provider-specific tables or file-backed secret references. Generic `provider_metadata` is an allowlisted, non-secret projection only.

Webhook providers also need a typed, service-only `public.channel_ingress_routes` directory containing `provider`, `route_key_hash`, `company_id`, `channel_account_id`, `state`, `created_at`, `updated_at`, and `revoked_at`, with unique active `(provider, route_key_hash)` routing. This avoids scanning tenant schemas before tenant identity is known. The public row cannot foreign-key to a tenant-local account, but both schemas share PostgreSQL: creation/revocation therefore writes the route and tenant account in one transaction. Any deployment unable to guarantee that uses a two-phase `pending` → `active` state, with ingress failing closed until both sides verify. Stale/revoked routes fail closed, and a reconciler detects either side missing. It exposes no credential or customer profile data and grants lookup/write only to the ingress service role.

### `contacts`

The final `contacts` table is the customer-level record:

```text
id uuid primary key
display_name text
organization_name text
avatar_url text
record_kind text not null        -- customer, legacy_group_projection
merged_into_contact_id uuid null
created_at timestamptz not null
updated_at timestamptz not null
archived_at timestamptz null
```

The current table already has this name. It will be evolved in place rather than replaced in one migration. Existing non-group rows become `customer`; current group rows are explicitly marked `legacy_group_projection` and are ineligible for contact APIs/merge once neutral reads start. They remain only to support old FKs/routes, then are archived/removed after all group conversations and rollback clients use the neutral IDs. WhatsApp columns remain as a deprecated compatibility projection. A merged source row remains as an alias/tombstone through the rollback and audit window.

### `contact_endpoints`

```text
id uuid primary key
contact_id uuid null
channel text not null
provider text not null
channel_account_id uuid null
endpoint_kind text not null
external_id text not null
identity_scope text not null
normalized_address text
address_display text
display_name text
verification_state text not null
provider_metadata jsonb not null default '{}'
first_seen_at timestamptz not null
last_seen_at timestamptz not null
created_at timestamptz not null
updated_at timestamptz not null
```

The adapter owns endpoint normalization. Email normalization must be conservative: lower-case domains, preserve local-part semantics, and never remove dots or plus aliases without provider proof. Provider-scoped IDs must not be treated as globally comparable. WhatsApp LID/JID aliases must use existing verified mapping logic rather than string similarity.

Uniqueness is channel/provider/scope aware. Use separate partial indexes so nullable account scope cannot bypass uniqueness:

```text
unique (channel, provider, channel_account_id, identity_scope, external_id)
  where channel_account_id is not null
unique (channel, provider, identity_scope, external_id)
  where channel_account_id is null
```

Persist provider/account-specific state in `endpoint_account_states(channel_account_id, contact_endpoint_id, provider_block_state, provider_status, updated_at)` and transient/cached presence in `endpoint_presence(channel_account_id, contact_endpoint_id, availability, last_seen_at, observed_at, expires_at)`. A separate `contact_suppressions(contact_id, scope, reason, created_by, created_at, revoked_at)` handles explicit customer-wide do-not-contact policy. Conversation-level send restrictions are a resolved policy result. The current `contacts.is_blocked`, `is_online`, and `last_seen` are dual-written to these linked-device projections; a provider block must not silently become a global customer suppression.

### `conversations`

```text
id uuid primary key
channel_account_id uuid not null
external_thread_id text null
client_thread_key text not null
kind text not null              -- direct, group, thread
subject text
provider_status text
provider_metadata jsonb not null default '{}'
legacy_contact_id uuid unique null
first_message_at timestamptz null
last_message_at timestamptz null
created_at timestamptz not null
updated_at timestamptz not null
archived_at timestamptz null
```

Provider identity uses a partial unique key on `(channel_account_id, external_thread_id)` where the provider ID is non-null, and `(channel_account_id, client_thread_key)` is always unique. `client_thread_key` is an immutable account-scoped key for a locally initiated conversation before the provider assigns an ID. A broadcast job is not a conversation unless a provider exposes a real durable broadcast thread. For existing WhatsApp rows, `conversations.id = contacts.id` and `legacy_contact_id = contacts.id`. Equal IDs are a compatibility bridge, not a permanent invariant.

Add `conversation_sync_states(conversation_id, provider, status, cursor_or_anchor, request_generation, last_requested_at, last_completed_at, error_code, updated_at)` as the generic sync projection, with provider-specific cursors encrypted or stored in provider tables when sensitive. This replaces the current contact-level remote-history projection without losing request generation, timeout, exhausted/unavailable, or error semantics.

### `conversation_participants`

```text
id uuid primary key
conversation_id uuid not null
contact_endpoint_id uuid null
workspace_user_id uuid null
participant_kind text not null  -- external, workspace_user, account
role text not null              -- account, owner, admin, member, guest
is_self boolean not null
joined_at timestamptz null
left_at timestamptz null
provider_metadata jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
```

Conversation participants describe membership only; their roles are account/self/member/owner-style roles rather than email envelope roles. Email recipients vary per message, so define:

```text
message_participants
  message_id uuid not null
  ordinal integer not null
  role text not null                 -- from, sender, reply_to, to, cc, bcc
  contact_endpoint_id uuid null
  address_snapshot text not null
  display_name_snapshot text
  provider_metadata jsonb not null default '{}'
  primary key (message_id, role, ordinal)
```

Order is retained per role. Address snapshots preserve the envelope even if an endpoint later changes. BCC rows require stricter authorization and are excluded from ordinary participant payloads, realtime, search, and exports.

### `messages`

The existing `messages` table is extended first:

```text
channel_account_id uuid null
conversation_id uuid null
external_message_id text null
external_identity_scope text null
client_idempotency_key text null
direction text null            -- inbound, outbound, system
sender_participant_id uuid null
reply_to_message_id uuid null
provider_occurred_at timestamptz null
normalized_type text null
subject text null
text_content text null
sanitized_html_content text null
provider_metadata jsonb null
```

The final authority is:

- `conversation_id` for thread membership;
- `external_message_id` for provider identity;
- `direction`, not `from_me`, for normalized direction;
- constrained `sender_participant_id` for the conversation actor, with `sent_by_user_id` retained separately for teammate attribution;
- internal `reply_to_message_id` for an unambiguous quote relation;
- text-based `normalized_type` rather than the legacy PostgreSQL `message_type` enum for extensibility;
- explicit subject, text, and already-sanitized HTML projections for email-like messages;
- `provider_metadata` only for allowlisted information that has no normalized home.

Legacy `whatsapp_connection_id`, `contact_id`, `message_id`, `from_me`, `sender_jid`, and `quoted_message_id` remain dual-written during compatibility. The existing monotonic `seq` and immutable `case_id` semantics remain unchanged.

Provider deduplication uses an adapter-defined identity scope and a partial unique index such as `(channel_account_id, external_identity_scope, external_message_id)` when all identity fields are non-null. Provider IDs must not be assumed account-global: some are thread- or recipient-scoped, and email `Message-ID` is not universally trustworthy. Application-originated idempotency is scoped to account and operation, stores a request fingerprint, and rejects reuse of one key with different semantics.

### `message_attachments`

```text
id uuid primary key
message_id uuid not null
ordinal integer not null          -- unique with message_id
kind text not null
provider_attachment_id text
file_name text
content_type text
byte_size bigint
storage_uri text
provider_locator jsonb
content_id text              -- inline email Content-ID
content_disposition text
status text not null         -- pending, available, failed, deleted
error_code text
provider_metadata jsonb not null default '{}'
created_at timestamptz not null
updated_at timestamptz not null
```

`provider_locator` may hold encrypted/deferred-fetch material only if the existing media security design supports it; it must never be returned directly to clients. Browser access continues through authorized short-lived signed URLs.

Require unique `(message_id, ordinal)` plus a provider-scoped partial identity index when `provider_attachment_id` is present. Current non-null `messages.media_*` values backfill at most one attachment with `ordinal = 0`. Sensitive linked-device deferred-fetch values are mapped losslessly to a provider-only `whatsapp_attachment_fetch_state(attachment_id, direct_path, media_key, file_sha256, file_enc_sha256)` table with the same access restrictions as current media keys, not serialized into generic JSON. WhatsApp album children may remain distinct messages with a provider grouping key; the spine does not silently collapse historical messages.

Scheduled/bulk media exists before a final message row. Add `outbound_intent_attachments(intent_id, ordinal, storage_uri, file_name, content_type, byte_size, provider_metadata)` with unique `(intent_id, ordinal)` and transfer/link those rows to message attachments as dispatch creates messages. Purge and quota accounting cover both pre-send and message attachments.

### `message_delivery_events`

```text
id uuid primary key
channel_account_id uuid not null
message_id uuid not null
recipient_endpoint_id uuid null
external_event_scope text null
external_event_id text null
status text not null
provider_occurred_at timestamptz null
ingested_at timestamptz not null
error_code text
error_detail text
provider_metadata jsonb not null default '{}'
```

This is append-only receipt history. It supports recipient-specific email delivery and bounce outcomes. Adapter-defined `(channel_account_id, external_event_scope, external_event_id)` identity deduplicates provider receipt events when available. The neutral API derives a delivery summary with recipient counts and outcomes such as `accepted`, `partial`, `delivered`, `failed`, and `unknown`; multi-recipient delivery is not forced into one monotonic scalar. Existing `messages.status` remains only the monotonic linked-device compatibility projection and never regresses on delayed WhatsApp events.

`public.message_delivery_outbox` is not this table: it is an internal realtime/push delivery queue whose current service locks `whatsapp_connections`. Keep it unchanged for legacy traffic. Before neutral-only traffic, add a channel-neutral fanout outbox keyed by `company_id`, `channel_account_id`, `conversation_id`, `message_id`, and delivery kind, or migrate the existing queue and guard under an additive compatibility design. A neutral-provider message must never be discarded merely because no `whatsapp_connections` row exists.

### `message_reactions`

Extend reactions with `reactor_endpoint_id`, `channel_account_id`, `external_reaction_id`, `external_event_scope`, `provider_occurred_at`, and allowlisted `provider_metadata`, while dual-writing the current `reactor_jid`. Provider-scoped partial uniqueness makes replay idempotent. Local-only reactions and provider reactions remain distinguishable.

### `channel_event_inbox`

Durable provider ingress needs an explicit idempotency journal:

```text
channel_account_id uuid not null
external_event_scope text not null
external_event_id text not null
kind text not null
payload_digest text not null
normalized_event jsonb not null
status text not null            -- pending, applied, quarantined
attempts integer not null
next_attempt_at timestamptz not null
last_error_code text
received_at timestamptz not null
applied_at timestamptz null
primary key (channel_account_id, external_event_scope, external_event_id)
```

The verified ingress stores a versioned normalized event before acknowledging providers that require durable acceptance. Event application locks the inbox row, applies all domain writes, enqueues external side effects, and marks it applied in one transaction; every effect remains idempotent under crash/replay. Reuse of the same event key with a different digest is quarantined. Raw provider payloads, when operationally required, belong in a provider-specific encrypted/retained inbox rather than generic metadata.

### `outbound_message_intents`

New HTTP/email providers need a provider-neutral transactional outbox instead of overloading the NATS-specific outbox:

```text
id uuid primary key
channel_account_id uuid not null
conversation_id uuid not null
message_id uuid null unique
scheduled_message_id uuid null
operation text not null
idempotency_key text not null
request_fingerprint text not null
normalized_payload jsonb not null
status text not null            -- pending, dispatching, handed_off, confirmed, failed, uncertain
attempts integer not null
next_attempt_at timestamptz not null
lease_token uuid null
lease_expires_at timestamptz null
provider_request_id text null
last_error_code text
created_at timestamptz not null
updated_at timestamptz not null
```

At least one source (`message_id` or immutable `scheduled_message_id`) is required. Immediate sends start with `message_id`; scheduled/bulk sends start with `scheduled_message_id` and may atomically add `message_id` at dispatch without clearing their immutable origin. A scoped unique key on `(channel_account_id, operation, idempotency_key)` prevents duplicate application requests, and the fingerprint rejects conflicting reuse. Claims use PostgreSQL atomic claim, expiring lease tokens, and compare-and-set completion so multiple API replicas cannot dispatch the same intent concurrently. The same stable provider attempt/idempotency key is used across safe retries. If a lease expires after an adapter without provider idempotency may have sent, the intent becomes `uncertain` and is reconciled by provider request/message identity rather than automatically reclaimed. The payload is immutable and contains no credential material.

For linked-device WhatsApp, the legacy send transaction remains unchanged until neutral write authority. At that cutover, the dispatcher atomically hands a generic intent to the existing tenant `nats_outbox` and records that handoff; provider confirmation still determines the terminal result.

### `channel_account_capabilities`

```text
channel_account_id uuid not null
capability_key text not null
support_state text not null      -- supported, unsupported, conditional
configuration jsonb not null default '{}'
revision text not null
observed_at timestamptz not null
updated_at timestamptz not null
primary key (channel_account_id, capability_key)
```

This table is the account-level capability snapshot. Conversation- and time-specific action availability is resolved at request time and may be cached as a projection, but it is not confused with commercial entitlements.

### Shared inbox tables

Add nullable `conversation_id` columns to the current operational tables before changing authority:

```text
conversation_states.conversation_id
conversation_cases.conversation_id
contact_assignments.conversation_id
contact_notes_private.conversation_id
contact_notes_shared.conversation_id
scheduled_messages.conversation_id
```

Introduce `conversation_tags(conversation_id, tag_id)` rather than changing `contact_tags` in place.

Before any neutral-only conversation is enabled, each existing workflow table must permit `contact_id` to be null when `conversation_id` is present. The transition is: backfill, add and validate `CHECK (conversation_id IS NOT NULL OR contact_id IS NOT NULL)`, enforce unique `conversation_states(conversation_id)`, unique active `contact_assignments(conversation_id) WHERE unassigned_at IS NULL`, and unique active `conversation_cases(conversation_id) WHERE status IN ('open','pending')`, migrate the auto-reply uniqueness currently keyed by contact, add remaining conversation history indexes/FKs, switch all writers/locks to conversation IDs, then drop legacy `contact_id NOT NULL`. Legacy contact indexes remain for old rows through the compatibility window. New conversation-only rows are prohibited until that sequence is complete.

Current `contact_notes_private`/`contact_notes_shared` rows and tags are backfilled as conversation metadata because that preserves today's behavior. Migration 019 retained `contacts.notes_shared` after copying it into the shared-note table, so the scalar is audited for unmatched data but is not copied again; this prevents duplicate notes. If customer-profile notes/tags are later required, add explicitly named contact-level resources; do not silently copy one conversation's operational data to every conversation of a merged contact.

Cases retain the snapshotted SLA policy and target minutes. `messages.case_id` continues to identify the exact case active at ingestion. After backfill, composite keys/FKs enforce that `(messages.conversation_id, messages.channel_account_id)` matches its conversation and `(messages.case_id, messages.conversation_id)` matches its case. Policy ownership adds `conversation_cases.company_id`, backfilled from the tenant registry, plus `UNIQUE (company_id, id)` on `public.sla_policies` and a `NOT VALID` then audited/validated composite FK `(company_id, policy_id) → public.sla_policies(company_id, id)`; the current policy FK alone does not prove company ownership. No historical case is fabricated, and no case membership is inferred from a provider timestamp.

### Provider-specific tables

Examples include:

```text
whatsapp_connections / whatsapp_connection_sessions / whatsapp_sessions.*
whatsapp_cloud_accounts / whatsapp_templates / whatsapp_catalogs / whatsapp_labels
meta_oauth_installations / meta_webhook_subscriptions
telegram_bot_accounts / telegram_webhook_state
line_channel_state
viber_bot_state
email_accounts / email_folders / email_sync_cursors / email_thread_state / email_message_state
```

Shared OAuth and webhook libraries are encouraged for the Meta family, but WhatsApp Cloud API, Messenger, and Instagram remain separate adapters.

## Adapter contracts

A provider adapter is the only layer allowed to interpret provider payloads, credentials, address rules, API errors, rate limits, and feature policy.

Illustrative TypeScript shape:

```ts
type Channel =
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "telegram"
  | "line"
  | "viber"
  | "email";

type Provider =
  | "whatsapp_linked_device"
  | "meta_cloud"
  | "telegram_bot"
  | "line_messaging"
  | "viber_bot"
  | "gmail"
  | "microsoft_graph"
  | "imap_smtp";

interface ChannelAdapter {
  readonly channel: Channel;
  readonly provider: Provider;

  verifyAndNormalizeIngress(input: ProviderIngress): Promise<NormalizedChannelEvent[]>;
  resolveCapabilities(context: CapabilityContext): Promise<ResolvedCapabilities>;
  send(intent: OutboundMessageIntent): Promise<ProviderSendResult>;
  perform(action: ChannelActionIntent): Promise<ProviderActionResult>;
}
```

`NormalizedChannelEvent` is a versioned discriminated union, not one optional-field bag. Initial event kinds should cover:

- account status;
- endpoint upsert;
- conversation upsert;
- participant upsert/remove;
- message upsert;
- message edit/delete;
- reaction upsert/delete;
- delivery update;
- attachment availability/failure;
- typing and presence;
- provider sync checkpoint.

Every durable event includes:

```text
contractVersion · eventId · companyId · channelAccountId
channel · provider · kind · providerOccurredAt · receivedAt · payload
```

`companyId` and `channelAccountId` are injected from the authenticated public ingress-route lookup or trusted linked-device session context. Provider payload values can never select a tenant schema and are ignored/rejected if they disagree.

The application transaction deduplicates `eventId` through `channel_event_inbox` and applies normalized writes. An adapter defines the event identity scope and a deterministic fallback for legacy/provider envelopes without stable event IDs; reuse with a different payload digest is quarantined. Durable and transient events remain separate. A typing event must never share backlog or retention behavior with a message or delivery event.

### Linked-device anti-corruption adapter

The first adapter wraps, rather than replaces, the current protocol:

```text
existing WHATSAPP.events.*
        │
        ▼
WhatsAppLinkedDeviceAdapter
        │
        ▼
NormalizedChannelEvent v1
        │
        ▼
neutral event application service
```

Before write-authority cutover, outbound sends continue using the existing tenant `nats_outbox` and `WHATSAPP.commands.*` subjects. After cutover, a generic `outbound_message_intents` dispatcher calls the linked-device adapter, which durably hands the command to that existing NATS outbox. The existing Go envelope, session-ID resolution, subject filters, durable consumers, worker outbox, and orchestrator lifecycle remain untouched initially.

New generic subjects, if eventually needed, must be versioned and use new durable consumers. Existing `WHATSAPP.*` filters must not be edited or renamed in place.

## Capabilities

A boolean interface is useful to the UI but is insufficient by itself because availability can depend on account configuration, conversation kind, recipient, time window, and provider policy.

```ts
interface ChannelCapabilities {
  typing: boolean;
  readReceipts: boolean;
  reactions: boolean;
  messageEditing: boolean;
  messageDeletion: boolean;
  templates: boolean;
  groups: boolean;
  multipleRecipients: boolean;
  outboundInitiation: boolean;
  scheduledMessages: boolean;
}

interface ComposerTypeDescriptor {
  type: string;
  enabled: boolean;
  maxTextLength?: number;
  caption?: { enabled: boolean; maxLength?: number };
  attachment?: {
    maxBytes?: number;
    maxCount?: number;
    acceptedContentTypes?: string[];
    albums?: boolean;
  };
  templateRequired?: boolean;
  unavailableReasonCode?: string;
}

interface ResolvedCapabilities extends ChannelCapabilities {
  messageTypes: ComposerTypeDescriptor[];
  actions: {
    reply: boolean;
    quote: boolean;
    forward: boolean;
    retry: boolean;
    starLocally: boolean;
    deleteLocally: boolean;
    deleteForEveryone: boolean;
    groupMentions: boolean;
    remoteHistory: boolean;
  };
  attachment: {
    enabled: boolean;
    maxBytes?: number;
    maxCount?: number;
    acceptedContentTypes?: string[];
  };
  constraints: Record<string, unknown>;
  unavailableReasons: Partial<
    Record<keyof ChannelCapabilities, { code: string; message: string }>
  >;
  version: string;
}
```

The booleans are compatibility summaries: `readReceipts` means provider receipt exchange, while teammate unread state is always an inbox feature; `messageDeletion` means provider-side delete/revoke, while local soft delete is a separate action. The adapter publishes account-level support. Scheduling is primarily a server-side inbox policy layered over whether the provider can send the selected content at dispatch time. A policy resolver derives current conversation/action availability. For example, WhatsApp Cloud may support outbound initiation only through an approved template outside a service window; the adapter capability is supported while free-form initiation is currently unavailable.

Rules:

1. API routes enforce resolved capabilities; UI hiding alone is not enforcement.
2. The composer consumes one capability object for the selected conversation.
3. Message action menus consume message- and conversation-specific capabilities.
4. Provider-specific components may be registered extension points, but generic components do not switch on channel/provider.
5. Commercial entitlements are checked separately and can further restrict an otherwise supported action.
6. Capability changes are versioned and invalidate the relevant client query/realtime projection.
7. Provider extension capabilities cover group administration, mentions, remote history, labels, catalogs, status/stories, templates, albums, caption/text limits, edit/delete windows, and per-message-type attachment limits without adding channel checks to core code.

## Contact resolution and merging

### Resolution

Adapters upsert endpoints using provider-defined exact identity. They may create an unresolved endpoint before a human contact exists. Identity resolution can then:

- auto-link only on a previously verified exact endpoint identity;
- suggest candidates from normalized phone/email/profile evidence;
- require a user decision for cross-channel or ambiguous matches;
- refuse person merges involving group, bot, shared-mailbox, or organization endpoints unless an explicit supported workflow exists.

Names, avatars, usernames, and phone-like strings are evidence, not durable identity keys.

### Merge transaction

Persist merge history in `contact_merge_events(id, source_contact_id, target_contact_id, actor_user_id, reason, endpoint_snapshot, created_at)` plus endpoint reassignment audit rows. `contacts.merged_into_contact_id` has a self-FK, cycle prevention, and at most one active canonical target.

A contact merge:

1. locks source and target contacts in deterministic UUID order;
2. verifies both are canonical, active, and in the same tenant schema;
3. reassigns eligible `contact_endpoints.contact_id` rows to the target;
4. records an immutable merge event with actor, reason, source, target, and a non-secret snapshot;
5. marks the source `merged_into_contact_id = target.id`;
6. updates the customer search projection;
7. leaves all conversations, participants, messages, assignments, cases, unread state, SLA, notes, and tags in place.

Contact-profile routes resolve alias IDs to the canonical contact. Conversation routes resolve exact `conversations.id`, then exact `conversations.legacy_contact_id`, and never follow customer merge aliases; otherwise merging a contact could redirect an old chat URL to a different conversation. Merge activation is blocked until all inbox workflow and route semantics are conversation-scoped. Before that point, the system may generate merge suggestions but must not execute merges.

An unmerge operation should be supported only while endpoint ownership and subsequent edits can be restored without ambiguity. Otherwise correction creates a new contact and reassigns selected endpoints with a full audit trail.

## API and client evolution

### New resources

Add versioned or additive resources without changing current response meaning:

```text
GET  /api/channel-accounts
GET  /api/channel-accounts/:id/capabilities
GET  /api/conversations
GET  /api/conversations/:conversationId
GET  /api/conversations/:conversationId/capabilities
GET  /api/messages/:messageId/capabilities
GET  /api/conversations/:conversationId/messages
POST /api/conversations/:conversationId/messages
GET  /api/contacts/:contactId/endpoints
POST /api/contacts/:targetId/merge
```

Provider-native groups, status/stories, labels, catalogs, history, and account lifecycle routes remain explicit extension surfaces discovered through capability keys and authorized by their existing policies; they are not forced into generic message actions. Existing routes remain compatibility façades during migration. In particular, existing `/api/conversations/:id/*` continues accepting the exact legacy contact/conversation bridge ID without contact-merge canonicalization, and `/api/messages` continues accepting `contactId` until clients migrate to `conversationId`. Existing WhatsApp connect/status routes and NATS contract v1 retain their exact meaning during this window; deprecated send routes retain their current deprecation headers until the API removal version.

### Response types

Introduce neutral fields before deprecating old ones:

```ts
interface ConversationSummary {
  id: string;
  channelAccount: ChannelAccountSummary;
  kind: "direct" | "group" | "thread";
  subject?: string;
  participants: ParticipantSummary[];
  primaryContact?: ContactSummary;
  capabilities: ResolvedCapabilities;
  assignment?: AssignmentSummary;
  unreadCount: number;
  activeCase?: CaseSummary;
  lastMessage?: MessageSummary;
}
```

`Message` adds `externalMessageId`, `direction`, `senderParticipant` (including its endpoint when external), `attachments`, and delivery summary. `whatsappMessageId` and JID fields remain deprecated aliases only for linked-device compatibility.

### Realtime

Introduce neutral payloads that always carry `conversationId` and, where relevant, `channelAccountId`. Keep current event names when their semantics are already neutral, but version payloads before changing field meaning.

Before versioning payloads, consolidate or mechanically verify the three realtime registries in `packages/shared/src/websocket-types.ts`, `apps/api/src/lib/realtime.ts`, and `apps/web/src/lib/realtime.ts`; they already have compatibility drift around `history:loaded`. Migrate `conversation:read.contactId` to `conversationId`, assignment payloads to conversation IDs, notification action URLs to `/chat/:conversationId`, and mute preferences from JIDs to conversation IDs. Because the same JID can exist on several linked accounts, one legacy muted JID maps to all matching account-scoped conversations unless the user explicitly chooses narrower behavior. During compatibility, the bridge IDs make old links valid for existing WhatsApp conversations.

PostgreSQL remains source of truth. Realtime events invalidate/refetch projections and never become the only durable state transition.

### Search, exports, analytics, and MCP

Message search documents add `conversationId`, `channelAccountId`, `channel`, `provider`, contact IDs, participant names/addresses safe for search, and attachment filenames. Authorization filters use conversation visibility, not contact visibility. Reindex into a new versioned index and use Meilisearch's atomic index-swap operation (or an application-level read-index switch); do not mutate the only production index in place.

Contact search becomes customer-level and endpoint-aware. Conversation search is a separate index/projection. The index switch covers query, indexing outbox, deletion, connection purge, and `purge_cleanup_items` together. PostgreSQL fallback remains fail-closed and conversation-visibility aware for restricted users before the new index is selected.

Exports add an explicit v2 format/route that distinguishes contact, endpoint, conversation, participant, and message IDs. Existing v1 column names, pagination, filenames, and meanings are never silently renamed or repurposed. Provider metadata and credentials are excluded by default.

Analytics use conversation and case IDs; channel/provider become dimensions. Existing historical case boundaries and message `seq` remain authoritative.

MCP tools accept `conversationId` for conversation actions, and every tool-list change bumps `MCP_SERVER_VERSION` with its version test because clients cache tool discovery. Contact tools operate only on customer profile/endpoints. Legacy `contactId` inputs receive a deprecation period and unambiguous bridge resolution. The first-outgoing-chat acknowledgment and audit entity also migrate to a conversation policy/action; merging contacts must neither bypass it nor require one conversation's acceptance for every other channel thread. Auto-replies are likewise conversation- and capability-scoped, direct-thread only by default, and re-check assignment, case, block/suppression, service-window, and send capability at dispatch. Provider labels map explicitly to workspace tags through `(channel_account_id, provider_label_id, tag_id)` and apply to conversations; existing WhatsApp label routes continue dual-writing their provider mapping.

## Migration and rollout plan

The phases below are not ceremony. Additive schema, dual-write, shadow parity, flagged neutral reads, and a fenced single-writer handoff are how a live WhatsApp inbox adopts a channel-neutral spine without renaming provider tables or rewriting authoritative rows in one shot. Skipping ahead to rename, mixed API authority, or an unfenced cutover is out of scope for this program.

### Phase 0 — contract freeze and characterization

Before schema work:

- inventory every contact-as-conversation read/write, route, query key, event, notification URL, export column, analytics query, and MCP tool;
- add characterization tests for direct chat, group chat, multiple linked accounts, delivery uncertainty, history import, case open/reopen, scheduled sends, search, and visibility;
- record a compatibility matrix for schema, API, linked-device worker, orchestrator, subjects, and durable consumers;
- define architecture import boundaries so provider packages cannot leak into inbox/domain packages;
- introduce a deployment-neutral `public.channel_spine_workspace_flags` authority keyed by `company_id`, carrying dual-write/read/write-authority/provider-enable revisions and audited actor/timestamps; all modes default off/legacy, reads fail closed, and cutover uses cross-replica invalidation or zero caching.

Exit criterion: current linked-device behavior has tests that can prove no observable change.

### Phase 1 — additive schema only

Create neutral tables and nullable bridge columns. Run read-only orphan, uniqueness, and cardinality preflights first. Use bounded lock/statement timeouts for metadata DDL and immediate abort thresholds for lock pressure. Add foreign keys as `NOT VALID` where existing tenant data may contain historical orphans. Build large indexes through a checkpointed non-transactional concurrent-index runner because `executeOnAllTenants()` migrations are transactional and `CREATE INDEX CONCURRENTLY` cannot run there; preflight every unique index because uniqueness cannot be `NOT VALID`. The runner verifies each catalog definition and validity bit, deterministically drops/retries invalid concurrent indexes, and cannot mark its checkpoint complete until every expected index is valid.

Do not:

- rename a table or column;
- add an immediately validated foreign key across a hot large table;
- add a required backfilled column in one blocking transaction;
- rewrite `messages`;
- create historical cases;
- alter existing NATS subjects or consumers.

All legacy application reads and writes remain authoritative. With flags off, the schema is behaviorally unused, but DDL can still lock tables, consume connections, or fail deployment and therefore requires the same production controls as any migration.

### Phase 2 — dual-write foundation and continuous reconciliation

Deploy the neutral-aware API/reconciler before bulk backfill so new legacy writes cannot fall permanently behind a completed checkpoint. Each dual-write transaction first idempotently ensures its deterministic channel-account/endpoint/conversation parent graph; tenants with unresolved parents write a durable reconciliation journal and remain legacy-only rather than failing the customer operation. Update API event application and outbound paths to maintain legacy and neutral structures in the same tenant transaction; legacy remains authoritative. Run all API replicas on this authority-aware revision before enabling dual write.

Mixed API revisions are prohibited by default during dual-write and authority transitions. A release may overlap only if a release-specific suite proves identical NATS consumer contracts, old-writer DML compatibility, idempotent anti-join repair, and consistent authoritative flags. No neutral-only provider is permitted while an old API runs.

The continuous reconciler measures account, endpoint, conversation, message, attachment, workflow, outbox, and delivery parity and repeatedly repairs rows omitted by an old/failed writer.

### Phase 3 — deterministic bounded backfill

Use an idempotent, resumable backfill with per-tenant checkpoints and repeated anti-join sweeps rather than a monolithic migration transaction.

For each tenant:

1. copy `whatsapp_connections` to `channel_accounts` with the same UUID;
2. treat each existing non-group contact row as the initial customer contact, while retaining group rows only as legacy projections;
3. create one endpoint from `(whatsapp_connection_id, jid)` without guessing null/ambiguous ownership; direct endpoints link to the initial contact, while group endpoints keep `contact_id` null;
4. create one conversation using every eligible legacy contact UUID, including group conversations, with `client_thread_key` deterministically derived from that UUID;
5. create account/self and external participants;
6. set neutral message fields in bounded primary-key/sequence batches;
7. create at most one attachment for existing inline media;
8. set workflow `conversation_id = contact_id` where the deterministic conversation exists;
9. copy current tags to `conversation_tags`;
10. map `groups`/`group_participants` into conversation participants with owner/admin/member roles, preserve unresolved JIDs as unlinked endpoints, and keep WhatsApp-only group settings in the provider projection;
11. quarantine ambiguous/orphan rows for explicit repair instead of attaching them to an arbitrary account.

Backfill `external_message_id` only for confirmed provider IDs. Values with the current `pending_<uuid>` form remain application identities and must not be misclassified as provider-issued IDs. Never backfill `messages.seq`, assign pre-061 messages to cases, or reinterpret provider timestamps.

Finish with a watermark/barrier and repeated no-gap anti-join scans; a one-pass UUID or `seq` checkpoint is insufficient because old writers may race and pre-061 rows have null `seq`.

### Phase 4 — linked-device normalization shadow

Translate current WhatsApp events into normalized events in shadow mode. Use an in-process tee after authoritative decode/validation; the shadow validator cannot ACK independently, bind to the authoritative durable/queue group, or perform side effects. It compares normalized identity, conversation, message, attachment, ordering, and terminal outcome with the legacy handler.

Keep existing WhatsApp subjects and durable consumers authoritative. If a broker-level mirror is later required, it uses new versioned subjects/durables provisioned before publishers, explicit retention/backlog monitoring, and a retirement runbook. Test duplicate delivery, NATS outage/replay, delayed receipts, history import, disconnect/reconnect, and API/orchestrator restart.

Exit criterion: zero unexplained durable event mismatches over an agreed observation window.

### Phase 5 — neutral reads for linked-device WhatsApp

Enable read paths one subsystem at a time for an allowlisted test workspace:

1. channel accounts and capabilities;
2. endpoint resolution;
3. conversation list and participants;
4. messages, quotes, and attachments;
5. assignment and unread state;
6. cases and SLA;
7. notes and tags;
8. scheduling, search, notifications, exports, analytics, and MCP.

Each switch has a legacy fallback and parity telemetry. The public API compatibility façade remains in place.

### Phase 6 — neutral linked-device write authority

After all reads are neutral and workflow legacy columns have completed the nullable/constraint transition, switch one test workspace's inbound event application and outbound intent dispatcher to the linked-device adapter. Every API replica must already run the authority-aware revision. Perform a fenced handoff: block scoped outbound admission, stop/lock scoped outbox claims, verify scoped database and NATS pending/ack-pending work, and take the same workspace PostgreSQL advisory/row lock used by every event applicator. Wait for pre-switch handlers to commit, atomically change authority, prove exactly one inbound mutator and that every later handler observes the new authority, then resume. The adapter still emits the existing NATS commands and consumes the existing WhatsApp events.

Required invariants include:

- pending message plus outbound intent committed atomically;
- external message ID adoption is idempotent;
- uncertain send does not invite unsafe automatic retry;
- delivery status is monotonic;
- case membership is fixed at ingestion;
- critical/history/transient event lanes remain isolated;
- worker session recovery requires no QR after ordinary restart.

### Phase 7 — first additional provider

Only after the existing provider works entirely through the spine should one additional provider be enabled for isolated test tenants. WhatsApp Cloud API is a strong validation of channel/provider separation; Telegram is a simpler validation of webhook/bot lifecycle. The implementation team should select one based on test-account and operational readiness, not add several adapters simultaneously.

A new provider starts disabled, uses separate credentials and webhook routes, and cannot share production customer traffic until its capability, retry, rate-limit, webhook replay, deletion, attachment, delivery, purge, and bulk-recipient behavior pass adapter conformance tests. Before bulk support is enabled, jobs store immutable channel-account/endpoint/conversation recipient snapshots; account budgets replace `bulk_connection_budgets.whatsapp_connection_id`, and each adapter owns eligibility, pacing, daily/provider limits, and skip reasons without using JID-based deduplication.

### Phase 8 — contact merge

Enable merge suggestions first. Enable actual merges only after:

- all workflow ownership is conversation-scoped;
- contact and conversation routes have distinct IDs/semantics;
- search and notifications resolve aliases safely;
- purge/export/audit workflows understand endpoints and merge history;
- correction/unmerge behavior is tested.

### Phase 9 — legacy retirement

Only after evidence shows no deployed old writer, no queued legacy-only work, zero compatibility telemetry, completion of the client/API deprecation window, documented rollback compatibility, a successful restore drill, and explicit maintenance approval:

- stop treating WhatsApp columns on `contacts` as authoritative;
- sever remaining legacy group-row references, archive/remove `legacy_group_projection` rows, and retain group identity only in conversations/endpoints/provider tables;
- stop accepting contact IDs for conversation operations;
- stop dual-writing inline message media and legacy message identity fields;
- retain provider-specific WhatsApp account/session/catalog/label tables behind the adapter;
- validate required neutral constraints;
- remove compatibility columns only in a separate reviewed maintenance release.

Database migrations remain forward-only in production. Application rollback keeps additive schema and neutral rows rather than running destructive down migrations.

## Production-safety plan

Hosted production was inspected read-only while preparing this RFC; the operational evidence remains in the private operations record and is intentionally not copied into this public design. Any hosted deployment must reconcile its effective manifest and verify schema/image/protocol compatibility before rollout.

Consequences:

1. **This RFC branch must not be deployed.** It contains documentation only. The additive → dual-write → shadow → fenced-cutover sequence in the migration plan is the only approved shape for later implementation work.
2. Production configuration reconciliation is a prerequisite to any spine rollout.
3. Do not use the legacy full-stack deployment command for this program.
4. Build and apply must be separate; apply must consume a reviewed immutable manifest.
5. Early phases target only compatible migration/API/web changes and explicitly preserve the running worker and orchestrator image identities and effective environment. Any later API/worker/orchestrator change requires a release-specific schema/protocol matrix and the complete reconciled manifest.
6. Every production action still requires explicit approval, a checkpoint, exact intended revisions, and service-level rollback commands.

### Pre-production environments

Use a separate Compose project with:

- disposable PostgreSQL and NATS volumes;
- separate Meilisearch index namespace;
- local object storage or a dedicated test bucket;
- fake provider servers and signed webhook fixtures;
- a dedicated non-customer linked-device account only for final integration tests;
- no production credentials, tenant IDs, messages, media, or database snapshots.

Required drills:

- fresh tenant creation and migration from representative old schema fixtures;
- bounded backfill interruption/resume;
- old/new API mixed-version writes;
- duplicate and out-of-order provider events;
- NATS and provider outage recovery;
- attachment deferred download and deletion;
- capability changes during an open composer;
- linked-device worker/orchestrator/API restarts;
- application rollback with additive schema retained;
- search index version rebuild and atomic index swap/read-index switch;
- merge/correction without conversation movement;
- connection/account purge, reset, media retention, and export across every new relation and outbox.

### Production rollout gates

A later implementation may proceed only when all of these are true:

- effective production manifest is reconciled;
- migrations pass fresh, upgrade, interruption, and tenant-reconciliation tests;
- all new constraints have orphan reports and bounded validation plans;
- shadow parity is complete for every production tenant, not a sample;
- no old API runs before a neutral-only provider is enabled;
- critical/history/transient event coverage is mechanically exhaustive;
- adapter idempotency and uncertain-send behavior pass conformance tests;
- search, notifications, exports, analytics, and MCP pass visibility tests;
- purge/reset/retention paths define and test cascade-versus-restrict order for every neutral table before dual-write authority or a new provider;
- feature flags can disable every neutral read/write/provider independently;
- backups and an isolated restore drill are current;
- exact service images and prior compatible images are retained.

### Canary order

For a separately approved deployment:

1. apply additive schema with all flags off;
2. verify health, locks, query latency, and legacy messaging;
3. deploy the neutral-aware dual-write/reconciliation API to every replica and verify legacy behavior;
4. enable bounded backfill and stop on anomaly thresholds;
5. complete no-gap parity sweeps, then enable shadow normalization only;
6. enable neutral reads for a dedicated internal workspace;
7. enable neutral linked-device writes for that workspace;
8. enable one new provider for a dedicated test account;
9. expand workspace allowlists gradually;
10. enable contact merging last.

Do not canary by moving a real customer conversation between legacy and neutral authority mid-send. Select whole workspaces and use the fenced single-writer handoff described in Phase 6; draining outbound intents alone is insufficient.

### Rollback

Rollback is flag-first:

1. suspend new outbound admission before dispatch and preserve uncertain sends without retry;
2. keep ingress accepting only when it can durably retain verified events; otherwise return retryable failures rather than acknowledge and drop;
3. drain or durably retain neutral queues under defined backlog/retention limits;
4. return linked-device reads/writes to the legacy path only when the selected image still preserves all accepted neutral data;
5. keep a neutral-provider containment/read-only path for traffic already accepted by providers that legacy code cannot serve;
6. roll back API/web images only to versions verified compatible with the additive schema and accepted provider data;
7. retain neutral tables, inboxes, outboxes, delivery events, and provider events for reconciliation;
8. never clear NATS, delete outbox rows, reuse idempotency keys, or remove provider IDs to force retry.

A rollback across an existing orchestrator hard boundary requires a release-specific recovery plan, stopped writers/orchestrators, a quantified data-loss window, compatible PostgreSQL/media/NATS state, and explicit approval for destructive restore; it is not a generic image-tag or checkpoint operation. The channel-neutral program should avoid crossing those boundaries by leaving the orchestrator and linked-device worker untouched until the adapter cutover is independently proven. Once a neutral-only provider has accepted traffic or a contact merge has executed, disabling flags stops further effects but does not make legacy code authoritative for that new data; recovery must preserve and replay the neutral inbox/intents and use a version that understands them.

## Testing strategy

### Adapter conformance suite

Every adapter must pass the same contract tests for:

- account and route identity;
- ingress signature verification;
- event deduplication and replay;
- endpoint normalization and scope;
- direct/group/thread participant semantics;
- outbound idempotency;
- success, permanent failure, transient failure, rate limit, and uncertain outcome;
- receipt ordering and status monotonicity;
- edits, deletes, reactions, and unsupported actions;
- attachment count/size/type policy and deferred download;
- capability resolution;
- credential redaction and metadata allowlisting.

Unsupported features are explicit capability results, not unimplemented exceptions.

### Database tests

Extend `packages/database` integration tests to cover:

- fresh schema and every supported upgrade fixture;
- one-to-one deterministic bridge IDs;
- null/ambiguous legacy rows quarantined rather than guessed;
- tenant-qualified FKs and no cross-schema references;
- message/event idempotency under concurrency;
- bounded resumable backfill;
- workflow `conversation_id` parity;
- immutable historical case membership;
- merge concurrency, aliases, and correction;
- purge behavior across contacts, endpoints, conversations, messages, and media.

### API and web tests

Add tests for:

- legacy and neutral route parity;
- conversation-based visibility and assignment;
- capability-driven composer/actions;
- dynamic service-window restrictions;
- multiple conversations sharing one contact;
- one conversation with multiple/no canonical contacts;
- email recipient roles;
- notification navigation and mute semantics;
- realtime duplicate/out-of-order events;
- versioned search and reindex;
- export and MCP compatibility.

### Architecture tests

Provider packages may depend on normalized contracts; normalized domain and inbox packages may not import provider packages. Channel/provider conditionals outside adapters, adapter registration, capability policy, provider-specific UI extension points, and migration compatibility code should fail a structural test or lint rule.

## Security and privacy

- Verify webhook signatures against raw request bytes before parsing.
- Resolve the tenant through a minimal service-only route directory and then use the existing tenant database boundary.
- Encrypt provider refresh/access tokens or reference file-backed secrets; never store them in generic JSON.
- Use distinct webhook secrets and least-privileged provider credentials per account where possible.
- Redact recipient addresses, provider responses, tokens, MIME bodies, and customer content from logs.
- Sanitize email HTML and block remote-content tracking by default in the client.
- Prevent SSRF in provider media fetches with provider allowlists, redirect limits, DNS/IP validation, size limits, timeouts, and content verification.
- Exclude BCC and credential/provider metadata from unauthorized exports, realtime, search, and analytics.
- Keep endpoint and merge records tenant-local; never perform global cross-tenant identity resolution.
- Extend deletion/purge workflows before enabling new providers or merges.

## OSS/private boundary

OSS owns the channel-neutral spine and the public adapter contract:

- normalized contracts and tenant schema;
- adapter interface, registration, and conformance tests;
- generic webhook verification/routing primitives;
- provider adapters intended for self-hosted use (starting with the linked-device anti-corruption adapter);
- single-host dispatch/runtime correctness;
- generic capability-driven API and UI;
- tenant-safe migration, backfill, audit, and reconciliation tooling.

Some provider adapters may remain private for product reasons while still implementing the public OSS adapter interface and passing the same conformance suite. The spine must not depend on private adapter source; private adapters plug in through registration only. Do not document private adapter inventory, roadmap, or competitive comparisons in this repository.

The private control plane retains:

- plans, prices, Stripe, entitlements, quotas, and add-ons;
- hosted provider-account provisioning policy;
- multi-host placement, fleet capacity, failover, drains, and rollout coordination;
- DigitalOcean-specific automation;
- hosted observability and operator lifecycle execution;
- production provider credentials and commercial policy;
- any private provider adapters and their operational playbooks.

The generic capability model says what an adapter/account/conversation can do. It does not decide what a customer has purchased.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Contact remains confused with conversation | Add explicit IDs and migrate workflow ownership before enabling merge. |
| Wrong cross-channel contact merge | Exact scoped endpoint keys, suggestions only for weak evidence, audited manual merge. |
| Message loss during protocol cutover | Keep legacy WhatsApp subjects authoritative; shadow first; new versioned consumers before publishers. |
| Duplicate sends | Transactional outbound intent, provider idempotency keys, explicit uncertain outcomes, no blind retry. |
| Blocking tenant migrations | Nullable/additive DDL, bounded lock timeouts, resumable backfill, `NOT VALID` FKs. |
| Old API omits shadow writes | Prohibit mixed revisions by default; prove any overlap; continuously reconcile before authority. |
| Capability checks spread through code | Adapter registry, centralized resolver, API enforcement, architecture tests. |
| Email overwhelms generic message shape | Normalize recipients/attachments/threading explicitly and keep MIME/provider state in email tables. |
| Search leaks endpoint data | Conversation visibility filters, safe indexed fields, versioned indexes, authorization tests. |
| Contact merge corrupts SLA/history | Never move conversations/cases/messages during merge. |
| Provider payload becomes a data dump | Allowlists, retention policy, redaction, explicit normalized fields. |
| Hosted orchestration leaks into OSS | Enforce the documented single-host/private-fleet boundary. |

## Rejected alternatives

### Rename `whatsapp_connections` to `connections`

Rejected. It hides provider-specific state, creates a vague abstraction, and does not separate contacts from conversations. It also encourages treating a live provider credential and session table as a generic channel account, which is exactly the cheaper-looking disaster this RFC avoids. `whatsapp_connections` remains a linked-device provider table behind `channel_accounts`, reached only through an anti-corruption adapter until a separately proven cutover.

### Add `channel` columns to current contacts and messages only

Rejected. It cannot represent several endpoints per person, changing email recipients, multiple threads per contact, or contact merge without conversation merge. It also leaves assignment, unread state, cases, and SLA keyed by the wrong identity and invites a false sense that omnichannel is “done” after a few nullable columns.

### One adapter method with a large optional payload

Rejected. It becomes an untyped lowest-common-denominator protocol. Use versioned discriminated events and provider extension points.

### Put all provider fields in JSON

Rejected. Identity, deduplication, authorization, threading, recipients, delivery, search, and SLA need normalized indexed columns. JSON is reserved for allowlisted extensions.

### Rewrite all existing WhatsApp rows in one release

Rejected. It creates outage-sized lock, rollback, and protocol risk on a live messaging system. Use additive bridge columns, bounded backfill, dual write, shadow validation, flagged neutral reads, and a fenced authority handoff instead. Heavy sequencing is intentional; a one-release rewrite is not an acceptable trade for schedule.

### Merge conversations when contacts merge

Rejected. Conversations have distinct channels, provider rules, participants, assignments, unread state, cases, and SLA clocks.

## Workstreams

1. **Architecture boundaries and characterization tests**
2. **Neutral schema and migration/reconciliation framework**
3. **Bounded backfill and parity tooling**
4. **Adapter SDK and linked-device anti-corruption adapter**
5. **Conversation-based workflow migration**
6. **Capability-driven API/composer/actions**
7. **Realtime, search, notification, export, analytics, and MCP migration**
8. **First additional provider adapter**
9. **Contact resolution, merge, correction, and audit**
10. **Legacy deprecation and maintenance cleanup**

Each workstream should be a separate RFC implementation plan or a small series of reviewable PRs. No PR should combine schema authority cutover, a new provider, and contact merge.

## Acceptance criteria

The channel-neutral spine is complete when:

- the inbox can show linked-device WhatsApp through the neutral read/write path with no behavior regression;
- a second provider can create accounts, endpoints, conversations, participants, messages, attachments, and delivery events without modifying shared inbox logic;
- composer and message actions are capability-driven;
- assignment, unread state, cases, SLA, operational notes, and tags use conversation IDs;
- a contact can own several endpoints and conversations;
- a conversation can contain several participants and need not resolve to one contact;
- merging contacts leaves all conversation histories and workflow state unchanged;
- legacy APIs have a documented deprecation and rollback window;
- migration parity, tenant isolation, idempotency, search visibility, and adapter conformance tests pass;
- linked-device workers and orchestrator remain recoverable without session re-pairing;
- production rollout remains a separate explicitly approved operation using a reconciled effective manifest.

## Open decisions for implementation planning

1. Select the first non-linked-device adapter: WhatsApp Cloud API or Telegram Bot.
2. Define provider payload retention periods and the encryption mechanism for provider-specific secrets.
3. Decide whether customer-profile notes/tags are needed in addition to conversation notes/tags.
4. Choose the public API versioning/deprecation mechanism and duration.
5. Define the exact account status vocabulary and endpoint identity scopes for each initial adapter.
6. Decide whether email is first implemented through one API provider or a Gmail/Graph/IMAP family, while keeping the domain model provider-neutral.

These decisions do not block linked-device characterization. Any decision that changes schema must be resolved before the additive schema migration is frozen; provider-specific decisions must be resolved before that provider is enabled.
