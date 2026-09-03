# Analytics API

> Base path: `/api/analytics` · 13 endpoints

Read-only aggregate metrics: messages, response times, SLA breaches, engagement, team activity, and dashboard totals. All queries run against the tenant schema; dashboard access is gated by `can_view_dashboard`.

## Endpoints

**Methods:** GET 13 · POST 0 · DELETE 0 · PATCH 0 · PUT 0

| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/analytics/contacts` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get contact statistics |
| GET | `/analytics/contacts/trend` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get new contacts trend over time |
| GET | `/analytics/dashboard` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get dashboard overview stats |
| GET | `/analytics/engagement` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get customer engagement metrics |
| GET | `/analytics/engagement/trend` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get engagement trend over time |
| GET | `/analytics/hourly` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get hourly message distribution |
| GET | `/analytics/message-types` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get message type distribution |
| GET | `/analytics/messages` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get message statistics over time |
| GET | `/analytics/response-time` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get response time statistics |
| GET | `/analytics/response-time/team` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get response time stats by team member |
| GET | `/analytics/response-time/trend` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get response time trend over time |
| GET | `/analytics/sla-breaches` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get conversations that exceeded SLA |
| GET | `/analytics/team` | Authenticated · Tenant context · `can_view_dashboard` · Rate limited | Get team activity statistics |

## Flows

### Analytics query

```mermaid
sequenceDiagram
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
```
