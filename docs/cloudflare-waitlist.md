# WATeamInbox Cloud waitlist on Cloudflare

`apps/waitlist-api` is a standalone Cloudflare Worker for the public **WATeamInbox Cloud** waitlist. It is deliberately separate from the static Astro marketing site:

- `apps/marketing` remains a static Astro build and can still be served by the existing Nginx image or any other static host.
- `apps/waitlist-api` owns the public signup API, confirmation links, D1 data, transactional confirmation email, and its private admin dashboard.
- The browser is configured with an explicit API URL. The Cloudflare Pages deployment uses a same-origin Worker route for the public `/v1/*` paths; self-hosted deployments can use the separate Worker origin.

The WATeamInbox-operated production waitlist and marketing site are live. The checked-in production D1 identifier, Worker/Pages project names, routes, domains, sender address, and Turnstile **site** key (when supplied at build time) are public identifiers, not credentials. Secret values and subscriber data must remain only in Cloudflare-managed bindings/storage. Forks and self-hosters must create and secure their own resources rather than assuming access to the WATeamInbox deployment.

## What the Worker does

`POST /v1/waitlist` accepts one email address, creates a pending D1 subscriber, and sends one confirmation link through Cloudflare Email Service. `GET /v1/waitlist/confirm?token=…` consumes that one-time, three-day token and redirects back to the configured marketing origin with a confirmation state.

The worker has the following safeguards:

- opaque 256-bit browser tokens, stored only as HMAC-SHA-256 hashes;
- single-use confirmation markers, expiry, and idempotent confirmation redirects;
- unique normalized email rows and a ten-minute resend cooldown;
- short-lived idempotency records for retries, keyed and request-fingerprinted with HMACs;
- fixed-window D1 limits for IP and email signup attempts, with hashed bucket keys rather than raw IP storage;
- a honeypot and minimum form-fill time; production Turnstile server validation;
- strict origin allowlisting and narrow public CORS headers;
- a PBKDF2-HMAC-SHA-256 password verifier, brute-force throttling, signed CSRF values, short-lived hashed admin sessions, and secure HTTPS cookies;
- a daily Worker cron that removes expired sessions, idempotency records, stale counters, old confirmation tokens, and stale unconfirmed records.

The dashboard at `/admin` is an authenticated operational view. It keeps the aggregate metrics and shows a paginated subscriber list with each email address, pending/confirmed state, signup time, and confirmation time when present. It never exposes raw confirmation tokens, session tokens, or IP values.

## Prerequisites

- Bun `1.2.18+` and the dependencies installed from the repository root: `bun install`.
- A Cloudflare account and Wrangler authentication for the operator who will create resources and deploy.
- A Cloudflare-managed DNS zone for the email sender domain. Cloudflare Email Service requires Cloudflare DNS for Email Sending.
- A distinct HTTPS Worker origin in production, for example `https://waitlist-api.example.com`.

Read the current Cloudflare documentation before operating the service:

