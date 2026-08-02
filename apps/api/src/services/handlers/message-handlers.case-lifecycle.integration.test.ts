import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import type { MessageEvent } from "../../lib/nats/types/events.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../tenant.service.js";
import { handleMessageEvent } from "./message-handlers.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function withTenant(
  run: (companyId: string, connectionId: string) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: `owner-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Message handler lifecycle test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await db
      .insertInto("sla_policies")
      .values({
        company_id: companyId,
        target_minutes: 60,
        direct_resolution_target_minutes: 480,
        group_response_target_minutes: 120,
        group_resolution_target_minutes: 960,
        timezone: "UTC",
        weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
        exceptions: JSON.stringify([]),
        effective_from: new Date("1970-01-01T00:00:00Z"),
        created_by: ownerId,
      })
      .execute();

    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    const [connection] = await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        name: "Test connection",
        phone_number: "15550000000",
        status: "connected",
      })
      .returning("id")
      .execute();

    await run(companyId, connection.id);
  } finally {
    // handleMessageEvent fires several NON-awaited background calls
    // (search indexing, push notification recipient resolution) that can
    // still be in flight against the tenant schema when `run()` resolves -
    // give them a beat to settle before dropping the schema, or the DROP
    // can race a background read/write and the subsequent sla_policies
    // cleanup below fails on the (still-existing) tenant FK.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await clearTenantConnection(companyId);
    await sql
      .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      .execute(db);
    await db
      .deleteFrom("sla_policies")
      .where("company_id", "=", companyId)
      .execute();
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

function directInboundEvent(
  companyId: string,
  connectionId: string,
  overrides: Partial<MessageEvent["payload"]> = {},
): MessageEvent {
  return {
    contractVersion: 1,
    type: "message",
    companyId,
    connectionId,
    timestamp: new Date().toISOString(),
    payload: {
      messageId: crypto.randomUUID(),
      from: "15551234567@s.whatsapp.net",
      to: "15550000000@s.whatsapp.net",
      fromMe: false,
      content: "hello there",
      messageType: "text",
      timestamp: new Date().toISOString(),
      ...overrides,
    },
  };
}

describe("handleMessageEvent - conversation-case lifecycle wiring", () => {
  integrationTest(
    "a newly stored live direct inbound atomically opens exactly one case",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const event = directInboundEvent(companyId, connectionId);

        await handleMessageEvent(event);

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", "15551234567@s.whatsapp.net")
          .executeTakeFirstOrThrow();

        const cases = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .execute();
        expect(cases).toHaveLength(1);
        expect(cases[0].kind).toBe("direct");
        expect(cases[0].status).toBe("open");

        const projection = await tenantDb
          .selectFrom("conversation_states")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .executeTakeFirstOrThrow();
        expect(projection.status).toBe("open");
        expect(projection.active_case_id).toBe(cases[0].id);
      });
    },
  );

  integrationTest(
    "a newly stored live group inbound atomically opens exactly one case",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const event = directInboundEvent(companyId, connectionId, {
          from: "15551110001@s.whatsapp.net",
          to: "120363000000000000@g.us",
          isGroup: true,
          groupId: "120363000000000000@g.us",
          content: "hi from group",
        });

        await handleMessageEvent(event);

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", "120363000000000000@g.us")
          .executeTakeFirstOrThrow();
        expect(contact.is_group).toBe(true);

        const cases = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .execute();
        expect(cases).toHaveLength(1);
        expect(cases[0].kind).toBe("group");
        expect(cases[0].response_target_minutes).toBe(120);
      });
    },
  );

  integrationTest(
    "duplicate/retried events are idempotent - no message duplication, no extra case",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const messageId = crypto.randomUUID();
        const event = directInboundEvent(companyId, connectionId, {
          messageId,
        });

        await handleMessageEvent(event);
        // Simulate an at-least-once redelivery of the exact same event.
        await handleMessageEvent(event);
        await handleMessageEvent(event);

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", "15551234567@s.whatsapp.net")
          .executeTakeFirstOrThrow();

        const messages = await tenantDb
          .selectFrom("messages")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .execute();
        expect(messages).toHaveLength(1);

        const cases = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .execute();
        expect(cases).toHaveLength(1);
      });
    },
  );

  integrationTest(
    "a live inbound after resolution creates a new case, never mutating the old one",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        await handleMessageEvent(directInboundEvent(companyId, connectionId));

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", "15551234567@s.whatsapp.net")
          .executeTakeFirstOrThrow();

        const { resolveActiveCase } = await import(
          "../conversation-case.service.js"
        );
        // The inbound message above was never answered by a team reply, so
        // "handled" would correctly be rejected (see conversation-case
        // .service.ts's hasUnansweredLatestTurn check) - resolve with a
        // valid response-SLA exclusion instead.
        const resolverId = crypto.randomUUID();
        await resolveActiveCase(tenantDb, contact.id, {
          outcome: "no_reply_needed",
          resolvedBy: resolverId,
        });

        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            messageId: crypto.randomUUID(),
            content: "still there?",
          }),
        );

        const cases = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .orderBy("opened_at", "asc")
          .execute();
        expect(cases).toHaveLength(2);
        expect(cases[0].status).toBe("resolved");
        expect(cases[1].status).toBe("open");

        const projection = await tenantDb
          .selectFrom("conversation_states")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .executeTakeFirstOrThrow();
        expect(projection.active_case_id).toBe(cases[1].id);
      });
    },
  );

  integrationTest(
    "future history sync never opens a case and leaves the projection resolved",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            from: "15559998888@s.whatsapp.net",
            isHistorySync: true,
          }),
        );

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", "15559998888@s.whatsapp.net")
          .executeTakeFirstOrThrow();

        const cases = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .execute();
        expect(cases).toHaveLength(0);

        // History sync never creates a conversation_states row for
        // unread-tracking purposes at all (see message-handlers.ts) - if
        // one exists for any other reason, it must not be open/pending.
        const projection = await tenantDb
          .selectFrom("conversation_states")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .executeTakeFirst();
        if (projection) {
          expect(projection.status).toBe("resolved");
          expect(projection.active_case_id).toBeNull();
        }
      });
    },
  );

  integrationTest(
    "a group burst from multiple distinct participants is one response episode, closed by one outbound reply",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const groupJid = "120363111111111111@g.us";

        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            messageId: crypto.randomUUID(),
            from: "15551110001@s.whatsapp.net",
            to: groupJid,
            isGroup: true,
            groupId: groupJid,
            content: "message from participant A",
          }),
        );
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            messageId: crypto.randomUUID(),
            from: "15551110002@s.whatsapp.net",
            to: groupJid,
            isGroup: true,
            groupId: groupJid,
            content: "message from participant B",
          }),
        );
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            messageId: crypto.randomUUID(),
            from: "15551110003@s.whatsapp.net",
            to: groupJid,
            isGroup: true,
            groupId: groupJid,
            content: "message from participant C",
          }),
        );

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", groupJid)
          .executeTakeFirstOrThrow();

        // All three participants' messages land in the SAME group
        // conversation and the SAME (still-open) case - never one case per
        // participant.
        const cases = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .execute();
        expect(cases).toHaveLength(1);
        expect(cases[0].kind).toBe("group");

        const { getResponseTimeStats } = await import(
          "../analytics/response-time.js"
        );
        const start = new Date(Date.now() - 60_000);

        // Before any reply: still pending, not yet an episode outcome to
        // count (see episode-outcome.ts) - no crash, no per-participant
        // fan-out.
        const beforeReply = await getResponseTimeStats(
          companyId,
          start,
          new Date(Date.now() + 60_000),
        );
        expect(beforeReply.totalConversations).toBe(0);

        // One team reply closes the entire burst as a single episode.
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            messageId: crypto.randomUUID(),
            from: connectionId,
            to: groupJid,
            fromMe: true,
            isGroup: true,
            groupId: groupJid,
            content: "team reply",
          }),
        );

        const afterReply = await getResponseTimeStats(
          companyId,
          start,
          new Date(Date.now() + 60_000),
        );
        expect(afterReply.totalConversations).toBe(1);
        expect(afterReply.byKind.group.totalConversations).toBe(1);
        expect(afterReply.byKind.direct.totalConversations).toBe(0);
      });
    },
  );

  integrationTest(
    "case membership is bounded by explicit case_id, never by the WhatsApp-supplied timestamp - delayed/future/duplicate timestamps never leak across cycles",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const jid = "15557778888@s.whatsapp.net";

        // Cycle 1 opens with an ordinary "now" timestamp.
        const cycle1Timestamp = new Date();
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            from: jid,
            messageId: crypto.randomUUID(),
            timestamp: cycle1Timestamp.toISOString(),
            content: "cycle 1 message",
          }),
        );

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", jid)
          .executeTakeFirstOrThrow();

        const { resolveActiveCase } = await import(
          "../conversation-case.service.js"
        );
        await resolveActiveCase(tenantDb, contact.id, {
          outcome: "no_reply_needed",
          resolvedBy: crypto.randomUUID(),
        });

        const [case1] = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .execute();
        expect(case1.status).toBe("resolved");

        // Cycle 2 opens with a DELAYED (out-of-order) WhatsApp timestamp -
        // earlier than cycle 1's own message - as can happen with
        // network-delayed delivery. Case membership must still land on
        // cycle 2's case; it must never be re-attributed to cycle 1 by
        // comparing timestamps against cycle 1's window.
        const delayedTimestamp = new Date(
          cycle1Timestamp.getTime() - 3_600_000,
        );
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            from: jid,
            messageId: crypto.randomUUID(),
            timestamp: delayedTimestamp.toISOString(),
            content: "cycle 2 message, delayed timestamp",
          }),
        );

        // A second cycle-2 message shares the EXACT SAME timestamp as
        // cycle 1's message - a naive timestamp-window join could match it
        // to either case.
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            from: jid,
            messageId: crypto.randomUUID(),
            timestamp: cycle1Timestamp.toISOString(),
            content: "cycle 2 message, same timestamp as cycle 1",
          }),
        );

        // A third cycle-2 message carries a FUTURE timestamp (e.g. a
        // clock-skewed device), which must not push it out of the
        // currently-open case.
        const futureTimestamp = new Date(
          cycle1Timestamp.getTime() + 86_400_000,
        );
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            from: jid,
            messageId: crypto.randomUUID(),
            timestamp: futureTimestamp.toISOString(),
            content: "cycle 2 message, future timestamp",
          }),
        );

        const cases = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .orderBy("created_at", "asc")
          .execute();
        expect(cases).toHaveLength(2);
        const [resolvedCase, activeCase] = cases;
        expect(resolvedCase.status).toBe("resolved");
        expect(activeCase.status).toBe("open");

        const cycle1Messages = await tenantDb
          .selectFrom("messages")
          .select(["id", "content", "case_id"])
          .where("case_id", "=", resolvedCase.id)
          .execute();
        expect(cycle1Messages).toHaveLength(1);
        expect(cycle1Messages[0].content).toBe("cycle 1 message");

        const cycle2Messages = await tenantDb
          .selectFrom("messages")
          .select(["id", "content", "case_id"])
          .where("case_id", "=", activeCase.id)
          .execute();
        expect(cycle2Messages).toHaveLength(3);
        expect(cycle2Messages.map((m) => m.content).sort()).toEqual(
          [
            "cycle 2 message, delayed timestamp",
            "cycle 2 message, same timestamp as cycle 1",
            "cycle 2 message, future timestamp",
          ].sort(),
        );

        // No message is ever left unattributed (case_id null would
        // silently drop it from every case-scoped analytics query), and no
        // message is ever double-counted across the two cases.
        const allMessages = await tenantDb
          .selectFrom("messages")
          .select(["id", "case_id"])
          .where("contact_id", "=", contact.id)
          .execute();
        expect(allMessages.every((m) => m.case_id !== null)).toBe(true);
        const countByCase = new Map<string, number>();
        for (const m of allMessages) {
          const key = m.case_id as string;
          countByCase.set(key, (countByCase.get(key) ?? 0) + 1);
        }
        expect(countByCase.get(resolvedCase.id)).toBe(1);
        expect(countByCase.get(activeCase.id)).toBe(3);
      });
    },
  );

  integrationTest(
    "a future-dated or delayed first live inbound never violates resolved_at >= opened_at - case.opened_at is authoritative server time, not the WhatsApp-supplied timestamp",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const beforeEvent = new Date();

        // A client with a badly future-skewed clock claims this arrived 30
        // days from now. Under the old (WhatsApp-timestamp-trusting)
        // behavior this would set case.opened_at 30 days in the future,
        // making an immediate resolve (resolved_at = real now) violate the
        // `resolved_at >= opened_at` check constraint.
        const futureClaimedTimestamp = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();

        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            from: "15556660000@s.whatsapp.net",
            timestamp: futureClaimedTimestamp,
          }),
        );
        const afterEvent = new Date();

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", "15556660000@s.whatsapp.net")
          .executeTakeFirstOrThrow();

        const openedCase = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .executeTakeFirstOrThrow();

        // opened_at is bounded by the actual wall-clock window this test
        // ran in - never the future-claimed WhatsApp timestamp.
        expect(openedCase.opened_at.getTime()).toBeGreaterThanOrEqual(
          beforeEvent.getTime(),
        );
        expect(openedCase.opened_at.getTime()).toBeLessThanOrEqual(
          afterEvent.getTime(),
        );

        // An immediate resolve must succeed - it would violate the DB
        // check constraint if opened_at had been trusted from the future-
        // dated client timestamp instead.
        const { resolveActiveCase } = await import(
          "../conversation-case.service.js"
        );
        const resolved = await resolveActiveCase(tenantDb, contact.id, {
          outcome: "no_reply_needed",
          resolvedBy: crypto.randomUUID(),
        });
        expect(resolved.status).toBe("resolved");
        expect(resolved.resolvedAt).not.toBeNull();
        expect(resolved.resolvedAt!.getTime()).toBeGreaterThanOrEqual(
          resolved.openedAt.getTime(),
        );

        // The original WhatsApp-claimed timestamp is still preserved on
        // the opening message itself, for display.
        const openingMessage = await tenantDb
          .selectFrom("messages")
          .select(["timestamp"])
          .where("id", "=", openedCase.opening_message_id as string)
          .executeTakeFirstOrThrow();
        expect(openingMessage.timestamp.toISOString()).toBe(
          futureClaimedTimestamp,
        );
      });
    },
  );

  integrationTest(
    "a delayed first live inbound (WhatsApp timestamp far in the past) still snapshots the CURRENTLY active policy, not one resolved against the stale timestamp",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const delayedClaimedTimestamp = new Date(
          Date.now() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString();

        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            from: "15556660001@s.whatsapp.net",
            timestamp: delayedClaimedTimestamp,
          }),
        );

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", "15556660001@s.whatsapp.net")
          .executeTakeFirstOrThrow();

        const openedCase = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .executeTakeFirstOrThrow();

        const { getCurrentSlaPolicy } = await import(
          "../sla-policy/policy.service.js"
        );
        const currentPolicy = await getCurrentSlaPolicy(companyId);

        expect(openedCase.policy_id).toBe(currentPolicy.id);
      });
    },
  );

  integrationTest(
    "an AUTOMATIC reopen (new live inbound after resolution) clears the prior assignment - the old assignee can no longer send, another user can claim it, and the old assignment row is preserved as history",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const jid = "15557778888@s.whatsapp.net";
        const oldAssigneeId = crypto.randomUUID();
        const otherUserId = crypto.randomUUID();

        const {
          assignContactToUser,
          getCurrentAssignment,
        } = await import("../contact.service.js");
        const { resolveActiveCase } = await import(
          "../conversation-case.service.js"
        );
        const { requireSendAccess, ContactAssignedToOtherError } =
          await import("../send-access.service.js");

        // Cycle 1: live inbound opens a case, an agent claims it, then
        // resolves.
        await handleMessageEvent(directInboundEvent(companyId, connectionId, { from: jid }));
        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", jid)
          .executeTakeFirstOrThrow();

        await assignContactToUser(
          tenantDb,
          contact.id,
          oldAssigneeId,
          oldAssigneeId,
        );
        await resolveActiveCase(tenantDb, contact.id, {
          outcome: "no_reply_needed",
          resolvedBy: oldAssigneeId,
        });

        // Cycle 2: a brand-new live inbound automatically reopens the
        // conversation. The prior assignee must NOT carry over.
        await handleMessageEvent(
          directInboundEvent(companyId, connectionId, {
            from: jid,
            messageId: crypto.randomUUID(),
            content: "customer is back",
          }),
        );

        const activeAssignment = await getCurrentAssignment(
          tenantDb,
          contact.id,
        );
        expect(activeAssignment).toBeUndefined();

        // The realtime signal and audit trail both reflect a SYSTEM-
        // triggered unassign (no human actor), not an explicit unassign
        // route call.
        const auditRow = await tenantDb
          .selectFrom("audit_logs")
          .selectAll()
          .where("action", "=", "contact.unassigned")
          .where("entity_id", "=", contact.id)
          .executeTakeFirstOrThrow();
        expect(auditRow.user_id).toBeNull();
        expect(
          (auditRow.details as { previousAssignee?: string } | null)
            ?.previousAssignee,
        ).toBe(oldAssigneeId);
        expect(
          (auditRow.details as { reason?: string } | null)?.reason,
        ).toBe("auto_reopen");

        // The old assignee can no longer send - the contact is unassigned,
        // so ANY permitted user (including a completely different one) can
        // claim it first via the normal auto-claim path.
        const newCaseId = await tenantDb
          .selectFrom("conversation_cases")
          .select("id")
          .where("contact_id", "=", contact.id)
          .where("status", "=", "open")
          .executeTakeFirstOrThrow();
        expect(newCaseId).toBeDefined();

        const otherClaim = await tenantDb
          .transaction()
          .execute((trx) => requireSendAccess(trx, contact.id, otherUserId));
        expect(otherClaim.autoAssigned).toBe(true);

        // Now that "other" holds it, the OLD assignee is blocked exactly
        // like any non-owner would be.
        await expect(
          tenantDb
            .transaction()
            .execute((trx) =>
              requireSendAccess(trx, contact.id, oldAssigneeId),
            ),
        ).rejects.toBeInstanceOf(ContactAssignedToOtherError);

        // Assignment HISTORY is preserved - the old row still exists,
        // soft-closed, not deleted, alongside the new active one.
        const allAssignments = await tenantDb
          .selectFrom("contact_assignments")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .orderBy("assigned_at", "asc")
          .execute();
        expect(allAssignments).toHaveLength(2);
        expect(allAssignments[0].assigned_to).toBe(oldAssigneeId);
        expect(allAssignments[0].unassigned_at).not.toBeNull();
        expect(allAssignments[1].assigned_to).toBe(otherUserId);
        expect(allAssignments[1].unassigned_at).toBeNull();
      });
    },
  );

  integrationTest(
    "a MANUAL reopen (an agent explicitly clicking Reopen) preserves the existing assignment - this is a deliberate human action, not the automatic-reopen unassign path",
    async () => {
      await withTenant(async (companyId, connectionId) => {
        const tenantDb = getTenantConnection(companyId);
        const jid = "15557778889@s.whatsapp.net";
        const assigneeId = crypto.randomUUID();

        const { assignContactToUser, getCurrentAssignment } = await import(
          "../contact.service.js"
        );
        const { resolveActiveCase, reopenAsNewCase } = await import(
          "../conversation-case.service.js"
        );

        await handleMessageEvent(directInboundEvent(companyId, connectionId, { from: jid }));
        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", jid)
          .executeTakeFirstOrThrow();

        await assignContactToUser(tenantDb, contact.id, assigneeId, assigneeId);
        await resolveActiveCase(tenantDb, contact.id, {
          outcome: "no_reply_needed",
          resolvedBy: assigneeId,
        });

        // The SAME assignee manually reopens (assertActorOwnsContact
        // requires the actor to already own the contact, or it to be
        // unassigned - the assignee here still owns it, since manual
        // reopen is a separate code path from the auto-reopen unassign).
        await reopenAsNewCase(
          tenantDb,
          { id: contact.id, isGroup: false },
          {
            companyId,
            openedBy: assigneeId,
            reason: "Customer followed up directly with the agent",
            expectedMode: "reopen",
          },
        );

        // getCurrentAssignment only ever returns a row where
        // unassigned_at IS NULL (see its own WHERE clause) - a match here
        // already proves the assignment is still active, not just that
        // SOME row with this assignee exists.
        const activeAssignment = await getCurrentAssignment(
          tenantDb,
          contact.id,
        );
        expect(activeAssignment?.assigned_to).toBe(assigneeId);

        const allAssignments = await tenantDb
          .selectFrom("contact_assignments")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .execute();
        // Never unassigned/re-assigned - still exactly the one original row.
        expect(allAssignments).toHaveLength(1);
      });
    },
  );
});
