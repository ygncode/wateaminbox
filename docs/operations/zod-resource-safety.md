# Zod collection resource-safety remediation

## Scope and upstream finding

This is a dependency/schema migration, not a diagnosis of an observed process
OOM. It contains no capacity change, database migration, or private
implementation. Deployment is reviewed and recorded separately.

Reviewed:

- [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
- [Upstream PR #6652](https://github.com/colinhacks/zod/pull/6652)
- [Patch a0ebf970](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd)
- The installed official `zod@4.6.7` implementation, including `capSize()` in
  `v4/core/schemas.js` and `sizeCaps()` in `v4/core/util.js`.

The patch runs **leading upper-size checks before element parsing** for arrays,
sets and maps (and adds corresponding compiled-path gates). An oversized
container emits its size error and aborts before parsing its elements, creating
per-element promises, or running later collection refinements. Checks that may
rewrite the value stop the leading-check scan; checks intentionally skipped or
backward codec processing are not covered by this gate.

**There is no global issue-count cap.** An unconstrained array of invalid values
still produces an issue for every invalid element. The advisory description's
unconstrained-array wording is broader than the actual fix. JSON decoding, input
allocation, large valid inputs, records and deeply nested data also remain
outside this mitigation. This work does not establish an OOM root cause or
claim that all resource-exhaustion risks are resolved.

## Dependencies

- API: `3.25.76` to exact `4.6.7`.
- Web: `3.24.4` to exact `4.6.7`.
- Root override and `bun.lock` also align the MCP SDK and `kysely-codegen` copies
  previously on `4.4.3`. Knip retains its previously resolved `4.6.7` version,
  now deduplicated with the application. Only Zod resolutions change in the
  lockfile. The collection-size fix first shipped in `4.6.6`; exact `4.6.7`
  avoids downgrading an existing patched dependency.
- Existing resolved `@hono/zod-validator@0.9.1`, `@hookform/resolvers@5.9.1` and
  `react-hook-form@7.91.0` already support Zod 4; no adapter upgrade is needed.
- Application schemas import the patched v4 default entry point, not `zod/v3`.
  The official package still includes legacy v3 compatibility exports and the MCP
  SDK imports those for legacy schema support; application tool schemas select
  the SDK's v4 path. Merely installing v4 would not patch code using v3 schemas.

## Compatibility handling

- Replace v3 UUID checks with v4 `guid()` throughout API, NATS, MCP and web. This
  preserves hexadecimal-group acceptance without adding UUID version/variant
  restrictions, including nil/max and uppercase identifiers.
- `apps/api/src/lib/schemas/string-contracts.ts` preserves existing datetime
  acceptance (optional seconds, UTC and optional basic/colon offsets) and
  original URL string output. v4's built-in datetime is stricter, and its URL
  check strips whitespace/control characters. Scheduling horizon, protocol/host
  checks and all existing field limits remain in their original callers.
- Unbounded integer offsets use `Number.isInteger` refinements, preserving v3's
  integer acceptance rather than silently adding v4's safe-integer ceiling.
  Existing bounded integer fields retain their limits.
- Explicit Zod metadata preserves the previous JSON Schema advertising:
  integer offsets remain `type: "integer"`, datetimes retain `format: "date-time"`,
  and URLs retain `format: "uri"`. Metadata does not replace runtime checks.
  Actual MCP `tools/list` responses are tested for all five offset-bearing tools
  and both scheduling tools, including minimum/default/required properties,
  descriptions and the absence of a newly introduced safe-integer maximum.
  Shared URL/UTC schemas are tested through the SDK converter; they are not
  currently advertised as MCP media tools. As in v3, these format annotations
  coexist with the more permissive legacy runtime syntax (e.g. optional seconds
  and basic timezone offsets); this does not claim new strict RFC validation.
  v4 additionally emits regex patterns; GUIDs retain the `uuid` format label.
- Records now explicitly declare string keys. Enum error customization uses the
  v4 API. Refined objects expose `.shape` directly instead of `.innerType()`;
  MCP still reparses the full auto-reply schema before calling the service.
- Defaults, unknown-key stripping, query coercion, JID normalization and form
  transforms are covered by regression tests. Authentication, tenant lookup,
  visibility checks, permissions and service execution order are unchanged.
- API validation remains HTTP 400 with
  `{ error: "Validation Error", details: [{ field, message }] }`; custom OAuth
  hooks retain control. Oversized arrays now return a collection-level size
  error rather than also enumerating bad elements, which is the intended fix.
  Zod's default diagnostic wording and issue codes can differ from v3 (for
  example, GUID wording and `invalid_format`); raw Zod issues are not the API
  envelope. Custom form messages and field paths are tested through the real
  React Hook Form resolver, including `criteriaMode: "all"`.
- The Web Push protocol refinement now catches malformed URL parsing rather
  than throwing after a failed URL-format refinement. Invalid endpoints reject
  as validation errors; HTTPS and the existing localhost HTTP exceptions remain.

## Array audit and residual risks

Existing application upper bounds are preserved, not invented or increased:

| Input | Existing upper bound |
| --- | --- |
| Batch message IDs | 50 |
| Send-message/conversation mentions | 100 |
| Broadcast audience tags / contacts (REST and MCP) | 50 / 500 |
| Contact query tag IDs after CSV conversion | 50 |
| Group participant operations / group creation | 64 / 1023 |
| Notification muted contacts | 1000 |
| API token scopes | 2 |
| SLA weekly days / daily intervals / exception dates | exact 7 / 12 / 366 |

These bounds precede collection transforms/refinements, so the patched gate is
usable. Query CSV splitting still allocates before the array validation stage.
There are no application Zod map/set input schemas.

Remaining unconstrained external inputs requiring separately reviewed policy:

1. `POST /api/actions/messages/read`, `messageIds: z.array(z.string()).optional()`
   in `apps/api/src/routes/actions/index.ts`. Authentication and tenant membership
   run before validation; contact existence/visibility is checked in the handler
   after validation. Large invalid arrays can still accumulate issues before that
   visibility check. The existing global rate limiter and Bun's 51 MiB upload
   body ceiling are not a collection issue budget. No arbitrary message-count
   limit is added by this migration.
2. SDK-owned MCP initialization `params.clientInfo.icons` and nested `sizes`
   arrays are unconstrained. The MCP route authenticates/rate-limits before
   handing requests to the SDK, but the patch does not cap these arrays. The SDK
   also defines other unconstrained protocol collections; this change does not
   introduce a new protocol-wide policy or assert those are all bounded.
3. Notification `metadata` and NATS envelope `payload` remain string-keyed
   unknown-value records. They do not validate array children element by element,
   but still allocate/iterate record entries. They are not covered by `capSize()`.

Regressions explicitly demonstrate that unconstrained arrays and SDK icon arrays
still emit per-element issues, to prevent future claims of a universal cap.

## Validation and release handoff

New coverage:

- `apps/api/src/lib/schemas/resource-safety.test.ts`: oversized invalid arrays,
  zero element reads, zero async element calls/promises, nested `.length()` and
  `.max()` gates, valid exact boundaries and in-bound field errors.
- `apps/api/src/lib/schemas/zod4-contracts.test.ts`: GUIDs, datetimes, URLs, email,
  offsets, defaults/transforms, records, NATS and cross-field refinements.
- `apps/api/src/lib/validator.test.ts`: actual Hono request/response contracts and
  bounded oversized-array errors.
- `apps/api/src/routes/mcp/zod4-validation.test.ts`: actual `tools/list` field
  metadata, SDK conversion of shared URI/UTC fields, in-memory tool-call
  validation, handler exclusion on invalid input, and the unconstrained
  initialization-array qualification.
- `apps/web/src/lib/schemas/form-resolver.test.ts`: actual resolver behavior for
  auth, profile, team, contacts, quick replies, status and company forms.

Run from the repository root:

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run lint
(cd apps/api && bun test)
(cd apps/web && bun test)
(cd packages/shared && bun test)
(cd packages/adapter-telegram && bun test)
git diff --check
```

Release validation on top of `d0fb8d45` (PR #446) passed (exit 0): fresh frozen
install, full build, typecheck, lint, unused-code analysis and `git diff --check`,
with exact Zod 4.6.7 and the metadata regressions. The current-main unread filter
is preserved; the migration's defaults test now includes `unreadOnly: false`.
API tests: 1028 passed / 583 gated skips / 0 failed; web: 775
passed; shared: 17 passed; Telegram adapter: 25 passed. Existing Vite chunk-size
and Biome configuration-version/deprecation warnings remain. A bounded synthetic
probe against the previous OSS SDK Zod 4.4.3 copy performed 1000 element parses
and emitted 1001 issues for a `.max(50)` array; 4.6.7 performed zero element
parses and emitted one size issue for the same input. This is a regression check,
not an OOM reproduction or root-cause attribution.

The build includes Go services; lint includes Go vet. The exact existing
`vendor/whatsmeow` gitlink revision must be present for those checks. Bun 1.2.18
can leave obsolete nested `node_modules/zod` directories after deduplication;
verify actual API/web/SDK resolution or validate with a clean dependency install.
A fresh production image build must use the frozen lockfile, not stale modules.

Database-backed integration cases are gated/skipped in the local unit run;
full integration checks run separately in PR CI. No production data is used for
testing. The release reviewer must account for both the API and the separate web
image and preserve the orchestrator. The earlier draft worktree and unrelated
original working-tree edits remain untouched.
