# Running the tenant index migrations (062, 063, 064)

Three migrations change per-tenant indexes. They are applied in numeric order by
the standard migration step and are safe to run in one pass, but 063 is the only
one that can abort, and the only one with meaningful lock cost.

| # | Purpose | Builds an index? | Can abort? |
| --- | --- | --- | --- |
| 062 | Index `group_participants (participant_jid)` so realtime fan-out can resolve which conversations a JID appears in | Yes, on a small table | No |
| 063 | Give every per-tenant index a deterministic name that fits PostgreSQL's 63-byte limit, and build four indexes that were silently never created | Yes — see cautions | **Yes**, on duplicate rows |
| 064 | Index outstanding media download claims so the stranded-media sweep stops sequentially scanning `messages` | Yes, on a tiny partial set | No |

## Why 063 matters most

PostgreSQL truncates identifiers at 63 bytes silently. A tenant schema name is
already 43 characters, so several intended index names overflowed — and three
families truncated to the *same* identifier, which turned
`CREATE INDEX IF NOT EXISTS` into a no-op for every one after the first. Four
indexes were therefore absent from every tenant, two of them UNIQUE:

| Index | Guarantee that was missing |
| --- | --- |
| `whatsapp_connections (phone_number)` | one WhatsApp connection per phone number |
| `whatsapp_labels (whatsapp_connection_id, synced_tag_id)` | one label per connection/synced tag |
| `scheduled_messages (contact_id, scheduled_at)` | per-conversation schedule list (pacing) |
| `scheduled_messages (bulk_job_id, status)` partial | bulk job leaf progress (pacing) |

The two UNIQUE ones are integrity, not performance: without them the database
permitted duplicate WhatsApp connections for one phone number and duplicate
label/tag links.

## Order

Apply **062 → 063 → 064**. The migrator enforces this; the ordering matters
because 063 normalizes names that 062's index already follows, and 064's index
name is validated against the same length rules 063 establishes.

Running them separately is fine. Running 064 or 062 without 063 is also fine —
neither depends on the rename.

## Before the deploy window

Run the read-only preflight. It changes nothing and covers 063 specifically,
which is the only migration that can abort or hold a significant lock:

```bash
DATABASE_URL=postgresql://... bun run packages/database/src/preflight-063.ts
```

It reports, per tenant schema:

- **renames** — catalog-only. `ALTER INDEX ... RENAME TO` does not rebuild or
  move data, so these are effectively instant regardless of table size.
- **redundant duplicates to drop** — an exact-shape clone under the historical
  name. The canonical index always survives; no guarantee is removed.
- **indexes to BUILD** — the only entries with real lock cost, listed largest
  first with estimated row counts (planner `reltuples`, not `COUNT(*)`).
- **blocked** — UNIQUE targets whose existing rows already conflict.

The script exits `1` when anything is blocked, so it can gate a pipeline step.
It reports **every** tenant rather than stopping at the first problem, so one
blocked workspace does not hide pending work in another.

There is no preflight for 062 or 064: neither can be blocked by data, and both
build small indexes.

## Lock and write-blocking cautions

Index creation is **not** concurrent in any of the three. Kysely's migrator
wraps each migration in a transaction, and `CREATE INDEX CONCURRENTLY` cannot
run inside one. Each build holds an `ACCESS EXCLUSIVE` lock on its table until
it finishes — blocking reads *and* writes to that table for the duration.

What that means per migration:

- **062** — `group_participants` holds one row per group member. Small on any
  workspace; the lock is momentary.
- **064** — the index is partial on `media_download_status = 'downloading'`,
  which is a handful of transient rows at any moment. The build is cheap even
  though `messages` is the largest table, because a partial index only scans
  and stores the matching rows.
- **063** — the one to plan for. `whatsapp_connections` and `whatsapp_labels`
  are small on any workspace, but **`scheduled_messages` grows with bulk
  broadcasts**, so a workspace that has run large campaigns can have a
  substantial table. Use the preflight's row estimate to decide whether the
  build fits your window.

If a build is too large for an online window, the safe path is to create that
one index manually with `CREATE INDEX CONCURRENTLY` **outside** a transaction,
using the exact canonical name from the preflight output, and then run the
migration — it adopts an existing index of the right shape instead of building a
second one.

## If 063 aborts on duplicates

This is deliberate. A UNIQUE index cannot be built over rows that already
conflict, and the migration will not delete or merge customer data to force one
through. It collects every conflict across every tenant, then aborts — and
because the migration runs in a transaction, an abort leaves the database
exactly as it was.

The report names the schema, table, guarantee, key columns, how many key groups
conflict, and a sample of the conflicting values. Resolve them however the
business requires — the right answer for two connections sharing a phone number
is a human decision, not a migration's — then re-run.

Two properties worth knowing:

- **Fail-closed is per target, not per tenant.** Within a blocked tenant, every
  *unblocked* target is still applied on that run.
- **Re-running is safe.** All three migrations are idempotent: anything already
  correct is skipped, and 063 additionally drops an exact-shape duplicate left
  under a historical name rather than keeping both.

## Rollback semantics

| # | `down()` behaviour |
| --- | --- |
| 062 | Drops the index it created. Fully reversible. |
| 063 | Reverses the **renames only**. Indexes it created because they had been silently missing are deliberately **not** dropped — they were meant to exist all along, and dropping a UNIQUE index would reopen the integrity hole the migration closed. It also skips a rename whose historical name is already taken by a truncation sibling. |
| 064 | Drops the index it created. Fully reversible. |

Rolling 063 back therefore returns to the previous *naming* without returning to
the previous *integrity gap*. That asymmetry is intentional.

## New tenants

`reconcileTenantSchema` runs on every tenant it creates and applies all three
outcomes — 062's participant index, 063's canonical names, and 064's claim
index — so a workspace provisioned after this change never has the truncated
names or the missing indexes in the first place. Nothing extra is required.

## Duplicate media response cleanup

Unrelated to the index work itself, but relevant to the same subsystem 064
serves, and worth knowing before you rely on the sweep.

A media download claim whose lease expires while its worker is still running can
be re-claimed, producing a second download command for the same message. Both
workers may complete and upload their own object to storage. The **database** is
protected — the response handler is first-writer-wins, so the later response
neither overwrites `media_url` nor emits a duplicate `media:downloaded` event —
which means the losing worker's uploaded object would otherwise be left in the
bucket with nothing referencing it.

The response handler now checks whether the uploaded reference won the database
compare-and-set. A losing or post-purge upload is deleted immediately when
unreferenced; transient object-storage failures are written to the durable purge
cleanup queue and retried by the independent cleanup cycle. The database remains
first-writer-wins, and the bucket no longer relies on a later full reconciliation
pass for this race.
