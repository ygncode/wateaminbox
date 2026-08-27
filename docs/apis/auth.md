# Auth API

> Base path: `/api/auth` · 14 endpoints

Authentication and account lifecycle: registration, login, session refresh/revocation, email verification, and password reset. These routes are **public** (no tenant context); a few (`/auth/me`, `/auth/sessions`, `/auth/logout`, `/auth/change-password`) require a valid access token.

## Endpoints

**Methods:** GET 2 · POST 9 · DELETE 2 · PATCH 1 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/auth/change-password` | Authenticated | Change the current user's password and revoke other device sessions. |
| POST | `/auth/forgot-password` | Public · Rate limited | Request a password reset email |
| POST | `/auth/login` | Public · Rate limited | Login with email and password |
| POST | `/auth/logout` | Authenticated | Logout the current session |
| GET | `/auth/me` | Authenticated | Get current user information |
| PATCH | `/auth/me` | Authenticated | Update the current user's name, email, or profile image. |
| POST | `/auth/refresh` | Public · Rate limited | Refresh access token using refresh token |
| POST | `/auth/register` | Public · Rate limited | Register a new user with email and password |
| POST | `/auth/resend-verification` | Public · Rate limited | Reissue a verification link after checking the account password. |
| POST | `/auth/reset-password` | Public | Reset password with token |
| DELETE | `/auth/sessions` | Authenticated | Logout all sessions except the current one |
| GET | `/auth/sessions` | Authenticated | List all active sessions for the current user |
| DELETE | `/auth/sessions/:id` | Authenticated | Delete a specific session |
| POST | `/auth/verify-email` | Public | Verify email with token |

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
    S->>S: hash password (bcrypt)
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
