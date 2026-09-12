# RFC: Unified customer timeline

Status: proposed
Depends on: `docs/channel-neutral-spine-rfc.md` (contact merge)

## What

Show one interleaved message history for a merged customer, across every
channel they can be reached on. Each message is labelled with its channel. The
existing chat switcher becomes a channel filter.

A merge combines identity. This combines only the view — conversations,
cases, and SLA clocks stay exactly as they are stored today.

## Why

Contact merge shipped with a switcher that moves between a customer's threads
one at a time. Operators read that as two half-conversations with the same
person.

## Decisions

Settled by the product owner:

1. **Always merged.** More than one thread means the interleaved view. No mode
   to discover.
2. **Replies go to the last inbound thread**, shown in the composer,
   overridable.
3. **Resolve/Pending/read apply to every thread** of the customer at once,
   except threads holding unread inbound — see Resolving below.

Decision 3 departs from the spine RFC, which keeps workflow conversation-scoped
(`channel-neutral-spine-rfc.md:1212`). It is a policy change, not a storage
change: each conversation keeps its own state row, case, and clock; the action
is applied to each of them.

## Resolving

Resolving a quiet thread is safe: a live inbound after resolution already
reopens the case automatically, and audits the reopen
(`message-handlers.ts:441-555`, reason `auto_reopen`). If the customer writes
again, the thread comes back on its own.

The unsafe case is narrow and specific: a thread holding an **unread inbound
that has already arrived**. Resolving that buries a question nobody answered,
and no later message will arrive to reopen it.

So the fan-out resolves every thread except those, and says which it skipped:

> Resolve 2 of 3 chats. Telegram has 1 unread and stays open.

This keeps the one-click "done with this customer" action while making it
impossible to silently close an unanswered message. Resolving only the active
thread was rejected as the worse failure: the operator resolves the customer
and the customer stays open.

## Ownership

Merge does not touch assignments today - `mergeContacts` moves endpoints and
nothing else (`contact-merge.service.ts:123-171`). Two threads of one merged
customer can therefore be owned by two different people, and nobody is told.
Invisible per-thread; obvious the moment the threads share a view.

Merge continues not to reassign. Silently moving a conversation from one
teammate to another is taking real work off someone's queue on the strength of
an identity guess, and the merge path deliberately leaves every other workflow
row alone for the same reason.

Instead, ownership becomes visible and deliberate:

- the profile lists the owner per thread - *Alice (Telegram), Bob (WhatsApp)*;
- assigning from the merged view assigns every thread, and the confirmation
  names whose work moves: *"This moves 1 chat from Alice to you."*

The stricter alternative - adopting the surviving contact's assignee at merge
time - has precedent, since auto-reopen already unassigns without asking. But
that is the system reacting to a customer, not one operator quietly taking
another's conversation.

## Design

**Ordering is free.** `(timestamp, id)` is already a total order across
conversations, and it is the trailing key of both existing message indexes
(`tenant-index-names.ts:117-125`, `channel-spine-index-runner.ts:127-143`). No
new column, no new index, and one cursor serves every thread.

**Reading.** `GET /contacts/:id/timeline?limit&cursor&channel`. The customer's
threads come from the existing `listCustomerChats`, including its per-thread
visibility filter. Two keyset queries per page — one per anchor, each
index-backed — merge-sorted on the same key:

```sql
WHERE conversation_id IN (:ids) AND (timestamp, id) < (:cursor)
WHERE contact_id IN (:ids) AND conversation_id IS NULL AND (timestamp, id) < (:cursor)
```

One query OR-ing both anchors is not an option: it can use neither index, and
did 40ms → 5 minutes when tried (`channel-spine-index-runner.ts:131-135`).

**Provenance is missing and must come first.** Today's message payload carries
no channel, no provider, and no real thread id — its `conversationId` field
holds the *contact* id (`message-formatters.ts:352`). A merged list cannot
label its own rows until that is fixed.

**Realtime.** A message on any of the customer's threads invalidates the
timeline and refetches the newest page. Cache surgery is a later optimization;
a misplaced row is indistinguishable from a pagination bug.

**Composer.** Targets the thread the customer last wrote from, stated plainly
("Replying on Telegram"), changed by the switcher. Capabilities re-resolve per
target, since what may be sent differs by channel.

## Rules that do not bend

- **Per-thread visibility.** A restricted member must not learn about threads
  they are not assigned (`routes/contacts/chats.ts:31-36`). This is the surface
  where that would leak.
- **Quotes stay within their thread**
  (`routes/conversations/messages.ts:284-288`).
- **No merging of conversations in the database**
  (`channel-neutral-spine-rfc.md:1238`).

## Risks

- The fan-out still closes threads the operator has not *opened*, even though it
  skips those with unread inbound. A read-but-unanswered thread can be resolved
  from another channel. Accepted; the confirmation names the count.
- Assignment fan-out moves a teammate's conversation. Always confirmed by name,
  never implicit.
- Resolutions now arrive in correlated bursts, so resolution-time analytics
  will read differently.
