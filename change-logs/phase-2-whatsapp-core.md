# Phase 2: WhatsApp Core - Changelog

## Status: COMPLETE

## Overview
Implementing the Go orchestrator service, WhatsApp process management, NATS integration, QR code connection flow, and basic message send/receive functionality.

---

## Tasks

### 2.1 Go Orchestrator Service
- [x] NATS JetStream client setup with reconnection handling
- [x] Process manager for spawning/monitoring WhatsApp processes
- [x] Health check endpoints
- [x] Graceful shutdown handling
- [x] Process state persistence

### 2.2 WhatsApp Process Management
- [x] Per-company WhatsApp process isolation
- [x] Process lifecycle management (start, stop, restart)
- [x] Session state management
- [x] Automatic reconnection on disconnect
- [x] Resource cleanup on process termination

### 2.3 NATS Integration
- [x] Define message schemas (JSON)
- [x] Subjects for orchestrator commands (spawn, kill, status)
- [x] Subjects for WhatsApp events (connected, disconnected, message)
- [x] Hono backend NATS client for sending/receiving
- [x] Message acknowledgment and retry logic

### 2.4 QR Code Connection Flow
- [x] QR code generation in WhatsApp service
- [x] QR code transmission to frontend via WebSocket
- [x] Connection status updates
- [x] Session persistence after successful login
- [x] Timeout handling for QR expiry

### 2.5 Basic Message Send/Receive
- [x] Receive incoming messages via whatsmeow
- [x] Store messages in tenant database
- [x] Send outgoing messages via API
- [x] Message status tracking (pending, sent, delivered, read)
- [x] Media message support (download and store)

---

## Completed Items

### 2026-01-01 - Go WhatsApp Service (whatsmeow integration)
- `internal/store/store.go` - SQLite store for whatsmeow session persistence
  - Creates database at `DATA_DIR/sessions.db`
  - Functions: `NewStore(ctx, cfg)`, `GetOrCreateDevice(ctx, container)`
- `internal/logger/logger.go` - Logger implementing waLog.Logger interface
  - Supports DEBUG, INFO, WARN, ERROR levels
- `internal/nats/publisher.go` - NATS JetStream publisher for WhatsApp events
  - Stream: `WHATSAPP_EVENTS`
  - Functions: `PublishQRCode`, `PublishConnectionStatus`, `PublishMessage`, `PublishReceipt`, `PublishPresence`
  - Uses company-specific subjects: `whatsapp.{companyID}.{event}`
- `internal/nats/subscriber.go` - NATS subscriber for send commands
  - Subject pattern: `whatsapp.{companyID}.send`
  - Implements `MessageSender` interface for text and media messages
- `internal/client/client.go` - Enhanced WhatsApp client wrapper
  - QR code pairing flow with callbacks
  - Reconnection handling (up to 5 attempts)
  - Media message support (image, video, audio, document)
  - Methods: `Connect(ctx)`, `SendMessage(ctx, jid, text)`, `SendMediaMessage(...)`
- `internal/handler/handler.go` - Event handler with NATS publishing
  - Handles: Message, Receipt, Presence, Connected, Disconnected, LoggedOut, QR, PairSuccess, HistorySync, StreamReplaced
- `main.go` - Main entry point with environment configuration
  - Environment variables: COMPANY_ID, NATS_URL, DATA_DIR, WORKER_ID, LOG_LEVEL

### 2026-01-01 - Go Orchestrator Service
- `internal/nats/client.go` - NATS JetStream client with reconnection
  - Stream creation for ORCHESTRATOR and WHATSAPP_EVENTS
  - Consumer management for command processing
- `internal/process/manager.go` - Process manager for WhatsApp workers
  - Spawns isolated WhatsApp processes per company
  - Health monitoring and auto-restart
  - Process state persistence
- `internal/process/worker.go` - Worker process wrapper
  - Command execution with environment injection
  - Output streaming and logging
- `cmd/orchestrator/main.go` - Orchestrator main entry
  - NATS subscription for spawn/kill commands
  - HTTP health endpoints

### 2026-01-01 - Hono API WhatsApp Integration
- `src/lib/nats.ts` - NATS client library for TypeScript
  - Singleton connection with reconnection handling
  - Functions: `getNatsConnection()`, `publishSpawnCommand()`, `publishKillCommand()`, `publishSendMessage()`
  - Subject definitions for commands and events
- `src/services/whatsapp.service.ts` - WhatsApp connection management
  - Functions: `spawnConnection()`, `killConnection()`, `getConnectionStatus()`, `sendMessage()`
  - Error classes: `ConnectionNotFoundError`, `ConnectionAlreadyExistsError`
- `src/routes/whatsapp.ts` - WhatsApp API routes
  - `POST /whatsapp/connect` - Start QR code flow
  - `POST /whatsapp/disconnect` - Disconnect WhatsApp
  - `GET /whatsapp/status` - Get connection status
  - `POST /whatsapp/send` - Send message
  - `GET /whatsapp/connection` - Get detailed connection info
- `src/routes/ws.ts` - WebSocket handler for real-time updates
  - Uses `createBunWebSocket` from Hono
  - Authentication via query params or first message
  - Subscribes to NATS events and broadcasts to clients
  - Handles: auth, ping, send_message client commands
- `src/services/message-handler.ts` - NATS event processor
  - Subscribes to all WhatsApp events on startup
  - Stores messages to tenant database
  - Broadcasts to WebSocket clients
  - Functions: `initializeMessageHandler()`, `shutdownMessageHandler()`

### 2026-01-01 - Database Types Update
- Updated `packages/database/src/client.ts` with Kysely `Generated<T>` types
  - All tables now properly support optional fields with database defaults
  - Fixes TypeScript strict mode compatibility

---

## Notes

- Go orchestrator manages multiple WhatsApp processes
- Each company gets its own isolated WhatsApp process
- NATS JetStream provides message persistence and replay
- Session data stored in SQLite (per worker) for whatsmeow
- Media files to be stored in MinIO (local) / R2 (production)
- WebSocket uses Bun's native WebSocket for performance

---

## Last Updated
2026-01-01
