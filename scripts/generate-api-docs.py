#!/usr/bin/env python3
"""
Generate detailed per-group API documentation with Mermaid sequence diagrams.

Reads apps/api/src/routes, extracts endpoints + access middleware, and combines
them with hand-authored overviews and sequence diagrams to produce docs/apis/.
"""
import collections
import datetime
import pathlib
import re

BASE = pathlib.Path("apps/api/src/routes")
OUT = pathlib.Path("docs/apis")

# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def clean_desc(raw: str) -> str:
    lines = []
    for l in raw.split("\n"):
        l = l.strip()
        l = re.sub(r"^\*\s?", "", l).strip()
        if not l:
            if lines:
                break
            continue
        if re.match(
            r"^(Requires|Rate limit|Query params|Body|Params|Returns?|Auth|Permissions|Access|Scope|Note|Example|Response|Status codes?)\b",
            l,
            re.I,
        ):
            break
        lines.append(l)
        if len(lines) >= 5:
            break
    text = " ".join(lines).strip()
    text = re.sub(r"^(GET|POST|PUT|PATCH|DELETE)\s+/\S*\s*[-–—:]\s*", "", text, flags=re.I)
    text = re.sub(r"^(GET|POST|PUT|PATCH|DELETE)\s+/\S*\s+", "", text, flags=re.I)
    return text


DESC_OVERRIDES = {
    ("DELETE", "/groups/:id/participants/:participantJid"): "Remove a single participant (deprecated; use `POST /groups/:id/participants/remove`)",
    ("POST", "/groups/:id/participants/:participantJid/demote"): "Demote a single admin to member",
    ("POST", "/groups/:id/participants/:participantJid/promote"): "Promote a single member to admin",
    ("POST", "/media/download/:messageId"): "Request on-demand download of deferred WhatsApp media",
    ("POST", "/media/upload"): "Upload a media file (multipart form)",
    ("GET", "/notifications/push/status"): "Get web-push subscription status",
    ("POST", "/notifications/push/subscribe"): "Subscribe to web-push notifications",
    ("DELETE", "/notifications/push/subscribe"): "Unsubscribe from web-push notifications",
    ("DELETE", "/notifications/push/subscriptions"): "Remove all web-push subscriptions",
    ("POST", "/whatsapp/connections/:connectionId/relink"): "Initiate a new pairing session for an archived connection",
    ("GET", "/whatsapp/connections/archived"): "List archived connections",
}


def access_labels(args_text: str):
    labels = []
    for m in re.finditer(r"requirePermission\(\s*(?:PERMISSIONS\.)?([A-Za-z_]+)\s*\)", args_text):
        labels.append(f"`{m.group(1).lower()}`")
    if re.search(r"\brequireAdmin\b", args_text):
        labels.append("Admin role")
    if re.search(r"\brequireOwner\b", args_text):
        labels.append("Owner role")
    if re.search(r"\brequireContactVisibility\b", args_text):
        labels.append("Contact visibility")
    if re.search(r"\brequireMessageVisibility\b", args_text):
        labels.append("Message visibility")
    if re.search(r"\brequireMessageSendPermission\b", args_text):
        labels.append("`can_send_messages`")
    if re.search(r"\brequireEmailVerification\b", args_text):
        labels.append("Email verified")
    if re.search(r"\blegacyMessageSendRemoved\b", args_text):
        labels.append("Legacy removed")
    if re.search(r"RateLimiter|rateLimiter|RateLimit", args_text):
        labels.append("Rate limited")
    return labels


