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

## Not covered yet (later phases)

- Per-channel block status in the profile, a Mute control, and Block for
  non-WhatsApp customers in the UI (phase 3).
- Per-sender and per-bot flood limits (phase 5).
- Provider signals such as Telegram `my_chat_member` (phase 6).
