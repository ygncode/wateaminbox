# Typing Indicator Flow

Typing indicators use REST for client commands, NATS for WhatsApp presence, and Pusher for teammate updates.

## Outbound flow

1. `MessageComposer` calls `sendTypingStart()` from `PusherProvider`.
2. The browser posts `{ conversationId, isTyping: true }` to `/api/actions/messages/typing`.
3. The API authenticates the user and tenant.
4. The API verifies the contact and its owning WhatsApp connection.
5. It broadcasts `typing:start` to the company's private Pusher channel, excluding the caller when its socket ID is supplied, and publishes the corresponding presence command to that connection's worker.

The composer refreshes the typing state while the user is active. Receivers automatically clear stale indicators after five seconds.

## Inbound flow

1. A WhatsApp worker receives a composing/paused presence event.
2. The worker publishes the event to NATS.
3. The API validates and transforms the event.
4. The API triggers `typing:start` or `typing:stop` on `private-company-{companyId}`.
5. `PusherProvider` updates the Zustand typing-indicator state.

## Debugging

- Confirm the browser is subscribed to the expected private company channel.
- Check `/api/pusher/auth` for 401/403 responses.
- Confirm `PUSHER_*` and `VITE_PUSHER_*` configuration.
- Inspect NATS worker events with `scripts/debug-nats.sh`.
- Verify that the conversation and company IDs match the active tenant.