def extract(f: pathlib.Path):
    text = f.read_text()
    out = []
    for m in re.finditer(
        r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*([\"'])([^\"']*)\3",
        text,
    ):
        recv, meth, q, path = m.groups()
        if not path.startswith("/"):
            continue
        desc = ""
        before = text[: m.start()]
        cm = list(re.finditer(r"/\*\*(.*?)\*/", before, re.DOTALL))
        if cm and before[cm[-1].end():].strip() == "":
            desc = clean_desc(cm[-1].group(1))
        # capture args up to the handler arrow for access detection
        tail = text[m.end(): m.end() + 4000]
        arrow = tail.find("=>")
        access = access_labels(tail[:arrow]) if arrow != -1 else []
        out.append((recv, meth, path, desc, access))
    return out


# file -> list of prefixes (one file may be mounted in several places)
MOUNT = {
    "health.ts": ["/health"],
    "auth/register.ts": ["/auth"], "auth/login.ts": ["/auth"],
    "auth/password.ts": ["/auth"], "auth/session.ts": ["/auth"],
    "companies/crud.ts": ["/companies"], "companies/members.ts": ["/companies"],
    "companies/permissions.ts": ["/companies"], "companies/sla-policy.ts": ["/companies"],
    "whatsapp/legacy.ts": ["/whatsapp"], "whatsapp/status.ts": ["/whatsapp"],
    "whatsapp/connections.ts": ["/whatsapp/connections"],
    "contacts/index.ts": ["/contacts"], "contacts/import.ts": ["/contacts"],
    "contacts/notes.ts": ["/contacts"], "contacts/tags.ts": ["/contacts"],
    "contacts/assignment.ts": ["/contacts"],
    "messages/scheduled.ts": ["/messages"], "messages/fetch.ts": ["/messages"],
    "messages/send.ts": ["/messages"], "messages/actions.ts": ["/messages"],
    "messages/reactions.ts": ["/messages"], "messages/batch.ts": ["/messages/batch"],
    "bulk-jobs.ts": ["/bulk-jobs"],
    "conversations/analytics.ts": ["/conversations"], "conversations/state.ts": ["/conversations"],
    "conversations/messages.ts": ["/conversations"],
    "tags.ts": ["/tags"], "audit.ts": ["/audit"], "analytics.ts": ["/analytics"],
    "export.ts": ["/export"], "groups/crud.ts": ["/groups"], "groups/members.ts": ["/groups"],
    "groups/settings.ts": ["/groups"], "status.ts": ["/status"], "search.ts": ["/search"],
    "notifications.ts": ["/notifications"], "quick-replies.ts": ["/quick-replies"],
    "labels.ts": ["/labels"], "catalogs.ts": ["/catalogs"], "media.ts": ["/media"],
    "debug.ts": ["/debug"], "feedback.ts": ["/feedback"],
    "realtime/index.ts": ["/realtime"], "actions/index.ts": ["/actions"],
}

# ---------------------------------------------------------------------------
# Hand-authored content
# ---------------------------------------------------------------------------

GROUPS = [
    {
        "key": "auth",
        "title": "Auth",
        "prefixes": ["/auth"],
        "public": True,
        "overview": (
            "Authentication and account lifecycle: registration, login, session "
            "refresh/revocation, email verification, and password reset. These routes "
            "are **public** (no tenant context); a few (`/auth/me`, `/auth/sessions`, "
            "`/auth/logout`, `/auth/change-password`) require a valid access token."
        ),
        "flows": [
            ("Registration", """sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant S as auth.service
    participant D as Postgres (shared db)
    participant M as Mail driver
    C->>A: POST /api/auth/register {email,password,name}
    A->>A: rate limit + zValidator + password strength
    A->>S: register(email,password,name)
    S->>S: hash password (argon2/bcrypt)
    S->>D: INSERT user
    S->>M: send verification email (Resend/Cloudflare)
    S-->>A: user + verificationEmailSent
    A-->>C: 201 {user, verificationEmailSent}
"""),
            ("Login & session", """sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant S as auth.service
    participant D as Postgres (shared db)
    C->>A: POST /api/auth/login {email,password,deviceInfo}
    A->>S: login(email,password,deviceInfo)
    S->>D: verify password against user
    S->>D: create session row
    S->>S: issue access JWT + refresh JWT
    S-->>A: {user, tokens, session}
    A->>A: set refresh token as HTTP-only cookie
    A-->>C: 200 {user, accessToken, session}
    Note over C,A: access token sent as `Authorization: Bearer`
"""),
            ("Authenticated request (middleware)", """sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant D as Postgres
    C->>A: GET /api/... (Bearer + X-Company-ID)
    A->>A: authMiddleware -> verifyAccessToken
    A->>D: getUserById + hasActiveSession
    A->>A: tenantMiddleware -> getMemberWithPermissions
    A->>D: member + role + permissions + tenantDb
    A->>A: role/permission/visibility guards
    A->>D: handler -> tenantDb query
    A-->>C: JSON response
"""),
        ],
    },
    {
        "key": "companies",
        "title": "Companies (Workspaces)",
        "prefixes": ["/companies"],
        "overview": (
            "Workspace management: company CRUD, members, invitations, member "
            "permissions, SLA policy, and ownership transfer. All routes require a "
            "valid JWT and tenant context (`X-Company-ID`). Admin/owner-only actions "
            "are annotated per endpoint."
        ),
        "flows": [
            ("Create company & become owner", """sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant S as company.service
    participant D as Postgres
    C->>A: POST /api/companies {name,...}
    A->>A: authMiddleware (JWT)
    A->>S: createCompany(userId, input)
    S->>D: INSERT company + tenant schema
    S->>D: INSERT owner membership
    S-->>A: company
    A-->>C: 201 {company}
"""),
            ("Invite & update member", """sequenceDiagram
    participant O as Owner/Admin
    participant A as API (Hono)
    participant D as Postgres
    participant M as Mail driver
    O->>A: POST /api/companies/:id/invitations
    A->>A: requirePermission(can_invite)
    A->>D: create invitation (token) + audit log
    A->>M: send invite email
    A-->>O: 201 {invitation}
    O->>A: PATCH /api/companies/:id/members/:userId/permissions
    A->>A: requirePermission(can_manage_team)
    A->>D: update member permissions + audit log
    A-->>O: 200 {member}
"""),
        ],
    },
    {
        "key": "invitations",
        "title": "Invitations (token acceptance)",
        "prefixes": ["/invitations"],
        "overview": (
            "Public token endpoints for previewing and accepting a workspace "
            "invitation. `GET /:token` is public; `POST /:token/accept` requires "
            "authentication but **no** tenant context (the user is not a member yet)."
        ),
        "flows": [
            ("Accept invitation", """sequenceDiagram
    participant U as Invited user
    participant A as API (Hono)
    participant S as company.service
    participant D as Postgres
    U->>A: GET /api/invitations/:token
    A->>S: getInvitationByToken(token)
    S->>D: SELECT invitation + company
    A-->>U: 200 {invitation preview}
    U->>A: POST /api/invitations/:token/accept (Bearer JWT)
    A->>S: acceptInvitation(token, userId)
    S->>D: validate + create membership in tenant schema
    A->>D: createAuditLog(invitation.accepted)
    A-->>U: 200 {company, member}
"""),
        ],
    },
    {
        "key": "contacts",
        "title": "Contacts",
        "prefixes": ["/contacts"],
        "overview": (
            "Contact (customer) management: CRUD, assignment, notes, tags, and CSV "
            "import. Notes and assignments carry permission/visibility semantics; see "
            "the access column per endpoint."
        ),
        "flows": [
            ("Create & assign contact", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as contact.service
    participant D as Postgres (tenantDb)
    participant R as Centrifugo
    U->>A: POST /api/contacts {jid,...}
    A->>A: authMiddleware + tenantMiddleware
    A->>S: createContact(tenantDb, input)
    S->>D: INSERT contact
    A-->>U: 201 {contact}
    U->>A: POST /api/contacts/:id/assign
    A->>A: requirePermission(can_assign_contacts)
    A->>D: update assignment
    A->>R: broadcast assignment event to viewers
    A-->>U: 200 {assignment}
"""),
            ("CSV import", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as import service
    participant D as Postgres (tenantDb)
    U->>A: POST /api/contacts/import (multipart CSV)
    A->>S: parse + validate rows
    S->>D: bulk upsert contacts
    S-->>A: {imported, skipped, errors}
    A-->>U: 200 {summary}
"""),
        ],
    },
    {
        "key": "conversations",
        "title": "Conversations",
        "prefixes": ["/conversations"],
        "overview": (
            "Conversation state transitions and message reads for a contact, plus "
            "resolution/SLA analytics. State transitions update the conversation case "
            "and are recorded for SLA tracking."
        ),
        "flows": [
            ("Resolve conversation (state + SLA)", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as conversation-state.service
    participant D as Postgres (tenantDb)
    participant R as Centrifugo
    U->>A: POST /api/conversations/:id/resolve
    A->>A: auth + tenant + contact visibility
    A->>S: resolve(tenantDb, contactId, user)
    S->>D: update conversation case state + timestamps
    A->>R: broadcast state change to viewers
    A-->>U: 200 {conversation}
"""),
        ],
    },
    {
        "key": "messages",
        "title": "Messages",
        "prefixes": ["/messages", "/messages/batch"],
        "overview": (
            "Sending, fetching, reacting to, starring, and scheduling messages, plus "
            "batch operations. Sending is **asynchronous**: the message is stored "
            "`pending`, a command is enqueued, and delivery/status updates flow back "
            "through NATS and the WhatsApp worker."
        ),
        "flows": [
            ("Send message (async)", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant O as Command Outbox
    participant N as NATS (JetStream)
    participant OC as Orchestrator
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/messages {contactId, content}
    A->>A: requireMessageSendPermission + rate limit + validate
    A->>D: lookup contact + active connection
    A->>D: transaction: insert message (status=pending) + enqueue command
    A->>R: broadcast message:new (pending) to viewers
    A-->>U: 201 {message (pending)}
    O->>N: publish send_message command
    N->>OC: command
    OC->>W: deliver to worker
    W->>WA: send text/media
    WA-->>W: ack/send receipt
    W->>N: publish receipt/send_confirmation event
    N->>A: event subscriber (message-handler)
    A->>D: update message status (sent/delivered/read)
    A->>R: broadcast message:status to viewers
"""),
            ("Inbound message", """sequenceDiagram
    participant WA as WhatsApp
    participant W as WhatsApp Worker
    participant N as NATS
    participant A as API (event subscriber)
    participant D as Postgres (tenantDb)
    participant R as Centrifugo
    WA-->>W: incoming message event
    W->>N: publish message event
    N->>A: message-handler
    A->>D: upsert contact + insert message
    A->>R: broadcast message:new to authorized viewers
    R-->>U: websocket push
"""),
        ],
    },
    {
        "key": "groups",
        "title": "Groups",
        "prefixes": ["/groups"],
        "overview": (
            "WhatsApp group administration: list/create/rename, participant add/"
            "remove/promote/demote, settings, invite links, join requests, leave, and "
            "sync. These are **asynchronous** commands to WhatsApp; results come back "
            "via group events. Every mutation requires `can_send_messages`."
        ),
        "flows": [
            ("Create group (async)", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/groups {name, participants[]}
    A->>A: auth + tenant + can_send_messages
    A->>D: enqueue group_create command
    A-->>U: 202 {group (pending)}
    N->>W: group_create command
    W->>WA: create group
    WA-->>W: group created
    W->>N: group event
    N->>A: group-sync handler
    A->>D: persist group + members
    A->>R: broadcast group event to workspace
"""),
            ("Add participants (async)", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    U->>A: POST /api/groups/:id/participants
    A->>D: enqueue group_add_participants command
    A-->>U: 202 {accepted}
    N->>W: command
    W->>WA: add participants
    WA-->>W: result
    W->>N: group event
    N->>A: sync handler -> persist
"""),
        ],
    },
    {
        "key": "whatsapp",
        "title": "WhatsApp Connections & Status",
        "prefixes": ["/whatsapp", "/whatsapp/connections"],
        "overview": (
            "Multi-connection management (list/create/rename/archive/purge/reconnect/"
            "relink/disconnect/send) plus legacy single-connection endpoints and "
            "WhatsApp Status (stories). Connecting is **asynchronous**: a worker is "
            "spawned, a QR code is produced and pushed in realtime, and the scan "
            "completes the pairing."
        ),
        "flows": [
            ("Create connection & QR pairing", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant OC as Orchestrator
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/whatsapp/connections
    A->>A: requirePermission(can_manage_connections)
    A->>D: advisory-lock count check + insert pending connection
    A->>D: enqueue spawn command
    A-->>U: 201 {connection (pending)}
    N->>OC: spawn command
    OC->>W: launch worker process
    W->>WA: connect (await QR)
    WA-->>W: QR code
    W->>N: QR event
    N->>A: store QR + expire time
    A->>R: broadcast `qr` to workspace
    R-->>U: show QR code
    U->>WA: scan QR on phone
    WA-->>W: connected
    W->>N: connection event
    N->>A: update status -> connected
    A->>R: broadcast `connected`
"""),
            ("Disconnect (kill)", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant OC as Orchestrator
    participant W as WhatsApp Worker
    U->>A: POST /api/whatsapp/connections/:id/disconnect
    A->>D: update status -> disconnected + enqueue kill command
    A-->>U: 200
    N->>OC: kill command
    OC->>W: terminate worker
"""),
        ],
    },
    {
        "key": "notifications",
        "title": "Notifications",
        "prefixes": ["/notifications"],
        "overview": (
            "In-app notifications, read state, mute, preferences, and web-push "
            "subscriptions. Delivery combines DB-persisted notification history with "
            "optional push via web-push subscriptions."
        ),
        "flows": [
            ("Notification delivery", """sequenceDiagram
    participant E as Event (service)
    participant S as notification-delivery.service
    participant D as Postgres (tenantDb)
    participant P as Push driver
    participant R as Centrifugo
    E->>S: deliver(companyId, userId, payload)
    S->>D: insert notification_history
    S->>R: broadcast notification event
    S->>P: push if subscription exists
"""),
        ],
    },
    {
        "key": "analytics",
        "title": "Analytics",
        "prefixes": ["/analytics"],
        "overview": (
            "Read-only aggregate metrics: messages, response times, SLA breaches, "
            "engagement, team activity, and dashboard totals. All queries run against "
            "the tenant schema; dashboard access is gated by `can_view_dashboard`."
        ),
        "flows": [
            ("Analytics query", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as analytics.service
    participant D as Postgres (tenantDb)
    U->>A: GET /api/analytics/messages?range=...
    A->>A: auth + tenant
    A->>S: compute metric
    S->>D: aggregate SQL over messages/conversations
    S-->>A: {series, totals}
    A-->>U: 200 {data}
"""),
        ],
    },
    {
        "key": "bulk-jobs",
        "title": "Bulk Broadcast Jobs",
        "prefixes": ["/bulk-jobs"],
        "overview": (
            "Bulk broadcast campaigns: create, preview, schedule, cancel, and track "
            "recipients. Creation requires `can_send_bulk_messages`; delivery fans out "
            "to each recipient through the same async send path as single messages."
        ),
        "flows": [
            ("Bulk job lifecycle", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant S as bulk-job.service
    participant N as NATS
    participant R as Centrifugo
    U->>A: POST /api/bulk-jobs {recipients, content}
    A->>A: requirePermission(can_send_bulk_messages)
    A->>S: createBulkJob
    S->>D: insert bulk_job + recipients
    A-->>U: 201 {job}
    S->>N: fan out send commands per recipient
    loop each recipient
        N->>N: send_message command
    end
    S->>R: broadcast bulk_job:updated
"""),
        ],
    },
    {
        "key": "catalogs",
        "title": "Catalogs",
        "prefixes": ["/catalogs"],
        "overview": (
            "WhatsApp Commerce catalogs: list catalogs and products, sync from "
            "WhatsApp, and toggle product visibility. Sync is asynchronous via the "
            "worker."
        ),
        "flows": [
            ("Sync catalog", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/catalogs/sync
    A->>D: enqueue sync_catalogs command
    A-->>U: 202
    N->>W: command
    W->>WA: fetch catalogs
    WA-->>W: catalog list
    W->>N: catalogs event
    N->>A: persist + broadcast catalogs:updated
"""),
        ],
    },
    {
        "key": "labels",
        "title": "Labels",
        "prefixes": ["/labels"],
        "overview": (
            "WhatsApp labels sync and contact label application. Sync and apply/"
            "remove are asynchronous worker commands; list endpoints read the "
            "synced label state from the tenant schema."
        ),
        "flows": [
            ("Sync & apply label", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    U->>A: POST /api/labels/sync
    A->>D: enqueue sync_labels command
    A-->>U: 202
    N->>W: sync_labels
    W->>WA: fetch labels
    W->>N: labels event -> persist
    U->>A: POST /api/labels/:id/apply/:contactId
    A->>D: enqueue apply_label command
    A-->>U: 202
"""),
        ],
    },
    {
        "key": "tags",
        "title": "Tags",
        "prefixes": ["/tags"],
        "overview": (
            "Workspace-local contact tags (distinct from WhatsApp labels). Simple "
            "synchronous CRUD against the tenant schema."
        ),
        "flows": [
            ("Tag CRUD", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    U->>A: POST /api/tags {name,color}
    A->>A: auth + tenant + zValidator
    A->>D: INSERT tag
    A-->>U: 201 {tag}
"""),
        ],
    },
    {
        "key": "quick-replies",
        "title": "Quick Replies",
        "prefixes": ["/quick-replies"],
        "overview": (
            "Canned/shortcut replies. Synchronous CRUD; `GET /search/:shortcut` lets "
            "the composer resolve a shortcut to its expansion."
        ),
        "flows": [
            ("Quick reply CRUD & lookup", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    U->>A: POST /api/quick-replies {shortcut, text}
    A->>D: INSERT quick_reply
    A-->>U: 201
    U->>A: GET /api/quick-replies/search/:shortcut
    A->>D: SELECT by shortcut
    A-->>U: 200 {text}
"""),
        ],
    },
    {
        "key": "search",
        "title": "Search",
        "prefixes": ["/search"],
        "overview": (
            "Full-text search across messages, contacts, and status, backed by "
            "Meilisearch. `POST /reindex` rebuilds the tenant index."
        ),
        "flows": [
            ("Search & reindex", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant M as Meilisearch
    participant D as Postgres (tenantDb)
    U->>A: GET /api/search/messages?q=...
    A->>M: query tenant index
    M-->>A: hits
    A->>D: hydrate results from tenantDb
    A-->>U: 200 {results}
    U->>A: POST /api/search/reindex
    A->>D: read documents
    A->>M: rebuild index
    A-->>U: 202
"""),
        ],
    },
    {
        "key": "status",
        "title": "Status (Stories)",
        "prefixes": ["/status"],
        "overview": (
            "WhatsApp Status (stories) posting and reading. Posting is asynchronous "
            "via the worker; status events are broadcast workspace-wide by policy."
        ),
        "flows": [
            ("Post status", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    U->>A: POST /api/status {content, mediaUrl?}
    A->>D: enqueue post_status command
    A-->>U: 202
    N->>W: post_status
    W->>WA: upload + publish status
    WA-->>W: result -> status event
    N->>A: persist status_updates
"""),
        ],
    },
    {
        "key": "audit",
        "title": "Audit",
        "prefixes": ["/audit"],
        "overview": (
            "Audit log for sensitive workspace actions. Read-only; requires "
            "`can_view_audit` (owner/admin). Supports export of the log."
        ),
        "flows": [
            ("Audit query", """sequenceDiagram
    participant U as Owner/Admin
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    U->>A: GET /api/audit?action=...&actor=...
    A->>A: auth + tenant + can_view_audit
    A->>D: SELECT audit_logs with filters
    A-->>U: 200 {items, pagination}
"""),
        ],
    },
    {
        "key": "export",
        "title": "Export",
        "prefixes": ["/export"],
        "overview": (
            "Data export: contacts, messages, full workspace, single conversation, "
            "and bulk exports. Requires `can_export`."
        ),
        "flows": [
            ("Export flow", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as export.service
    participant D as Postgres (tenantDb)
    U->>A: GET /api/export/contacts
    A->>A: requirePermission(can_export)
    A->>S: build CSV
    S->>D: stream rows
    S-->>A: CSV bytes
    A-->>U: 200 (text/csv)
"""),
        ],
    },
    {
        "key": "media",
        "title": "Media",
        "prefixes": ["/media"],
        "overview": (
            "Media upload and authorized download. Uploads go to private storage "
            "(R2/S3); reads return short-lived signed URLs. On-demand download of "
            "deferred WhatsApp media is asynchronous."
        ),
        "flows": [
            ("Upload & authorized read", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as storage (R2/S3)
    participant D as Postgres (tenantDb)
    U->>A: POST /api/media/upload (multipart)
    A->>S: put object (private)
    A->>D: record media reference
    A-->>U: 201 {mediaUrl}
    U->>A: GET /api/media/messages/:messageId
    A->>D: lookup media_url
    A->>S: presign URL (5 min expiry)
    A-->>U: 200 {mediaUrl, expiresIn}
"""),
        ],
    },
    {
        "key": "actions",
        "title": "Actions (realtime REST)",
        "prefixes": ["/actions"],
        "overview": (
            "Lightweight REST actions mirrored to realtime: mark read, send, and "
            "typing indicators. `typing` emits an ephemeral signal to the other side."
        ),
        "flows": [
            ("Typing indicator", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant N as NATS
    participant W as WhatsApp Worker
    participant R as Centrifugo
    U->>A: POST /api/actions/messages/typing
    A->>N: publish typing command (ephemeral)
    N->>W: forward typing
    W->>R: emit typing:start/stop to viewers
"""),
        ],
    },
    {
        "key": "realtime",
        "title": "Realtime (Centrifugo token)",
        "prefixes": ["/realtime"],
        "overview": (
            "Issues a short-lived Centrifugo connection token. Channel subscriptions "
            "are derived server-side from the authenticated user and their verified "
            "workspace membership."
        ),
        "flows": [
            ("Realtime connect", """sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant CF as Centrifugo
    C->>A: POST /api/realtime/token (Bearer + X-Company-ID)
    A->>A: auth + tenant membership check
    A->>CF: createRealtimeConnectionToken(user, company)
    A-->>C: 200 {token}
    C->>CF: WebSocket connect (token)
    CF->>CF: subscribe company:{companyId} + allowed conversations
"""),
        ],
    },
    {
        "key": "health",
        "title": "Health",
        "prefixes": ["/health"],
        "overview": (
            "Infrastructure probes for Kubernetes/Docker: liveness, readiness, and "
            "overall status. Public (no auth); readiness gates on Postgres/NATS/"
            "event-consumer/Centrifugo."
        ),
        "flows": [
            ("Readiness probe", """sequenceDiagram
    participant K as K8s/Docker
    participant A as API (Hono)
    participant D as Postgres
    participant N as NATS
    K->>A: GET /api/health/ready
    A->>D: SELECT 1
    A->>N: connection + consumer state
    A-->>K: 200 ready / 503 unready
"""),
        ],
    },
    {
        "key": "feedback",
        "title": "Feedback",
        "prefixes": ["/feedback"],
        "overview": (
            "Public feedback submission. Unauthenticated, body-bounded, and emailed "
            "to the product address."
        ),
        "flows": [
            ("Submit feedback", """sequenceDiagram
    participant U as Any user
    participant A as API (Hono)
    participant M as Mail driver
    U->>A: POST /api/feedback {message, email?}
    A->>A: zValidator (bounded) + escape HTML
    A->>M: sendEmail(contact@wateaminbox.com)
    A-->>U: 200 {message}
"""),
        ],
    },
    {
        "key": "debug",
        "title": "Debug (NATS)",
        "prefixes": ["/debug"],
        "overview": (
            "Development-only NATS inspection endpoints (consumers, messages, trace). "
            "Not enabled in production."
        ),
        "flows": [
            ("NATS inspection", """sequenceDiagram
    participant U as Developer
    participant A as API (Hono)
    participant N as NATS
    U->>A: GET /api/debug/nats/messages/:stream
    A->>N: fetch stream messages
    A-->>U: 200 {messages}
"""),
        ],
    },
]

# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def collect_rows():
    rows = collections.defaultdict(list)  # group key -> list[(prefix, meth, path, desc, access)]
    for f in sorted(BASE.rglob("*.ts")):
        if ".test." in f.name or ".integration." in f.name:
            continue
        rel = str(f.relative_to(BASE))
        if rel == "index.ts":
            for recv, meth, path, desc, access in extract(f):
                if path == "/" and not desc:
                    desc = "API service info (name and version)"
                rows["(root)"].append(("(root)", meth, path, desc, access))
            continue
        if rel == "groups/index.ts":
            continue
        if rel == "companies/invitations.ts":
            for recv, meth, path, desc, access in extract(f):
                if recv == "tokenInvitationRoutes":
                    rows["invitations"].append(("/invitations", meth, path, desc, access))
                elif recv == "invitationRoutes":
                    rows["companies"].append(("/companies", meth, path, desc, access))
            continue
        if rel not in MOUNT:
            continue
        for recv, meth, path, desc, access in extract(f):
            for prefix in MOUNT[rel]:
                # map prefix to group key
                key = None
                for g in GROUPS:
                    if prefix in g["prefixes"]:
                        key = g["key"]
                        break
                if key is None:
                    key = prefix.strip("/").replace("/", "-")
                rows[key].append((prefix, meth, path, desc, access))
    for k in rows:
        rows[k].sort(key=lambda x: (x[0], x[2]))
    return rows


def md_escape(s):
    return s.replace("|", "\\|")


def endpoint_table(items):
    lines = ["| Method | Path | Access | Description |",
             "|--------|------|--------|-------------|"]
    for prefix, meth, path, desc, access in items:
        full = prefix + path if prefix != "(root)" else "/"
        desc = DESC_OVERRIDES.get((meth.upper(), full), desc)
        acc = " · ".join(access) if access else "—"
        lines.append(f"| {meth.upper()} | `{full}` | {md_escape(acc)} | {md_escape(desc)} |")
    return "\n".join(lines)


def write_group(g, items):
    if g["key"] == "(root)":
        return
    total = len(items)
    meths = collections.Counter(m for _, m, _, _, _ in items)
    lines = []
    base = ", ".join(f"`/api{p}`" for p in g["prefixes"])
    lines.append(f"# {g['title']} API")
    lines.append("")
    lines.append(f"> Base path: {base} · {total} endpoints")
    lines.append("")
    lines.append(g["overview"])
    lines.append("")
    lines.append("## Endpoints")
    lines.append("")
    lines.append(f"**Methods:** GET {meths.get('get', 0)} · POST {meths.get('post', 0)} · "
                 f"DELETE {meths.get('delete', 0)} · PATCH {meths.get('patch', 0)} · "
                 f"PUT {meths.get('put', 0)}")
    lines.append("")
    lines.append(endpoint_table(items))
    lines.append("")
    lines.append("## Flows")
    lines.append("")
    for title, diagram in g["flows"]:
        lines.append(f"### {title}")
        lines.append("")
        lines.append("```mermaid")
        lines.append(diagram.rstrip())
        lines.append("```")
        lines.append("")
    (OUT / f"{g['key']}.md").write_text("\n".join(lines) + "\n")


def write_readme(rows):
    total = sum(len(v) for v in rows.values())
    lines = []
    lines.append("# WATeamInbox API Documentation")
    lines.append("")
    lines.append("Detailed, group-by-group API reference for `apps/api` (the OSS API "
                 "service). Every group file lists its endpoints with access controls "
                 "and includes Mermaid sequence diagrams for the important flows.")
    lines.append("")
    lines.append(f"> Generated from `apps/api/src/routes` on "
                 f"{datetime.date.today().isoformat()}. All paths are served under the "
                 f"`/api` base path.")
    lines.append("")
    lines.append("## Architecture at a glance")
    lines.append("")
    lines.append("The API is a [Hono](https://hono.dev) app. Every request passes "
                 "through a fixed middleware pipeline, then a route handler, then a "
                 "service that talks to the per-tenant PostgreSQL schema and/or NATS.")
    lines.append("")
    lines.append("```mermaid")
    lines.append("""sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant M as Middleware
    participant H as Route handler
    participant S as Service
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant R as Centrifugo
    C->>A: HTTP /api/...
    A->>M: CORS -> global rate limit
    M->>M: authMiddleware (JWT + session)
    M->>M: tenantMiddleware (X-Company-ID -> role/permissions/tenantDb)
    M->>M: permission/role/visibility guards
    M->>H: route handler
    H->>S: service call
    alt synchronous read/write
        S->>D: tenant schema query
        S-->>H: result
    else async WhatsApp action
        S->>D: persist + enqueue command
        S->>N: publish command (outbox)
        N-->>R: later: events -> broadcast
    end
    H-->>A: response
    A-->>C: JSON
""")
    lines.append("```")
    lines.append("")
    lines.append("### Request context")
    lines.append("")
    lines.append("- **Auth:** `Authorization: Bearer <access-token>` (JWT). Refresh tokens "
                 "live in an HTTP-only cookie.")
    lines.append("- **Tenant:** `X-Company-ID: <workspace-uuid>`. The tenant middleware "
                 "resolves membership, role, permissions, and opens the per-tenant "
                 "`tenant_<uuid>` schema connection.")
    lines.append("- **Permissions:** feature-based (`can_send_messages`, "
                 "`can_manage_connections`, ...) plus role hierarchy "
                 "(owner > admin > member).")
    lines.append("")
    lines.append("### Async command path")
    lines.append("")
    lines.append("WhatsApp-affecting actions are asynchronous and reliable: the handler "
                 "persists state and enqueues a command in the **command outbox**, which "
                 "publishes to **NATS (JetStream)**. The **orchestrator** runs the "
                 "**WhatsApp worker**, which performs the action against WhatsApp and "
                 "publishes events back; the API consumes those events, persists the "
                 "result, and broadcasts to **Centrifugo** for the realtime UI.")
    lines.append("")
    lines.append("## Groups")
    lines.append("")
    lines.append("| Group | File | Endpoints |")
    lines.append("|-------|------|-----------|")
    for g in GROUPS:
        n = len(rows.get(g["key"], []))
        lines.append(f"| {g['title']} | [`{g['key']}.md`]({g['key']}.md) | {n} |")
    if "(root)" in rows:
        n = len(rows["(root)"])
        lines.append(f"| Root (`/`) | see below | {n} |")
    lines.append("")
    lines.append("## Root")
    lines.append("")
    lines.append(endpoint_table(rows.get("(root)", [])))
    lines.append("")
    (OUT / "README.md").write_text("\n".join(lines) + "\n")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = collect_rows()
    write_readme(rows)
    for g in GROUPS:
        write_group(g, rows.get(g["key"], []))
    total = sum(len(v) for v in rows.values())
    print(f"Generated {len(GROUPS)} group files + README.md ({total} endpoints) into {OUT}")


if __name__ == "__main__":
    main()
