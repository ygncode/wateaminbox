# Large Files Analysis (1000+ lines)

**Generated**: 2025-01-08
**Threshold**: 1000+ lines
**Total Files Found**: 11 production files

---

## 🔴 Critical (1500+ lines)

### 1. `apps/web/src/lib/api.ts` - **1,612 lines**
**Type**: Frontend API client
**Role**: Centralized API client with all endpoint definitions

**Refactoring Recommendations**:
- Split by domain/route:
  - `api/auth.ts` - Authentication endpoints
  - `api/contacts.ts` - Contact management
  - `api/messages.ts` - Message operations
  - `api/whatsapp.ts` - WhatsApp connection
  - `api/companies.ts` - Company/team management
  - `api/analytics.ts` - Analytics & reporting
- Create `api/client.ts` - Base axios instance with interceptors
- Use barrel exports: `api/index.ts` exports all modules

**Benefits**:
- Easier to locate endpoint definitions
- Better code splitting (smaller bundles)
- Clearer dependency tracking

---

### 2. `services/whatsapp/internal/store/pgstore.go` - **1,531 lines**
**Type**: Go database layer
**Role**: PostgreSQL storage for WhatsApp service

**Refactoring Recommendations**:
- Split by entity:
  - `store/messages.go` - Message CRUD operations
  - `store/contacts.go` - Contact operations
  - `store/groups.go` - Group operations
  - `store/attachments.go` - Media/file storage
  - `store/queries.go` - Complex queries/reporting
  - `store/migrations.go` - Schema management
- Create `store/store.go` - Main store interface & initialization

**Benefits**:
- Clearer separation of concerns
- Easier to mock for testing
- Better performance (smaller compilation units)

---

### 3. `apps/web/src/components/whatsapp/WhatsAppConnectionPanel.tsx` - **1,505 lines**
**Type**: React component
**Role**: WhatsApp device linking & connection management UI

**Refactoring Recommendations**:
- Extract sub-components:
  - `QRCodeScanner.tsx` - QR code display
  - `ConnectionStatus.tsx` - Status indicators
  - `DeviceList.tsx` - Connected devices
  - `LinkNewDevice.tsx` - New device flow
  - `ConnectionHistory.tsx` - Past connections
- Extract hooks:
  - `useWhatsAppConnection.ts` - Connection state logic
  - `useQRCode.ts` - QR code generation/polling
  - `useDeviceManagement.ts` - Device CRUD operations
- Move validation logic to `lib/whatsapp-validation.ts`

**Benefits**:
- Better testability (isolated components)
- Reusable hooks for other components
- Clearer component hierarchy

---

## 🟡 High Priority (1000-1500 lines)

### 4. `apps/web/src/components/chat/EmojiInputPicker.tsx` - **1,358 lines**
**Type**: React component
**Role**: Emoji picker with search/categories

**Refactoring Recommendations**:
- **Immediate action**: Replace with a library
  - Consider: `emoji-picker-react` or `picmo`
- If building custom:
  - `emoji-data.ts` - Raw emoji mappings
  - `EmojiCategory.tsx` - Category component
  - `EmojiSearch.tsx` - Search functionality
  - `EmojiGrid.tsx` - Display grid
  - `useEmojiPicker.ts` - State management hook

**Why this is unusual**: Emoji pickers shouldn't be this large unless embedding all emoji data

---

### 5. `apps/api/src/services/message-handler.ts` - **1,300 lines**
**Type**: Backend service
**Role**: Process incoming WhatsApp messages

**Refactoring Recommendations**:
- Split by message type:
  - `handlers/text.handler.ts` - Text messages
  - `handlers/media.handler.ts` - Images/audio/video
  - `handlers/document.handler.ts` - Files
  - `handlers/location.handler.ts` - Location sharing
  - `handlers/system.handler.ts` - Notifications/updates
- Extract utilities:
  - `lib/message-processing.ts` - Common transformations
  - `lib/message-validation.ts` - Schema validation
  - `lib/webhook-utils.ts` - Webhook logic
- Create `message-handler/index.ts` - Main orchestrator

**Benefits**:
- Easier to add new message types
- Better unit testing
- Clearer error handling per type

---

### 6. `services/whatsapp/internal/handler/handler.go` - **1,166 lines**
**Type**: Go HTTP handler
**Role**: HTTP API for WhatsApp service

**Refactoring Recommendations**:
- Split by route group:
  - `handlers/messages.go` - Message endpoints
  - `handlers/contacts.go` - Contact endpoints
  - `handlers/groups.go` - Group endpoints
  - `handlers/websocket.go` - WebSocket connections
  - `handlers/health.go` - Health checks/metrics
- Create `handlers/router.go` - Route registration
- Extract middleware: `middleware/auth.go`, `middleware/logging.go`

**Benefits**:
- Standard Go project structure
- Easier to find route handlers
- Better request routing organization

---

### 7. `apps/web/src/components/dashboard/Dashboard.tsx` - **1,076 lines**
**Type**: React component
**Role**: Main dashboard with stats, charts, activity feed

**Refactoring Recommendations**:
- Extract sections:
  - `dashboard/StatCards.tsx` - KPI cards
  - `dashboard/Charts.tsx` - Analytics charts
  - `dashboard/ActivityFeed.tsx` - Recent activity
  - `dashboard/QuickActions.tsx` - Action buttons
- Extract chart configs:
  - `dashboard/chart-configs.ts` - Chart configurations
- Extract hooks:
  - `hooks/useDashboardStats.ts` - Data fetching
  - `hooks/useRealtimeUpdates.ts` - WebSocket integration

