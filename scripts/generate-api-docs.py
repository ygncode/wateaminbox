#!/usr/bin/env python3
"""
Generate detailed per-group API documentation with Mermaid sequence diagrams.

Reads apps/api/src/routes, extracts endpoints + access middleware, and combines
them with hand-authored overviews and sequence diagrams to produce docs/apis/.
"""
import collections
import dataclasses
import pathlib
import re
from typing import Optional

BASE = pathlib.Path("apps/api/src/routes")
OUT = pathlib.Path("docs/apis")
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}

# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def clean_desc(raw: str) -> str:
    lines = []
    for line in raw.split("\n"):
        line = re.sub(r"^\s*\*\s?", "", line).strip()
        if not line:
            if lines:
                break
            continue
        if re.match(
            r"^(Requires|Rate limit|Query params|Body|Params|Returns?|Auth|Permissions|Access|Scope|Note|Example|Response|Status codes?)\b",
            line,
            re.I,
        ):
            break
        lines.append(line)
        if len(lines) >= 5:
            break
    text = " ".join(lines).strip()
    # Stop the route token non-greedily at a whitespace-delimited dash/colon.  A
    # route itself may contain both ':' parameters and hyphens.
    text = re.sub(
        r"^(?:GET|POST|PUT|PATCH|DELETE)\s+/\S*?(?:\s+[-–—:]\s*|(?<=\S):\s+)",
        "",
        text,
        flags=re.I,
    )
    text = re.sub(r"^(?:GET|POST|PUT|PATCH|DELETE)\s+/\S*\s+", "", text, flags=re.I)
    return text


DESC_OVERRIDES = {
    ("POST", "/groups"): "Request group creation; returns 200 with `{message, data: {pending, name, participantJids, connectionId}}`",
    ("POST", "/groups/:id/participants"): "Request adding participants; returns 200 with `{message, data: {participantJids, pending: true}}`",
    ("POST", "/media/download/:messageId"): "Request on-demand download of deferred WhatsApp media",
    ("POST", "/media/upload"): "Upload a media file (multipart form)",
    ("GET", "/notifications/push/status"): "Get web-push subscription status",
    ("POST", "/notifications/push/subscribe"): "Subscribe to web-push notifications",
    ("DELETE", "/notifications/push/subscribe"): "Unsubscribe from web-push notifications",
    ("DELETE", "/notifications/push/subscriptions"): "Remove all web-push subscriptions",
    ("POST", "/whatsapp/connections/:connectionId/relink"): "Initiate a new pairing session for an archived connection",
    ("GET", "/whatsapp/connections/archived"): "List archived connections",
    ("POST", "/messages"): "Queue a message for delivery and return the pending message (200)",
    ("POST", "/catalogs/sync"): "Queue a catalog sync request (200)",
    ("POST", "/catalogs/:catalogId/sync-products"): "Queue a product sync request (200)",
    ("POST", "/labels/sync"): "Queue a label sync request (200)",
    ("POST", "/labels/:labelId/apply/:contactId"): "Queue applying a label to a contact (200)",
    ("DELETE", "/labels/:labelId/apply/:contactId"): "Queue removing a label from a contact (200)",
    ("POST", "/search/reindex"): "Rebuild the tenant's message and contact indexes (200)",
    ("POST", "/status"): "Create a pending local status and queue publication (201)",
    ("DELETE", "/status/:id"): "Delete the creator's local status row only (does not retract it from WhatsApp)",
    ("GET", "/debug/nats/messages/:stream"): "Get stream statistics and CLI inspection instructions (not message content)",
    ("POST", "/actions/messages/read"): "Broadcast a visibility-checked realtime read signal only",
    ("POST", "/actions/messages/typing"): "Broadcast realtime typing and publish a WhatsApp typing command in parallel",
}

