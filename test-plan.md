# Manual Test Plan - Sync Overlay Changes

## Objective
Verify that the Syncing Overlay correctly displays progress without a timeout or countdown, and persists until the synchronization is genuinely complete.

## Test Cases

### 1. Sync Overlay Appearance
- **Trigger:** Start a new WhatsApp connection or trigger a full sync.
- **Expected Behavior:**
  - The overlay appears immediately with a fade-in effect.
  - The spinner animation is active.
  - The text "Syncing messages..." is visible.
  - The text "Please wait while we sync your conversations" is initially visible (if 0 synced).
  - The text "Do not close this window" is visible at the bottom.
  - **Crucial:** No countdown timer (e.g., "19s remaining") is displayed.

### 2. Progress Updates
- **Trigger:** Simulate incoming sync progress events (conversations being processed).
- **Expected Behavior:**
  - The text updates to reflect the number of synced conversations (e.g., "5 conversations synced", "12 conversations synced").
  - The overlay remains visible and does not disappear.

### 3. Indefinite Wait (No Timeout)
- **Trigger:** Allow the sync process to run longer than 30 seconds (previously the timeout limit).
- **Expected Behavior:**
  - The overlay **remains visible**.
  - No "Continue to chats" button appears.
  - No timeout error message is displayed.
  - The spinner continues to animate.

### 4. Sync Completion
- **Trigger:** Backend sends the `sync:complete` event.
- **Expected Behavior:**
  - The overlay fades out and disappears.
  - The user is returned to the main chat interface.

### 5. Multi-Connection Sync (Optional)
- **Trigger:** Have two connections syncing simultaneously.
- **Expected Behavior:**
  - The "conversations synced" count reflects the total across all connections.
  - The overlay remains until *all* connections have finished syncing.

## Verification Steps (Dev Environment)

1.  **Mock Long Sync:**
    - Temporarily modify the backend (or use a mock script) to delay the `sync:complete` event by > 45 seconds.
    - Send periodic `sync:progress` events.

2.  **Visual Check:**
    - Observe the overlay in the browser.
    - Confirm the absence of the countdown timer.
    - Confirm the overlay persists past the 30-second mark.