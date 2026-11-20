# Optional GA4 product analytics

WATeamInbox can optionally report anonymous product usage to a Google
Analytics 4 property **that you own**. The integration is fully inert unless
you, the deployer, explicitly enable it, and each visitor's browser must also
grant consent by default.

This is separate from the built-in workspace analytics dashboard
(`apps/api/src/services/analytics`, `apps/web/src/hooks/analytics`), which
serves your team's own conversation metrics. The GA integration lives in
`apps/web/src/lib/product-analytics` and is referred to as *product
analytics*.

GA data is **approximate by design**: consent choices, ad blockers, browser
privacy features, and network failures all suppress events. Never treat it as
authoritative for billing, quotas, or exact usage.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_GA_ENABLED` | `false` | Explicit kill switch. Only the exact string `true` enables analytics. |
| `VITE_GA_MEASUREMENT_ID` | empty | Your GA4 **web stream** measurement ID (`G-XXXXXXXXXX`). A missing, blank, or malformed ID disables analytics even when the switch is on. |
| `VITE_GA_REQUIRE_CONSENT` | `true` | When `true`, each browser must accept an in-app consent prompt before `gtag.js` loads. Only the literal `false` bypasses the gate. |

Rules:

- Analytics is active only when `VITE_GA_ENABLED=true` **and** the ID
  validates. Every other combination is disabled — including keeping the ID
  while flipping the switch off.
- These are public build-time values, not secrets, and they are compiled into
  the browser bundle. **Changing any of them requires rebuilding the web
  app/image** (`docker compose -f compose.production.yml build web` in
  production, or restarting `vite` locally).
- Never commit a real measurement ID to the repository, and never add a GA
  API secret or Measurement Protocol credential to the frontend.
- Setting `VITE_GA_REQUIRE_CONSENT=false` is an explicit operator policy
  decision: you are responsible for having another valid consent/legal
  mechanism. This switch is deployment policy, not legal advice.

Local/dev enablement:

```sh
# .env (or shell) — then restart/rebuild the web app
VITE_GA_ENABLED=true
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_GA_REQUIRE_CONSENT=true
```

Production enablement: set the same three variables in `.env.production`
(they are passed to the web image through `compose.production.yml` build
args), then rebuild and redeploy the `web` image.

## Consent model

There are two separate choices:

1. **Deployer opt-in** — `VITE_GA_ENABLED=true` plus a valid measurement ID
   enables the integration for the build.
2. **Visitor consent** — with `VITE_GA_REQUIRE_CONSENT=true` (default), each
   browser sees a first-party prompt with equally clear Accept and Decline
   actions. `gtag.js` is not injected before acceptance; a decline persists
   (key `wateaminbox:analytics-consent:v1`) and nothing is ever sent.

Additional behavior:

- Unavailable or corrupt browser storage is treated as *unknown* (not
  granted), never as implicit consent.
- Calls made before consent is granted are discarded, not replayed later.
- Consent can be changed at any time from the authenticated app under
  **Settings → Personal → Privacy & analytics**. This section (like the
  banner) is rendered only when GA is configured, keeping the settings UI
  untouched for deployments that never opt in.
- Withdrawing consent sets gtag's per-property kill switch
  (`window["ga-disable-<measurement id>"] = true`, which stops even the
  cookieless Consent Mode pings a denial update alone still allows), issues
  Consent Mode v2 denial updates (`analytics_storage`, `ad_storage`,
  `ad_user_data`, `ad_personalization`), stops all dispatch immediately, and
  removes the GA cookies that are removable on the current host. The tag is
  not reinitialized in that session; a later re-grant takes effect on the
  next page load.
- Public pages (login/registration) are tracked under exactly the same
  consent rules as every other route — nothing loads before acceptance.

## What is (and is not) sent

Page views are sent manually with a **sanitized, canonicalized route** — never
the raw URL, query string, hash, referrer, or `document.title`. The sanitized
location (and an empty `page_referrer`) is also pinned onto the tag itself
before and at `config` time and re-pinned on every navigation, so GA's
automatically collected events (`first_visit`, `session_start`,
`user_engagement`) cannot fall back to the raw browser URL or referrer either.
Examples:

```text
/w/<workspace-id>/chat/<contact-id>  ->  /w/:workspace/chat/:contact
/w/<workspace-id>/broadcasts/<job>   ->  /w/:workspace/broadcasts/:job
/invite/<token>                      ->  /invite/:token
/reset-password?token=<secret>      ->  /reset-password
unknown paths                        ->  /unknown
```

Only settled, actually rendered destinations produce a page view:
redirect-only locations (`/`, legacy pre-workspace paths like `/chat`, the
workspace index, bare/unknown settings sections, and unknown wildcards) are
skipped so one user navigation is never counted as several page views.

Events pass a typed contract **and** a runtime allowlist: unknown event names
are rejected, unknown parameters are dropped, and values must match small
predefined enums (no free-form strings, counts are bucketed).

Never sent, by policy and by the allowlist: user/workspace/contact/
conversation/message/connection/job IDs, invitation or verification tokens,
emails, names, phone numbers/JIDs, message or quick-reply content, notes,
filenames, media URLs, search terms, labels, tags, custom field values, or
raw API error text. GA `user_id` is not used, and no raw or hashed
application identifier is sent; pseudonymous user/workspace correlation is
explicitly deferred pending a separate privacy review, so GA shows
browser-level trends, not tenant-level retention.

## Event rollout

**Stage 1 (instrumented now)** — foundation and activation, each fired once
and only after a successful outcome:

| Event | Fired when | Parameters |
| --- | --- | --- |
| `page_view` | each SPA navigation (sanitized) | canonical path/title |
| `sign_up` | registration succeeds | `method: email` |
| `login` | authentication succeeds | `method: email` |
| `workspace_created` | create-workspace mutation succeeds | — |
| `whatsapp_connection_setup_started` | backend accepts connection creation | — |
| `whatsapp_connection_connected` | a user-initiated setup/reconnect actually transitions to connected | `connectionMode: new \| reconnect` |

**Stage 2 (contract defined, not yet instrumented)** — `message_sent`,
`conversation_resolved`, `teammate_invited`, `quick_reply_used`,
`broadcast_created`, `report_exported`. Their names and parameter enums are
already part of the reviewed allowlist so future call sites cannot drift;
instrument them only after Stage 1 is verified in GA DebugView and reports.

## GA property setup checklist

The code cannot enforce GA-side behavior. After creating your property:

1. Create a GA4 **web** data stream and copy only its `G-...` measurement ID.
2. In the web stream's **Enhanced Measurement** settings, disable the whole
   feature — or at minimum "Page changes based on browser history events" and
   "Site search" — because Enhanced Measurement collects browser-derived URLs
   and query parameters on the GA side and would bypass the app's route
   canonicalization. The SPA sends sanitized page views manually
   (`send_page_view: false` and pinned canonical page state cover the tag;
   this setting covers the property).
3. Disable Google Signals and advertising personalization unless separately
   reviewed and consented. The tag already sets
   `allow_google_signals: false` and `allow_ad_personalization_signals:
   false`, and denies all ad consent signals.
4. Choose the shortest event-data retention period that supports your
   analysis.
5. Mark key events such as `sign_up`, `workspace_created`, and
   `whatsapp_connection_connected` only after DebugView confirms they fire
   once at the correct outcome.
6. Register only reviewed, non-identifying custom dimensions (message type,
   delivery mode, recipient bucket, report type, role enum).
7. Configure internal/developer traffic filtering so testing does not distort
   production data.
8. Update your deployment's privacy notice and data-retention documentation
   before enabling in production; review the consent copy as part of that.

## Verifying a deployment

- **Disabled build** (default): the app makes no request to
  `googletagmanager.com` or `google-analytics.com`, creates no `dataLayer`,
  and shows no consent banner or settings section. Confirm in the browser
  Network panel.
- **Enabled build**: before accepting the prompt, no Google request occurs;
  after accepting, `gtag/js?id=G-...` loads and DebugView shows sanitized
  page views. Declining or withdrawing stops all traffic.
- Ad blockers commonly block `gtag.js`; the app must (and does) behave
  identically when the script fails to load.

Focused tests live in `apps/web/src/lib/product-analytics/`:

```sh
bun test apps/web/src/lib/product-analytics
```
