import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import { assignContactToUser } from "../../services/contact.service.js";
import {
  openOrReopenCaseForInboundMessage,
  resolveActiveCase,
  setActiveCasePending,
} from "../../services/conversation-case.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

async function loginAndGetHeaders(
  email: string,
  password: string,
  companyId: string,
) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
    "content-type": "application/json",
  };
}

/**
 * Sets up a company + tenant schema plus an owner and (optionally) a member
 * with custom permissions, and tears everything down afterward. Mirrors the
 * pattern used by conversation-case.service.integration.test.ts and
 * sla-policy.integration.test.ts.
 */
async function withTenantAndUsers(
  run: (ctx: {
    companyId: string;
    ownerHeaders: Record<string, string>;
    ownerId: string;
    createMember: (
      permissions?: Record<string, boolean>,
    ) => Promise<{ headers: Record<string, string>; userId: string }>;
  }) => Promise<void>,
): Promise<void> {
  const memberIds: string[] = [];

  // createCompany always mints its own company id, so build the tenant
  // directly (as the other integration tests in this area do) rather than
  // going through it.
  const realCompanyId = crypto.randomUUID();
  const realSchemaName = getSchemaName(realCompanyId);
  const realOwnerId = crypto.randomUUID();
  const realOwnerEmail = `owner-${realOwnerId}@example.com`;

  try {
    await db
      .insertInto("users")
      .values({
        id: realOwnerId,
        email: realOwnerEmail,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: realCompanyId,
        name: "State route test",
        schema_name: realSchemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({
        company_id: realCompanyId,
        user_id: realOwnerId,
        role: "owner",
      })
      .execute();
    await db
      .insertInto("sla_policies")
      .values({
        company_id: realCompanyId,
        target_minutes: 60,
        direct_resolution_target_minutes: 480,
        group_response_target_minutes: 120,
        group_resolution_target_minutes: 960,
        timezone: "UTC",
        weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
        exceptions: JSON.stringify([]),
        effective_from: new Date("1970-01-01T00:00:00Z"),
        created_by: realOwnerId,
      })
      .execute();
    await createTenantSchema(realCompanyId);

    const ownerHeaders = await loginAndGetHeaders(
      realOwnerEmail,
      PASSWORD,
      realCompanyId,
    );

    const createMember = async (permissions?: Record<string, boolean>) => {
      const memberId = crypto.randomUUID();
      const memberEmail = `member-${memberId}@example.com`;
      memberIds.push(memberId);
      await db
        .insertInto("users")
        .values({
          id: memberId,
          email: memberEmail,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();
      await db
        .insertInto("company_members")
        .values({
          company_id: realCompanyId,
          user_id: memberId,
          role: "member",
          ...(permissions ? { permissions } : {}),
        })
        .execute();
      const headers = await loginAndGetHeaders(
        memberEmail,
        PASSWORD,
        realCompanyId,
      );
      return { headers, userId: memberId };
    };

    await run({
      companyId: realCompanyId,
      ownerHeaders,
      ownerId: realOwnerId,
      createMember,
    });
  } finally {
    await clearTenantConnection(realCompanyId);
    await sql
      .raw(`DROP SCHEMA IF EXISTS "${realSchemaName}" CASCADE`)
      .execute(db);
    await db
      .deleteFrom("sla_policies")
      .where("company_id", "=", realCompanyId)
      .execute();
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", realCompanyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", realCompanyId).execute();
    await db.deleteFrom("users").where("id", "=", realOwnerId).execute();
    for (const memberId of memberIds) {
      await db.deleteFrom("users").where("id", "=", memberId).execute();
    }
  }
}

async function insertContact(companyId: string) {
  const tenantDb = getTenantConnection(companyId);
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      jid: `${crypto.randomUUID()}@s.whatsapp.net`,
      phone_number: crypto.randomUUID().slice(0, 10),
      push_name: "Route test contact",
    })
    .returning("id")
    .execute();
  return contact.id;
}

/** Opens a real case for the contact (message inserted first, matching production - see conversation-case.service.integration.test.ts). */
async function openCaseFor(companyId: string, contactId: string) {
  const tenantDb = getTenantConnection(companyId);
  return tenantDb.transaction().execute(async (trx) => {
    const messageId = crypto.randomUUID();
    await trx
      .insertInto("messages")
      .values({
        id: messageId,
        contact_id: contactId,
        message_id: crypto.randomUUID(),
        from_me: false,
        message_type: "text",
        content: "hello",
        timestamp: new Date(),
      })
      .execute();
    return openOrReopenCaseForInboundMessage(
      trx,
      companyId,
      { id: contactId, isGroup: false },
      { id: messageId, timestamp: new Date() },
    );
  });
}

describe("conversation lifecycle routes - authorization and validation", () => {
  integrationTest(
    "denies open/resolve/pending to a member without can_send_messages",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember }) => {
        const contactId = await insertContact(companyId);
        const { headers } = await createMember({
          can_send_messages: false,
          can_view_all_chats: true,
        });

        const openResponse = await app.request(
          `/api/conversations/${contactId}/open`,
          { method: "POST", headers, body: "{}" },
        );
        expect(openResponse.status).toBe(403);

        const pendingResponse = await app.request(
          `/api/conversations/${contactId}/pending`,
          { method: "POST", headers },
        );
        expect(pendingResponse.status).toBe(403);

        const resolveResponse = await app.request(
          `/api/conversations/${contactId}/resolve`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ outcome: "no_reply_needed" }),
          },
        );
        expect(resolveResponse.status).toBe(403);
      });
    },
  );

  integrationTest(
    "denies visibility of an unassigned contact's lifecycle state to a member without can_view_all_chats",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember }) => {
        const contactId = await insertContact(companyId);
        const { headers } = await createMember({
          can_view_all_chats: false,
          can_send_messages: true,
        });

        const stateResponse = await app.request(
          `/api/conversations/${contactId}/state`,
          { headers },
        );
        expect(stateResponse.status).toBe(404);

        const openResponse = await app.request(
          `/api/conversations/${contactId}/open`,
          { method: "POST", headers, body: "{}" },
        );
        expect(openResponse.status).toBe(404);
      });
    },
  );

  integrationTest(
    "rejects resolving 'handled' at the route level when the latest turn was never answered",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const contactId = await insertContact(companyId);
        await openCaseFor(companyId, contactId);

        const response = await app.request(
          `/api/conversations/${contactId}/resolve`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ outcome: "handled" }),
          },
        );
        expect(response.status).toBe(400);
      });
    },
  );

  integrationTest(
    "two concurrent resolve requests on the same case: exactly one succeeds, the other gets a controlled 409",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const contactId = await insertContact(companyId);
        await openCaseFor(companyId, contactId);

        const body = JSON.stringify({ outcome: "no_reply_needed" });
        const [first, second] = await Promise.all([
          app.request(`/api/conversations/${contactId}/resolve`, {
            method: "POST",
            headers: ownerHeaders,
            body,
          }),
          app.request(`/api/conversations/${contactId}/resolve`, {
            method: "POST",
            headers: ownerHeaders,
            body,
          }),
        ]);

        const statuses = [first.status, second.status].sort();
        expect(statuses).toEqual([200, 409]);
      });
    },
  );

  integrationTest(
    "GET /state reports hasCaseHistory correctly, and POST /open vs /reopen behave accordingly",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const contactId = await insertContact(companyId);

        // Brand-new contact: no case history at all.
        const freshState = await app.request(
          `/api/conversations/${contactId}/state`,
          { headers: ownerHeaders },
        );
        expect(freshState.status).toBe(200);
        const freshBody = (await freshState.json()) as {
          data: { hasCaseHistory: boolean };
        };
        expect(freshBody.data.hasCaseHistory).toBe(false);

        // Manual Open with no history requires no reason and succeeds.
        const openResponse = await app.request(
          `/api/conversations/${contactId}/open`,
          { method: "POST", headers: ownerHeaders, body: "{}" },
        );
        expect(openResponse.status).toBe(200);

        const tenantDb = getTenantConnection(companyId);
        const active = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contactId)
          .where("status", "=", "open")
          .executeTakeFirstOrThrow();
        expect(active.open_source).toBe("manual");
        expect(active.reopened_from_case_id).toBeNull();

        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: crypto.randomUUID(),
        });

        // Now there IS case history - Reopen requires a reason.
        const historyState = await app.request(
          `/api/conversations/${contactId}/state`,
          { headers: ownerHeaders },
        );
        const historyBody = (await historyState.json()) as {
          data: { hasCaseHistory: boolean };
        };
        expect(historyBody.data.hasCaseHistory).toBe(true);

        const reopenNoReason = await app.request(
          `/api/conversations/${contactId}/reopen`,
          { method: "POST", headers: ownerHeaders, body: "{}" },
        );
        expect(reopenNoReason.status).toBe(400);

        const reopenWithReason = await app.request(
          `/api/conversations/${contactId}/reopen`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ reason: "Customer followed up again" }),
          },
        );
        expect(reopenWithReason.status).toBe(200);
      });
    },
  );

  integrationTest(
    "cross-endpoint misuse: /open on a contact with prior history and /reopen on one with none both 409, never silently doing the other action",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const contactId = await insertContact(companyId);

        // No case history at all yet - /reopen must 409, not silently open.
        const reopenOnFresh = await app.request(
          `/api/conversations/${contactId}/reopen`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ reason: "irrelevant" }),
          },
        );
        expect(reopenOnFresh.status).toBe(409);
        const stillNoHistory = await app.request(
          `/api/conversations/${contactId}/state`,
          { headers: ownerHeaders },
        );
        const stillNoHistoryBody = (await stillNoHistory.json()) as {
          data: { hasCaseHistory: boolean; status: string };
        };
        expect(stillNoHistoryBody.data.hasCaseHistory).toBe(false);
        expect(stillNoHistoryBody.data.status).toBe("resolved");

        // /open correctly succeeds on this genuinely-fresh contact.
        const openResponse = await app.request(
          `/api/conversations/${contactId}/open`,
          { method: "POST", headers: ownerHeaders, body: "{}" },
        );
        expect(openResponse.status).toBe(200);

        await resolveActiveCase(getTenantConnection(companyId), contactId, {
          outcome: "no_reply_needed",
          resolvedBy: crypto.randomUUID(),
        });

        // Now there IS history - /open must 409, not silently reopen.
        const openOnHistory = await app.request(
          `/api/conversations/${contactId}/open`,
          { method: "POST", headers: ownerHeaders, body: "{}" },
        );
        expect(openOnHistory.status).toBe(409);
        const stillResolved = await app.request(
          `/api/conversations/${contactId}/state`,
          { headers: ownerHeaders },
        );
        const stillResolvedBody = (await stillResolved.json()) as {
          data: { hasCaseHistory: boolean; status: string };
        };
        expect(stillResolvedBody.data.hasCaseHistory).toBe(true);
        expect(stillResolvedBody.data.status).toBe("resolved");

        // /reopen correctly succeeds now.
        const reopenResponse = await app.request(
          `/api/conversations/${contactId}/reopen`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ reason: "Customer followed up" }),
          },
        );
        expect(reopenResponse.status).toBe(200);
      });
    },
  );

  integrationTest(
    "denies reopen to a member without can_send_messages",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders, createMember }) => {
        const contactId = await insertContact(companyId);
        await app.request(`/api/conversations/${contactId}/open`, {
          method: "POST",
          headers: ownerHeaders,
          body: "{}",
        });
        await resolveActiveCase(getTenantConnection(companyId), contactId, {
          outcome: "no_reply_needed",
          resolvedBy: crypto.randomUUID(),
        });

        const { headers } = await createMember({
          can_send_messages: false,
          can_view_all_chats: true,
        });
        const reopenResponse = await app.request(
          `/api/conversations/${contactId}/reopen`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ reason: "irrelevant" }),
          },
        );
        expect(reopenResponse.status).toBe(403);
      });
    },
  );

  integrationTest(
    "a manual Pending transition is recorded in the audit log, so it isn't lost once a later inbound flips the case back to open",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders, ownerId }) => {
        const contactId = await insertContact(companyId);
        await openCaseFor(companyId, contactId);

        const pendingResponse = await app.request(
          `/api/conversations/${contactId}/pending`,
          { method: "POST", headers: ownerHeaders },
        );
        expect(pendingResponse.status).toBe(200);

        const tenantDb = getTenantConnection(companyId);
        const auditRow = await tenantDb
          .selectFrom("audit_logs")
          .selectAll()
          .where("action", "=", "conversation.pending")
          .where("entity_id", "=", contactId)
          .executeTakeFirst();
        expect(auditRow).toBeDefined();
        expect(auditRow?.user_id).toBe(ownerId);
      });
    },
  );

  integrationTest(
    "POST /resume flips a pending case back to open (same case) and is audited; it 409s when there's nothing pending to resume",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders, ownerId }) => {
        const contactId = await insertContact(companyId);
        const opened = await openCaseFor(companyId, contactId);

        const pendingResponse = await app.request(
          `/api/conversations/${contactId}/pending`,
          { method: "POST", headers: ownerHeaders },
        );
        expect(pendingResponse.status).toBe(200);

        const resumeResponse = await app.request(
          `/api/conversations/${contactId}/resume`,
          { method: "POST", headers: ownerHeaders },
        );
        expect(resumeResponse.status).toBe(200);
        const resumeBody = (await resumeResponse.json()) as {
          data: { id: string; status: string };
        };
        expect(resumeBody.data.id).toBe(opened!.case.id);
        expect(resumeBody.data.status).toBe("open");

        const tenantDb = getTenantConnection(companyId);
        const auditRow = await tenantDb
          .selectFrom("audit_logs")
          .selectAll()
          .where("action", "=", "conversation.resumed")
          .where("entity_id", "=", contactId)
          .executeTakeFirst();
        expect(auditRow).toBeDefined();
        expect(auditRow?.user_id).toBe(ownerId);

        // No active case at all - resuming again after resolving 409s.
        await resolveActiveCase(tenantDb, contactId, {
          outcome: "no_reply_needed",
          resolvedBy: ownerId,
        });
        const resumeAfterResolve = await app.request(
          `/api/conversations/${contactId}/resume`,
          { method: "POST", headers: ownerHeaders },
        );
        expect(resumeAfterResolve.status).toBe(409);
      });
    },
  );

  integrationTest(
    "a contact assigned to another team member 403s every lifecycle mutation for a can_view_all_chats/can_send_messages user who isn't the assignee, even though they CAN see it - the current assignee still succeeds",
    async () => {
      await withTenantAndUsers(
        async ({ companyId, ownerHeaders, ownerId, createMember }) => {
          const tenantDb = getTenantConnection(companyId);
          // view-all + send permission is exactly the combination that
          // bypasses `requireContactVisibility` - this proves that
          // visibility bypass is NOT the same as ownership, and cannot
          // substitute for it at the lifecycle-mutation layer.
          const { headers: otherHeaders } = await createMember({
            can_view_all_chats: true,
            can_send_messages: true,
          });

          // 1) resolve
          const resolveContactId = await insertContact(companyId);
          await assignContactToUser(
            tenantDb,
            resolveContactId,
            ownerId,
            ownerId,
          );
          await openCaseFor(companyId, resolveContactId);
          const resolveAsOther = await app.request(
            `/api/conversations/${resolveContactId}/resolve`,
            {
              method: "POST",
              headers: otherHeaders,
              body: JSON.stringify({ outcome: "no_reply_needed" }),
            },
          );
          expect(resolveAsOther.status).toBe(403);
          const resolveAsOwner = await app.request(
            `/api/conversations/${resolveContactId}/resolve`,
            {
              method: "POST",
              headers: ownerHeaders,
              body: JSON.stringify({ outcome: "no_reply_needed" }),
            },
          );
          expect(resolveAsOwner.status).toBe(200);

          // 2) pending
          const pendingContactId = await insertContact(companyId);
          await assignContactToUser(
            tenantDb,
            pendingContactId,
            ownerId,
            ownerId,
          );
          await openCaseFor(companyId, pendingContactId);
          const pendingAsOther = await app.request(
            `/api/conversations/${pendingContactId}/pending`,
            { method: "POST", headers: otherHeaders },
          );
          expect(pendingAsOther.status).toBe(403);
          const pendingAsOwner = await app.request(
            `/api/conversations/${pendingContactId}/pending`,
            { method: "POST", headers: ownerHeaders },
          );
          expect(pendingAsOwner.status).toBe(200);

          // 3) resume - set up pending state directly (not via the route,
          // so this scenario isolates /resume itself).
          const resumeContactId = await insertContact(companyId);
          await assignContactToUser(
            tenantDb,
            resumeContactId,
            ownerId,
            ownerId,
          );
          await openCaseFor(companyId, resumeContactId);
          await setActiveCasePending(tenantDb, resumeContactId, ownerId);
          const resumeAsOther = await app.request(
            `/api/conversations/${resumeContactId}/resume`,
            { method: "POST", headers: otherHeaders },
          );
          expect(resumeAsOther.status).toBe(403);
          const resumeAsOwner = await app.request(
            `/api/conversations/${resumeContactId}/resume`,
            { method: "POST", headers: ownerHeaders },
          );
          expect(resumeAsOwner.status).toBe(200);

          // 4) open - assigned to owner, no case history yet.
          const openContactId = await insertContact(companyId);
          await assignContactToUser(tenantDb, openContactId, ownerId, ownerId);
          const openAsOther = await app.request(
            `/api/conversations/${openContactId}/open`,
            { method: "POST", headers: otherHeaders, body: "{}" },
          );
          expect(openAsOther.status).toBe(403);
          const openAsOwner = await app.request(
            `/api/conversations/${openContactId}/open`,
            { method: "POST", headers: ownerHeaders, body: "{}" },
          );
          expect(openAsOwner.status).toBe(200);

          // 5) reopen - assigned to owner, WITH prior (resolved) case history.
          const reopenContactId = await insertContact(companyId);
          await assignContactToUser(
            tenantDb,
            reopenContactId,
            ownerId,
            ownerId,
          );
          await openCaseFor(companyId, reopenContactId);
          await resolveActiveCase(tenantDb, reopenContactId, {
            outcome: "no_reply_needed",
            resolvedBy: ownerId,
          });
          const reopenAsOther = await app.request(
            `/api/conversations/${reopenContactId}/reopen`,
            {
              method: "POST",
              headers: otherHeaders,
              body: JSON.stringify({ reason: "irrelevant" }),
            },
          );
          expect(reopenAsOther.status).toBe(403);
          const reopenAsOwner = await app.request(
            `/api/conversations/${reopenContactId}/reopen`,
            {
              method: "POST",
              headers: ownerHeaders,
              body: JSON.stringify({ reason: "Customer followed up" }),
            },
          );
          expect(reopenAsOwner.status).toBe(200);
        },
      );
    },
  );

  integrationTest(
    "a resolve racing a concurrent takeover is fully serialized by the SAME contact-row lock the assignment route takes - never a resolve that silently succeeds for an assignee a concurrent takeover already displaced",
    async () => {
      await withTenantAndUsers(
        async ({ companyId, ownerHeaders, ownerId, createMember }) => {
          const tenantDb = getTenantConnection(companyId);
          const { headers: otherHeaders, userId: otherId } = await createMember({
            can_view_all_chats: true,
            can_send_messages: true,
            can_assign_contacts: true,
          });

          const contactId = await insertContact(companyId);
          await assignContactToUser(tenantDb, contactId, ownerId, ownerId);
          await openCaseFor(companyId, contactId);

          // Owner (the current assignee) resolves while "other" concurrently
          // takes the contact over. Advisory locks never conflict with the
          // `SELECT ... FOR UPDATE` the assignment route takes on `contacts`
          // - only a lock on the SAME row/primitive can force these two
          // transactions to serialize instead of racing each other's reads.
          const [resolveResponse, takeoverResponse] = await Promise.all([
            app.request(`/api/conversations/${contactId}/resolve`, {
              method: "POST",
              headers: ownerHeaders,
              body: JSON.stringify({ outcome: "no_reply_needed" }),
            }),
            app.request(`/api/contacts/${contactId}/assign`, {
              method: "POST",
              headers: otherHeaders,
              body: "{}",
            }),
          ]);

          // The takeover itself never depends on case/lifecycle state, so it
          // always succeeds regardless of ordering - it's the resolve whose
          // outcome depends on which transaction won the row-lock race.
          expect(takeoverResponse.status).toBe(201);
          expect([200, 403]).toContain(resolveResponse.status);

          const finalAssignment = await tenantDb
            .selectFrom("contact_assignments")
            .select("assigned_to")
            .where("contact_id", "=", contactId)
            .where("unassigned_at", "is", null)
            .executeTakeFirstOrThrow();
          // The takeover always wins the assignment table regardless of
          // ordering (assign has no ownership precondition of its own) -
          // this asserts the row lock didn't leave a torn/duplicate
          // assignment behind, not which transaction ran first.
          expect(finalAssignment.assigned_to).toBe(otherId);

          const finalCase = await tenantDb
            .selectFrom("conversation_cases")
            .selectAll()
            .where("contact_id", "=", contactId)
            .orderBy("created_at", "desc")
            .limit(1)
            .executeTakeFirstOrThrow();

          if (resolveResponse.status === 200) {
            // Resolve's lock acquisition (and thus its assignment read) beat
            // the takeover's - it was still genuinely owner's contact at
            // that instant, so a resolve by owner is the correct outcome.
            expect(finalCase.status).toBe("resolved");
            expect(finalCase.resolved_by).toBe(ownerId);
          } else {
            // The takeover's lock acquisition beat resolve's - by the time
            // resolve's transaction could even read the assignment, it was
            // already "other"'s, so the controlled 403 (never a silent
            // resolve on someone else's now-current contact) is correct,
            // and the case must be untouched by the failed attempt.
            expect(finalCase.status).not.toBe("resolved");
            expect(finalCase.resolved_by).toBeNull();
          }
        },
      );
    },
  );
});
