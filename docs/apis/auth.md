# Auth API

> Base path: `/api/auth` · 14 endpoints

Authentication and account lifecycle: registration, login, session refresh/revocation, email verification, and password reset. These routes are **public** (no tenant context); a few (`/auth/me`, `/auth/sessions`, `/auth/logout`, `/auth/change-password`) require a valid access token.

## Endpoints

**Methods:** GET 2 · POST 9 · DELETE 2 · PATCH 1 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/auth/change-password` | — | password Change the current user's password and revoke other device sessions. |
| POST | `/auth/forgot-password` | Rate limited | password Request a password reset email |
| POST | `/auth/login` | Rate limited | Login with email and password |
| POST | `/auth/logout` | — | Logout the current session |
| GET | `/auth/me` | — | Get current user information |
| PATCH | `/auth/me` | — | Update the current user's name, email, or profile image. |
| POST | `/auth/refresh` | Rate limited | Refresh access token using refresh token |
| POST | `/auth/register` | Rate limited | Register a new user with email and password |
| POST | `/auth/resend-verification` | Rate limited | verification Reissue a verification link after checking the account password. |
| POST | `/auth/reset-password` | — | password Reset password with token |
| GET | `/auth/sessions` | — | List all active sessions for the current user |
| DELETE | `/auth/sessions` | — | Logout all sessions except the current one |
| DELETE | `/auth/sessions/:id` | — | id Delete a specific session |
| POST | `/auth/verify-email` | — | email Verify email with token |

## Flows

### Registration

```mermaid
sequenceDiagram
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
```

### Login & session

```mermaid
sequenceDiagram
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
```

### Authenticated request (middleware)

```mermaid
sequenceDiagram
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
```

