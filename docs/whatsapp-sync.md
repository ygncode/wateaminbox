# WhatsApp Synchronization Mechanism

This document outlines the synchronization capabilities of the platform, detailing supported flows, data models, and current implementation gaps.

## Overview

The platform ensures data consistency through three primary mechanisms:
1.  **History Sync:** Fetches historical data upon initial connection (QR scan).
2.  **Offline Sync:** Catches up on missed messages after a disconnect.
3.  **Real-time Sync:** Processes incoming events (messages, receipts, presence) while connected.

## Synchronization Flows

### 1. History Sync (Initial Link)
**Trigger:** Successful connection after QR code scan.
- **Status:** Reports `starting` -> `completed` via NATS.
- **Data:** Fetches conversations, messages, and contacts.
- **Media:** Eagerly downloaded (images, video, docs, audio) with retry logic.
- **Limitation:** Does not sync Status (Stories) or Call Logs.

### 2. Offline Sync (Resume)
**Trigger:** Reconnection after network interruption.
- **Status:** Reports `starting` (with expected count) -> `completed`.
- **Data:** Processes buffered messages from the downtime.

## Feature Support Matrix

| Feature | Status | Details |
| :--- | :--- | :--- |
| **Messages** | ✅ **Full** | Text, Image, Video, Audio, Document, Sticker, Location, Contact cards. |
| **Contacts** | ✅ **Full** | Upsert logic (Create/Update). Syncs Name, PushName, Profile Picture, Online Status. |
| **Receipts** | ✅ **Full** | Sent, Delivered, Read, Played status updates. |
| **Presence** | ✅ **Full** | Online/Offline status and Last Seen. |
| **Typing** | ✅ **Full** | "Typing..." indicators (ephemeral broadcast). |
| **Revoke** | ✅ **Full** | Handles "Delete for Everyone" (Message Revocation). |
| **Reactions** | ✅ **Full** | Emoji reactions to messages. |
| **Groups** | ⚠️ **Partial** | Syncs group info (Name, JID) during history/message events. **MISSING:** Real-time participant changes (Join/Leave/Promote). |
| **Stories** | ❌ **Missing** | WhatsApp Status (Stories) are **not** handled by the worker. |
| **Calls** | ❌ **Missing** | Voice/Video call offers and logs are **ignored**. |
| **Labels** | ❌ **Missing** | WhatsApp Business Labels sync is unimplemented. |
| **Catalogs** | ❌ **Missing** | WhatsApp Business Catalog sync is unimplemented. |

## Event Architecture

### Message Processing
- **Subject:** `WHATSAPP.events.{companyId}.{connectionId}.message`
- **Logic:**
  - `IsHistorySync: true`: Notifications & Webhooks suppressed.
  - `IsHistorySync: false`: Real-time processing (Notifications, Unread Counts).

### Contact Upsert
- **Subject:** `WHATSAPP.events.{companyId}.{connectionId}.contact`
- **Logic:** Matches by normalized JID (e.g., `123@s.whatsapp.net`). Updates profile data if changed.

### Known Issues & Limitations

1.  **Subject Collision (Status):**
    - The NATS subject `...status` is used by the Go service for **Connection Status** (Connected/Disconnected).
    - The API expects **Story Status** on a similar channel. This confirms Stories are unimplemented and likely blocked by this naming collision.

2.  **Deferred Media:**
    - The API supports "On-Demand Download" (storing `directPath`), but the Go service **eagerly downloads everything**. This increases bandwidth usage during initial sync.

3.  **Group Participants:**
    - Users added/removed from groups while the bot is online will not be reflected in the database until a full re-sync or message event carries the data.