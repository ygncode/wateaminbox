# WhatsApp Connection Flow

## Creating a connection

1. An admin posts to `/api/whatsapp/connections`.
2. The API validates tenant membership, role, and the company's connection limit.
3. A pending `whatsapp_connections` row is created in the tenant schema.
4. In the same transaction, the API writes a spawn command to the tenant command outbox. The dispatcher publishes it to `WHATSAPP.commands.{companyId}.{connectionId}` with a stable deduplication ID.
5. The Go orchestrator starts a dedicated WhatsApp worker.
6. The worker initializes whatsmeow and requests a QR code.
7. QR and connection events travel from the worker through NATS to the API.
8. The API persists state changes and broadcasts them on the company's private Pusher channel.
9. React connection hooks display the QR code and update connection state.

The create endpoint returns the connection record. There is no WebSocket URL; realtime events are delivered through the already-authorized Pusher subscription.

## Channel security

The browser can only subscribe to `private-company-{companyId}` after `/api/pusher/auth` verifies its access token, active session, tenant membership, and requested channel name.

## Lifecycle states

```text
pending -> connecting -> connected
   |            |            |
   +---------- error <-------+
                |
          disconnected
```

The orchestrator persists non-secret worker metadata and handles process lifecycle. Its durable consumer retains commands published while it is offline. Disconnect and delete operations commit the state change and kill command atomically through the tenant outbox.

## Main files

| Area | File |
| --- | --- |
| Connection routes | `apps/api/src/routes/whatsapp/connections.ts` |
| Connection service | `apps/api/src/services/whatsapp/connection.ts` |
| Orchestrator manager | `services/orchestrator/internal/manager/manager.go` |
| Worker client | `services/whatsapp/internal/client/client.go` |
| API event handlers | `apps/api/src/services/handlers/connection-handlers.ts` |
| React connection hooks | `apps/web/src/hooks/whatsapp/` |
