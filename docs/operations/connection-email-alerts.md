# Connection alerts

Connection alerts use the OSS app's existing `MAIL_DRIVER`, `EMAIL_FROM`,
`APP_URL`, branded HTML shell and plain-text alternative. There is no new mail
provider configuration. This is available to self-hosted deployments too.

- A WhatsApp logout queues email immediately; the background runner polls every
  15 seconds. Provider latency and backlog can add delivery time.
- A previously connected number that remains offline for five minutes queues a
  sustained-disconnect alert. Temporary drops do not send mail.
- Recipients are verified workspace owners/admins at the time of the event.
  Each receives a separate email. Membership, role, verification and active
  workspace status are checked again before sending.
- A successful reconnection or archive cancels queued mail. Unpaired QR expiry
  does not alert. Repeated events do not restart the timer or resend delivered
  mail. A logout after an offline alert sends a new, actionable logout alert.
- Emails identify the workspace and connection name, give the event time in UTC,
  and link to that workspace's Connections settings. They omit phone numbers,
  raw provider errors and message contents.

Migration `087_add_connection_email_alerts` installs a tenant-local queue and
status-change trigger. The trigger queues in the same transaction as connection
state updates, covering worker events, failures and restart recovery. New tenant
reconciliation installs the same schema. There is deliberately no backfill of
existing disconnected connections on deployment, to avoid sending old incidents.
Apply the migration before starting the new API. No private billing changes are
required.

Each queue item has a two-minute claim lease; mail requests have a ten-second
abort deadline. Multiple API replicas use `FOR UPDATE SKIP LOCKED`. Accepted
emails remain recorded until recovery/archive removes the incident. Failed sends
back off from one minute to one hour; an API crash leaves an expiring claim.
The runner stops claiming work during shutdown.

This is at-least-once delivery, not exactly-once: provider acceptance followed by
an API crash or a lost response can produce a duplicate on retry. Recovery or a
role change after the final pre-send check can race with an email already being
submitted. The email tells recipients to check current status. The existing
provider contract cannot retract accepted emails or guarantee idempotency.

Logs report accepted emails and retry attempts without recipient addresses or
provider response bodies. For a tenant's `connection_email_alerts` table,
`sent_at IS NULL` indicates pending delivery; `next_attempt_at` includes both
retry scheduling and an active claim lease. Use aggregate counts in operations
checks, not recipient exports.

## Persistent in-app notifications

Migration `088_add_connection_system_notifications` adds a delivery marker to
that same durable queue. Apply it before starting the updated API. Each eligible
owner/admin gets a `system` notification in Notification Center before the mail
attempt, with a workspace-specific Connections link. It survives refresh and
recovery; users can mark it read or delete it using the existing controls.

Email failures do not prevent notification creation. Retries and competing API
replicas reuse the incident ID, and the delivery marker prevents a dismissed
notification from reappearing. Escalation from offline to logged out creates a
new notification. Existing unresolved queue rows can receive their first in-app
notification without resending an already accepted email. Historical connections
without a queued incident remain excluded.

Realtime invalidation is best-effort; if it fails, the saved notification is
available on the next list refresh. Logout and connection-error toasts offer an
**Open connections** action, as do scheduled-message failures caused by an inactive
connection. Links open Connections settings; reconnecting remains an explicit
user action through the existing QR flow.

## Preview without sending

From the repository root:

```sh
APP_URL=http://localhost:45817 bun run preview:connection-emails
python3 -m http.server 45817 --bind 127.0.0.1 --directory .temp/connection-email-previews
```

Open `/logged_out.html` or `/disconnected.html`. The sample is fictional; the
script writes HTML and text files only. It uses the actual production renderer
and the existing logo. `test-env.ts` supplies test-only signing values required
by the app's configuration loader; no production secrets are needed.

## Validation

Run `bun install --frozen-lockfile`, `bun run build`, and `bun run typecheck` from
the root. Apply migrations to an isolated test PostgreSQL database, then run from
`apps/api`:

```sh
RUN_DB_INTEGRATION=1 DATABASE_URL=<isolated-test-database-url> bun test --timeout 30000 src/services/connection-email-alerts.integration.test.ts src/services/tenant-schema.integration.test.ts
bun test src/lib/connection-alert-email.test.ts src/lib/email-template.test.ts src/lib/mail
```

Integration tests use fake senders and never send actual email. Deployment,
commits and pushes require separate approval under the workspace guide.
