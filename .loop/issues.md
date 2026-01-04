# Issues Log

## Case 1 - Database Schema Missing Tables

**Date:** 2026-01-04

### Summary
Multiple database tables are missing in the tenant schema `tenant_a2c17e3b_22fd_4eaf_ad1d_09c3f8b7359b`.

### Missing Tables

| Table Name | Occurrences |
|------------|-------------|
| `messages` | 200+ errors |
| `conversation_states` | 100+ errors |
| `notification_history` | 4 errors |
| `quick_replies` | 2 errors |
| `whatsapp_labels` | 6 errors |
| `whatsapp_catalogs` | 4 errors |

### Error Examples
```
error: relation "tenant_a2c17e3b_22fd_4eaf_ad1d_09c3f8b7359b.notification_history" does not exist
error: relation "tenant_a2c17e3b_22fd_4eaf_ad1d_09c3f8b7359b.quick_replies" does not exist
error: relation "tenant_a2c17e3b_22fd_4eaf_ad1d_09c3f8b7359b.whatsapp_labels" does not exist
error: relation "tenant_a2c17e3b_22fd_4eaf_ad1d_09c3f8b7359b.whatsapp_catalogs" does not exist
error: relation "messages" does not exist
error: relation "conversation_states" does not exist
```

### Suggested Fix
Run database migrations to create missing tables in the tenant schema:
```bash
bun run db:migrate
```

---

## Case 2 - WhatsApp Connection & Messaging Issues

**Date:** 2026-01-04

### Issue 2.1 - QR Code Initialization Stuck

**Symptom:** UI shows "Initializing Connection - Please wait while we prepare the QR code..." even though QR code is being generated.

**Root Cause:** WebSocket connection closes before initialization completes.

**Error Logs:**
```
[WS] Connection closed before initialization
[WS] Message received before initialization
```

**Evidence:** QR codes ARE being generated and published via NATS:
```
QR code event for worker a2c17e3b-22fd-4eaf-ad1d-09c3f8b7359b: 6 codes available
Published event to WHATSAPP.events.a2c17e3b-22fd-4eaf-ad1d-09c3f8b7359b.qr
[MessageHandler] QR code generated for company a2c17e3b-22fd-4eaf-ad1d-09c3f8b7359b
```

**Investigation Points:**
- Check WebSocket connection lifecycle in frontend
- Verify WebSocket reconnection logic
- Check if frontend is subscribing to WS before requesting QR

---

### Issue 2.2 - Outgoing Messages Not Showing in UI

**Symptom:** User reports outgoing messages not working.

**Analysis:** Messages ARE being sent successfully on the backend:
```
[NATS] Published send message to WHATSAPP.commands.60a44e18-ce48-4142-9472-aa2db35f3d7d
2026/01/04 13:28:37 Successfully sent message to 6594603306@s.whatsapp.net
Message sent: ID=3EB0F1F0FADD3212997737, ServerTimestamp=2026-01-04 13:28:37
```

**Possible Causes:**
1. WebSocket not delivering real-time updates to frontend
2. Frontend not receiving message confirmation events
3. Message status updates showing `rows affected: 0` in some cases

---

### Issue 2.3 - Incoming Messages Not Showing in UI

**Symptom:** User reports incoming messages not working.

**Analysis:** Incoming messages ARE being received and stored:
```
Received message from 6594603306@s.whatsapp.net
[MessageHandler] Stored message 2e28c2e0-a38f-4c45-804e-fa1437aad9e1 for company 60a44e18-ce48-4142-9472-aa2db35f3d7d
```

**Possible Causes:**
1. WebSocket issues (`[WS] Message received before initialization`)
2. Frontend not receiving real-time message events
3. Related to Issue 2.1 - WS connection issues

---

### Issue 2.4 - Worker Lifecycle Race Conditions

**Error Logs:**
```
Error: WhatsApp connection already exists for company 60a44e18-ce48-4142-9472-aa2db35f3d7d
Failed to stop worker for company 60a44e18-ce48-4142-9472-aa2db35f3d7d: worker not found
Error handling command kill: worker 60a44e18-ce48-4142-9472-aa2db35f3d7d not found
```

**Root Cause:** Race condition in orchestrator when handling multiple spawn/kill commands for the same company.

**Impact:** May cause connection instability and delayed QR code display.

---

## Case 3 - UI/UX and Feature Issues

**Date:** 2026-01-04

### Issue 3.1 - Add New Contact Not Working

**Symptom:** Cannot add new contacts.

**Log Evidence:**
```
POST /api/contacts 409
```

**Analysis:** API returns 409 Conflict - likely duplicate contact or validation issue. Frontend may not be showing the error message properly.

---

### Issue 3.2 - Quick Replies Not Working

**Symptom:** Quick replies feature doesn't work.

**Log Evidence:** API calls succeed (GET 200, POST 201, DELETE 200), but UI integration may be broken.

**Investigation Points:**
- Check if quick replies are being inserted into message input
- Verify keyboard shortcut (/) triggers quick reply picker
- Related to Case 1: `quick_replies` table missing in some tenant schemas

