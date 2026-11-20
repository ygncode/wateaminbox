# Channel-neutral spine Phase 0 inventory and compatibility

Status: implementation inventory only. This does not authorize Phase 1 schema, dual write, provider work, cutover, deployment, or any change to `docs/channel-neutral-spine-rfc.md`.

## Tracking rule and baseline

A contact-as-conversation dependency is any read, write, API field, query/cache key, event, URL, export field, analytics grouping, or MCP input where `contacts.id`/`contact_id` identifies a thread. Keep it tracked until it has a characterization test and is moved to `conversation_id` or retained as an explicit versioned compatibility facade.

Production-source discovery baseline (Phase 0):

| Surface | Matching files |
| --- | ---: |
| `apps/api/src/routes` | 26 |
| `apps/api/src/services` | 41 |
| `apps/api/src/middleware` | 1 |
| `apps/web/src` | 90 |
| `packages/shared/src` | 3 |

Reproduce the source list with:

```sh
rg -l 'contactId|contact_id|conversationId|/chat/' \
  apps/api/src apps/web/src packages/shared/src \
  --glob '*.{ts,tsx}' --glob '!**/*.test.*' --glob '!**/*.integration.test.*' \
  | sort
```

Counts are a discovery alarm, not a completion metric. Update this inventory when dependencies move. New neutral domain/inbox code is guarded by `apps/api/src/architecture/channel-provider-import-boundary.test.ts`.

## Coupling inventory

| Area | Current authority/coupling | Primary paths | Existing characterization / next gate |
| --- | --- | --- | --- |
| Tenant schema | Messages, state, cases, assignments, notes, tags, schedules, and groups reference `contact_id` | `packages/database/src/client.ts`, `tenant-schema.ts`, migrations | tenant contract and migration suites |
| Conversation list/direct/group | A contact query is the conversation projection; groups are contact rows | `contact.service.ts`, `helpers/contact-query-builder.ts`, `group.service.ts` | contact/group integration tests |
| Inbound/history | Account + JID resolves contact; message/case/state writes use its ID | `message-handler.ts`, `handlers/message-handlers.ts`, `handlers/history-handlers.ts`, `import/processing.ts` | case-lifecycle/history/import tests |
| Outbound | `contactId` resolves JID/account; response emits `conversationId = contactId` | `routes/messages/send.ts`, `routes/conversations/messages.ts`, `command-outbox.service.ts` | send route and command-outbox tests |
| Multiple linked accounts | `(whatsapp_connection_id, jid)` scopes contact and routing | connection/send/handler services | `multi-connection.integration.test.ts` |
| Assignment/visibility | Assignment, send access, and restricted visibility key on contact | `send-access.service.ts`, `middleware/resource-visibility.ts`, `routes/contacts/assignment.ts` | send-access/assignment tests |
| Cases/SLA/state | Locks, uniqueness, snapshots, membership, lifecycle, and analytics key on contact/case | `conversation-case.service.ts`, `conversation-state.service.ts`, `services/analytics/` | lifecycle/response/resolution tests |
| Notes/tags/labels | Operational metadata is under contact routes; provider labels map to contact tags | contact note/tag routes, `routes/labels.ts`, `note.service.ts` | route tests; conversation parity later |
| Scheduling/bulk/auto-reply | Recipient, eligibility, claims, budgets, uniqueness resolve contacts/JIDs | scheduled, bulk, auto-reply services | scheduled/background/bulk tests |
| Delivery/fanout | Outcomes update contact-owned messages; public fanout validates WhatsApp connection | incoming delivery and delivery-outbox services | command-outcome and delivery migration tests |
| Realtime | Payloads carry `contactId` or a `conversationId` equal to contact ID | `packages/shared/src/websocket-types.ts`, API/web realtime registries, broadcast service | registry/policy/event-handler tests |
| Search | Documents and visibility filters store contact ID/JID as conversation identity | search, Meilisearch, search-outbox services and route | search/visibility tests; version index later |
| Notifications/URLs | Records and `/chat/:id` use contact ID; mute state stores JIDs | assignment/recipient services, web notification navigation/provider | navigation/preferences/architecture tests |
| Export | v1 rows, names, filters, and pagination inherit contact-as-thread semantics | export service/route/web hook | export integration; preserve v1 meaning |
| Analytics | Engagement, response, episode, and resolution group by contact/case | `apps/api/src/services/analytics/` | analytics suites; never infer old cases |
| MCP | Conversation tools accept legacy contact IDs; discovery is cached | `apps/api/src/routes/mcp/tools/`, MCP routes | MCP tests; bump server version for tool-list changes |
| Web state/UI | selected chat, URL, query keys, drafts, typing, composer/profile/actions use contact (typing also JID) | `ChatPage.tsx`, stores, hooks, chat components, API client | existing UI tests; compatibility view model first |
| Purge/media | Connection purge traverses contacts and contact-owned resources | purge cleanup, WhatsApp connection, message cleanup services | purge suites must expand before dual write |

## Phase 0 compatibility matrix

| Contract | Authority and promise | Phase 0 change |
| --- | --- | --- |
| Public database | Missing flag row or defaults means legacy/off | Add public flags and append-only mutation audit; no tenant DDL/data |
| API | Existing contact-based reads/writes and response meanings stay authoritative | Add uncached fail-closed internal accessor; no route consumes it |
| Web | `/chat/:contactId`, query keys, composer, typing, notifications, mute unchanged | None |
| Linked-device worker | Go behavior, whatsmeow storage/session recovery, event/command envelope unchanged | None |
| Orchestrator | Lifecycle and placement unchanged | None |
| NATS subjects | `WHATSAPP.commands.*`, `WHATSAPP.events.*`, download subjects unchanged | None |
| Durable consumers | Names, filters, lanes, ACK ownership, and coverage unchanged | None |
| Search/export/analytics/MCP | Existing contact-based contracts unchanged | Inventory only |
| Other providers | Disabled; empty `enabled_providers` grants nothing | None |
| Private control plane | Commercial policy and hosted fleet/provider operations stay private | None |

## Characterization retained

- Direct send/facade: `apps/api/src/routes/messages/send.integration.test.ts`.
- Group/history: `apps/api/src/services/group-sync.integration.test.ts` and handler history tests.
- Same JID on several accounts: `apps/api/src/services/multi-connection.integration.test.ts`.
- Delivery uncertainty: `apps/api/src/services/handlers/command-outcome.test.ts` and outbox/delivery migration tests.
- Case open/reopen and immutable membership: handler case-lifecycle and conversation-case suites.
- Scheduled claims/retry: scheduled and background-dispatch suites.
- Search/restricted visibility: search, send-access, and authorization suites.

Phase 0 adds an assertion that direct-send `message.contactId` and compatibility `message.conversationId` remain the submitted contact ID. No WhatsApp behavior changes.
