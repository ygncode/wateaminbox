# Typing Indicator Flow

Typing indicators use REST for client commands, NATS for WhatsApp presence, and Centrifugo for teammate updates.

## Outbound flow

1. `MessageComposer` calls `sendTypingStart()` from `RealtimeProvider`.
2. The browser posts `{ conversationId, isTyping: true }` to `/api/actions/messages/typing`.
3. The API authenticates the user and tenant.
4. The API verifies the contact and its owning WhatsApp connection.
5. It publishes `typing:start` to `company:{companyId}`, marks the caller's Centrifugo client ID for filtering, and publishes the corresponding presence command to that connection's worker.

The composer refreshes the typing state while the user is active. Receivers automatically clear stale indicators after five seconds.

## Inbound flow

1. A WhatsApp worker receives a composing/paused presence event.
2. The worker publishes the event to NATS.
3. The API validates and transforms the event.
4. The API publishes `typing:start` or `typing:stop` on `company:{companyId}`.
5. `RealtimeProvider` updates the Zustand typing-indicator state.

## Debugging

- Confirm the connection token contains the expected company channel.
- Check `/api/realtime/token` for 401/403 responses.
- Confirm the API and Centrifugo share the configured HMAC secret.
- Inspect NATS worker events with `scripts/debug-nats.sh`.
- Verify that the conversation and company IDs match the active tenant.
