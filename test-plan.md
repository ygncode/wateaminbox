# WhatsApp Connection Flow - Comprehensive Test Plan

## Overview

This plan covers testing the complete WhatsApp phone connection flow, from user clicking "Connect" to receiving "Connected" status. The flow spans multiple services and technologies.

**Scope:** Full implementation (all 4 phases)
**E2E Approach:** Fully mocked (no running infrastructure required)

## Current Test Coverage

| Component | Current State | Priority |
|-----------|--------------|----------|
| Backend WhatsApp Service | ✅ Good coverage | - |
| Go WhatsApp Client | ✅ Good coverage | - |
| Orchestrator Service | ❌ No tests | High |
| WebSocket Events | ❌ No tests | High |
| E2E Connection Flow | ❌ No tests | Medium |
| NATS Integration | ⚠️ Mocked only | Low |

## Test Implementation Plan

### Phase 1: Orchestrator Unit Tests (Go)

**Location:** `services/orchestrator/internal/manager/manager_test.go`

**Dependencies to Mock:**
- `exec.Cmd` - Process execution
- NATS client - Message publishing/subscribing
- `syscall` - Process signals

**Test Files to Create:**

1. **`manager_test.go`** - Core manager tests
   - `TestNew_ValidConfig` - Manager initialization
   - `TestNew_InvalidConfig` - Missing required config
   - `TestSpawnWorker_Success` - Worker process creation
   - `TestSpawnWorker_DuplicateConnection` - Idempotency check
   - `TestSpawnWorker_EnvironmentVariables` - Correct env vars passed
   - `TestStopWorker_GracefulShutdown` - SIGTERM then SIGKILL
   - `TestStopWorker_NotFound` - Non-existent worker
   - `TestGetWorkerStatus_Exists` - Status retrieval
   - `TestGetWorkerStatus_NotFound` - Missing worker
   - `TestListWorkers_Empty` - No workers
   - `TestListWorkers_Multiple` - Multiple workers
   - `TestListWorkersByCompany_Filtered` - Company filtering
   - `TestUpdateWorkerStatus_ValidTransitions` - Status state machine
   - `TestStop_GracefulShutdown` - Manager shutdown with workers

2. **`handlers_test.go`** - NATS command handlers
   - `TestHandleSpawnCommand_Valid` - Spawn command processing
   - `TestHandleSpawnCommand_MissingFields` - Validation errors
   - `TestHandleKillCommand_Valid` - Kill command processing
   - `TestHandleKillCommand_NotFound` - Worker doesn't exist
   - `TestHandleStatusCommand_Valid` - Status query
   - `TestHandleStatusCommand_NotFound` - Missing worker
   - `TestProcessCommands_RoutesCorrectly` - Command type routing
   - `TestProcessCommands_InvalidJSON` - Malformed messages

3. **`health_test.go`** - Health monitoring
   - `TestHealthCheckWorker_Healthy` - Process running
   - `TestHealthCheckWorker_ProcessDied` - Process exit detection
   - `TestHealthCheckWorker_StaleActivity` - No activity timeout
   - `TestMonitorWorkerProcess_ExitCode` - Exit code handling
   - `TestHandleWorkerFailure_Reconnect` - Auto-restart logic

**Mock Interfaces to Create:**

```go
// internal/manager/interfaces.go
type ProcessExecutor interface {
    Start(cmd *exec.Cmd) error
    Wait(cmd *exec.Cmd) error
    Signal(pid int, sig syscall.Signal) error
    Kill(pid int) error
    FindProcess(pid int) (*os.Process, error)
}

type NATSPublisher interface {
    Publish(subject string, data []byte) error
    PublishMsg(msg *nats.Msg) error
}

type NATSSubscriber interface {
    Subscribe(subject string) (*nats.Subscription, error)
    Fetch(batch int, timeout time.Duration) ([]*nats.Msg, error)
}
```

### Phase 2: WebSocket Integration Tests (Backend)

**Location:** `apps/api/src/__tests__/integration/websocket.integration.test.ts`

**Test Categories:**

1. **Authentication Tests**
   - `should authenticate via query parameters`
   - `should authenticate via auth message`
   - `should reject invalid JWT token`
   - `should reject user not in company`
   - `should reject invalid company ID format`
   - `should handle already authenticated connection`

2. **Event Broadcasting Tests**
   - `should broadcast to all clients in same company`
   - `should not leak events to other companies`
   - `should include correct connectionId in events`
   - `should handle closed connections gracefully`
   - `should remove disconnected clients from broadcast list`

3. **QR Code Flow Tests**
   - `should receive qr event when connection requested`
   - `should receive connected event after QR scan`
   - `should receive disconnected event on connection loss`
   - `should handle qr expiration and refresh`

4. **Message Events Tests**
   - `should broadcast message:new to company clients`
   - `should broadcast message:status updates`
   - `should broadcast message:deleted events`
   - `should broadcast message:reaction events`

5. **Presence & Typing Tests**
   - `should broadcast presence:online events`
   - `should broadcast presence:offline events`
   - `should broadcast typing:start events`
   - `should broadcast typing:stop events`

**Test Helpers to Create:**

```typescript
// apps/api/src/__tests__/helpers/websocket-mock.ts
export function createMockWebSocket(): MockWebSocket
export function createMockNatsSubscription(): MockSubscription
export function simulateNatsEvent(type: string, payload: unknown): void
export function waitForWebSocketMessage(ws: MockWebSocket, type: string): Promise<unknown>
```

### Phase 3: E2E Connection Flow Tests (Playwright)

**Location:** `apps/web/e2e/tests/whatsapp-connection.spec.ts`

**Page Object to Create:**

