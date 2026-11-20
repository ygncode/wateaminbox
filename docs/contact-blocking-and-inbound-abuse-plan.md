# Contact blocking and inbound abuse control — channel-neutral plan

Status: draft for review · Scope: `oss/` (single-host product) · Base: `origin/main` `cbf7de7b`

## 1. Problem

A customer who floods a workspace through any channel (today Telegram, later
Messenger, Instagram, LINE, Viber, email) cannot be stopped:

- `PATCH /contacts/:id { isBlocked }` refuses any contact without a WhatsApp
  `jid` + `whatsapp_connection_id` (`routes/contacts/index.ts`). Every
  non-WhatsApp customer gets a 400.
- `is_blocked` is enforced only on **outbound** paths (`send-access.service`,
  `channel-outbound.service`, bulk, scheduled). Inbound blocking works for
  WhatsApp only because the phone itself refuses delivery. Neutral ingress
  (`routes/channel-ingress.ts` → `applyNormalizedChannelEvent`) stores every
  event unconditionally.
- There is no per-sender or per-account inbound rate limit. The only limiter on
  the webhook is the global IP limiter (3000/60 s), keyed by the **provider's**
  IP. One flooding Telegram user drains the bucket shared by every Telegram bot
  on the instance and can cause 429s for legitimate traffic.
- Merged customers (WhatsApp + Telegram) are inconsistent. The block flag lives
  on one `contacts` row, while each conversation still points at its own
  `legacy_contact_id`. Merge and unmerge neither carry nor combine block state,
  and the profile can show "Blocked" while the Telegram thread is wide open, or
  refuse to block entirely when the survivor is the Telegram contact.

## 2. What the design already gives us

The channel-neutral spine RFC (`docs/channel-neutral-spine-rfc.md` §"contact
endpoints", line ~389) already separates the two concepts we need, and the
tables already exist (`packages/database/src/channel-spine-schema.ts`):

| Concept | Table | Today |
|---|---|---|
| Provider-side block of one endpoint on one account | `endpoint_account_states.provider_block_state` (`unknown/allowed/blocked`) | Written only by the WhatsApp shadow writer; never read |
| Workspace policy about a **person**, provider-independent | `contact_suppressions(contact_id, scope, reason, created_by, created_at, revoked_at)` | Table and active index exist; **no code uses it** |
| Event dedupe/quarantine | `channel_event_inbox.status` (`pending/applied/quarantined`) | Used for identity collisions only |

The RFC is explicit: *"a provider block must not silently become a global
customer suppression."* This plan builds on that split instead of extending
`contacts.is_blocked`.

What the **adapter contract** (`packages/shared/src/channel-spine/contracts.ts`)
does *not* have yet:

- No capability describing how a provider can block a user. `ChannelCapabilities`
  has typing/reactions/templates/etc., nothing about blocking or abuse.
- No typed block/unblock operation. `perform(ChannelActionIntent)` takes a free
  `operation: string` with an `"unsupported"` outcome, which is the right
  extension point, but nothing standardises the operation names. The WhatsApp
  neutral transport returns `neutral_action_not_wired` for every action.
  WhatsApp block still goes through the legacy NATS `block_contact` command.
- No normalized event for "provider says this endpoint is now blocked or has
  blocked us" (WhatsApp blocklist sync, Telegram `my_chat_member` → `kicked`,
  Meta opt-out, email unsubscribe/bounce).
- No inbound gating step between `verifyAndNormalizeIngress` and
  `applyNormalizedChannelEvent`.
- No per-provider statement of inbound volume expectations (rate-limit hints).

So the **storage contracts** are ready. The **adapter and application
contracts** need four small, additive extensions.

## 3. Provider landscape (why it has to be generic)

| Provider | Can the provider itself block a user? | Inbound still arrives after we "block"? | Provider signals |
|---|---|---|---|
| `whatsapp_linked_device` | Yes (account blocklist, via NATS) | No, the phone drops it | blocklist sync, command outcome |
| `telegram_bot` | **No** for private chats (bots can only ban in groups or channels they admin) | Yes, must be dropped by us | `my_chat_member` (user blocked the bot), not subscribed today |
| `meta_cloud` (Messenger/IG) | Limited (page-level block is not reliably in the API) | Yes | opt-out/policy errors on send |
| `line_messaging` | No | Yes | `unfollow` webhook |
| `viber_bot` | No | Yes | `unsubscribed` webhook |
| email (`gmail`, `microsoft_graph`, `imap_smtp`) | Mailbox filter possible but invasive | Yes | bounces, unsubscribe |