- [D1 get started](https://developers.cloudflare.com/d1/get-started/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Email Service — send emails](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [Email Service Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Email Service send-binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Wrangler configuration and secrets](https://developers.cloudflare.com/workers/wrangler/configuration/)

## 1. Configure D1

The checked-in `apps/waitlist-api/wrangler.jsonc` contains a local/default D1 binding named `DB`, database name `wateaminbox-waitlist`, and a `migrations` directory. Its default binding intentionally omits `database_id` for local development. The `env.production` binding contains the WATeamInbox-operated production database's public resource identifier. Forks and self-hosters must replace that production environment with a database they own; creating one explicitly keeps ownership clear:

```sh
cd apps/waitlist-api
bunx wrangler d1 create wateaminbox-waitlist
```

When Wrangler offers to add the returned `database_id` to `wrangler.jsonc`, accept it (or copy the returned D1 binding into that file). Do not put a fake UUID in source control.

Apply the migration locally first:

```sh
bun run db:migrate:local
bunx wrangler d1 migrations list wateaminbox-waitlist --local
```

After creating the intended remote database and reviewing `migrations/0001_waitlist.sql`, apply it remotely:

```sh
bunx wrangler d1 migrations apply wateaminbox-waitlist-production --remote --env production
bunx wrangler d1 migrations list wateaminbox-waitlist-production --remote --env production
```

Migrations are forward-only. Take an appropriate D1 backup/export and review the SQL before applying it to a production database.

### Named environments

The checked-in config includes `env.production` for the WATeamInbox-operated waitlist. Cloudflare does **not** inherit bindings, variables, or `secrets.required` into named environments, so every added or replaced environment must re-declare `d1_databases`, `send_email`, `vars`, and required secret names. Use resources you own and a separate D1 database for staging. See the [Wrangler environments documentation](https://developers.cloudflare.com/workers/wrangler/environments/).

## 2. Onboard the sending domain and Email Service binding

1. In Cloudflare Dashboard, open **Compute → Email Service → Email Sending**.
2. Onboard the domain that will appear in `WAITLIST_FROM_EMAIL`. Cloudflare adds/requires the sender domain’s SPF, DKIM, bounce, and DMARC records.
3. Update the non-secret `WAITLIST_FROM_EMAIL` variable in `wrangler.jsonc`, for example `WATeamInbox <waitlist@your-domain.example>`.
4. Keep the checked-in `send_email` binding named `EMAIL`. The Worker uses `env.EMAIL.send({ to, from, subject, html, text })`; it needs no application API token.

After you know the verified sender address, restrict the binding’s blast radius in the deployment-specific config:

```jsonc
"send_email": [
  {
    "name": "EMAIL",
    "allowed_sender_addresses": ["waitlist@your-domain.example"]
  }
]
```

Do not set `destination_address` or `allowed_destination_addresses` for this public waitlist: confirmation mail must be delivered to the address supplied by the user. Before a sender domain is onboarded, Email Service only permits verified destination addresses; after onboarding, it can send to recipients generally. See [Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/).

By default, `wrangler dev` simulates the email binding and writes the rendered text/HTML under `.wrangler/tmp/email`; it does **not** deliver mail. Setting a `send_email` binding to `remote: true` sends real email during local development, so use a test recipient only.

## 3. Set secrets safely

The Worker declares four secrets in `secrets.required`:

- `WAITLIST_TOKEN_SECRET` — at least 32 random characters; peppers confirmation, idempotency, and rate-limit hashes.
- `ADMIN_SESSION_SECRET` — a different at-least-32-character random value for administrator sessions and CSRF signatures.
- `ADMIN_PASSWORD_HASH` — a PBKDF2-HMAC-SHA-256 encoded verifier, not a plaintext password. Use 100,000 iterations; Cloudflare Workers rejects higher PBKDF2 counts.
- `TURNSTILE_SECRET_KEY` — the private key matching the public marketing-site Turnstile site key. It is required for non-development deployments.

Never place any of these in `wrangler.jsonc`, a marketing `PUBLIC_*` variable, shell history, or source control. Generate and set them interactively or through an approved secret manager. One safe shell pattern is:

```sh
cd apps/waitlist-api
umask 077

# Generate the password verifier without passing the password as an argument.
read -r -s -p 'Admin password: ' ADMIN_PASSWORD
printf '\n'
ADMIN_PASSWORD_HASH=$(printf '%s' "$ADMIN_PASSWORD" | bun run hash:admin-password)
unset ADMIN_PASSWORD
printf '%s' "$ADMIN_PASSWORD_HASH" | bunx wrangler secret put ADMIN_PASSWORD_HASH --env production
unset ADMIN_PASSWORD_HASH

openssl rand -base64 48 | tr -d '\n' | bunx wrangler secret put WAITLIST_TOKEN_SECRET --env production
openssl rand -base64 48 | tr -d '\n' | bunx wrangler secret put ADMIN_SESSION_SECRET --env production
# Paste the private Turnstile secret only through this command or your secret manager.
bunx wrangler secret put TURNSTILE_SECRET_KEY --env production
```

For local-only work, copy `apps/waitlist-api/.dev.vars.example` to ignored `.dev.vars` and replace its placeholders. `TURNSTILE_SECRET_KEY` may remain blank only while `ENVIRONMENT=development`; production configuration rejects an empty value. Run `bun run types` whenever `wrangler.jsonc` changes, then commit the generated `src/worker-configuration.d.ts`.

## 4. Configure origins, custom domain, and CORS

Before a production deploy, replace the development values in `vars` with real public origins:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "ALLOWED_ORIGINS": "https://www.example.com",
  "MARKETING_ORIGIN": "https://www.example.com",
  "PUBLIC_API_ORIGIN": "https://waitlist-api.example.com",
  "WAITLIST_FROM_EMAIL": "WATeamInbox <waitlist@example.com>"
}
```

For WATeamInbox's selected root-canonical setup, set
`MARKETING_ORIGIN` and `ALLOWED_ORIGINS` to `https://wateaminbox.com`, and set
`PUBLIC_API_ORIGIN` to `https://waitlist-api.wateaminbox.com`. The production
Worker also routes `wateaminbox.com/v1/*`, so the Pages form uses the same
origin and does not depend on browser cross-origin exceptions. The separate API
origin remains the confirmation-link and admin origin. Serve
`www.wateaminbox.com` only as a redirect to the root; it does not need to be a
CORS origin because the form never runs there.

Rules:

- `MARKETING_ORIGIN`, `PUBLIC_API_ORIGIN`, and every entry in `ALLOWED_ORIGINS` must be origins only: scheme, host, optional port, and no path/query/hash. Outside `ENVIRONMENT=development`, the Worker rejects any HTTP value; every one must use HTTPS.
- `ALLOWED_ORIGINS` is a comma-separated allowlist and must contain `MARKETING_ORIGIN`.
- `PUBLIC_API_ORIGIN` is used to generate confirmation links. It must be the Worker’s real public origin, not the static marketing hostname.
- The checked-in configuration sets `workers_dev: false` and `preview_urls: false`, so neither the account `workers.dev` hostname nor version preview URLs become an alternate admin surface. Before deployment, configure the real custom domain as a reviewed route, for example:

  ```jsonc
  "routes": [
    { "pattern": "waitlist-api.example.com", "custom_domain": true }
  ]
  ```

  Replace the example with the exact hostname from `PUBLIC_API_ORIGIN`. Do not re-enable `workers_dev` as a shortcut. A deployment without a configured public route is intentionally not reachable for public requests.
- Public endpoints do not use browser credentials. The admin session is scoped to the Worker origin and is not shared with the marketing site.

The API handles CORS only for `POST /v1/waitlist` and its preflight. It accepts `Content-Type` and `Idempotency-Key` from configured origins only. Do not widen this to `*`.

## 5. Connect the static Astro site

The form has no implicit same-origin `/api` fallback. It uses the explicit build-time API URL: the Cloudflare Pages deployment points it at `https://wateaminbox.com`, where the Worker owns `/v1/*`; self-hosted deployments can point it at the separate Worker origin.

### Cloudflare Pages direct upload

The checked-in `apps/marketing/wrangler.jsonc` is the source of truth for the
production direct-upload Pages project named `wateaminbox`. It deliberately has
no server-side bindings or secrets.

Create the Pages project once, after reviewing the public release:

```sh
cd apps/marketing
bunx wrangler pages project create wateaminbox \
  --production-branch main \
  --compatibility-date 2026-08-02
```

Build the static site with the same-origin Worker path and Turnstile site key,
then upload the configured `dist` directory to the `main` production branch:

```sh
PUBLIC_WAITLIST_API_URL=https://wateaminbox.com \
PUBLIC_WAITLIST_TURNSTILE_SITE_KEY=your-public-turnstile-site-key \
bun run build
bun run deploy:pages
```

The production Worker route `wateaminbox.com/v1/*` handles the form and
confirmation endpoints while Pages continues to serve the rest of the static
site. `deploy:pages` is intentionally a direct upload, not a Git integration. A
public GitHub repository does not deploy Pages automatically in this model;
repeat the reviewed build and upload for each release, or later add a CI workflow
with a dedicated restricted Cloudflare API token.

After the Pages deployment is healthy at its `*.pages.dev` URL, add
`wateaminbox.com` through **Workers & Pages → wateaminbox → Custom domains**.
The apex zone must be active in the same Cloudflare account. Adding it replaces
whatever currently serves the apex. To use `www.wateaminbox.com`, create the
root redirect with Cloudflare Bulk Redirects; do not add a Caddy redirect.

For local development:

```sh
cp apps/marketing/.env.example apps/marketing/.env
# Keep PUBLIC_WAITLIST_API_URL=http://localhost:8787 while the Worker runs there.
cd apps/marketing && bun run dev
```

For a production static build, provide the explicit Worker URL as a **public build-time** value:

```sh
PUBLIC_WAITLIST_API_URL=https://wateaminbox.com \
  bun run --filter @wateaminbox/marketing build
```

To enable Turnstile in the static form, set the non-secret public site key at the same build time:

```sh
PUBLIC_WAITLIST_API_URL=https://wateaminbox.com \
PUBLIC_WAITLIST_TURNSTILE_SITE_KEY=your-public-site-key \
  bun run --filter @wateaminbox/marketing build
```

The Worker validates every received Turnstile token against Siteverify; rendering the widget alone is not sufficient. The form explicitly resets its Turnstile widget after a failed request because validation tokens are single-use. The supplied Docker/Compose changes pass both public variables as build arguments, preserving the current Nginx static-hosting model. Rebuild the marketing image after changing either `PUBLIC_*` value.

When the public API URL is absent, the initial static HTML disables the controls and explains that this copy of the static site has no configured Cloud waitlist. It does not attempt a broken `/api` request. A `noscript` message also explains that configured waitlist signup requires JavaScript while self-hosting does not.

## 6. Validate and deploy (operator-run)

Run the focused checks before any remote operation:

```sh
bun run --filter @wateaminbox/waitlist-api typecheck
bun run --filter @wateaminbox/waitlist-api lint
bun run --filter @wateaminbox/waitlist-api test
bun run --filter @wateaminbox/marketing lint
bun run --filter @wateaminbox/marketing build
```

After D1, Email Service, the reviewed custom-domain route, variables, and all required secrets are set, an authorized operator can deploy from `apps/waitlist-api`:

```sh
bunx wrangler deploy --env production
```

This repository does not invoke that command automatically. Use a reviewed staging environment first, verify a real confirmation delivery, then point `PUBLIC_WAITLIST_API_URL` at the intended Worker origin and rebuild the static site.

## Admin dashboard

Visit `https://waitlist-api.example.com/admin` directly. It is not linked from the public landing page.

The dashboard uses an HttpOnly, `SameSite=Strict` session cookie. Outside local development it uses a `__Host-` cookie name, `Secure`, and `Path=/`; startup rejects non-HTTPS public/admin origins. Login and logout require both signed CSRF values and an exact `Origin` matching `PUBLIC_API_ORIGIN`. Standard browser form posts supply that header; manual local checks must send `Origin: http://localhost:8787` (or the configured HTTPS origin in production). Successful login sessions expire after 12 hours. In addition to the application controls, protect this URL with Cloudflare Access, an appropriate WAF rule, and/or a narrow network policy before inviting other operators.

The dashboard reports totals, confirmed/pending counts, confirmation volume, expiry signal, and conversion rate. It also gives an authenticated administrator a server-paginated subscriber registry with the email address, pending/confirmed state, signup time, and (when present) confirmation time. The list has a bounded server-side page size plus email search and status filters; filters affect only the registry, not the aggregate metrics. Treat the addresses as restricted customer data and grant dashboard access only to operators who need it. Raw confirmation tokens, session tokens, and IP values are never rendered or returned by the dashboard.

## Operational notes

- The WATeamInbox-operated waitlist is covered by the public [waitlist privacy notice](https://wateaminbox.com/privacy). Forks and self-hosters must publish their own operator-specific notice and contact process. The confirmation email is transactional double-opt-in mail, and this Worker does not contain a bulk campaign endpoint. Before sending recurring launch or marketing mail, add an appropriate unsubscribe/opt-out flow.
- Email addresses are necessarily stored to send the confirmation. Raw confirmation tokens, raw session tokens, raw IP addresses, and raw idempotency keys are not stored in D1.
- The in-Worker D1 rate limit is intentionally conservative for a low-volume waitlist. Add Cloudflare WAF/Rate Limiting rules and keep Turnstile enabled for an Internet-facing production domain.
- The scheduled cleanup runs at `04:17 UTC`. It removes stale pending signups and expired artifacts after 30 days; it is a retention cleanup, not a substitute for backups or observability.
- Use Email Service delivery/metrics logs to diagnose actual delivery. A Worker email send can appear as `dropped` in Email Routing summaries even when it is delivered; Cloudflare documents this distinction in the Email Service limits page.
