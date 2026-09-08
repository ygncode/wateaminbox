# RFC: Channel-neutral messaging spine

- **Status:** Proposed
- **Scope:** OSS application architecture and migration plan
- **Production change:** None. This RFC does not authorize a migration, deployment, provider credential change, webhook registration, or traffic cutover.

## Summary

WATeamInbox should add a channel-neutral messaging spine rather than generalize the existing WhatsApp tables in place.

The current model makes one tenant `contacts.id` serve as all of the following:

- the ID of a row representing a WhatsApp JID/address;
- the ID of a row representing a person or group;
- a conversation/thread identifier;
- the partition key for messages;
- the target for assignment, unread state, notes, tags, case lifecycle, and SLA.

That model cannot safely represent one person with several channel identities, an email thread with changing recipients, multiple conversations with the same person, or a group with several participants. Renaming `whatsapp_connections` to `connections` would retain those problems and blur the difference between a channel and a provider.

This RFC introduces these explicit concepts:

```text
Provider adapters
├── WhatsApp linked device
├── WhatsApp Cloud API
├── Facebook Messenger
├── Instagram Messaging
├── Telegram Bot
├── LINE Messaging
├── Viber Bot
└── Email
          │
          ▼
Normalized channel layer
├── channel accounts
├── contacts and external endpoints
├── conversations and participants
├── messages and attachments
├── delivery events
└── capabilities
          │
          ▼
Shared inbox
assignments · cases · SLA · notes · tags
notifications · search · analytics · realtime
```

The migration posture is deliberate and heavy on purpose. Live linked-device WhatsApp traffic, NATS subjects and durable consumers, session recovery without QR re-pairing, case and SLA history, and send/idempotency semantics make in-place rename or “add a channel column to contacts and messages” unsafe. Renaming `whatsapp_connections` to a vague `connections` table, or rewriting existing WhatsApp rows in one release, is the cheaper-looking disaster: it blurs channel versus provider, creates outage-sized lock and rollback risk, and cannot represent several endpoints or threads per person.

Instead, the program uses additive schema, dual-write with continuous reconciliation, shadow normalize-and-compare, neutral reads behind flags, then a fenced single-writer authority handoff. The early schema, shadow-write, and shadow-read phases are reversible at the application level by disabling flags while retaining new data. Existing linked-device WhatsApp remains authoritative while neutral rows are shadow-written and verified. Existing IDs and APIs remain valid during the compatibility window. No destructive rename or table removal occurs in the initial program. Neutral-only provider writes, executed contact merges, authority cutover, and legacy retirement are later forward-only compatibility boundaries with separate recovery plans.

The most important product decision is:

> Assignment, unread state, cases, SLA, operational notes, and inbox tags belong to `conversation_id`, not `contact_id`.

A contact merge combines customer identity and endpoints. It must not combine conversations, message histories, assignments, unread counters, or SLA cases.

The most important migration decision is:

> Prefer additive dual-write, shadow validation, and a fenced cutover over renaming or rewriting live WhatsApp state in place.

That choice costs more engineering time up front and is the load-bearing safety property of this program.

## Motivation

LOADER_WILL_CONTINUE