**Benefits**:
- Component reusability
- Better lazy loading (code splitting)
- Easier to add new dashboard widgets

---

### 8. `apps/api/src/lib/nats.ts` - **1,056 lines**
**Type**: Backend messaging
**Role**: NATS JetStream integration for pub/sub

**Refactoring Recommendations**:
- Split by concern:
  - `nats/publisher.ts` - Message publishing
  - `nats/subscriber.ts` - Message subscriptions
  - `nats/stream-manager.ts` - Stream lifecycle
  - `nats/consumer.ts` - Consumer management
  - `nats/health.ts` - Connection monitoring
- Extract constants: `nats/subjects.ts` - Subject names/patterns
- Extract types: `nats/types.ts` - Message type definitions

**Benefits**:
- Clearer pub/sub patterns
- Easier to test individual concerns
- Better error isolation

---

### 9. `apps/web/src/contexts/WebSocketProvider.tsx` - **1,051 lines**
**Type**: React context
**Role**: Global WebSocket connection & real-time updates

**Refactoring Recommendations**:
- Extract hooks:
  - `hooks/useWebSocketConnection.ts` - Connection logic
  - `hooks/useWebSocketSubscriptions.ts` - Subscription management
  - `hooks/useWebSocketEvents.ts` - Event handlers
- Extract utilities:
  - `lib/websocket-message-handler.ts` - Message routing
  - `lib/websocket-reconnection.ts` - Reconnect strategy
- Split context:
  - `WebSocketConnectionContext` - Connection status only
  - `WebSocketDataContext` - Real-time data updates

**Benefits**:
- More granular re-renders
- Easier to test connection logic
- Better separation of concerns

---

### 10. `apps/web/src/components/chat/MessageBubble.tsx` - **1,051 lines**
**Type**: React component
**Role**: Display individual messages (all message types)

**Refactoring Recommendations**:
- Split by message type:
  - `messages/TextMessage.tsx`
  - `messages/ImageMessage.tsx`
  - `messages/AudioMessage.tsx`
  - `messages/VideoMessage.tsx`
  - `messages/DocumentMessage.tsx`
  - `messages/LocationMessage.tsx`
  - `messages/SystemMessage.tsx`
- Extract shared UI:
  - `messages/MessageTimestamp.tsx`
  - `messages/MessageStatus.tsx`
  - `messages/MessageAvatar.tsx`
- Use composition: `<MessageBubble type="image" {...props} />`

**Benefits**:
- Easier to add new message types
- Better performance (smaller components)
- Clearer message-specific logic

---

### 11. `apps/api/src/services/analytics.service.ts` - **1,036 lines**
**Type**: Backend service
**Role**: Analytics queries & reporting

**Refactoring Recommendations**:
- Split by domain:
  - `analytics/message-analytics.ts` - Message stats
  - `analytics/contact-analytics.ts` - Contact metrics
  - `analytics/team-analytics.ts` - Team performance
  - `analytics/exports.ts` - Report generation
- Extract queries:
  - `analytics/queries.ts` - Raw SQL queries
- Extract caching logic:
  - `analytics/cache.ts` - Result caching

**Benefits**:
- Easier to extend with new metrics
- Better query organization
- Improved caching strategy

---

## 🟊 Notable Mentions (900-1000 lines)

These files are approaching the threshold and should be monitored:

- `apps/web/src/components/chat/ContactProfile.tsx` (994 lines)
- `apps/api/src/routes/whatsapp.ts` (871 lines)
- `apps/api/src/routes/messages.ts` (848 lines)

---

## Refactoring Strategy

### Phase 1: Quick Wins (1-2 weeks each)
1. **EmojiInputPicker** - Replace with library
2. **api.ts** - Split into domain modules
3. **MessageBubble** - Split by message type

### Phase 2: Backend Services (2-3 weeks each)
1. **message-handler.ts** - Split by message type
2. **nats.ts** - Split by concern
3. **analytics.service.ts** - Split by domain

### Phase 3: Complex Components (3-4 weeks each)
1. **WhatsAppConnectionPanel** - Extract sub-components
2. **Dashboard** - Extract sections
3. **WebSocketProvider** - Extract hooks

### Phase 4: Go Services (2-3 weeks each)
1. **pgstore.go** - Split by entity
2. **handler.go** - Split by route group

---

## General Refactoring Principles

1. **Single Responsibility**: Each file/module should have one reason to change
2. **Domain-Driven Splitting**: Group by business domain, not technical layers
3. **Composition Over Inheritance**: Use small, composable components
4. **Testability**: Smaller files are easier to test
5. **Maintainability**: Faster code navigation, clearer dependencies

---

## Metrics to Track

- Lines of code per file (target: <500 lines)
- Cyclomatic complexity (target: <10 per function)
- Test coverage (target: >80%)
- Bundle size impact (for frontend)

---

## Next Steps

1. Prioritize files based on:
   - Team pain points (which files cause the most issues?)
   - Frequency of changes (high churn = refactor first)
   - Test coverage (untested = harder to refactor)

2. For each file:
   - Read and understand current structure
   - Create refactoring plan (breakdown by module)
   - Write tests for existing behavior
   - Incrementally split without changing behavior
   - Update imports across codebase
   - Verify tests still pass

3. Consider using:
   - **ESLint/TypeScript**: Ensure no breaking changes
   - **Git hooks**: Prevent large files from being added
   - **Pre-commit checks**: `max-lines` rule in ESLint

