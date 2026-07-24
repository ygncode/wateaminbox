# WhatsApp Synchronization Flow

## Initial history sync

1. A connected whatsmeow worker receives history-sync batches from WhatsApp.
2. The worker normalizes contacts, conversations, messages, media metadata, and receipts.
3. Events are published to NATS with company and connection identifiers.
4. The Bun API consumes the events and writes them to the correct tenant schema.
5. Message uniqueness constraints make redelivery safe.
6. Searchable records are indexed in Meilisearch.
7. Sync progress is broadcast through Pusher (`sync:start`, `sync:progress`, `sync:complete`, or `sync:interrupted`).
8. React displays sync state and invalidates chat queries when synchronization completes.

## Live messages

```text
WhatsApp
  -> Go event handler
  -> optional R2/MinIO media upload
  -> NATS JetStream
  -> API validation and tenant persistence
  -> Meilisearch indexing
  -> Pusher message:new
  -> React Query and Zustand caches
```

Outgoing messages take the reverse command path: REST API -> atomic tenant persistence and command outbox -> NATS command -> worker -> WhatsApp. Delivery receipts return through the durable event path and produce `message:status` updates.

## Deferred media

History messages may be stored before large media is downloaded. The UI requests a download, the worker retries with bounded exponential backoff, and the API publishes `media:downloaded` or `media:download_failed` after updating the message.

## Delivery guarantees

- Durable JetStream consumers with explicit acknowledgements provide at-least-once event delivery.
- Tenant-local command outboxes close the database/NATS crash window and use JetStream message IDs for deduplication.
- Database uniqueness constraints deduplicate WhatsApp message IDs and reactions.
- PostgreSQL is the source of truth; Pusher is a realtime update signal.
- Clients refetch affected queries after reconnect or sync completion.

## Main files

| Area | File |
| --- | --- |
| Worker history sync | `services/whatsapp/internal/handler/history_sync.go` |
| API NATS consumer | `apps/api/src/services/message-handler.ts` |
| Message handlers | `apps/api/src/services/handlers/message-handlers.ts` |
| Realtime provider | `apps/web/src/contexts/PusherProvider.tsx` |
| Database constraints | `packages/database/src/migrations/` |