# Route registration middleware cannot express checks performed inside handlers.
# These additions keep the generated Access column fail-closed and explicit.
ACCESS_OVERRIDES = {
    ("GET", "/conversations/stats/resolution"): ["`can_view_dashboard`"],
    ("GET", "/conversations/stats/resolution-trend"): ["`can_view_dashboard`"],
    ("GET", "/conversations/stats/resolution-breaches"): ["`can_view_dashboard`"],
    ("GET", "/conversations/stats/resolution-team"): ["`can_view_dashboard`"],
    ("POST", "/search/reindex"): ["Admin role"],
    ("PATCH", "/companies/:id"): ["Owner role when changing status"],
    ("POST", "/contacts/:id/assign"): [
        "Conditional `can_assign_contacts` (other-user assignment or takeover)",
    ],
    ("PUT", "/contacts/:id/notes/shared/:noteId"): ["Author only"],
    ("DELETE", "/contacts/:id/notes/shared/:noteId"): ["Author only"],
    ("GET", "/messages"): ["Contact visibility (result-filtered)"],
    ("GET", "/messages/starred"): ["Contact visibility (result-filtered)"],
    ("GET", "/messages/scheduled"): ["Contact visibility (result-filtered)"],
    ("POST", "/messages/batch/star"): ["Message visibility (all selected)"],
    ("POST", "/messages/batch/delete"): ["Message visibility (all selected)"],
    ("POST", "/actions/messages/read"): ["Contact visibility"],
    ("POST", "/actions/messages/typing"): ["Send access for typing start"],
    ("DELETE", "/status/:id"): ["Creator only"],
    ("POST", "/bulk-jobs"): ["`can_send_messages`"],
    ("POST", "/bulk-jobs/preview"): ["`can_send_messages`"],
    ("PATCH", "/bulk-jobs/:id/schedule"): ["`can_send_messages`"],
    ("POST", "/bulk-jobs/:id/cancel"): ["`can_send_messages`"],
    ("POST", "/contacts/import"): ["Admin role"],
    ("POST", "/companies/:id/leave"): ["Non-owner only"],
    ("PATCH", "/companies/:id/members/:userId"): ["Actor must outrank target"],
    ("DELETE", "/companies/:id/members/:userId"): ["Actor must outrank target"],
    ("GET", "/contacts"): ["Contact visibility (result-filtered)"],
    ("GET", "/groups"): ["Contact visibility (result-filtered)"],
    ("GET", "/search"): ["Contact visibility (result-filtered)"],
    ("GET", "/search/messages"): ["Contact visibility (result-filtered)"],
    ("GET", "/search/contacts"): ["Contact visibility (result-filtered)"],
    ("GET", "/export/contacts"): ["Contact visibility (result-filtered)"],
    ("GET", "/export/messages"): ["Contact visibility (result-filtered)"],
    ("POST", "/export/bulk"): ["Contact visibility (result-filtered)"],
    ("POST", "/groups/:id/participants"): ["WhatsApp group admin"],
    ("POST", "/groups/:id/participants/remove"): ["WhatsApp group admin"],
    ("POST", "/groups/:id/participants/promote"): ["WhatsApp group admin"],
    ("POST", "/groups/:id/participants/demote"): ["WhatsApp group admin"],
    ("PATCH", "/groups/:id/settings"): ["WhatsApp group admin"],
    ("POST", "/groups/:id/invite-link"): ["WhatsApp group admin"],
    ("GET", "/groups/:id/join-requests"): ["WhatsApp group admin"],
    ("POST", "/groups/:id/join-requests/refresh"): ["WhatsApp group admin"],
    ("POST", "/groups/:id/join-requests/decision"): ["WhatsApp group admin"],
}


def access_labels(args_text: str):
    labels = []
    if re.search(r"\bauthMiddleware\b", args_text):
        labels.append("Authenticated")
    if re.search(r"\b(?:tenantMiddleware|tenantFromParam|tenantFromHeader)\s*\(", args_text):
        labels.append("Tenant context")
    for match in re.finditer(r"requirePermission\(\s*(?:PERMISSIONS\.)?([A-Za-z_]+)\s*\)", args_text):
        labels.append(f"`{match.group(1).lower()}`")
    role_args = re.finditer(
        r"tenantFrom(?:Param|Header)\(\s*[^,)]*(?:,\s*[\"'](owner|admin|member)[\"'])?\s*\)",
        args_text,
    )
    for match in role_args:
        if match.group(1):
            labels.append(f"{match.group(1).title()} role")
    if re.search(r"\brequireAdmin\s*\(", args_text):
        labels.append("Admin role")
    if re.search(r"\brequireOwner\s*\(", args_text):
        labels.append("Owner role")
    if re.search(r"\brequireContactVisibility\b", args_text):
        labels.append("Contact visibility")
    if re.search(r"\brequireMessageVisibility\b", args_text):
        labels.append("Message visibility")
    if re.search(r"\brequireMessageSendPermission\b", args_text):
        labels.append("`can_send_messages`")
    if re.search(r"\brequireBulkSendPermission\b", args_text):
        labels.append("`can_send_bulk_messages`")
    if re.search(r"\brequireEmailVerification\b", args_text):
        labels.append("Email verified")
    if re.search(r"(?:RateLimiter|rateLimiter|RateLimit)", args_text):
        labels.append("Rate limited")
    return list(dict.fromkeys(labels))


