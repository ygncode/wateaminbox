# Media API

> Base path: `/api/media` · 3 endpoints

Media upload and authorized download. Uploads go to private storage (R2/S3); reads return short-lived signed URLs. On-demand download of deferred WhatsApp media is asynchronous.

## Endpoints

**Methods:** GET 1 · POST 2 · DELETE 0 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/media/download/:messageId` | Authenticated · Tenant context · Message visibility | Request on-demand download of deferred WhatsApp media |
| GET | `/media/messages/:messageId` | Authenticated · Tenant context · Message visibility | Request on-demand media download Triggers download for deferred media from history sync |
| POST | `/media/upload` | Authenticated · Tenant context · Rate limited | Upload a media file (multipart form) |

## Flows

### Upload & authorized read

```mermaid
sequenceDiagram
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
```