```typescript
// apps/web/e2e/pages/whatsapp-connection.page.ts
export class WhatsAppConnectionPage extends BasePage {
  readonly connectButton: Locator
  readonly qrCodeImage: Locator
  readonly qrCountdown: Locator
  readonly connectedStatus: Locator
  readonly phoneNumber: Locator
  readonly disconnectButton: Locator
  readonly refreshButton: Locator
  readonly errorMessage: Locator

  async clickConnect(): Promise<void>
  async waitForQRCode(): Promise<void>
  async waitForConnected(): Promise<void>
  async disconnect(): Promise<void>
  async getDisplayedPhoneNumber(): Promise<string>
}
```

**Test Scenarios:**

1. **Connection Initiation**
   - `should display Connect button when not connected`
   - `should show loading state when connecting`
   - `should display QR code after clicking connect`
   - `should show countdown timer for QR expiration`

2. **QR Code States**
   - `should refresh QR code when expired`
   - `should show refresh button after timeout`
   - `should handle QR generation timeout gracefully`

3. **Connected State**
   - `should show Connected status after scan`
   - `should display phone number when connected`
   - `should show Disconnect button when connected`
   - `should update UI immediately via WebSocket`

4. **Disconnection**
   - `should disconnect when clicking Disconnect`
   - `should return to Connect state after disconnect`
   - `should handle unexpected disconnection gracefully`

5. **Error Handling**
   - `should display error message on connection failure`
   - `should show retry option on error`
   - `should handle max connections exceeded`

6. **Multi-Connection (if enabled)**
   - `should allow adding multiple connections`
   - `should show list of connections`
   - `should manage each connection independently`

**Mock Strategy:**

```typescript
// Mock API responses
await page.route('**/api/whatsapp/connections', mockConnectionsAPI)
await page.route('**/api/whatsapp/status', mockStatusAPI)

// Mock WebSocket events
await page.evaluate(() => {
  window.__mockWebSocket = {
    simulateEvent: (type, payload) => {
      // Dispatch to WebSocket handlers
    }
  }
})
```

### Phase 4: NATS Message Handler Tests

**Location:** `apps/api/src/__tests__/services/message-handler.test.ts` (extend existing)

**Additional Tests:**

1. **Connection Events**
   - `should handle qr event from Go worker`
   - `should handle connected event with phone number`
   - `should handle disconnected event`
   - `should update database on connection status change`

2. **Event Routing**
   - `should route events to correct company`
   - `should handle unknown event types gracefully`
   - `should log errors without crashing`

## File Structure

```
services/orchestrator/
├── internal/
│   └── manager/
│       ├── interfaces.go          # NEW: Mockable interfaces
│       ├── mocks_test.go          # NEW: Mock implementations
│       ├── manager_test.go        # NEW: Manager unit tests
│       ├── handlers_test.go       # NEW: Handler unit tests
│       └── health_test.go         # NEW: Health check tests

apps/api/src/__tests__/
├── helpers/
│   └── websocket-mock.ts          # NEW: WebSocket test helpers
├── integration/
│   └── websocket.integration.test.ts  # NEW: WebSocket tests
└── services/
    └── message-handler.test.ts    # EXTEND: Add connection events

apps/web/e2e/
├── pages/
│   └── whatsapp-connection.page.ts    # NEW: Page object
├── fixtures/
│   └── whatsapp.fixture.ts            # NEW: Connection fixtures
└── tests/
    └── whatsapp-connection.spec.ts    # NEW: E2E tests
```

## Implementation Order

1. **Orchestrator interfaces** - Create mockable interfaces
2. **Orchestrator mocks** - Implement mock process executor and NATS
3. **Orchestrator unit tests** - Test manager and handlers
4. **WebSocket helpers** - Create test utilities
5. **WebSocket integration tests** - Test event broadcasting
6. **E2E page object** - Create WhatsAppConnectionPage
7. **E2E fixtures** - Create connection mock fixtures
8. **E2E tests** - Implement connection flow tests

## Test Commands

```bash
# Run orchestrator tests
cd services/orchestrator && go test ./... -v

# Run backend tests
cd apps/api && bun test

# Run WebSocket integration tests specifically
cd apps/api && bun test src/__tests__/integration/websocket

# Run E2E tests
cd apps/web && bunx playwright test whatsapp-connection

# Run all tests
bun run test
```

## Success Criteria

- [ ] Orchestrator has >80% code coverage
- [ ] All WebSocket event types have integration tests
- [ ] E2E tests cover happy path and error scenarios
- [ ] Tests run in CI without external dependencies
- [ ] No flaky tests (deterministic results)

## Summary of Changes

### New Files to Create

| File | Type | Description |
|------|------|-------------|
| `services/orchestrator/internal/manager/interfaces.go` | Go | Mockable interfaces |
| `services/orchestrator/internal/manager/mocks_test.go` | Go | Mock implementations |
| `services/orchestrator/internal/manager/manager_test.go` | Go | Manager unit tests |
| `services/orchestrator/internal/manager/handlers_test.go` | Go | Handler unit tests |
| `apps/api/src/__tests__/helpers/websocket-mock.ts` | TS | WebSocket test helpers |
| `apps/api/src/__tests__/integration/websocket.integration.test.ts` | TS | WebSocket tests |
| `apps/web/e2e/pages/whatsapp-connection.page.ts` | TS | Page object |
| `apps/web/e2e/fixtures/whatsapp.fixture.ts` | TS | Connection fixtures |
| `apps/web/e2e/tests/whatsapp-connection.spec.ts` | TS | E2E tests |

### Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/__tests__/services/message-handler.test.ts` | Add connection event tests |

### Estimated Test Count

- **Orchestrator (Go):** ~25 unit tests
- **WebSocket (TS):** ~15 integration tests
- **E2E (Playwright):** ~12 tests
- **Total:** ~52 new tests
