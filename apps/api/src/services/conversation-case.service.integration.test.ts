import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import {
  ConflictError,
  NoActiveCaseError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import {
  getActiveCase,
  getConversationCaseHistory,
  openOrReopenCaseForInboundMessage,
  reopenAsNewCase,
  requireActiveCaseForSend,
  resolveActiveCase,
  resolveActiveCaseIdForContact,
  resumePendingCase,
  setActiveCasePending,
} from "./conversation-case.service.js";
import { getCurrentSlaPolicy } from "./sla-policy/policy.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function withTenant(
  run: (companyId: string) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: `case-owner-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Conversation case test",
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
    await run(companyId);
  } finally {
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

async function insertContact(companyId: string, isGroup = false) {
  const tenantDb = getTenantConnection(companyId);
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      jid: `${crypto.randomUUID()}@${isGroup ? "g.us" : "s.whatsapp.net"}`,
      phone_number: isGroup ? null : crypto.randomUUID().slice(0, 10),
      push_name: "Test contact",
      is_group: isGroup,
    })
    .returning("id")
    .execute();
  return contact.id;
}

/**
 * Mirrors production exactly: inserts the inbound message row FIRST, then
 * opens/reopens the case referencing that real message - `opening_message
 * _id`/`case_id` are foreign keys, so (unlike earlier drafts of this test
 * file) a case can never be opened against a message that doesn't exist.
 */
async function openInboundCase(
  companyId: string,
  contact: { id: string; isGroup: boolean },
  timestamp: Date,
): ReturnType<typeof openOrReopenCaseForInboundMessage> {
  const tenantDb = getTenantConnection(companyId);
  return tenantDb.transaction().execute(async (trx) => {
    const messageId = crypto.randomUUID();
    await trx
      .insertInto("messages")
      .values({
        id: messageId,
        contact_id: contact.id,
        message_id: crypto.randomUUID(),
        from_me: false,
        message_type: "text",
        content: "hello",
        timestamp,
      })
      .execute();
    return openOrReopenCaseForInboundMessage(trx, companyId, contact, {
      id: messageId,
      timestamp,
    });
  });
}

describe("conversation-case lifecycle", () => {
  integrationTest(
    "a live inbound message opens exactly one case, and a second inbound stays on the same case",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const t0 = new Date("2026-01-05T10:00:00Z");

        const result = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          t0,
        );
        expect(result).not.toBeNull();
        expect(result?.wasAutoReopen).toBe(false);
        expect(result?.case.kind).toBe("direct");
        expect(result?.case.status).toBe("open");
        expect(result?.case.openSource).toBe("live_inbound");
        expect(result?.case.openedBy).toBeNull();

        const active1 = await getActiveCase(tenantDb, contactId);
        expect(active1).not.toBeNull();

        // A second inbound message a minute later must not open a new case.
        const second = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(t0.getTime() + 60_000),
        );
        expect(second).toBeNull();

        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(1);
        expect(history[0].id).toBe(active1!.id);
      });
    },
  );

  integrationTest(
    "concurrent inbound events for the same contact never open two cases",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const t0 = new Date("2026-01-05T10:00:00Z");

        const attempts = await Promise.all(
          Array.from({ length: 5 }, () =>
            openInboundCase(companyId, { id: contactId, isGroup: false }, t0),
          ),
        );

        const opened = attempts.filter((r) => r !== null);
        expect(opened).toHaveLength(1);

        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(1);
      });
    },
  );

  integrationTest(
    "resolve requires an outcome, closes the active case, and a later inbound opens a new case (auto-reopen)",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();
        const t0 = new Date("2026-01-05T10:00:00Z");

        const opened = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          t0,
        );

        await expect(
          resolveActiveCase(tenantDb, contactId, {
            outcome: "other",
            resolvedBy: userId,
          }),
        ).rejects.toBeInstanceOf(ValidationError);

        // The opening message above is the only (unanswered) message, so
        // "handled" is rejected too - close with a valid exclusion instead.
        const resolved = await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: userId,
        });
        expect(resolved.status).toBe("resolved");
        expect(resolved.resolutionOutcome).toBe("no_reply_needed");
        expect(resolved.id).toBe(opened!.case.id);

        const activeAfterResolve = await getActiveCase(tenantDb, contactId);
        expect(activeAfterResolve).toBeNull();

        // A later live inbound reopens - as a brand-new case, not a mutation
        // of the resolved one.
        const reopenResult = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(t0.getTime() + 3600_000),
        );
        expect(reopenResult).not.toBeNull();
        expect(reopenResult!.wasAutoReopen).toBe(true);
        expect(reopenResult!.case.id).not.toBe(resolved.id);
        expect(reopenResult!.case.reopenedFromCaseId).toBe(resolved.id);
        expect(reopenResult!.case.openSource).toBe("live_inbound");
        expect(reopenResult!.case.openedBy).toBeNull();

        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(2);
      });
    },
  );

  integrationTest(
    "manual reopen creates a new case and cannot run while a case is already active",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();

        await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );
        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: userId,
        });

        const reopened = await reopenAsNewCase(
          tenantDb,
          { id: contactId, isGroup: false },
          { companyId, openedBy: userId, reason: "Customer called back", expectedMode: "reopen" },
        );
        expect(reopened.status).toBe("open");
        expect(reopened.reopenReason).toBe("Customer called back");
        expect(reopened.reopenedFromCaseId).not.toBeNull();
        expect(reopened.openSource).toBe("manual");
        expect(reopened.openedBy).toBe(userId);

        // A reason is supplied (a prior case now exists, so one would
        // otherwise be required) specifically to isolate the "already
        // active" conflict this asserts, from the separate
        // reason-required-to-reopen validation.
        await expect(
          reopenAsNewCase(
            tenantDb,
            { id: contactId, isGroup: false },
            { companyId, openedBy: userId, reason: "Should never apply", expectedMode: "reopen" },
          ),
        ).rejects.toBeInstanceOf(ConflictError);
      });
    },
  );

  integrationTest(
    "expectedMode enforces the correct endpoint: /open on a contact with prior history, or /reopen on one with none, is a controlled ConflictError, never a silent fallthrough",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);

        // A brand-new contact has no case history at all - /reopen must
        // reject it (there's nothing to reopen), not silently open it.
        const freshContactId = await insertContact(companyId);
        await expect(
          reopenAsNewCase(
            tenantDb,
            { id: freshContactId, isGroup: false },
            {
              companyId,
              openedBy: crypto.randomUUID(),
              reason: "irrelevant",
              expectedMode: "reopen",
            },
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        // Never opened anything.
        expect(await getActiveCase(tenantDb, freshContactId)).toBeNull();
        expect(await getConversationCaseHistory(tenantDb, freshContactId)).toHaveLength(0);

        // /open on that SAME fresh contact correctly succeeds (this is
        // genuinely a first-ever open).
        const opened = await reopenAsNewCase(
          tenantDb,
          { id: freshContactId, isGroup: false },
          { companyId, openedBy: crypto.randomUUID(), expectedMode: "open" },
        );
        expect(opened.reopenedFromCaseId).toBeNull();

        // Resolve it so this contact now HAS prior case history.
        const resolverId = crypto.randomUUID();
        await resolveActiveCase(tenantDb, freshContactId, {
          outcome: "no_reply_needed",
          resolvedBy: resolverId,
        });

        // Now /open must reject it (there IS prior history) - never
        // silently reopen on the caller's behalf.
        await expect(
          reopenAsNewCase(
            tenantDb,
            { id: freshContactId, isGroup: false },
            { companyId, openedBy: crypto.randomUUID(), expectedMode: "open" },
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        // Still resolved, no new case created by the rejected attempt.
        expect(await getActiveCase(tenantDb, freshContactId)).toBeNull();
        expect(await getConversationCaseHistory(tenantDb, freshContactId)).toHaveLength(1);

        // /reopen on it now correctly succeeds.
        const reopened2 = await reopenAsNewCase(
          tenantDb,
          { id: freshContactId, isGroup: false },
          {
            companyId,
            openedBy: crypto.randomUUID(),
            reason: "Customer followed up",
            expectedMode: "reopen",
          },
        );
        expect(reopened2.reopenedFromCaseId).toBe(opened.id);
      });
    },
  );

  integrationTest(
    "pending stays within the same case and a follow-up inbound flips it back to open",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const t0 = new Date("2026-01-05T10:00:00Z");

        const opened = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          t0,
        );

        const pending = await setActiveCasePending(
          tenantDb,
          contactId,
          crypto.randomUUID(),
        );
        expect(pending.id).toBe(opened!.case.id);
        expect(pending.status).toBe("pending");

        const followUp = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(t0.getTime() + 60_000),
        );
        expect(followUp!.case.id).toBe(opened!.case.id);
        expect(followUp!.case.status).toBe("open");
        expect(followUp!.wasAutoReopen).toBe(false);

        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(1);
      });
    },
  );

  integrationTest(
    "resumePendingCase flips a pending case back to open - the SAME case, opened_at/policy/target untouched, idempotent if already open",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const t0 = new Date("2026-01-05T10:00:00Z");

        const opened = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          t0,
        );
        await setActiveCasePending(tenantDb, contactId, crypto.randomUUID());

        const resumed = await resumePendingCase(
          tenantDb,
          contactId,
          crypto.randomUUID(),
        );
        expect(resumed.id).toBe(opened!.case.id);
        expect(resumed.status).toBe("open");
        expect(resumed.openedAt.getTime()).toBe(
          opened!.case.openedAt.getTime(),
        );
        expect(resumed.policyId).toBe(opened!.case.policyId);
        expect(resumed.responseTargetMinutes).toBe(
          opened!.case.responseTargetMinutes,
        );

        // Never a new case - still exactly one in history.
        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(1);

        // Idempotent: already open, resuming again is a no-op success.
        const resumedAgain = await resumePendingCase(
          tenantDb,
          contactId,
          crypto.randomUUID(),
        );
        expect(resumedAgain.id).toBe(opened!.case.id);
        expect(resumedAgain.status).toBe("open");

        // No active case at all -> ConflictError.
        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: crypto.randomUUID(),
        });
        await expect(
          resumePendingCase(tenantDb, contactId, crypto.randomUUID()),
        ).rejects.toBeInstanceOf(ConflictError);
      });
    },
  );

  integrationTest(
    "group and direct inbound resolve to their own kind-specific SLA targets",
    async () => {
      await withTenant(async (companyId) => {
        const directContactId = await insertContact(companyId, false);
        const groupContactId = await insertContact(companyId, true);

        const directResult = await openInboundCase(
          companyId,
          { id: directContactId, isGroup: false },
          new Date(),
        );
        const groupResult = await openInboundCase(
          companyId,
          { id: groupContactId, isGroup: true },
          new Date(),
        );

        expect(directResult!.case.kind).toBe("direct");
        expect(directResult!.case.responseTargetMinutes).toBe(60);
        expect(directResult!.case.resolutionTargetMinutes).toBe(480);

        expect(groupResult!.case.kind).toBe("group");
        expect(groupResult!.case.responseTargetMinutes).toBe(120);
        expect(groupResult!.case.resolutionTargetMinutes).toBe(960);
      });
    },
  );

  integrationTest(
    "getMostRecentCase and case history order by created_at, not the WhatsApp-supplied opened_at",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();

        // First cycle: opened_at is set far in the FUTURE relative to the
        // second cycle - a delayed/out-of-order WhatsApp timestamp. Despite
        // that, it was genuinely created (and resolved) first.
        const first = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date("2026-06-01T00:00:00Z"),
        );
        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: userId,
        });

        // Second cycle: opened_at is chronologically EARLIER than the
        // first cycle's opened_at, but this row is created_at-after it.
        const second = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date("2026-01-01T00:00:00Z"),
        );

        expect(second!.case.reopenedFromCaseId).toBe(first!.case.id);

        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(2);
        // Most-recently-created first, regardless of opened_at ordering.
        expect(history[0].id).toBe(second!.case.id);
        expect(history[1].id).toBe(first!.case.id);
      });
    },
  );

  integrationTest(
    "deleting a case sets messages.case_id to NULL instead of being blocked by retained message rows",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const opened = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );
        const caseId = opened!.case.id;

        const before = await tenantDb
          .selectFrom("messages")
          .select(["id", "case_id"])
          .where("case_id", "=", caseId)
          .execute();
        expect(before.length).toBeGreaterThan(0);

        await tenantDb
          .deleteFrom("conversation_cases")
          .where("id", "=", caseId)
          .execute();

        const after = await tenantDb
          .selectFrom("messages")
          .select(["id", "case_id"])
          .where(
            "id",
            "in",
            before.map((m) => m.id),
          )
          .execute();
        expect(after).toHaveLength(before.length);
        expect(after.every((m) => m.case_id === null)).toBe(true);
      });
    },
  );

  integrationTest(
    "response/resolution target snapshot columns reject out-of-range values, not just non-positive ones",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const policy = await getCurrentSlaPolicy(companyId);

        await expect(
          tenantDb
            .insertInto("conversation_cases")
            .values({
              contact_id: contactId,
              kind: "direct",
              status: "open",
              opened_at: new Date(),
              open_source: "live_inbound",
              policy_id: policy.id,
              response_target_minutes: 1441, // > 1440 upper bound
              resolution_target_minutes: 480,
            })
            .execute(),
        ).rejects.toThrow();

        await expect(
          tenantDb
            .insertInto("conversation_cases")
            .values({
              contact_id: contactId,
              kind: "direct",
              status: "open",
              opened_at: new Date(),
              open_source: "live_inbound",
              policy_id: policy.id,
              response_target_minutes: 60,
              resolution_target_minutes: 20161, // > 20160 upper bound
            })
            .execute(),
        ).rejects.toThrow();
      });
    },
  );
});

async function projectionRow(
  tenantDb: ReturnType<typeof getTenantConnection>,
  contactId: string,
) {
  return tenantDb
    .selectFrom("conversation_states")
    .selectAll()
    .where("contact_id", "=", contactId)
    .executeTakeFirst();
}

describe("conversation-case concurrency and projection integrity", () => {
  integrationTest(
    "only one of two concurrent resolves wins; the loser gets ConflictError",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userA = crypto.randomUUID();
        const userB = crypto.randomUUID();

        await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );

        const results = await Promise.allSettled([
          resolveActiveCase(tenantDb, contactId, {
            outcome: "no_reply_needed",
            resolvedBy: userA,
          }),
          resolveActiveCase(tenantDb, contactId, {
            outcome: "spam",
            resolvedBy: userB,
          }),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
          ConflictError,
        );

        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe("resolved");
      });
    },
  );

  integrationTest(
    "pending cannot resurrect a case that a concurrent resolve already closed",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();

        await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );

        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: userId,
        });

        await expect(
          setActiveCasePending(tenantDb, contactId, userId),
        ).rejects.toBeInstanceOf(ConflictError);

        // The case must stay resolved - pending must never resurrect it.
        const active = await getActiveCase(tenantDb, contactId);
        expect(active).toBeNull();
        const projection = await projectionRow(tenantDb, contactId);
        expect(projection?.status).toBe("resolved");
        expect(projection?.active_case_id).toBeNull();
      });
    },
  );

  integrationTest(
    "only one of two concurrent manual reopens wins; the loser gets ConflictError",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();

        await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );
        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: userId,
        });

        const results = await Promise.allSettled([
          reopenAsNewCase(
            tenantDb,
            { id: contactId, isGroup: false },
            { companyId, openedBy: userId, reason: "race A", expectedMode: "reopen" },
          ),
          reopenAsNewCase(
            tenantDb,
            { id: contactId, isGroup: false },
            { companyId, openedBy: userId, reason: "race B", expectedMode: "reopen" },
          ),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
          ConflictError,
        );

        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(2); // original resolved + exactly one reopen
      });
    },
  );

  integrationTest(
    "auto-reopen (live inbound) and manual resolve racing each other resolve to exactly one of two fully-consistent, deterministic outcomes",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();
        const t0 = new Date("2026-01-05T10:00:00Z");

        const opened = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          t0,
        );
        const originalCaseId = opened!.case.id;

        // Race: a manual resolve and a live inbound (which would flip a
        // still-active case, or - if the resolve wins first - auto-reopen a
        // brand-new, linked one) happen concurrently. The per-contact
        // advisory lock (see conversation-case.service.ts's `lockContact`)
        // forces one to fully complete before the other starts, so exactly
        // one of two fully-determined outcomes is possible - never a
        // half-applied state where a new case exists with no
        // `reopened_from_case_id`, or two active cases.
        const [resolveOutcome, inboundOutcome] = await Promise.allSettled([
          resolveActiveCase(tenantDb, contactId, {
            outcome: "no_reply_needed",
            resolvedBy: userId,
          }),
          openInboundCase(
            companyId,
            { id: contactId, isGroup: false },
            new Date(t0.getTime() + 1000),
          ),
        ]);

        expect(inboundOutcome.status).toBe("fulfilled");
        expect(resolveOutcome.status).toBe("fulfilled");

        const allCases = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contactId)
          .orderBy("created_at", "asc")
          .execute();
        const projection = await projectionRow(tenantDb, contactId);

        if (allCases.length === 2) {
          // The lock let the resolve run first: the inbound then observed
          // an already-resolved projection and correctly auto-reopened a
          // brand-new case, linked back to the one the resolve just closed.
          expect(allCases[0].id).toBe(originalCaseId);
          expect(allCases[0].status).toBe("resolved");
          expect(allCases[0].resolution_outcome).toBe("no_reply_needed");
          expect(allCases[1].status).toBe("open");
          expect(allCases[1].open_source).toBe("live_inbound");
          expect(allCases[1].opened_by).toBeNull();
          expect(allCases[1].reopened_from_case_id).toBe(originalCaseId);
          expect(projection?.status).toBe("open");
          expect(projection?.active_case_id).toBe(allCases[1].id);
          expect(projection?.reopened_at).not.toBeNull();
          expect(projection?.reopened_by).toBeNull();
        } else {
          // The lock let the inbound run first: it self-healed onto the
          // still-open original case (no second case, no reopen link, no
          // event to emit), and the resolve that ran after correctly
          // closed exactly that case.
          expect(allCases).toHaveLength(1);
          expect(allCases[0].id).toBe(originalCaseId);
          expect(allCases[0].status).toBe("resolved");
          expect(allCases[0].resolution_outcome).toBe("no_reply_needed");
          expect(allCases[0].reopened_from_case_id).toBeNull();
          expect(projection?.status).toBe("resolved");
          expect(projection?.active_case_id).toBeNull();
        }

        // Never more than one active case, regardless of which order won.
        const activeCases = allCases.filter((c) =>
          ["open", "pending"].includes(c.status),
        );
        expect(activeCases.length).toBeLessThanOrEqual(1);
      });
    },
  );

  integrationTest(
    "an outbound send racing a resolve is fully serialized by the contact lock - it either lands on the still-active case or gets no case at all, never a case that's already resolved",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();

        const opened = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );
        const caseId = opened!.case.id;

        async function sendOutbound() {
          return tenantDb.transaction().execute(async (trx) => {
            const activeCaseId = await resolveActiveCaseIdForContact(
              trx,
              contactId,
            );
            const messageId = crypto.randomUUID();
            await trx
              .insertInto("messages")
              .values({
                id: messageId,
                contact_id: contactId,
                message_id: crypto.randomUUID(),
                from_me: true,
                message_type: "text",
                content: "reply",
                timestamp: new Date(),
                case_id: activeCaseId,
              })
              .execute();
            return { messageId, activeCaseId };
          });
        }

        const [resolveOutcome, sendOutcome] = await Promise.allSettled([
          resolveActiveCase(tenantDb, contactId, {
            outcome: "no_reply_needed",
            resolvedBy: userId,
          }),
          sendOutbound(),
        ]);

        expect(resolveOutcome.status).toBe("fulfilled");
        expect(sendOutcome.status).toBe("fulfilled");
        const { messageId, activeCaseId } = (
          sendOutcome as PromiseFulfilledResult<{
            messageId: string;
            activeCaseId: string | null;
          }>
        ).value;

        const messageRow = await tenantDb
          .selectFrom("messages")
          .select(["case_id"])
          .where("id", "=", messageId)
          .executeTakeFirstOrThrow();

        if (activeCaseId === caseId) {
          // The send acquired the lock before the resolve: it correctly
          // attached to the still-active case, which the resolve (forced
          // to wait) then closed afterward.
          expect(messageRow.case_id).toBe(caseId);
        } else {
          // The resolve acquired the lock first: the case was already
          // closed by the time the send's lookup ran, so it correctly got
          // no case at all - it can never silently answer a case that was
          // already resolved.
          expect(activeCaseId).toBeNull();
          expect(messageRow.case_id).toBeNull();
        }

        const finalCase = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("id", "=", caseId)
          .executeTakeFirstOrThrow();
        expect(finalCase.status).toBe("resolved");
      });
    },
  );

  integrationTest(
    "requireActiveCaseForSend rejects an interactive send into a resolved conversation, but allows one into an active case",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();

        // No case at all yet.
        await expect(
          tenantDb
            .transaction()
            .execute((trx) => requireActiveCaseForSend(trx, contactId)),
        ).rejects.toBeInstanceOf(NoActiveCaseError);

        const opened = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );

        // An active case exists - the guard returns its id, same as
        // resolveActiveCaseIdForContact would.
        const caseId = await tenantDb
          .transaction()
          .execute((trx) => requireActiveCaseForSend(trx, contactId));
        expect(caseId).toBe(opened!.case.id);

        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: userId,
        });

        // Resolved again - rejected again.
        await expect(
          tenantDb
            .transaction()
            .execute((trx) => requireActiveCaseForSend(trx, contactId)),
        ).rejects.toBeInstanceOf(NoActiveCaseError);
      });
    },
  );

  integrationTest(
    "resolving 'handled' is rejected when the latest turn is still unanswered",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();
        const t0 = new Date("2026-01-05T10:00:00Z");

        // The opening message (inserted by openInboundCase) is the only,
        // unanswered turn.
        await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          t0,
        );

        await expect(
          resolveActiveCase(tenantDb, contactId, {
            outcome: "handled",
            resolvedBy: userId,
          }),
        ).rejects.toBeInstanceOf(ValidationError);

        // A valid exclusion still works for the same unanswered turn.
        const resolved = await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: userId,
        });
        expect(resolved.status).toBe("resolved");
        expect(resolved.resolutionOutcome).toBe("no_reply_needed");
      });
    },
  );

  integrationTest(
    "resolving 'handled' succeeds once the latest turn has a team reply",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const userId = crypto.randomUUID();
        const t0 = new Date("2026-01-05T10:00:00Z");

        const opened = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          t0,
        );
        // Mirrors production: an outbound send stamps case_id from
        // whichever case is currently active (see
        // resolveActiveCaseIdForContact) - it is never inferred from a
        // timestamp window.
        await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contactId,
            message_id: crypto.randomUUID(),
            from_me: true,
            message_type: "text",
            content: "we're on it",
            timestamp: new Date(t0.getTime() + 60_000),
            case_id: opened!.case.id,
          })
          .execute();

        const resolved = await resolveActiveCase(tenantDb, contactId, {
          outcome: "handled",
          resolvedBy: userId,
        });
        expect(resolved.status).toBe("resolved");
        expect(resolved.resolutionOutcome).toBe("handled");
      });
    },
  );

  integrationTest(
    "resolve/reopen keep the projection's resolved_at/resolved_by/notes and reopened_at/reopened_by in sync",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);
        const resolverId = crypto.randomUUID();
        const reopenerId = crypto.randomUUID();

        await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );
        await resolveActiveCase(tenantDb, contactId, {
          outcome: "other",
          notes: "Escalated externally",
          resolvedBy: resolverId,
        });

        const afterResolve = await projectionRow(tenantDb, contactId);
        expect(afterResolve?.status).toBe("resolved");
        expect(afterResolve?.resolved_by).toBe(resolverId);
        expect(afterResolve?.resolution_notes).toBe("Escalated externally");
        expect(afterResolve?.active_case_id).toBeNull();

        await reopenAsNewCase(
          tenantDb,
          { id: contactId, isGroup: false },
          { companyId, openedBy: reopenerId, reason: "Customer replied again", expectedMode: "reopen" },
        );

        const afterReopen = await projectionRow(tenantDb, contactId);
        expect(afterReopen?.status).toBe("open");
        expect(afterReopen?.reopened_by).toBe(reopenerId);
        expect(afterReopen?.reopened_at).not.toBeNull();
        // Stale resolution metadata from the previous cycle must be cleared.
        expect(afterReopen?.resolved_at).toBeNull();
        expect(afterReopen?.resolved_by).toBeNull();
        expect(afterReopen?.resolution_notes).toBeNull();
      });
    },
  );

  integrationTest(
    "a bare conversation_states insert (read-before-inbound) defaults to resolved, not open",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);

        // Simulates the /conversations/:id/read route creating a row before
        // any inbound message/case has ever existed for this contact.
        await tenantDb
          .insertInto("conversation_states")
          .values({ contact_id: contactId, unread_count: 0 })
          .execute();

        const row = await projectionRow(tenantDb, contactId);
        expect(row?.status).toBe("resolved");
        expect(row?.active_case_id).toBeNull();
      });
    },
  );

  integrationTest(
    "a live inbound after a resolved-with-no-case-history projection still broadcasts as a reopen",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);

        // Baseline-style projection: resolved, but with zero
        // conversation_cases rows behind it (migration 061's baseline never
        // fabricates a case).
        await tenantDb
          .insertInto("conversation_states")
          .values({ contact_id: contactId, status: "resolved", unread_count: 0 })
          .execute();
        const history = await getConversationCaseHistory(tenantDb, contactId);
        expect(history).toHaveLength(0);

        const result = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );

        expect(result).not.toBeNull();
        expect(result!.wasAutoReopen).toBe(true);
      });
    },
  );

  integrationTest(
    "a brand-new contact's first-ever live inbound is 'opened', never 'auto_reopened'",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const contactId = await insertContact(companyId);

        // No conversation_states row exists at all yet - a genuine
        // first-ever contact, not a migrated/resolved baseline.
        const preExisting = await projectionRow(tenantDb, contactId);
        expect(preExisting).toBeUndefined();

        const result = await openInboundCase(
          companyId,
          { id: contactId, isGroup: false },
          new Date(),
        );

        expect(result).not.toBeNull();
        expect(result!.wasAutoReopen).toBe(false);
      });
    },
  );

  integrationTest(
    "every lifecycle mutation raises a controlled NotFoundError (never a raw constraint failure) for a contact id that doesn't exist - lockContact's row-lock select finding nothing",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const missingContactId = crypto.randomUUID();
        const actorId = crypto.randomUUID();

        await expect(
          resolveActiveCase(tenantDb, missingContactId, {
            outcome: "no_reply_needed",
            resolvedBy: actorId,
          }),
        ).rejects.toBeInstanceOf(NotFoundError);

        await expect(
          setActiveCasePending(tenantDb, missingContactId, actorId),
        ).rejects.toBeInstanceOf(NotFoundError);

        await expect(
          resumePendingCase(tenantDb, missingContactId, actorId),
        ).rejects.toBeInstanceOf(NotFoundError);

        await expect(
          reopenAsNewCase(
            tenantDb,
            { id: missingContactId, isGroup: false },
            { companyId, openedBy: actorId, expectedMode: "open" },
          ),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    },
  );
});
