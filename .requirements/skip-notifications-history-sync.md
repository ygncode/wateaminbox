# Skip Notifications for History Sync Messages

> Prevent notification flood when user connects WhatsApp by skipping notifications, unread counts, and WebSocket broadcasts for history sync messages.

## Background

When a user connects their WhatsApp account, the whatsmeow library performs a history sync that imports hundreds or thousands of historical messages. Currently, each of these messages triggers:

1. In-app notification creation for all company users
2. `notification:new` WebSocket broadcast (causing frontend refetches)
3. Unread count increment in `conversation_states`
4. `message:new` WebSocket broadcast (causing real-time UI updates)

This floods the notification system with old messages and causes excessive WebSocket traffic, degraded performance, and a poor user experience.

## Current State

### Go Worker (services/whatsapp/internal/handler/handler.go)

The `handleHistorySync()` function (line 592) processes historical conversations. Messages are correctly marked with `IsHistorySync: true` (line 809) in `processHistorySyncMessage()`:

```go
msgEvent := natsClient.MessageEvent{
    // ...
    IsHistorySync: true, // Mark as history sync for deferred media
}
```

### API Message Handler (apps/api/src/services/message-handler.ts)

The `handleMessageEvent()` function (line 302) processes all incoming messages. The `isHistorySync` flag is available in the `MessageEvent` interface (line 292 of `apps/api/src/lib/nats.ts`):

```typescript
export interface MessageEvent extends WhatsAppEvent {
  payload: {
    // ...
    isHistorySync?: boolean;
  };
}
```

However, the flag is **not checked** before:
- Creating notifications (lines 485-503)
- Broadcasting `notification:new` (lines 507-511)
- Incrementing unread count (lines 449-473)
- Broadcasting `message:new` (lines 516-542)

## Requirements

### Must Have

- [ ] Check `payload.isHistorySync` before creating in-app notifications
- [ ] Skip `createNotification()` call when `isHistorySync === true`
- [ ] Skip `notification:new` WebSocket broadcast when `isHistorySync === true`
- [ ] Skip unread count increment in `conversation_states` when `isHistorySync === true`
- [ ] Skip `message:new` WebSocket broadcast when `isHistorySync === true`
- [ ] Add unit tests for the `isHistorySync` check

### Should Have

- [ ] Add debug logging when skipping notifications due to history sync

### Out of Scope

- E2E tests simulating history sync
- Changes to the Go worker (already correctly sets the flag)
- Any frontend changes
- Batch notification after history sync completes

## Technical Approach

Modify `handleMessageEvent()` in `apps/api/src/services/message-handler.ts` to check `payload.isHistorySync` before the notification/broadcast block:

```typescript
// Skip notifications, unread counts, and broadcasts for history sync messages
if (!payload.fromMe && !payload.isHistorySync) {
  // Existing notification and unread count logic
  // ...

  // Broadcast notification:new
  broadcastToCompany(companyId, {
    type: "notification:new",
    // ...
  });
}

// Skip message:new broadcast for history sync messages
if (!payload.isHistorySync) {
  broadcastToCompany(companyId, {
    type: "message:new",
    // ...
  });
}
```

## Affected Areas

- `apps/api/src/services/message-handler.ts` - Main change location
- `apps/api/src/__tests__/services/message-handler.test.ts` - Add unit tests

## Acceptance Criteria

- [ ] Connecting a new WhatsApp account does not create notifications for historical messages
- [ ] Connecting a new WhatsApp account does not increment unread counts
- [ ] No `notification:new` WebSocket events during history sync
- [ ] No `message:new` WebSocket events during history sync
- [ ] Real-time messages (non-history sync) continue to work normally
- [ ] Historical messages are still stored in the database
- [ ] Unit tests pass for the new behavior

## Open Questions

None - all questions resolved during interview.

---
*Generated from requirement interview on 2026-01-07*