---

### Issue 3.3 - Emoji Not Received/Displayed

**Symptom:** Emoji messages not showing in chat.

**Possible Causes:**
- Emoji encoding issue in message storage
- Frontend rendering issue for emoji characters
- May require UTF-8/emoji font support check

---

### Issue 3.4 - Input Focus Lost After Sending Message

**Symptom:** Every time user types and sends a message, the active input loses focus. User needs to click the input again.

**Root Cause:** Frontend issue - message input not retaining focus after send action.

**Fix Location:** `apps/web` - Chat input component, check `onSubmit` handler to call `inputRef.focus()` after sending.

---

### Issue 3.5 - Reply Message UI Not Showing

**Symptom:** Reply message works functionally but the reply reference design is not visible in the UI.

**Analysis:** Backend handles reply correctly but frontend doesn't render the "replying to" preview above the quoted message.

---

### Issue 3.6 - No Emoji Reactions on Messages

**Symptom:** Cannot add emoji reactions to messages.

**Status:** Feature may not be implemented or UI is broken.

---

### Issue 3.7 - No Message Status Indicators

**Symptom:** No delivery/read status indicators (checkmarks) on messages.

**Log Evidence:**
```
[MessageHandler] Updated message status to read for message ... (rows affected: 0)
[MessageHandler] Updated message status to sent for message ... (rows affected: 0)
```

**Analysis:** Backend receives status updates but `rows affected: 0` suggests messages aren't being found/updated. Frontend likely not displaying status even when available.

---

### Issue 3.8 - Emoji Picker Not Working

**Symptom:** Emoji picker UI doesn't function.

**Investigation Points:**
- Check if emoji picker component renders
- Verify click handlers are attached
- Check for JavaScript errors in browser console

---

### Issue 3.9 - Attachment/Document Upload Not Working

**Symptom:** Cannot send attachments or documents. UI doesn't work.

**Investigation Points:**
- Check file input click handler
- Verify upload API endpoint
- Check R2/MinIO storage configuration
- May need to verify file type validation

---

### Issue 3.10 - Forward Message Not Working

**Symptom:** Cannot forward messages to other contacts.

**Status:** Feature may not be fully implemented or UI handler is broken.

---

### Issue 3.11 - Message Search Always Shows "No Results"

**Symptom:** Search functionality returns no results regardless of query.

**Investigation Points:**
- Check Meilisearch connection and indexing
- Verify messages are being indexed on creation
- Check search API endpoint response
- May be related to Case 1: missing `messages` table prevents indexing

---

## Case 4 - Fresh Start / New Tenant Schema Incomplete

**Date:** 2026-01-04

### Summary

When a new company/tenant is created (fresh registration), the tenant schema is created but **missing critical tables**. This causes 500 errors across multiple API endpoints immediately after registration.

### Issue 4.1 - Tenant Schema Missing Tables on Creation

**Symptom:** After fresh database and new user registration, multiple API endpoints return 500 errors.

**Affected Endpoints (all return 500):**
| Endpoint | Missing Table |
|----------|---------------|
| `/api/labels/status` | `whatsapp_labels` |
| `/api/labels` | `whatsapp_labels` |
| `/api/labels/tags/with-status` | `whatsapp_labels` |
| `/api/quick-replies` | `quick_replies` |
| `/api/catalogs` | `whatsapp_catalogs` |
| `/api/catalogs/status` | `whatsapp_catalogs`, `catalog_products` |
| `/api/notifications` | `notification_history` |
| `/api/notifications/count` | `notification_history` |

**Error Logs:**
```
error: relation "tenant_b3911365_ca9d_4228_8025_73074170a2bb.whatsapp_catalogs" does not exist
error: relation "tenant_b3911365_ca9d_4228_8025_73074170a2bb.whatsapp_labels" does not exist
error: relation "tenant_b3911365_ca9d_4228_8025_73074170a2bb.quick_replies" does not exist
error: relation "tenant_b3911365_ca9d_4228_8025_73074170a2bb.notification_history" does not exist
error: relation "tenant_b3911365_ca9d_4228_8025_73074170a2bb.catalog_products" does not exist
```

**Root Cause:** The tenant schema creation function (called during company creation) is not creating all required tables. The migration `002_create_tenant_schema_template` and subsequent migrations (003-008) may not be applying to new tenant schemas.

**Investigation Points:**
- Check `packages/database/src/migrations/002_create_tenant_schema_template.ts`
- Verify the `createTenantSchema()` function copies ALL tables from template
- Ensure migrations 003-008 are reflected in the tenant template schema

---

### Issue 4.2 - WebSocket Closes Before Connection Established

**Symptom:** WebSocket connection fails during QR code initialization.

**Browser Console Error:**
```
WebSocket connection to 'ws://localhost:3001/api/ws?token=...&company=...' failed:
WebSocket is closed before the connection is established.
```

**Analysis:** This may be caused by the 500 errors from the API endpoints triggering component re-renders that disconnect the WebSocket before it can complete the handshake.

**Related to:** Issue 4.1 - The cascade of 500 errors destabilizes the frontend state.

---
