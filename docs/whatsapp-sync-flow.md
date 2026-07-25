# WhatsApp Synchronization Flow

## Initial history sync

1. A connected whatsmeow worker receives history-sync batches from WhatsApp.
2. The worker normalizes contacts, conversations, messages, media metadata, and receipts.
3. Events are published to NATS with company and connection identifiers.
4. The Bun API consumes the events and writes them to the correct tenant schema.
5. Message uniqueness constraints make redelivery safe.
6. Searchable records are indexed in Meilisearch.
7. The worker opens the lifecycle on the first tracked history chunk, aggregates progress across bootstrap/full/recent chunks, and completes only after the final `RECENT` chunk reaches 100%. WhatsApp's separate offline catch-up events do not control history-sync state. A two-minute inter-chunk idle fallback closes protocol variants that omit the final marker.
8. The API persists cumulative message/conversation counters on the connection and publishes progress through Centrifugo (`sync:start`, `sync:progress`, `sync:complete`, or `sync:interrupted`).
9. React displays sync state, rejects progress without an active start, restores persisted counters after refresh, polls PostgreSQL while syncing, and invalidates chat queries when synchronization completes.

## Live messages

```text
WhatsApp
  -> Go event handler
  -> optional R2/MinIO media upload
  -> NATS JetStream
  -> API validation and tenant persistence
  -> Meilisearch indexing
  -> Centrifugo message:new
  -> React Query message cache and ephemeral Zustand UI state
```

Outgoing messages take the reverse command path: REST API -> atomic tenant persistence and command outbox -> NATS command -> worker -> WhatsApp. Delivery receipts return through the durable event path and produce `message:status` updates.

### Outgoing media transport

1. `/api/media/upload` validates the file and writes it below `media/{companyId}/` in S3/R2/MinIO.
2. The send endpoint resolves the API-issued URL to that tenant-prefixed key and uses `HeadObject` to validate MIME type, filename, size (maximum 50 MiB), and SHA-256 metadata.
3. The NATS command contains only the object key and validated metadata; it never contains media bytes or an arbitrary client URL.
4. The owning WhatsApp worker verifies the tenant prefix, streams the object with the same size cap, verifies its checksum, and passes the bytes directly to whatsmeow.

This keeps realistic documents below the default NATS payload limit and avoids the previous S3 → API → PostgreSQL outbox → NATS byte-array copy.

## Deferred media

History messages may be stored before large media is downloaded. The UI requests a download, the worker retries with bounded exponential backoff, and the API publishes `media:downloaded` or `media:download_failed` after updating the message.

## Delivery guarantees

- Durable JetStream consumers with explicit acknowledgements provide at-least-once event delivery.
- Tenant-local command outboxes close the database/NATS crash window and use JetStream message IDs for deduplication.
- Workers persist successful command results by `command_id` before ACK. Redelivery republishes that result instead of repeating the WhatsApp side effect; publication failure is retried through NAK/redelivery.
- The irreducible crash window is after WhatsApp accepts a send but before its result reaches the worker ledger. Such commands remain unacknowledged and are observable by command/message ID for reconciliation.
- Database uniqueness constraints deduplicate WhatsApp message IDs and reactions.
- PostgreSQL is the source of truth; Centrifugo is a realtime update signal.
- Clients refetch affected queries after reconnect or sync completion.

## Main files

| Area | File |
| --- | --- |
| Worker history sync | `services/whatsapp/internal/handler/history_sync.go` |
| API NATS consumer | `apps/api/src/services/message-handler.ts` |
| Message handlers | `apps/api/src/services/handlers/message-handlers.ts` |
| Realtime provider | `apps/web/src/contexts/RealtimeProvider.tsx` |
| Database constraints | `packages/database/src/migrations/` |