Conclusion: **enforcement must live in the application, not in the provider.**
A provider block is an optional extra used when it exists, and it is reported
per endpoint.

## 4. Target model

```
             ┌─────────────────────────── workspace decision ──────────────────────────┐
  operator → │ contact_suppressions (contact_id = canonical customer, scope, reason)  │
             └───────────────┬─────────────────────────────────────────┬───────────┘
                             │ fan-out per owned endpoint               │ checked at
                             ▼                                          ▼
     endpoint_account_states.provider_block_state      inbound gate + outbound/send gate
     (best-effort provider mirror, per account)        (authoritative, every channel)
```

### 4.1 Suppression scopes

`contact_suppressions.scope` (text, validated in app code; extend the CHECK
later):

- `block` drops new inbound **and** forbids outbound. This is the "Block" button.
- `mute_inbound` stores inbound silently (no unread, no notification, no
  auto-assign or auto-reply) but keeps it auditable. Useful for "noisy but not
  abusive". This is optional for phase 1.
- `do_not_contact` forbids outbound only (opt-out, legal). It already matches
  RFC wording.

At most one active row per `(contact_id, scope)` (`revoked_at IS NULL`). Add a
partial unique index. Revocation sets `revoked_at` so history is kept.

### 4.2 Resolution rule (the one function everyone calls)

```ts
resolveInboundPolicy(trx, { channelAccountId, senderEndpointId })
  -> { action: "accept" | "drop" | "silence", reason, suppressionId? }

resolveOutboundPolicy(trx, { conversationId })
  -> { allowed: boolean, reasonCode }
```

Order:

1. Endpoint → `contact_endpoints.contact_id` → follow `merged_into_contact_id` to
   the **canonical** customer. This alone fixes the mixed-customer bug, because
   policy is looked up on the person and not on whichever legacy row a thread
   points at.
2. Active `contact_suppressions` on the canonical customer decide.
3. `endpoint_account_states.provider_block_state = 'blocked'` on this account
   also means drop (the provider told us, or we mirrored it).
4. Legacy fallback while WhatsApp is still on legacy ingress: `contacts.is_blocked`
   on the conversation's legacy contact.

Groups, bots and shared endpoints are never suppressed by a person-level block.
The RFC already refuses to merge them, and the same set
(`MERGEABLE_ENDPOINT_KINDS`) is reused.

### 4.3 Inbound gate

A new step in `applyNormalizedChannelEvent`, inside the same transaction, after
the inbox dedupe and before any domain write:

- Event kinds gated: `message.upsert`, `message.edit`, `reaction.upsert`,
  `attachment.available`, `typing.update`, `presence.update`. Not gated:
  `delivery.update` and `message.delete` for our own outbound, and
  `account.status`/`sync.checkpoint`.
- `drop`: mark the inbox row `applied` with `outcome = 'suppressed'` (new
  nullable column, or store it in existing metadata) so replays stay idempotent.
  Do not create a conversation, message, unread count, notification, attachment
  fetch, first-chat acknowledgment or auto-reply. Still return 200 to the
  provider so it does not retry.
- Keep a bounded counter per `(channel_account_id, endpoint_id, day)` so
  operators can see "N messages dropped from blocked customer" without storing
  the content.
- `silence`: apply normally, then skip unread, notification, assignment and
  auto-reply side effects.

The legacy WhatsApp NATS handler (`services/handlers/message-handlers.ts`) gets
the same call through a thin shim, so a WhatsApp-plus-Telegram customer behaves
the same on both paths until WhatsApp moves to neutral authority.

### 4.4 Inbound rate limiting (abuse without a manual block)

Two layers, both in the application, keyed by identities the adapter has
already verified:

1. **Ingress route limiter** (protects the instance). Replace the IP key for
   `/api/channel-ingress/*` with a key on the hashed `routeKey`, which equals one
   channel account. Exclude the path from the global IP limiter and give it its
   own tier (`RATE_LIMIT_CHANNEL_INGRESS_*`). One abusive bot then cannot starve
   another tenant's bot behind the same Telegram IPs.
2. **Per-sender limiter** (protects the inbox). This runs after normalization,
   keyed `(company, channel_account, sender_endpoint)`, with a token bucket using
   the existing rate-limit store. When it is exceeded:
   - over the soft limit: apply as `silence` for the rest of the window, and
     raise one `contact.inbound_throttled` audit and realtime event (debounced);
   - over the hard limit (configurable, off by default): auto-create a temporary
     `mute_inbound` suppression with `reason = 'auto:rate_limit'` and an
     expiry. That needs `expires_at` on `contact_suppressions`, which is an
     additive column.
   - Never auto-`block`. A block is a human decision because it also stops our
     outbound replies.