- Two index scans per page instead of one. Same shape, double the constant —
  measured on the largest workspace before enabling, not assumed.

## One read path, two shapes

The server is one endpoint that takes the cheap branch when the customer has
one thread, so the merge only runs where it changes the answer.

The client is narrower, and deliberately: it reads the timeline only for a
customer with more than one thread. The condition below - that a single-thread
customer's realtime cache key must not change - cannot be honoured any other
way. Moving every thread in the product onto the merged key would replace an
optimistic cache insert with an invalidate-and-refetch for every workspace,
including the ones that have never merged anything. The read path that matters
for correctness is the server's, and that one is shared.

Two read paths was the alternative, and it costs more than it looks. The
existing message route does far more than fetch rows - quoted-message
resolution, reactions, media authorization, sender names and avatars, remote
history status - and a second path has to reproduce all of it and keep
reproducing it. Realtime doubles too: new messages land in a per-conversation
cache key today, and two read paths mean two sets of cache plumbing.

The branch is affordable because resolving the customer and listing their
threads is one query, not two. A recursive CTE walks the merge alias up to the
canonical customer and back down to the rows merged into it, then collects
their threads; it returns the canonical id, the conversation ids, and the
contact ids together. Measured at ~1ms on a workspace of 2,000 contacts, and
its answer matches `listCustomerChats` for both a merged and an unmerged
customer.

So the trip count is:

| | DB trips | scans |
| --- | --- | --- |
| today | 2 | 1 |
| timeline, one thread | 2 | 1 |
| timeline, merged | 3 | 2 |

Conditions: the single-thread path must benchmark no slower than today on the
largest workspace before it is enabled, and its realtime cache key must not
change - otherwise the plumbing churn lands on every workspace to serve the
ones that have merged.

## The inbox row

The row shows the newest message across all of the customer's threads, not the
newest of its own. One row means one customer, so its preview and its timestamp
have to mean the customer too - otherwise a reply arriving on Telegram leaves
the row showing a stale WhatsApp line, and the row sorts by the wrong time.

The "N chats" badge counts **threads**, for the same reason: it is a promise
about what the switcher will offer. Counting merged contacts instead is wrong
as soon as one contact brings two endpoints.

Both come from the list query, which is the measured-hot one. The rollup must
stay behind the existing guard so it only runs for rows that actually have
merged children, and it must be re-measured on the largest workspace - this is
the query that went from 54ms to 10.5s when a lateral lost its index.

## Search

Search is scoped to the customer: a hit on any of their threads is a hit on
them, and opening it lands in the merged timeline at that message.

The index already supports this without a reindex. Message documents carry
`contactId` and `conversationId`, both filterable
(`meilisearch.service.ts:118-129`), so a customer search filters on the thread
set the timeline already resolves - contact ids for legacy rows, conversation
ids for neutral ones. Merge itself does not rewrite message documents, so
filtering on the set is not an optimization, it is the only correct form.

Two existing constraints carry over unchanged: Meilisearch is skipped entirely
for assignment-restricted users, because the index is tenant-scoped but not
assignment-scoped (`search.service.ts:90-95`), and per-thread visibility still
applies to the threads that make up the filter.

## Known limitation: reconnecting an account fragments a customer

Reconnecting a channel account mints a new `channel_accounts` row, so the same
person arrives on a new `contact_endpoints` row and ingest creates them a new
customer. A merged customer therefore splits: their next message lands beside
the merged row rather than in it, and the thread they were reachable on points
at an account that no longer works.

The obvious fix - adopt the customer that already owns another endpoint with
the same normalized address on the same channel - was attempted and backed
out. It fails on a constraint that predates this work:
`conversation_cases` carries a unique index on `contact_id` where the status is
open or pending, so one customer may hold one active case. Two threads for one
customer both want one, and the second inbound message fails the insert.

That is the contact-to-conversation workflow migration the spine RFC sequences
(`channel-neutral-spine-rfc.md:617`), which also prohibits new
conversation-only workflow rows until that sequence completes. Automatic
adoption is downstream of it, not a change that can be slipped in beside it.

Until then:

- re-merging after a reconnect is manual, and the suggestion already surfaces
  it - the two endpoints share a normalized address on the same channel, which
  is the strongest evidence the suggester has;
- a thread whose account was archived is left out of the switcher. It cannot be
  written to, and offering it queues a message the dispatcher can never claim,
  which reads as the product losing the message rather than refusing it. Its
  history still belongs to the customer and still appears in their timeline.

## Plan

1. **Provenance.** Add `threadId`/`channel`/`provider` to the message payload.
   No UI change.
2. **Timeline.** The endpoint, the merge, the visibility filter, with tests
   before any UI. Then render it, with the switcher as a filter.
3. **Fan-out.** Lifecycle, read, and assignment across the customer's threads,
   with the unread skip and the named-owner confirmation.
4. **Row and search.** The list preview and badge roll up across threads;
   search scopes to the customer. Both are independent of the timeline itself
   and can ship either side of it.

Steps 1–2 are read-only and reversible by not rendering the view. Step 3
changes stored state and ships on its own.
