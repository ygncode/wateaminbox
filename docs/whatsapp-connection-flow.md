# WhatsApp Connection Flow

## Creating a connection

1. An admin posts to `/api/whatsapp/connections`.
2. The API validates tenant membership, role, and the company's connection limit.
3. A stable inbox identity is created in `whatsapp_connections`, together with
   a replaceable row in `whatsapp_connection_sessions`.
4. In the same transaction, the API writes a spawn command to the tenant
   command outbox. Worker commands and whatsmeow credentials use the session
   ID; contacts and messages use the stable connection/account ID.
5. The Go orchestrator starts a dedicated WhatsApp worker.
6. The worker initializes whatsmeow and requests a QR code.
7. QR and connection events travel from the worker through NATS to the API.
8. The API persists state changes and publishes them to the company's Centrifugo channel.
9. React connection hooks display the QR code and update connection state.

The create endpoint returns the connection record. Realtime events arrive through the authenticated Centrifugo connection.

## Channel security

`POST /api/realtime/token` verifies the access token, active session, and tenant membership before placing `company:{companyId}` in the short-lived Centrifugo connection token.

## Lifecycle states

```text
pending -> connecting -> connected
   |            |            |
   +---------- error <-------+
                |
          disconnected
```

The orchestrator persists non-secret worker metadata and handles process
lifecycle. Its durable consumer retains commands published while it is
offline. The API resolves every worker session event back to its stable account
before writing inbox data.

## Disconnect, archive, and deletion

- **Disconnect** stops the worker but retains the session credentials and stable
  account so reconnect can resume the same linked device.
- **Archive & unlink** logs the device out of WhatsApp, purges all rows in the
  `whatsapp_sessions` schema for that session, ends the session record, and
  hides the stable account. Contacts, messages, notes, and assignments remain.
- **Link again** creates a new pairing session for the archived stable account.
  The expected phone identity is enforced before the session can claim it.
- **Create and pair the same phone again** atomically moves the new session from
  its empty provisional account to the historical stable account. The
  provisional account is removed, preventing duplicate conversations.
- **Permanent deletion** is a separate permission-gated operation that only
  accepts archived accounts and erases their retained inbox data.

Archive/unlink commits the account state, ended session, and idempotent unlink
command together through the tenant outbox. The worker receives a dedicated
unlink signal, logs out from WhatsApp, purges its credential store, and exits.

## Main files

| Area | File |
| --- | --- |
| Connection routes | `apps/api/src/routes/whatsapp/connections.ts` |
| Connection service | `apps/api/src/services/whatsapp/connection.ts` |
| Orchestrator manager | `services/orchestrator/internal/manager/manager.go` |
| Worker client | `services/whatsapp/internal/client/client.go` |
| API event handlers | `apps/api/src/services/handlers/connection-handlers.ts` |
| React connection hooks | `apps/web/src/hooks/whatsapp/` |
