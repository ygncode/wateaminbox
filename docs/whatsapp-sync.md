# WhatsApp Synchronization Mechanism

This document outlines how WhatsApp synchronization works within the platform, specifically focusing on the **History Sync** mechanism which ensures local data consistency with the linked WhatsApp device.

## Overview

The platform primarily synchronizes data through **History Sync**, which occurs automatically when a WhatsApp session is established or reconnected. This process fetches historical messages and contacts from the phone to populate the platform's database.

> **Note:** Infrastructure for **Label Sync** and **Catalog Sync** (for WhatsApp Business) exists in the codebase (API routes, services, NATS commands), but the end-to-end implementation is currently under development.

## Architecture

The synchronization process involves four main components:

1.  **WhatsApp Worker (Go Service):** Manages the direct connection to WhatsApp servers using the `whatsmeow` library.
2.  **NATS (Message Broker):** Facilitates asynchronous communication between the Worker and the API.
3.  **API Service (Node.js):** Consumes events, updates the PostgreSQL database, and manages WebSocket connections to the frontend.
4.  **Frontend (React):** Displays real-time sync status to the user.

## History Sync Flow

### 1. Trigger
The process begins when the **WhatsApp Worker** successfully connects to the WhatsApp servers. This triggers a `HistorySync` event from the underlying `whatsmeow` library.

### 2. Synchronization Phases

The sync process reports its status via NATS events (`WHATSAPP.events.{companyId}.{connectionId}.sync_status`).

#### Phase A: Starting
- The Worker publishes a `sync:start` status.
- **API:** Updates the connection's `sync_status` to `syncing` in the database.
- **Frontend:** Receives a WebSocket event and displays the `SyncingOverlay`.

#### Phase B: Processing (Optimized)
The Worker processes incoming history data with specific optimizations to ensure performance and prevent flooding:

- **Batching:** Messages and conversations are processed in parallel workers (default: 10).
- **Deferred Media:** To speed up the initial sync, media (images, videos, documents) are **not** downloaded immediately. They are marked for "on-demand" download.
- **Profile Pictures:** Fetching of profile pictures is skipped during history sync.
- **Flagging:** Messages are marked with `IsHistorySync: true`.

#### Phase C: Event Consumption (API)
The API Service listens for incoming events and updates the tenant database:

- **Contacts:** Incoming `contact` events trigger a "create or update" logic in `handleContactEvent`.
  - New contacts are created with a UUID and normalized JID.
  - Existing contacts have their `push_name` and `profile_picture_url` updated.
- **Sync Status:** `sync_status` events update the `whatsapp_connections` table.
  - `starting` or `progress` -> `syncing`
  - `completed` -> `completed`
- **Messages:** Incoming message events are stored in the `messages` table. Crucially, it checks the `isHistorySync` flag:
  - **Notifications:** Skipped for history sync messages to prevent flooding the user with alerts for old messages.
  - **Unread Counts:** Skipped to ensure the unread count reflects only *new* activity.
  - **Webhooks:** Outgoing webhooks are typically suppressed for history sync messages.

#### Phase D: Completion
- Once all history data is processed, the Worker publishes a `sync:complete` status.
- **API:** Updates `sync_status` to `completed` in the database.
- **Frontend:** Removes the overlay and displays the chat interface.

## Data Models & Events

### Database Fields
- `whatsapp_connections.sync_status`: Tracks the current sync state (`null`, `syncing`, `completed`).
- `contacts.jid`: Primary identifier for WhatsApp contacts (normalized to remove device suffixes).
- `messages.is_history_sync`: Boolean flag to distinguish historical messages from real-time ones.

### NATS Subjects
- **Sync Status:** `WHATSAPP.events.{companyId}.{connectionId}.sync_status`
- **Contacts:** `WHATSAPP.events.{companyId}.{connectionId}.contact`
- **Messages:** `WHATSAPP.events.{companyId}.{connectionId}.message`

### WebSocket Events
The Frontend subscribes to these events to update the UI:
- `sync:start`
- `sync:progress`
- `sync:complete`
- `contact` (to refresh contact list/details)

## Label & Catalog Sync (Status)

The codebase contains the following infrastructure for WhatsApp Business features:

- **Services:** `LabelSyncService` and `CatalogSyncService` in the API.
- **Routes:** Endpoints to trigger syncs (e.g., `POST /labels/sync`).
- **Commands:** NATS commands `sync_labels` and `sync_catalogs` are defined.

**Current State:** The WhatsApp Worker's NATS subscriber (`services/whatsapp/internal/nats/subscriber.go`) currently handles message sending (`text`, `media`, `reaction`) but does not yet process `sync_labels` or `sync_catalogs` commands. Consequently, the downstream logic to update the database (`syncLabelsFromWhatsApp`) is not currently invoked.

## Known Limitations

1.  **Last Sync Timestamp:** Although `whatsapp_connections` has a `last_sync_at` column and the API has an `updateLastSync` service function, it is currently **not invoked** upon sync completion. The `updated_at` column is used as a proxy for the last sync activity.
2.  **Label/Catalog Sync:** End-to-end synchronization for labels and catalogs is not yet operational in the worker service.
3.  **Profile Pictures during Sync:** To maximize performance, profile pictures are not fetched during the initial history sync and are instead loaded on-demand.