@dataclasses.dataclass(frozen=True)
class Call:
    receiver: str
    method: str
    path: str
    arguments: tuple[str, ...]
    description: str = ""


@dataclasses.dataclass
class Module:
    path: pathlib.Path
    text: str
    calls: list[Call]
    imports: dict[str, tuple[pathlib.Path, str]]
    reexports: dict[str, tuple[pathlib.Path, str]]
    routers: set[str]


def _matching_paren(text: str, opening: int) -> int:
    depth = 0
    quote: Optional[str] = None
    escaped = False
    line_comment = block_comment = False
    i = opening
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
        elif block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
                i += 1
        elif quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        elif char == "/" and nxt == "/":
            line_comment = True
            i += 1
        elif char == "/" and nxt == "*":
            block_comment = True
            i += 1
        elif char in "\"'`":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"unclosed call at character {opening}")


def _split_args(text: str) -> tuple[str, ...]:
    parts, start = [], 0
    depths = {"(": 0, "[": 0, "{": 0}
    closes = {")": "(", "]": "[", "}": "{"}
    quote: Optional[str] = None
    escaped = False
    line_comment = block_comment = False
    i = 0
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if line_comment:
            if char == "\n": line_comment = False
        elif block_comment:
            if char == "*" and nxt == "/": block_comment = False; i += 1
        elif quote:
            if escaped: escaped = False
            elif char == "\\": escaped = True
            elif char == quote: quote = None
        elif char == "/" and nxt == "/": line_comment = True; i += 1
        elif char == "/" and nxt == "*": block_comment = True; i += 1
        elif char in "\"'`": quote = char
        elif char in depths: depths[char] += 1
        elif char in closes: depths[closes[char]] -= 1
        elif char == "," and not any(depths.values()):
            parts.append(text[start:i].strip()); start = i + 1
        i += 1
    parts.append(text[start:].strip())
    return tuple(part for part in parts if part)


def _resolve_specifier(source: pathlib.Path, specifier: str) -> pathlib.Path:
    target = source.parent / re.sub(r"\.js$", ".ts", specifier)
    if target.exists():
        return target
    index = target.with_suffix("") / "index.ts"
    if index.exists():
        return index
    return target