Defaults are per workspace and adjustable later. The adapter can publish a
hint (section 5.2) so email and chat get different thresholds.

### 4.5 Outbound gate

`send-access.service`, `channel-outbound.service` (claim time), bulk,
scheduled and auto-reply all switch from `contacts.is_blocked` to
`resolveOutboundPolicy`, which checks the canonical customer's `block` and
`do_not_contact` scopes. The behaviour for WhatsApp is unchanged, because the
dual-write (section 4.6) keeps `is_blocked` in sync.

### 4.6 Provider mirroring (best effort, per endpoint)

Applying `block` to a customer:

1. Insert the `contact_suppressions` row. This is the authoritative decision and
   takes effect immediately on every channel.
2. For each person endpoint the customer owns, on each connected account where
   `capabilities.blocking.provider === true`: enqueue an outbound intent with
   operation `action:endpoint.block` (idempotency key = suppression id +
   endpoint + account). The provider result writes
   `endpoint_account_states.provider_block_state`.
3. WhatsApp keeps the current legacy path (`enqueueConnectionCommand` →
   `block_contact`, with the existing optimistic rollback in
   `business-handlers.ts`) until its neutral transport implements
   `endpoint.block`. Dual-write `contacts.is_blocked` on WhatsApp legacy contact
   rows, as the RFC requires.
4. A provider failure does **not** revoke the suppression. It shows up as
   "Blocked in WATeamInbox · WhatsApp: not applied (retry)".

Unblock reverses all of this. Revocation is a separate audit entry.

### 4.7 Merge and unmerge

- Merge: suppressions move with the person. Re-point active suppressions from
  source to target (`contact_suppressions.contact_id`) and record the moved IDs
  in `contact_merge_events` (add `suppression_snapshot jsonb`). The result is
  the union: if either side was blocked, the merged customer is blocked. Show
  this in the merge confirmation dialog.
- Unmerge: restore exactly the snapshot, so suppressions that came from the
  source go back to the source. Suppressions created after the merge stay with
  the target, and the dialog asks whether to copy them to the revived customer.
  Default: copy `block`, because an abusive person stays abusive.
- Purge and delete of a channel account cascade through
  `endpoint_account_states`. Suppressions stay because they belong to the person.

## 5. Contract changes (`packages/shared/src/channel-spine/contracts.ts`)

All additive. The contract version stays 1 because no existing field changes
meaning.

### 5.1 Capability

```ts
export interface BlockingCapability {
  /** Provider can block this endpoint itself (we call perform("endpoint.block")). */
  provider: boolean;
  /** Provider stops inbound after a provider block (else app-side drop is the only defense). */
  providerStopsInbound: boolean;
  /** Provider notifies us when the user blocks/unsubscribes from us. */
  reportsRemoteBlock: boolean;
}

export interface InboundVolumeHint {
  /** Typical burst a legitimate sender produces (chat ≈ 20/min, email ≈ 5/min). */
  perSenderPerMinute: number;
}

// on ResolvedCapabilities:
blocking: BlockingCapability;
inboundVolume?: InboundVolumeHint;
```

- WhatsApp linked device: `{ provider: true, providerStopsInbound: true, reportsRemoteBlock: true }`
- Telegram bot: `{ provider: false, providerStopsInbound: false, reportsRemoteBlock: true }` (after we subscribe to `my_chat_member`)

The adapter conformance test (`adapter-conformance.test.ts`) asserts every
registered adapter declares `blocking`. Then a new provider cannot ship without
taking a position.

### 5.2 Typed action operations

```ts
export const CHANNEL_ACTION_OPERATIONS = [
  "delete", "edit", "reaction",          // existing, now named
  "endpoint.block", "endpoint.unblock",
] as const;
```

The payload for `endpoint.*` is `{ endpoint: ExternalEndpointReference }`. An
adapter without provider blocking returns `{ outcome: "unsupported",
errorCode: "<provider>_block_unsupported" }`, which the application records as
`provider_block_state = 'unknown'`, not as a failure.

### 5.3 Normalized event

```ts
"endpoint.state": {
  endpoint: ExternalEndpointReference;
  /** What the provider now says about this endpoint on this account. */
  providerBlockState?: "allowed" | "blocked";       // we blocked them (sync)
  reachability?: "reachable" | "unreachable";        // they blocked/left us
  reason?: string;                                   // provider code, not free text
}
```

It is durable and handled by the event processor. It writes
`endpoint_account_states` and **never** creates a suppression. Sources:
WhatsApp blocklist sync, Telegram `my_chat_member.status = kicked`, LINE
`unfollow`, Viber `unsubscribed`, email hard bounce. `reachability =
unreachable` makes the composer show "This customer has blocked the bot".

