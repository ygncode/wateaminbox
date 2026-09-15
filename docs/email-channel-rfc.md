# Email channel — implementation plan

Status: draft for decision. Answers open question 6 of
[`channel-neutral-spine-rfc.md`](./channel-neutral-spine-rfc.md) ("decide
whether email is first implemented through one API provider or a
Gmail/Graph/IMAP family").

## What already exists

The spine was designed with email in mind, so this is mostly implementation,
not redesign:

- `CHANNELS` already contains `email`; `PROVIDERS` already contains `gmail`,
  `microsoft_graph`, and `imap_smtp` (`packages/shared/src/channel-spine/contracts.ts`).
- `MessageUpsertEventPayload` already carries `subject` and
  `sanitizedHtmlContent`. **No contract change is needed for HTML bodies.**
- `ExternalConversationReference` already carries `subject` and a `thread` kind.
- `sync.checkpoint` is already a durable event kind — the spine anticipated
  pull-based providers.
- `channel_account_credentials` already stores encrypted per-account secrets and
  upserts on conflict, so OAuth refresh-token rotation needs no schema change.
- `channel_ingress_routes` already gives us hashed, revocable public callback
  routes, if a push provider is added later.

The only email code in the tree today is `apps/api/src/lib/mail/`, which is
outbound transactional mail (Resend). It is unrelated to this work.

## Correction: "Basic Auth or OAuth2 (Gmail/Outlook)" is not the real matrix

Basic authentication is no longer available for the two providers named:

- **Google** permanently disabled username+password authentication for
  IMAP/POP/SMTP in May 2025. The remaining non-OAuth option is a 16-character
  **app password**, which requires 2-Step Verification and is itself being
  phased out during 2026.
- **Microsoft** is disabling SMTP AUTH basic authentication by default for
  existing tenants at the end of December 2026, is already unavailable by
  default for tenants created after that, with final removal announced for
  the second half of 2027. IMAP/POP themselves are not deprecated — only basic
  auth over them.

So the matrix is not "Basic Auth *or* OAuth2 per provider". It is:

| Provider | Auth | Notes |
| --- | --- | --- |
| `gmail` | OAuth2 only | Gmail API, not IMAP |
| `microsoft_graph` | OAuth2 only | Graph API, not IMAP |
| `imap_smtp` | password / app password | everything else: Fastmail, Zoho, cPanel, self-hosted |

Building password auth *for Gmail and Outlook specifically* would ship a
feature with a known expiry date. `imap_smtp` with password auth remains
correct and necessary — for the long tail of providers that have no OAuth app
at all — and a Gmail app password will keep working there until Google removes
it. It should just not be the recommended path for Gmail or Outlook.

## The one real architecture gap: pull ingress

`ChannelAdapter.verifyAndNormalizeIngress(input: ProviderIngress)` is
push-shaped. It assumes a provider POSTs to us and the adapter verifies a
signature. That is true of Telegram and WhatsApp Cloud. It is not true of email:

- **IMAP** has no webhook at all. IDLE holds a connection open; otherwise poll.
- **Gmail** can push via `watch` + Cloud Pub/Sub, but that needs a GCP project
  and a public endpoint. `history.list` polling needs neither.
- **Graph** can push via subscriptions, but they expire and need renewal. Delta
  query polling needs neither.

All three work on pull. Only IMAP *cannot* do push. So the plan adds a pull
ingress contract alongside the existing push one:

```ts
export interface ChannelSyncAdapter {
  sync(input: ChannelSyncInput): Promise<{
    events: NormalizedChannelEvent[];
    nextCheckpoint: string;
    hasMore: boolean;
  }>;
}
```

A provider implements `ChannelAdapter`, `ChannelSyncAdapter`, or both. This is
additive: no existing adapter changes.

**Recommendation: polling only for v1.** IMAP IDLE, Gmail Pub/Sub, and Graph
subscriptions are latency optimizations that layer onto the same loop later, and
each drags in infrastructure (a public endpoint, a GCP project, renewal timers).
Ship correct-and-slower first; a 60-second poll is acceptable for email, which
is not an instant-messaging medium.

### Scheduler constraints

Two facts from the current production topology shape this:

1. **Production runs two API replicas** (`api-17`, `api-18`). A naive
   `setInterval` would poll every mailbox twice and double-ingest. Polling must
   be single-flight per account, via a database-leased claim — the same pattern
   `channel_message_delivery_outbox` already uses for delivery fanout.
2. **Sync cursors belong in a provider-specific table**, not in
   `provider_metadata`, which the spine RFC (line 334) defines as an
   allowlisted non-secret projection. So: a new `email_sync_state` table keyed
   by `channel_account_id`, holding the checkpoint, lease owner, lease
   expiry, consecutive failure count, and last error code.

Do **not** put this in the orchestrator. That machinery is WhatsApp-session
shaped — process supervision, node fencing, pairing — and email needs none of
it. A leased poll loop inside the API process is the right weight, and it keeps
the single-host deployment story intact.

## Identity, threading, and the echo problem

**Message identity is `Message-ID`** — the RFC 5322 header — on both the sync
path and the send path. This is what makes the hardest email problem disappear:
a message we send appears again in the mailbox (Sent folder, or Gmail's unified
store) and would be ingested a second time. If we generate the `Message-ID`
before handing the mail to SMTP and record it as `externalMessageId`, the echo
arrives with an identity we have already applied, and `channel_event_inbox`
dedupes it for free. No special-casing, no Sent-folder exclusion heuristics.

Thread identity, in descending order of trustworthiness:

| Provider | Thread key | Confidence |
| --- | --- | --- |
| `gmail` | `threadId` | authoritative |
| `microsoft_graph` | `conversationId` | authoritative |
| `imap_smtp` | `References`/`In-Reply-To` chain, falling back to normalized subject + participants | heuristic |

The IMAP case is genuinely a heuristic and should be labelled as such in the
code. Subject-based grouping is what every mail client does and it is
occasionally wrong; the fallback must never merge threads across different
participant sets.

Address normalization must follow spine RFC line 378: lower-case the domain,
**preserve the local part** — no dot-stripping, no plus-alias removal. Those are
Gmail-specific behaviors and treating them as universal silently merges
different people at other providers.

## Capabilities

Email inverts most of the Telegram matrix:

| Capability | Telegram | Email |
| --- | --- | --- |
| `outboundInitiation` | false | **true** — you may email a stranger |
| `multipleRecipients` | false | **true** — To/Cc/Bcc |
| `templates` | false | arguably true later |
| `typing` | true | false |
| `reactions` | true | false |
| `readReceipts` | false | false (MDN is unreliable; do not claim it) |
| `messageEditing` | true | false |
| `messageDeletion` | true | local only |
| subject | n/a | **required-ish** on thread start |

`ResolvedCapabilities` has no `subject` flag today. Rather than add one, subject
support is implied by the channel and carried in the payload field that already
exists — but the composer needs to know, so a small capability addition is
likely cleaner. Flagged as a work item, not decided here.

Per-message envelope recipients (To/Cc per message, which vary within one
thread) have no home in `MessageUpsertEventPayload`. The spine RFC (line 431)
anticipated this and left it open.

**Decided: extend the contract.** Recipients become typed fields on the message
payload rather than an untyped `providerMetadata` bag, because the inbox has to
render and query them, and `providerMetadata` is defined as a non-secret
projection, not domain data. This is a contract change touching every adapter's
type surface, so it lands in step 2 — before either provider — and carries a
`contractVersion` bump with `assertNormalizedChannelEvent` validation for the
new fields.

## Outbound

- Gmail: `messages.send`. Graph: `sendMail`. IMAP accounts: SMTP via nodemailer.
- **SMTP has no idempotency key**, exactly like Telegram. Reuse the pattern
  already built: a closed set of local failure codes, and anything ambiguous
  classified `uncertain` and never auto-retried. A duplicate email is worse
  than a failed one.
- Generate `Message-ID` locally before sending (see above).
- **Header injection** is a real risk on compose: any user-supplied subject or
  recipient must be rejected if it contains CR/LF. This is the email equivalent
  of SQL injection and is easy to get wrong.

## Attachments

Unlike Telegram — where we fetch by `file_id` after the fact — MIME delivers
attachments **inline in the fetched message**. So the sync path must stream
parts to R2 at ingest, with a size cap, and emit `attachment.available` /
`attachment.failed`. A 25MB attachment on a 60-second poll of a busy mailbox is
the memory-pressure case to design for: stream, never buffer whole messages.

## Security

- **HTML sanitization is the biggest new attack surface in the product.**
  Inbound HTML is attacker-controlled and rendered in the agent's browser. It
  must be sanitized server-side into `sanitizedHtmlContent` (the field exists),
  remote content proxied or blocked by default, and the rendering surface
  CSP-constrained. Treat this as a security review item, not a formatting task.
- OAuth: PKCE, state parameter bound to the workspace, exact redirect URI
  matching. Refresh tokens are long-lived credentials — they belong in
  `channel_account_credentials` under the existing cipher, never in
  `provider_metadata`.
- A failed token refresh maps to the `ChannelCredentialKeyError` semantics
  plumbed for Telegram: a permanent, operator-visible failure that degrades the
  account status — never an `uncertain` outcome that silently parks messages.

## Package layout

Follow the `@wateaminbox/adapter-telegram` pattern established this week:
injected ports, a closed local-failure code set, host-side translation of
application errors into that set.

**Decided: one `@wateaminbox/adapter-email`** with `gmail`, `microsoft_graph`,
and `imap_smtp` entry points. The shared MIME parsing, threading, and
sanitization surface is large enough that three packages would need a fourth
shared one anyway — and each package costs an entry in all six hand-maintained
lists below, not one.

### Workspace checklist (learned the hard way)

Every new package must be added to all of these, or it breaks in a place local
builds cannot see — see
`docs/operations/telegram-adapter-package-release-2026-09-14.md`:

1. root `typecheck` script chain
2. `scripts/run-tests.sh`
3. `knip.json`
4. `apps/api/Dockerfile` — manifest + source + build step
5. `apps/web/Dockerfile` — manifest only
6. `.github/workflows/ci.yml` — two "Build internal TypeScript dependencies"
   steps, plus a test step in `ts-unit`

## Product boundary and quota

- The adapters are generic integration code and belong in **OSS**, per the
  open-core boundary in `AGENTS.md`. Self-hosters register their own Google and
  Microsoft OAuth applications; hosted OAuth client credentials are private
  deployment configuration, not code.
- Email accounts consume the **same paid connection slots** as every other
  channel — `countUsedConnectionSlots` already counts every channel against one
  pool, and the connect route must reuse it. A mailbox is not free capacity.

## De-risking spikes, before committing to the full build

1. **imapflow / mailparser / nodemailer under Bun.** TLS socket behavior is the
   plausible landmine; these libraries are Node-native and heavily socket-bound.
   One day, timeboxed. If Bun cannot host them, the whole `imap_smtp` provider
   changes shape.
2. **Leased poll loop with two API replicas**, proving single-flight under the
   real replica count.
3. **Sanitization**, against a corpus of hostile HTML mail.

## Sequence

**Decided: `imap_smtp` and `gmail` are built in parallel** against the new pull
contract. Two providers in flight at once is the strongest available test of
whether the abstraction is actually provider-neutral — a pull contract validated
against only one provider tends to encode that provider's shape.

The cost is real and worth stating: the contract is still moving while both
providers depend on it, so churn lands twice. Two things contain that:

1. **Step 2 is a hard gate.** The pull contract, the payload extension, the
   `email_sync_state` table, and the leased scheduler are finished and merged
   before either provider starts. Providers consume a frozen interface; changing
   it afterwards is a deliberate versioned change, not an in-flight edit.
2. **`email-core` is owned by neither provider.** MIME parsing, threading,
   sanitization, and address normalization are built once, with tests that do
   not reference a provider. A provider may not fork shared behavior to suit
   itself.

The sequence:

1. Spikes — and note that parallel work makes spike 1 (Bun + imapflow/nodemailer)
   *more* urgent, not less: it gates one of the two tracks entirely.
2. **Gate:** pull ingress contract + payload extension (`contractVersion` bump)
   + `email_sync_state` + leased scheduler + `sync.checkpoint`.
3. `email-core`: MIME, threading, sanitization, normalization — provider-neutral.
4. Parallel: **`imap_smtp`** (password/app-password auth, SMTP send, IMAP fetch)
   and **`gmail`** (OAuth2, Gmail API send + `history.list` sync).
5. Compose UI, attachments, agent-facing rendering.
6. `microsoft_graph` — third, reusing the OAuth machinery Gmail establishes.
7. Later optimizations: IMAP IDLE, Gmail Pub/Sub push, Graph subscriptions.

If the two tracks cannot be staffed genuinely in parallel, run `imap_smtp`
first: it needs no external app registration and exercises the pull path
hardest.

## Decisions taken

| Question | Decision |
| --- | --- |
| Provider order | `imap_smtp` and `gmail` in parallel, behind a frozen contract gate; `microsoft_graph` third |
| Per-message recipients | Extend `MessageUpsertEventPayload` with typed envelope fields; `contractVersion` bump |
| Packaging | One `@wateaminbox/adapter-email`, three provider entry points |

## Still open

1. Is a `subject` capability flag worth adding for the composer, or is subject
   support implied by `channel === "email"`?
2. Exact retry and backoff policy for a mailbox that fails repeatedly — when
   does an account go `degraded`, and what surfaces it to the operator?
3. Whether a shared hosted Google/Microsoft OAuth application is offered for
   Cloud customers, which is a `cloud-control` concern and out of scope here.