def parse_module(path: pathlib.Path) -> Module:
    text = path.read_text()
    imports: dict[str, tuple[pathlib.Path, str]] = {}
    reexports: dict[str, tuple[pathlib.Path, str]] = {}
    named = r"([^}]+)"
    for match in re.finditer(rf"import\s*{{{named}}}\s*from\s*[\"']([^\"']+)[\"']", text):
        target = _resolve_specifier(path, match.group(2))
        for item in match.group(1).split(","):
            bits = re.split(r"\s+as\s+", item.strip())
            if bits and bits[0]: imports[bits[-1]] = (target, bits[0])
    for match in re.finditer(rf"export\s*{{{named}}}\s*from\s*[\"']([^\"']+)[\"']", text):
        target = _resolve_specifier(path, match.group(2))
        for item in match.group(1).split(","):
            bits = re.split(r"\s+as\s+", item.strip())
            if bits and bits[0]:
                reexports[bits[-1]] = (target, bits[0])
    # Resolve local export lists through their imports.  This matters when a
    # module both imports one name for internal mounts and exports a different
    # local name under that same public name (companies/index.ts does this).
    for match in re.finditer(rf"export\s*{{{named}}}\s*;", text):
        for item in match.group(1).split(","):
            bits = re.split(r"\s+as\s+", item.strip())
            if bits and bits[0]:
                reexports[bits[-1]] = imports.get(bits[0], (path, bits[0]))
    routers = set(re.findall(r"(?:export\s+)?const\s+(\w+)\s*=\s*new\s+Hono\b", text))
    calls = []
    call_re = re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*(get|post|put|patch|delete|use|route)\s*\(")
    for match in call_re.finditer(text):
        end = _matching_paren(text, match.end() - 1)
        args = _split_args(text[match.end():end])
        if not args or not re.fullmatch(r"[\"'][^\"']*[\"']", args[0], re.S):
            continue
        route_path = args[0][1:-1]
        before = text[:match.start()]
        comments = list(re.finditer(r"/\*\*(.*?)\*/", before, re.S))
        desc = ""
        if comments and not before[comments[-1].end():].strip():
            desc = clean_desc(comments[-1].group(1))
        calls.append(Call(match.group(1), match.group(2), route_path, args[1:], desc))
    return Module(path, text, calls, imports, reexports, routers)


def _join_paths(prefix: str, suffix: str) -> str:
    result = "/".join((prefix.rstrip("/"), suffix.lstrip("/")))
    return "/" + result.strip("/") if result.strip("/") else "/"


def _matches(pattern: str, path: str) -> bool:
    if pattern in ("*", "/*"):
        return True
    tokens = pattern.strip("/").split("/") if pattern != "/" else []
    regex = "^"
    for token in tokens:
        if token == "*": regex += r"(?:/.*)?"
        elif token.startswith(":"): regex += r"/[^/]+"
        else: regex += "/" + re.escape(token)
    regex += "$"
    candidate = "/" + path.strip("/") if path != "/" else "/"
    return re.match(regex, candidate) is not None


def _is_guard_only(call: Call) -> bool:
    """Identify Hono method registrations used only as scoped middleware."""
    return (
        call.method in HTTP_METHODS
        and len(call.arguments) == 1
        and call.arguments[0].strip() == "requireMessageSendPermission"
    )


class RouteGraph:
    def __init__(self, base: pathlib.Path = BASE):
        self.base = base
        self.modules = {
            path.resolve(): parse_module(path.resolve())
            for path in sorted(base.rglob("*.ts"))
            if ".test." not in path.name and ".integration." not in path.name
        }
        self.visited_routers: set[tuple[pathlib.Path, str]] = set()

    def resolve(self, module_path: pathlib.Path, symbol: str, seen=None, *, external=False):
        seen = seen or set()
        key = (module_path.resolve(), symbol, external)
        if key in seen:
            raise ValueError(f"cyclic route export: {module_path}:{symbol}")
        seen.add(key)
        module = self.modules.get(module_path.resolve())
        if module is None:
            raise ValueError(f"route import does not exist: {module_path}")

        # A route() expression resolves names in the module's local scope, so
        # imports win over a same-named export alias.  Consumers importing from
        # the module instead see its re-export first.
        if external and symbol in module.reexports:
            target = module.reexports[symbol]
            return self.resolve(target[0], target[1], seen, external=True)
        if symbol in module.routers:
            return module.path, symbol
        if symbol in module.imports:
            target = module.imports[symbol]
            return self.resolve(target[0], target[1], seen, external=True)
        if symbol in module.reexports:
            target = module.reexports[symbol]
            return self.resolve(target[0], target[1], seen, external=True)
        raise ValueError(f"cannot resolve route symbol {symbol!r} in {module.path}")

    def expand(self, module_path: pathlib.Path, router: str, prefix="", inherited=()):
        module = self.modules[module_path.resolve()]
        self.visited_routers.add((module.path, router))
        own = [call for call in module.calls if call.receiver == router]
        for index, call in enumerate(own):
            # Hono copies mounted routes in registration order. Only guards
            # registered before this endpoint/mount can affect it.
            active = [
                guard for guard in own[:index]
                if guard.method == "use" or _is_guard_only(guard)
            ]
            if call.method == "route":
                if len(call.arguments) != 1:
                    raise ValueError(f"unexpected route() arguments in {module.path}: {call}")
                child_path, child_router = self.resolve(module.path, call.arguments[0])
                child_prefix = _join_paths(prefix, call.path)
                scoped = tuple((guard, prefix) for guard in active)
                yield from self.expand(child_path, child_router, child_prefix, inherited + scoped)
            elif call.method in HTTP_METHODS and not _is_guard_only(call):
                full = _join_paths(prefix, call.path)
                guards = [
                    guard for guard, guard_prefix in inherited
                    if (guard.method == "use" or guard.method == call.method)
                    and _matches(_join_paths(guard_prefix, guard.path), full)
                ]
                guards.extend(
                    guard for guard in active
                    if (guard.method == "use" or guard.method == call.method)
                    and _matches(_join_paths(prefix, guard.path), full)
                )
                guard_text = " ".join(arg for guard in guards for arg in guard.arguments)
                has_inline_handler = bool(call.arguments) and (
                    "=>" in call.arguments[-1] or "function" in call.arguments[-1]
                )
                middleware = call.arguments[:-1] if has_inline_handler else call.arguments
                guard_text += " " + " ".join(middleware)
                labels = access_labels(guard_text)
                if "Authenticated" not in labels:
                    labels.insert(0, "Public")
                labels.extend(ACCESS_OVERRIDES.get((call.method.upper(), full), []))
                labels = list(dict.fromkeys(labels))
                yield full, call.method, call.description, labels, module.path

    def rows(self):
        root = (self.base / "index.ts").resolve()
        endpoints = list(self.expand(root, "routes"))
        route_bearing = {
            (module.path, call.receiver)
            for module in self.modules.values()
            for call in module.calls
            if (
                call.receiver in module.routers
                and call.method in HTTP_METHODS
                and not _is_guard_only(call)
            )
        }
        unaccounted = sorted(route_bearing - self.visited_routers)
        if unaccounted:
            names = ", ".join(
                f"{path.relative_to(self.base.resolve())}:{router}"
                for path, router in unaccounted
            )
            raise ValueError(f"unaccounted route-bearing routers: {names}")
        return endpoints


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
    S->>S: hash password (bcrypt)
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
            "permissions, SLA policy, and ownership transfer. Listing and creating "
            "companies require only a valid JWT; routes for a specific `:id` resolve "
            "tenant membership with `tenantFromParam`. `PATCH /:id` requires Admin "
            "access generally, but changing `status` is conditionally owner-only."
        ),
        "flows": [
            ("Create company & become owner", """sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant S as company.service
    participant D as Postgres
    C->>A: POST /api/companies {name,...}
    A->>A: authMiddleware (JWT)
    A->>S: createCompany(input, userId)
    S->>D: INSERT company + tenant schema
    S->>D: INSERT owner membership in shared company_members
    S-->>A: company
    A-->>C: 201 {data: company}
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
    A->>A: owner-only tenant guard
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
    S->>D: validate + create membership in shared company_members
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
    participant D as Postgres (tenantDb)
    participant R as Centrifugo
    U->>A: POST /api/contacts {phoneNumber, customName?, connectionId?}
    A->>A: authMiddleware + tenantMiddleware
    A->>D: resolve exactly one connected account (or explicit connectionId)
    A->>D: INSERT contact
    A-->>U: 201 {data: contact}
    U->>A: POST /api/contacts/:id/assign {targetUserId?}
    A->>D: validate target workspace member
    A->>A: can_assign_contacts only for other-user assignment/takeover
    A->>D: transaction: lock contact + replace assignment
    A->>R: broadcast assignment event to affected viewers
    A-->>U: 201 {assignment, wasTakeover, previousAssignee}
"""),
            ("CSV import", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as import service
    participant D as Postgres (tenantDb)
    U->>A: POST /api/contacts/import (multipart CSV)
    A->>A: Admin role + rate limit; parse and validate CSV
    A->>D: resolve explicit/sole connected account
    A->>S: importContacts (upsert rows and optional tags)
    S-->>A: summary + per-row results
    A-->>U: 201 {summary, results, connection}
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
    A->>S: resolveActiveCase(contactId, outcome, notes, resolvedBy)
    S->>D: resolve active case + update lifecycle projection
    A->>R: broadcast conversation:updated to viewers
    A-->>U: 200 {data: resolvedCase}
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
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/messages {contactId, content}
    A->>A: requireMessageSendPermission + rate limit + validate
    A->>D: lookup contact + active connection
    A->>D: transaction: insert message (status=pending) + enqueue command
    A->>R: broadcast message:new (pending) to viewers
    A-->>U: 200 {message (pending)}
    O->>N: publish connection command subject
    N->>W: worker consumes command directly
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
            "sync. WhatsApp-affecting mutations enqueue asynchronous commands and are "
            "persisted only after worker events; the group alias update is local and "
            "synchronous. Every mutation requires `can_send_messages`, and applicable "
            "administration handlers also verify the connected account is a group admin."
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
    U->>A: POST /api/groups {connectionId, name, participantJids[]}
    A->>A: auth + tenant + can_send_messages
    A->>D: transaction: enqueue group_create command (no group row yet)
    A-->>U: 200 {message, data: {pending, name, participantJids, connectionId}}
    N->>W: group_create command
    W->>WA: create group
    WA-->>W: group created
    W->>N: group event
    N->>A: group-sync handler
    A->>D: persist group + members
    A->>R: broadcast group:updated to authorized conversation viewers
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
    A-->>U: 200 {message, data: {participantJids, pending: true}}
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
            "relink/disconnect) plus legacy single-connection endpoints. Connecting "
            "is **asynchronous**: a worker is "
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
            "subscriptions. Notification history/realtime delivery and web-push are "
            "separate delivery paths; push subscriptions do not themselves create "
            "or modify in-app notification rows."
        ),
        "flows": [
            ("Notification delivery", """sequenceDiagram
    participant E as Event (service)
    participant S as notification-delivery.service
    participant D as Postgres (tenantDb)
    participant P as Push driver
    participant R as Centrifugo
    E->>S: createAndPublishNotifications(...)
    S->>D: insert notification_history
    S->>R: publish notification:new to the user's channel
    opt caller independently requests web push
        E->>S: sendPushToUsers(...)
        S->>P: send to active web-push subscriptions
    end
    Note over D,P: Push is not part of notification-history persistence/realtime
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
            "Bulk broadcast campaigns: preview, create, schedule, cancel, and track "
            "recipients. Send surfaces require both `can_send_bulk_messages` and "
            "`can_send_messages`. Creation atomically materializes scheduled-message "
            "leaves; a later paced, per-connection dispatcher sends them."
        ),
        "flows": [
            ("Bulk job lifecycle", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant S as bulk-job.service
    participant P as Scheduled dispatcher
    participant N as NATS
    participant W as WhatsApp Worker
    participant R as Centrifugo
    U->>A: POST /api/bulk-jobs {audience, scheduledAt, content}
    A->>A: require can_send_bulk_messages + can_send_messages
    A->>S: createBulkJob
    S->>D: transaction: insert bulk_job + scheduled_message leaves
    A->>R: broadcast bulk_job:updated
    A-->>U: 201 {data: job}
    Note over S,N: Creation performs no immediate NATS fanout
    loop later paced cycles (per connection/quota)
        P->>D: claim one eligible scheduled leaf
        P->>N: enqueue/publish send command
        N->>W: worker consumes connection command
    end
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
    A-->>U: 200 {data: {status: syncing}}
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
    A-->>U: 200 {data: {status: syncing}}
    N->>W: sync_labels
    W->>WA: fetch labels
    W->>N: labels event -> persist
    U->>A: POST /api/labels/:id/apply/:contactId
    A->>D: enqueue apply_label command
    A-->>U: 200 {message}
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
            "Full-text search across messages and contacts, backed by Meilisearch "
            "with a PostgreSQL fallback. Results are returned directly by the search "
            "service (not hydrated afterward). `POST /reindex` requires Admin/Owner "
            "role, rebuilds both tenant indexes, and returns 200."
        ),
        "flows": [
            ("Search & reindex", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant M as Meilisearch
    participant D as Postgres (tenantDb)
    U->>A: GET /api/search/messages?q=...
    A->>M: query tenant message index with assignment filter
    M-->>A: direct indexed results
    A-->>U: 200 {query, data, pagination}
    U->>A: POST /api/search/reindex
    A->>D: read documents
    A->>M: rebuild message + contact indexes
    A-->>U: 200 {message, data: indexed counts}
"""),
        ],
    },
    {
        "key": "status",
        "title": "Status (Stories)",
        "prefixes": ["/status"],
        "overview": (
            "WhatsApp Status (stories) posting and reading. Posting creates a pending "
            "local row and asynchronously commands the worker; status events are "
            "broadcast workspace-wide by policy. Deletion is creator-only and removes "
            "the local row—it does not retract a story from WhatsApp."
        ),
        "flows": [
            ("Post status", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    U->>A: POST /api/status {type, content?, mediaUrl?}
    A->>D: transaction: insert pending status row + enqueue post_status
    A-->>U: 201 {data: {id, type, content, mediaUrl, timestamp, expiresAt}}
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
    U->>A: GET /api/audit?action=...&userId=...
    A->>A: auth + tenant + can_view_audit
    A->>D: SELECT audit_logs with userId/action/entity/date filters
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
            "and bulk exports. Requires `can_export`. Export queries materialize rows "
            "in memory before JSON serialization or CSV generation; they do not stream "
            "database rows incrementally."
        ),
        "flows": [
            ("Export flow", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant S as export.service
    participant D as Postgres (tenantDb)
    U->>A: GET /api/export/contacts
    A->>A: requirePermission(can_export)
    A->>S: exportContacts(companyId, visibility filters)
    S->>D: query and materialize all matching rows
    S-->>A: contact array
    A->>A: convert materialized rows to CSV bytes
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
    A->>S: put object (private; no database write)
    A-->>U: 200 {data: {mediaUrl, fileName, fileSize, mimeType, key, mediaReference}}
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
            "Lightweight realtime REST actions. Read is a visibility-checked "
            "Centrifugo signal only; it does not persist read state or command "
            "WhatsApp. Typing broadcasts to authorized realtime viewers while "
            "publishing the worker/WhatsApp command in parallel."
        ),
        "flows": [
            ("Typing indicator", """sequenceDiagram
    participant U as Agent
    participant A as API (Hono)
    participant N as NATS
    participant W as WhatsApp Worker
    participant WA as WhatsApp
    participant R as Centrifugo
    U->>A: POST /api/actions/messages/typing
    A->>A: validate contact/JID + send access for typing:start
    par realtime signal
        A->>R: typing:start/stop to authorized viewers
    and WhatsApp command
        A->>N: publish typing command (ephemeral)
        N->>W: worker consumes command
        W->>WA: send presence update
    end
"""),
        ],
    },
    {
        "key": "realtime",
        "title": "Realtime (Centrifugo token)",
        "prefixes": ["/realtime"],
        "overview": (
            "Issues a short-lived Centrifugo connection token after authenticated "
            "workspace membership resolution. The token grants exactly the workspace "
            "company channel and the caller's company-scoped user channel; conversation "
            "visibility is enforced by server-side fanout to user channels."
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
    CF->>CF: subscribe company:{companyId} + user:{companyId}:{userId} only
"""),
        ],
    },
    {
        "key": "health",
        "title": "Health",
        "prefixes": ["/health"],
        "overview": (
            "Infrastructure probes for Kubernetes/Docker: liveness, readiness, and "
            "overall status. Public (no auth). PostgreSQL, NATS, and the event consumer "
            "gate readiness; missing/unreachable Centrifugo reports `degraded` with HTTP "
            "200 rather than making the API unready."
        ),
        "flows": [
            ("Readiness probe", """sequenceDiagram
    participant K as K8s/Docker
    participant A as API (Hono)
    participant D as Postgres
    participant N as NATS
    K->>A: GET /api/health/ready
    A->>D: SELECT 1
    A->>N: connection + event-consumer state
    A->>A: probe Centrifugo (degraded only)
    A-->>K: 200 ready/degraded; 503 only when core checks are unready
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
            "Development-only NATS inspection endpoints (status, consumers, stream "
            "statistics, trace guidance, and help). The messages endpoint does not read "
            "message content: it returns stream counters plus CLI instructions. These "
            "routes return 403 in production."
        ),
        "flows": [
            ("NATS inspection", """sequenceDiagram
    participant U as Developer
    participant A as API (Hono)
    participant N as NATS
    U->>A: GET /api/debug/nats/messages/:stream
    A->>N: fetch stream info only
    A-->>U: 200 {stream, stats, instructions}
"""),
        ],
    },
]

# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def collect_rows(base: pathlib.Path = BASE):
    """Expand the mounted router graph and group its leaf endpoints."""
    rows = collections.defaultdict(list)
    group_prefixes = [
        (prefix, group["key"])
        for group in GROUPS
        for prefix in group["prefixes"]
    ]

    for path, method, desc, access, source in RouteGraph(base).rows():
        if path == "/":
            if not desc:
                desc = "API service info (name and version)"
            rows["(root)"].append((("(root)"), method, path, desc, access))
            continue

        matches = [
            (prefix, key)
            for prefix, key in group_prefixes
            if path == prefix or path.startswith(prefix + "/")
        ]
        if not matches:
            relative_source = source.relative_to(base.resolve())
            raise ValueError(f"no documentation group for {method.upper()} {path} ({relative_source})")
        _, key = max(matches, key=lambda item: len(item[0]))
        # The endpoint already has its fully composed path.  An empty prefix
        # keeps the existing renderer shape without re-introducing mount joins.
        rows[key].append(("", method, path, desc, access))

    for items in rows.values():
        items.sort(key=lambda item: (item[2], item[1]))
    return rows


def md_escape(s):
    return s.replace("|", "\\|")


def endpoint_table(items):
    lines = ["| Method | Path | Access | Description |",
             "|--------|------|--------|-------------|"]
    for prefix, meth, path, desc, access in items:
        full = _join_paths(prefix, path) if prefix != "(root)" else "/"
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
    (OUT / f"{g['key']}.md").write_text("\n".join(lines).rstrip() + "\n")


def write_readme(rows):
    total = sum(len(v) for v in rows.values())
    lines = []
    lines.append("# WATeamInbox API Documentation")
    lines.append("")
    lines.append("Detailed, group-by-group API reference for `apps/api` (the OSS API "
                 "service). Every group file lists its endpoints with access controls "
                 "and includes Mermaid sequence diagrams for the important flows.")
    lines.append("")
    lines.append("> Generated from `apps/api/src/routes`. All paths are served under "
                 "the `/api` base path.")
    lines.append("")
    lines.append("## Architecture at a glance")
    lines.append("")
    lines.append("The API is a [Hono](https://hono.dev) app. Logging, CORS, and the "
                 "configured global rate limiter run at the app level; authentication, "
                 "tenant resolution, authorization, persistence, and messaging depend "
                 "on the endpoint. Each group table lists the applicable route guards.")
    lines.append("")
    lines.append("```mermaid")
    lines.append("""sequenceDiagram
    participant C as Client
    participant A as API (Hono)
    participant M as Middleware
    participant H as Route handler
    participant S as Service
    participant E as API event handler
    participant D as Postgres (tenantDb)
    participant N as NATS
    participant R as Centrifugo
    C->>A: HTTP /api/...
    A->>M: CORS -> global rate limit
    alt public route
        M->>H: route handler (no JWT/tenant guard)
    else protected route
        M->>M: authMiddleware (JWT + session)
        opt tenant-scoped route
            M->>M: tenant middleware (header or path -> role/permissions/tenantDb)
            M->>M: permission/role/visibility guards
        end
        M->>H: route handler
    end
    H->>S: service call
    alt synchronous read/write
        S->>D: database query
        S-->>H: result
    else durable async WhatsApp action
        S->>D: persist + enqueue command
        S->>N: publish command (outbox)
        N-->>E: later: consume worker event
        E->>D: persist event result
        E->>R: broadcast authorized realtime event
    else ephemeral signal (for example, typing)
        H->>N: publish command directly
        H->>R: optionally broadcast realtime signal
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
    lines.append("- **Tenant:** Most tenant routes use `X-Company-ID: <workspace-uuid>`; "
                 "company-resource routes resolve `:id` instead. The tenant middleware "
                 "resolves membership, role, permissions, and opens the per-tenant "
                 "`tenant_<uuid>` schema connection.")
    lines.append("- **Permissions:** feature-based (`can_send_messages`, "
                 "`can_manage_connections`, ...) plus role hierarchy "
                 "(owner > admin > member).")
    lines.append("")
    lines.append("### Async command path")
    lines.append("")
    lines.append("Durable, state-changing WhatsApp actions persist state and enqueue a "
                 "command in the **command outbox**, which publishes to **NATS "
                 "(JetStream)**. A connection's **WhatsApp worker** consumes its command "
                 "subject directly, performs the action, and publishes events back. The "
                 "API event handlers consume those events, persist results, then "
                 "broadcast through **Centrifugo**. Ephemeral signals such as typing may "
                 "publish directly instead of using the outbox. The **orchestrator** "
                 "manages worker lifecycle (spawn/kill); it does not forward ordinary "
                 "connection commands.")
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
    (OUT / "README.md").write_text("\n".join(lines).rstrip() + "\n")


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