### 5.4 Application port (not part of the adapter)

`apps/api/src/channel-spine/application/contact-policy.ts`:

```ts
resolveInboundPolicy(...)
resolveOutboundPolicy(...)
applySuppression(trx, { contactId, scope, reason, actorUserId, expiresAt? })
revokeSuppression(trx, { suppressionId, actorUserId })
```

Adapters never import it. The registry composition root stays the only place
that knows providers.

## 6. API and UI

- `POST /contacts/:id/suppressions { scope, reason }` and
  `DELETE /contacts/:id/suppressions/:suppressionId`. Both require send
  permission (same as today's block), are audited
  (`contact.blocked`/`contact.unblocked` kept as action names), and resolve the
  canonical customer.
- Keep `PATCH /contacts/:id { isBlocked }` as a compatibility shim that calls
  the new service, and remove the WhatsApp-only 400.
- Contact profile: one "Block customer" control plus a per-channel status list
  (applied, not applied with retry, not supported by provider, customer blocked
  us).
- Conversation view for a non-merged Telegram thread: `BlockStatusSection`
  currently renders only when `contact` exists. Once `attachWorkflowContact`
  creates a customer this works, but threads without a customer (groups, bots)
  must hide it.
- Inbox: a "Blocked" filter, plus the dropped counter on the profile.
- MCP: add a `block_customer` and `unblock_customer` tool, and bump
  `MCP_SERVER_VERSION` together with its version test.

## 7. Phasing

| Phase | Deliverable | Risk |
|---|---|---|
| **0. Contracts** | `blocking` capability, typed operations, `endpoint.state` kind, conformance assertions; both adapters declare values. No behaviour change. | none |
| **1. Policy core** | `contact-policy.ts`; partial unique index plus `expires_at` on `contact_suppressions`; backfill one `block` suppression per `contacts.is_blocked = true` (canonical customer); dual-write. | migration (additive) |
| **2. Enforcement** | Inbound gate in neutral processor and legacy WhatsApp handler; outbound gate swap; suppressed-event outcome. **This fixes Telegram and mixed customers.** | inbound path, so needs a feature flag per workspace |
| **3. API/UI** | Suppression routes, PATCH shim, per-channel status UI, MCP tools. | low |
| **4. Merge/unmerge** | Suppression move plus snapshot; unmerge restore. | medium (interacts with #378 merge fixes) |
| **5. Rate limits** | Ingress route-key tier; per-sender bucket and silence; optional auto `mute_inbound`. | tuning |
| **6. Provider signals** | Telegram `my_chat_member` subscription → `endpoint.state`; WhatsApp blocklist sync → `endpoint.state`; WhatsApp neutral `endpoint.block`. | provider-specific |

Phases 0–3 are the minimum to answer "can we block an abusive Telegram user".
Phase 5 answers "too many messages" even without anyone clicking Block.

## 8. Tests

- Conformance: every adapter declares `blocking`. `perform("endpoint.block")`
  returns `unsupported` or a valid result, never throws.
- Event processor: blocked sender gives `suppressed` with no rows created; a
  replay is still `suppressed`; a group message from a blocked person in a group
  is still accepted (person block ≠ group block); `delivery.update` for our
  outbound is still applied.
- Mixed customer: block via the WhatsApp survivor drops Telegram inbound and
  forbids Telegram outbound, and the reverse; merge of blocked + unblocked gives
  blocked; unmerge restores per side.
- Legacy parity: WhatsApp `is_blocked` dual-write and the optimistic rollback
  still work.
- Rate limit: N+1 messages from one sender in a window are silenced, and another
  sender on the same bot is unaffected. Ingress tier is keyed by route, not IP.
- Tenant isolation: suppression lookups only ever use the tenant schema.

## 9. Open questions

1. Drop vs. store hidden for `block`: storing hidden keeps evidence for abuse
   reports but costs storage and media quota. Proposal: drop content and keep a
   counter. Attachments are never fetched.
2. Should a person-level block also leave or ban in groups the bot admins on
   Telegram? Proposal: no. Group moderation is a separate feature.
3. Default per-sender thresholds per channel kind (chat vs. email).
4. Whether `mute_inbound` ships in phase 2 or waits for phase 5.

## 10. Boundary

Everything here is single-host product behaviour and belongs in `oss/`. Nothing
touches plans, pricing or entitlements. Per-plan abuse limits, if ever wanted,
would be policy in `cloud-control/` that sets the generic thresholds exposed
here.
