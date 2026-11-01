# Chat pagination performance assessment

Local baseline (2026-10-31) and optimized follow-up (2026-11-01), measured against
the uncommitted infinite-scroll implementation. The initial results below are retained
for comparison; see [Optimized implementation](#optimized-implementation) for the
current changes and measurements. The release was subsequently integrated onto
current `main`; [the release comparison](#release-integration-on-current-main)
is the relevant comparison against the source currently deployed, not the older
baseline's 8–12× ratios.
This is **not a production load test or a performance sign-off**. No production
access, global database configuration changes, deployment, commits, or private code
were involved.

## Baseline verdict (before optimization)

Virtualization works: the DOM stays small even after loading 10,000 chats. However,
**the initial implementation needed performance work before being considered suitable
for large, busy inboxes**:

1. A realtime invalidation refetches every loaded contact page, sequentially.
2. The client-side Unread filter can download the entire inbox to find a few matches.
3. The contact-list SQL does work across the whole matching population before LIMIT;
   PostgreSQL JIT compilation amplifies the cost sharply in this local configuration.
4. Rapid scrolling shows frame drops under 4× CPU throttling.

The baseline assessment added reusable tooling without application changes. The
follow-up implements the scoped optimizations described below.

## Method and limits

### API / database

- Machine: Mac14,9, 10 logical CPUs, 16 GiB RAM; Docker allocated 10 CPUs / ~7.75 GiB.
- PostgreSQL 18.4, aarch64 Alpine; `jit=on`, `jit_above_cost=100000`, inline/optimization
  thresholds 500000, `shared_buffers=128MB`, `work_mem=4MB`.
- One new UUID-owned synthetic workspace, incrementally populated at each size.
  Per size N: N WhatsApp contacts, N bridged conversations, 10N text messages,
  N additional Telegram conversations, 2N conversation states, one account per
  provider, and a tag on 10% of contacts. Ten percent of contacts are marked groups.
  States are resolved; the main measured inbox explicitly requests All.
- Supported tenant indexes reconciled, then ANALYZE before measurements.
- Actual authenticated Hono handlers via `app.request`, including route logic,
  database calls and response serialization. This **excludes HTTP/network RTT**.
- Each endpoint/offset: one first observation, two additional warmups, then
  **20 timed requests**. The first observation is not called a cold-cache test.
- A separate burst issues 10 simultaneous contact-list requests; it is not a sustained
  multi-user load test. API runs and timed browser runs were separated. Brief browser
  readiness smoke checks overlapped the first API run; other host/container activity
  was not isolated, so its tail timings should be treated as directional.
- Real service SQL captured using a Kysely plugin and run through
  `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. No simplified replacement query.
- All benchmark fixtures removed in `finally`; no existing workspace reset.
- No merged contacts, assignments, avatars, populated channel counterparts, binary
  media, or large message bodies. These are important unmeasured dimensions.

### Browser

- Headless Chrome 156.0.8078.74, actual `ChatList`, real auth/workspace/realtime/query
  providers, and an optimized Vite production build. Standalone 420×900 sidebar,
  1280×960 viewport. The rest of the application shell is not rendered.
- Fetch is replaced **only in the separate benchmark entry point**. Responses are
  generated per page, with a controlled 40ms delay; no actual backend calls, real
  credentials, external fetches, live WebSocket traffic, or avatar downloads.
- Default production query options; realtime refresh is triggered through the actual
  `invalidateChatList()` function. Network/WebSocket delivery itself is not measured.
- Scenarios run once each at native speed and CDP 4× CPU throttling: 10,000 contacts,
  sparse unread at the oldest end of that dataset, and 1,000 contacts plus 1,000
  channel conversations. No page errors in the six scenarios. A final native-speed
  repeat of all three scenarios also passed; the tables below use the primary run.
- Heap is JavaScript heap after forced GC, **not browser RSS** or a leak soak test.
- Scroll timing: 179 `requestAnimationFrame` intervals during a rapid scripted sweep
  through already-loaded rows, away from the load-more threshold. This is a headless
  stress comparison, not a guarantee for real phones or touch scrolling.
- Response sizes below are **uncompressed JSON body bytes**, not wire-transfer bytes.
- The loader deliberately waits ~100ms after each batch; aggregate `loadElapsedMs`
  therefore includes test pacing and should not be interpreted as maximum throughput.
- Standalone bootstrap took ~4.2–6.5s in the primary run (up to 8.7s on the final
  native validation repeat), including a large pre-data long task. Its entry
  point eagerly bundles imports rather than using the application's route splitting;
  do not interpret `initialReadyMs` as a product page-load benchmark. Startup would
  need a separate full-application profile.

## Baseline results

### API latency (milliseconds, median / p95)

Each page returns at most 100 rows. Contact responses were ~120–121 KB uncompressed;
channel responses ~55–56 KB.

| Contacts + channel conversations | Contacts, offset 0 | Contacts, last full page | Channels, offset 0 | Channels, last full page |
| --- | ---: | ---: | ---: | ---: |
| 1,000 + 1,000 | 12.17 / 17.18 | 10.65 / 13.90 | 4.89 / 6.34 | 4.01 / 5.63 |
| 10,000 + 10,000 | 815.46 / 1,204.61 | 827.17 / 2,057.07 | 10.74 / 15.20 | 13.22 / 17.77 |
| 25,000 + 25,000 | 1,221.59 / 2,246.84 | 903.37 / 1,194.63 | 72.72 / 162.31 | 47.97 / 56.37 |

The first page is already expensive at larger sizes; this is **not just a deep-OFFSET
problem**. Tail variation and the faster last-page median do not show a benefit to
OFFSET; see the query-plan evidence below.

For 10 concurrent contact-list requests, median / p95 completion time:

- 1,000 contacts: 124 / 198ms.
- 10,000 contacts: 3,714 / 3,899ms.
- 25,000 contacts: 3,748 / 3,823ms.

Filtered contact requests (median / p95):

| Size | Tag matching 10% | Exact-name search | Empty Open status |
| --- | ---: | ---: | ---: |
| 1,000 | 10.12 / 16.62 | 8.56 / 54.05 | 7.00 / 8.51 |
| 10,000 | 100.82 / 113.79 | 30.50 / 44.41 | 97.54 / 118.25 |
| 25,000 | 886.94 / 1,324.96 | 71.05 / 110.67 | 993.57 / 2,364.32 |

### Query-plan findings

- The contact query looks up the latest message and merged-customer aggregates for
  every matching contact before ordering and limiting. The recent-message index is
  used, but its loop count is 10,000 or 25,000 even when returning just 100 rows.
- First-page top-N sorting stays in memory. Last-page sorts spilled to disk at
  10,000 (~4,352 KB) and 25,000 (~10,872 KB) contacts with this `work_mem`.
- At 10,000, a first-page row plan spent 813ms of 911ms in JIT compilation; at
  25,000 it spent 842ms of 1,099ms. The count queries took only ~2–6ms.
- A separate **five-sample, transaction-local** `SET LOCAL jit = off` diagnostic
  confirmed that JIT is a major contributor. These numbers are instrumented row SQL
  only, **not full API latency**:

| Size / offset | Default JIT, median | JIT off, median |
| --- | ---: | ---: |
| 10,000 / 0 | 853.65ms | 97.93ms |
| 10,000 / 9,900 | 833.68ms | 87.09ms |
| 25,000 / 0 | 1,062.16ms | 203.46ms |
| 25,000 / 24,900 | 998.28ms | 244.51ms |

This is evidence for investigating query-level planning/JIT policy, **not approval
for a global or production JIT change**. Even with JIT off, work grows with inbox size.

### Browser memory and rendering

Native-speed run:

| Cached contacts | Rendered rows | JS heap after GC |
| --- | ---: | ---: |
| 100 | 16 | 5.53 MiB |
| 1,000 | 21 | 7.13 MiB |
| 10,000 | 21 | 13.75 MiB |

At 10,000 contacts, DOM count stayed around 471 nodes. With 1,000 contacts plus
1,000 channel conversations, ~20 rows were rendered and heap was ~8.07 MiB.
Virtualization bounds DOM work, **not the cached data size**, which keeps growing.

Scrolling the 10,000 already-loaded contacts:

| CPU setting | Frame p95 | Frame p99 | Intervals >25ms | Long tasks >50ms |
| --- | ---: | ---: | ---: | ---: |
| Native | 16.7ms | 16.8ms | 0 / 179 | 0 |
| 4× throttled | 33.4ms | 50.1ms | 30 / 179 | 1 (53ms) |

Neither scroll sweep made a data request, as expected away from the bottom threshold.

### Refresh amplification and filtering

With 10,000 contacts / 100 pages cached:

| Action | Native result | 4× CPU result |
| --- | --- | --- |
| One invalidation | 100 requests, 9.016 MiB, 4.50s | 100 requests, 9.016 MiB, 4.68s |
| Five invalidations, 150ms apart | 117 requests, 4 aborts, 10.183 MiB, 5.11s | 116 requests, 4 aborts, 10.093 MiB, 5.32s |
| Find the 10 oldest unread contacts | 100 contact + 1 empty channel request, 9.016 MiB, 5.15s | Same request count/bytes, 5.47s |

Refetch completion also produced an 80ms long task at native speed / 157ms at 4× CPU.
These refresh times use **40ms synthetic responses**, not the slower measured real
SQL. Do not multiply the two experiments to claim an observed production duration.
The final native repeat confirmed 21 rows / 13.74 MiB at 10,000 contacts, 100 requests
and 4.43s for one invalidation, and 5.17s for the sparse-unread scan.

## Original recommendations

1. **Server-side unread filtering before pagination.** The service already has an
   `unreadOnly` option, but the current list hook filters each downloaded page in
   the browser. Expose and use the authoritative filter, preserving merged-customer
   unread aggregation and tenant/assignment visibility. Apply equivalent filters
   to channel conversations where possible.
2. **Bound refresh work.** Coalesce frequent realtime invalidations and design an
   anchored/windowed cache or safe event-driven updates. Avoid blindly refetching
   every loaded page on every message. Do not simply refresh page one while leaving
   mutable offset boundaries stale; that can cause missing or duplicated rows.
3. **Page candidates before expensive hydration.** Investigate an indexed activity
   ordering/read model and keyset pagination, then hydrate only that page. Preserve
   merged-customer ordering, account/tag/status filters and authorization semantics.
   A cursor alone will not fix a query that still computes every candidate first.
   Evaluate narrowly scoped JIT mitigation separately; do not change production
   settings on the strength of this local benchmark.
4. **Profile slow-device row rendering** and then repeat these measurements, including
   full-application/mobile tests, realistic merged and assigned data, avatars, larger
   message histories, and a sustained multi-user/realtime workload.

## Optimized implementation

### Changes

- Both APIs validate `unreadOnly=true|false` and apply unread filtering **before**
  pagination. Contacts preserve merged-customer unread aggregation, tag/account/
  lifecycle filters and assignment visibility. Counts now use the same
  conversation-first state resolution as rows, including states without a legacy
  contact ID.
- Each sidebar source retains at most **five 100-row pages**. Scrolling loads older
  pages, with upward loading / “Load newer chats” for evicted newer pages and a
  “Back to latest” action. Stable row anchors preserve position when rows move or
  pages are prepended/evicted. Returning to a cached deep filter starts at the head.
  The shell's existing head-page unread badge uses a separate one-page cache; it
  does not follow the sidebar window (and is still not a workspace-wide total).
- Realtime list refreshes are coalesced with a **250ms quiet period / 1s maximum
  wait**. Active queries are refreshed without cancelling an existing request.
  Signals during a refresh or page load schedule a follow-up; workspace keys are
  captured when scheduled. All retained pages are refreshed, not just page one.
- Virtualized rows live in a memoized component, isolating scroll updates from the
  surrounding filters, dialogs and account menus.
- Contact SQL materializes a narrow candidate page before fetching contact/message
  payloads. Latest-message ordering, merged activity and all visibility predicates
  remain authoritative. Normal calls execute row and count SQL in a short
  transaction with `SET LOCAL jit = off`; the setting restores on success/failure.
  Existing caller-owned transactions are reused without changing their policy.
  Sender-name lookup happens after the internally owned transaction is released.

### Follow-up measurement scope

The same local environment, sizes and 20-sample API methodology were used, with
API and browser timings run separately from tests/builds. The API fixture now also
marks the oldest ten conversations per source unread. Captured production EXPLAINs
replay the service's transaction-local JIT policy; the optional diagnostic explicitly
compares server-default planning with JIT disabled. No server configuration is changed.

Browser traversal tracks **visited offsets**, not cumulative cached rows. Backward
navigation verifies the same visible row stays within 2px and that “Back to latest”
returns both sources to offset zero. Response bytes remain uncompressed JSON, and
the 40ms browser responses remain independent of actual API/database timings.

### Optimized API measurements

Milliseconds, median / p95, 20 sequential samples per page (10 for the burst):

| Size | Baseline first page | Optimized first page | Optimized last page | Optimized 10-request burst |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 12.17 / 17.18 | 75.49 / 138.32 | 32.32 / 89.70 | 609.55 / 658.75 |
| 10,000 | 815.46 / 1,204.61 | 66.40 / 97.81 | 68.91 / 120.67 | 613.78 / 643.29 |
| 25,000 | 1,221.59 / 2,246.84 | 150.93 / 313.76 | 144.40 / 182.26 | 851.26 / 897.49 |

The 1,000-contact phase was unusually variable and slower than the baseline; it
must not be represented as an improvement. Larger-inbox improvements are clear in
this local comparison, but these are separate runs on a non-dedicated machine, not
an interleaved controlled A/B experiment. At 25,000 contacts one request reached
1,073.73ms despite the lower median/p95.

Two 1,000-contact repeats measured first-page median / p95 **16.91 / 25.28ms**
and **18.80 / 35.19ms**. That is still modestly slower than the original 12.17 /
17.18ms. The first repeat's 10-request burst was **584.60 / 656.39ms**; another run
with three consecutive bursts measured **111.35 / 202.07**, **51.77 / 124.82**, and
**95.99 / 107.29ms**. The ~600ms burst slowdown did not reproduce in that last run.
Connection/plan warm-up and host variability have not been isolated as causes;
these results do not establish either a universal speedup or a steady-state burst
regression at small sizes.

The unread endpoint returned exactly ten contacts: median / p95 **71.43 / 86.74ms**
at 10,000 and **221.67 / 275.42ms** at 25,000. Channel first-page timings were largely
unchanged at larger sizes: **11.22 / 14.70ms** and **70.65 / 160.87ms**, respectively.

Production-policy plans contain no JIT compilation. At 25,000 contacts the latest-ID
probe still loops 25,000 times, but message-payload lookup by primary key loops only
100 times. Last-page candidate sorts used **1,713 KB at 10,000** and **3,935 KB at
25,000**, both in memory, rather than the baseline's disk spills. Corrected count
queries cost ~20–33ms in these instrumented larger-dataset plans; their additional
conversation/state joins are not free.

### Optimized browser measurements

After traversing 10,000 contacts, **500 stay cached**, **21 rows** are rendered, and
the DOM has ~474 nodes. Native JS heap after GC was **7.61 MiB**, down from 13.75 MiB.
The mixed 1,000 + 1,000 case retained 500 per source, rendered 20 rows, and used
7.69 MiB. Native and 4× CPU backward-navigation checks both held the anchor at **0px
shift** and successfully returned to offset zero.

| Action after traversing 10,000 contacts | Native | 4× CPU |
| --- | --- | --- |
| One invalidation | 5 contacts + 1 empty channel request; 0.451 MiB; 582ms | Same count/bytes; 586ms |
| Five invalidations, 150ms apart | Same count/bytes; 1,198ms; no aborts | Same count/bytes; 1,213ms; no aborts |
| Find ten oldest unread contacts | 1 contact + 1 empty channel request; 0.009 MiB; 163ms | Same count/bytes; 221ms |
| Scroll frame p95 / p99 | 16.8 / 16.8ms | 16.7 / 16.8ms |
| Scroll intervals over 25ms | 0 / 179 | 0 / 179 |

No long tasks occurred in the measured scroll, refresh or unread phases. All six
scenarios passed without page errors. Startup still had a large standalone-harness
long task (readiness 6.2–10.1s); **startup has not been optimized or signed off**.

A final six-scenario repeat after the empty-window scroll guard also passed:
7.61 MiB native heap at 10,000 visited contacts, 577ms native / 601ms throttled
refresh, 179ms native / 216ms throttled unread lookup, no >25ms scroll intervals,
and zero anchor shift. The tables above retain the primary run rather than mixing
its best results with those from the repeat.

### Remaining limits

- Offset windows are not snapshot/cursor pagination. Activity can move rows across
  page boundaries; deduplication removes repeated IDs but cannot guarantee a frozen
  traversal. The two sources are paged independently, not by a shared global cursor.
- Latest-message probes and merged aggregates still scale with the matching
  population. Narrow page hydration and local JIT policy do not replace an indexed
  authoritative activity read model or eliminate deep OFFSET work.
- Five pages per active source bounds each refresh/window, not the whole QueryClient:
  inactive filter variants live until normal cache GC. The full application also
  keeps the separate head query and may refresh other active lists. The standalone
  browser request counts must not be claimed as whole-application totals.
- Channel search/status/account narrowing still includes client-side filtering;
  sparse combinations other than Unread can require additional pages.
- Full-app startup, real mobile devices, asymmetric multi-channel histories,
  realistic merged/assigned datasets, avatars, and sustained concurrent realtime
  traffic still need profiling. No production performance sign-off is implied.

### Validation

- 747 frontend tests passed, including bounded forward/backward windows, isolated
  head-page badges, cache updates, server unread requests, refresh coalescing /
  in-flight follow-ups / workspace scope, anchors, and empty-window scroll clamping.
- 43 backend regression cases covered: 42 passing batch cases and the corrected
  transaction/JIT regression rerun separately (27 assertions). Coverage includes
  tenant/assignment visibility, unread/tag pagination, merged customers,
  authoritative message ordering, count parity and JIT restoration on errors.
- Application and benchmark TypeScript checks, production builds, targeted lint,
  and diff whitespace checks passed. The benchmark build warns about its large
  standalone bundle; it is not the application's route-split entry point.
- Local fixtures were removed and verified: zero benchmark workspaces/users;
  server `jit` remains `on`. The local preview was stopped.
- At the initial measurement checkpoint, changes were uncommitted and undeployed.
  API and web must be released together after review and explicit approval; the
  current-main release preparation is documented below.

## Release integration on current main

The release branch was ported onto `74a5a063374a1ea9a909a81038c16f168fb12edb`,
the production checkout at release preparation. It preserves the newer one-pass
merged-customer aggregation, pending-read deduplication, avatar signing/timings,
broadcast exclusions, hidden-picker behavior, realtime sync batching and startup
fixes. Broadcast exclusions now also apply to pagination counts. The original
old-branch working tree and unrelated changes were not folded into the release.

A fresh, sequential local comparison used separate current-main and candidate
worktrees, the same synthetic fixture, and **10 samples** per request case. No
build/test/browser workloads overlapped these API measurements. Milliseconds,
median / p95 (with only ten samples, p95 here is the largest observation):

| Size | Current-main first page | Release first page | Current-main 10-request burst | Release 10-request burst |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 14.52 / 20.84 | 12.44 / 18.33 | 32.03 / 32.63 | 33.07 / 33.80 |
| 10,000 | 106.46 / 124.54 | 52.86 / 60.32 | 154.84 / 155.45 | 83.04 / 83.90 |
| 25,000 | 185.56 / 294.23 | 119.96 / 132.71 | 293.69 / 294.39 | 157.27 / 158.61 |

Current main already coalesces identical pending unrestricted reads, so its burst
is materially cheaper than the historical baseline. That behavior is preserved.
The release's unread requests returned ten rows at every size (44.11 / 62.07ms at
10,000; 95.42 / 133.90ms at 25,000). Current main ignored the new query parameter
and returned an ordinary 100-row page; its unread timings are not equivalent work.

Release-worktree checks: **768 web tests**, **75 API regression tests**, TypeScript,
lint, unused-code checks and production builds passed. The final browser run is
recorded separately from the historical runs. No schema migrations or dependencies
were added. Local performance comparisons remain directional, not production
latency guarantees or sustained-load evidence.

Reports: `/tmp/chat-pagination-main-baseline.json` and
`/tmp/chat-pagination-release-api.json`. The older reports and tables above are
retained as historical measurements, not a claim that deploying this release will
make today's production API 8–12× faster.

## Reproduce

Run from `oss/`. Existing dependencies are sufficient for TypeScript and Vite.
The browser driver additionally requires Python Playwright and local Google Chrome.
The database benchmark intentionally refuses anything other than the local
`localhost`/`127.0.0.1:4447/wateaminbox` database and explicit opt-in.

```sh
bun install --frozen-lockfile
bunx tsc -p scripts/benchmarks/tsconfig.json --noEmit

DATABASE_URL=postgresql://postgres:postgres@localhost:4447/wateaminbox \
RUN_CHAT_PAGINATION_BENCHMARK=1 \
BENCH_SIZES=1000,10000,25000 BENCH_SAMPLES=20 \
BENCH_OUTPUT=/tmp/chat-pagination-api-optimized.json \
bun scripts/benchmarks/chat-pagination-api.ts

# Optional repeated-burst diagnostic: use BENCH_SIZES=1000 and
# BENCH_BURST_REPEATS=3 with a separate BENCH_OUTPUT path.

# Optional transaction-local JIT diagnostic, after the main run:
DATABASE_URL=postgresql://postgres:postgres@localhost:4447/wateaminbox \
RUN_CHAT_PAGINATION_BENCHMARK=1 BENCH_DIAGNOSTIC_ONLY=1 \
BENCH_SIZES=10000,25000 BENCH_SAMPLES=5 \
BENCH_OUTPUT=/tmp/chat-pagination-jit-diagnostic-optimized.json \
bun scripts/benchmarks/chat-pagination-api.ts

bunx vite build --config scripts/benchmarks/chat-pagination-browser/vite.config.ts
bunx vite preview --config scripts/benchmarks/chat-pagination-browser/vite.config.ts
# In another terminal; do not overlap timed browser/API runs:
python scripts/benchmarks/chat-pagination-browser/run.py \
  --output /tmp/chat-pagination-browser-optimized.json
```

Stop the localhost preview when finished. The standalone harness is not a product
entry point and must not be deployed. Build artifacts live under
`/tmp/wateaminbox-chat-pagination-browser`, not `apps/web/dist`.

Raw local reports (baseline files are kept separate from optimized runs):

- `/tmp/chat-pagination-api.json` — API distributions and full query plans.
- `/tmp/chat-pagination-jit-diagnostic.json` — transaction-local comparisons/plans.
- `/tmp/chat-pagination-browser.json` — primary browser scenario measurements and limitations.
- `/tmp/chat-pagination-browser-validation.json` — baseline native repeat after tooling validation.
- `/tmp/chat-pagination-api-optimized.json` — optimized API distributions and production-policy plans.
- `/tmp/chat-pagination-api-optimized-small-repeat.json` — 1,000-contact repeat.
- `/tmp/chat-pagination-api-optimized-burst-repeat.json` — 1,000-contact repeat with three consecutive bursts.
- `/tmp/chat-pagination-browser-optimized.json` — optimized native / 4× CPU measurements.
- `/tmp/chat-pagination-browser-optimized-validation.json` — final six-scenario repeat.
- `/tmp/chat-pagination-browser-window-smoke.json` — earlier navigation regression run (not used for timing claims).

The summaries above are retained in this document because `/tmp` reports are ephemeral.
