# Customer suppression (contact blocking)

Design: `docs/contact-blocking-and-inbound-abuse-plan.md`.

A **suppression** is the workspace's own decision about a person, applied on
every channel they use. It is separate from a provider block: a Telegram bot,
LINE, Viber and email cannot block anyone, so WATeamInbox enforces the decision
itself.

| Scope            | Inbound (new direct messages)                                                            | Outbound |
| ---------------- | ---------------------------------------------------------------------------------------- | -------- |
| `block`          | Dropped. Only a per-person, per-channel, per-day count is kept.                          | Refused  |
| `mute_inbound`   | Stored, with no unread count, case open, push or auto-reply. Open screens still refresh. | Allowed  |
| `do_not_contact` | Accepted                                                                                 | Refused  |

Suppressions are read across a merged customer's whole merge group. Blocking
either half blocks the person, and unmerging returns each half its own state.
Groups are never gated by a person block. History sync and messages already
stored are never touched.

## Enforcement is per workspace and off by default

Migrations 115 and 116 only add the data. Until a workspace is enabled, it
behaves exactly as before: only WhatsApp's own `contacts.is_blocked` applies,
and the Block button keeps dual-writing the suppression.

Turn enforcement on or off for one workspace:

```sh
bun run apps/api/src/scripts/set-contact-policy-enforcement.ts \
  --company <uuid> --on          # or --off; add --dry-run to preview
```

In a deployed image the script is
`apps/api/dist/scripts/set-contact-policy-enforcement.js`. Run it through the
secret entrypoint so it has `DATABASE_URL`. `--all` applies to every active
workspace; enable a few first. Each change writes a
`contact_policy.enforcement_enabled` / `..._disabled` audit entry in the
workspace.

Rollback is `--off`: the gate stops, suppressions stay recorded, and nothing
already dropped comes back. Dropped content was never stored.

## Checking what was dropped

```sql
SELECT contact_id, channel, day, dropped_count, last_dropped_at
FROM <tenant_schema>.contact_suppression_drops
ORDER BY last_dropped_at DESC LIMIT 50;
```

## Flood limits

In an enforcing workspace, a customer who writes faster than any person would
is kept quiet automatically. Their messages are still stored, with no unread
count, push or auto-reply, through an expiring `mute_inbound` with reason
`auto:flood`. It shows in the profile, and an operator can lift it early.

| Class | Quiet after | Quiet for | Auto-mute (off by default) |
|---|---|---|---|
| chat (WhatsApp, Telegram, ...) | 30 messages / minute | 10 min | 200 in 10 min -> 1 h |
| email | 10 messages / minute | 30 min | 50 in 10 min -> 1 h |

A flood that keeps going keeps its quiet period running. Nothing is ever
blocked automatically. Counts live in `<tenant>.inbound_flood_windows`
(one-minute windows, pruned after 30 minutes).

Separately, provider webhooks (`/api/channel-ingress/*`) are rate-limited per
channel account instead of per IP, because every Telegram bot is called from
Telegram's addresses. Default 600 requests / 60 s, tunable with
`RATE_LIMIT_CHANNEL_INGRESS_REQUESTS` / `_WINDOW_SECONDS`. This applies in
every workspace, enforcing or not.

## Not covered yet

- Provider signals such as Telegram `my_chat_member` (phase 6).
- Workspace-level settings UI for the flood thresholds and auto-mute.
