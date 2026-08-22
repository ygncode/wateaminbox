import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import {
  ContactAssignedToOtherError,
  ContactBlockedError,
  NoActiveCaseError,
} from "../lib/errors.js";
import { assignContactToUser } from "./contact.service.js";
import { openOrReopenCaseForInboundMessage } from "./conversation-case.service.js";
import { requireSendAccess } from "./send-access.service.js";
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
        email: `send-access-owner-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Send access test",
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

async function insertContactWithActiveCase(companyId: string) {
  const tenantDb = getTenantConnection(companyId);
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      jid: `${crypto.randomUUID()}@s.whatsapp.net`,
      phone_number: crypto.randomUUID().slice(0, 10),
      push_name: "Send access contact",
    })
    .returning("id")
    .execute();

  await tenantDb.transaction().execute(async (trx) => {
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
        timestamp: new Date(),
      })
      .execute();
    return openOrReopenCaseForInboundMessage(
      trx,
      companyId,
      { id: contact.id, isGroup: false },
      { id: messageId, timestamp: new Date() },
    );
  });

  return contact.id;
}

describe("requireSendAccess", () => {
  integrationTest(
    "allows an unassigned contact and self-assigned contact, blocks a contact assigned to someone else",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const userA = crypto.randomUUID();
        const userB = crypto.randomUUID();

        const unassignedContactId = await insertContactWithActiveCase(companyId);
        const unassignedResult = await tenantDb
          .transaction()
          .execute((trx) => requireSendAccess(trx, unassignedContactId, userA));
        expect(unassignedResult.caseId).toBeTruthy();
        // Unassigned contacts are atomically claimed as part of the guard.
        expect(unassignedResult.autoAssigned).toBe(true);
        const claimedAssignment = await tenantDb
          .selectFrom("contact_assignments")
          .select("assigned_to")
          .where("contact_id", "=", unassignedContactId)
          .where("unassigned_at", "is", null)
          .executeTakeFirstOrThrow();
        expect(claimedAssignment.assigned_to).toBe(userA);

        const selfAssignedContactId = await insertContactWithActiveCase(companyId);
        await assignContactToUser(
          tenantDb,
          selfAssignedContactId,
          userA,
          userA,
        );
        const selfResult = await tenantDb
          .transaction()
          .execute((trx) => requireSendAccess(trx, selfAssignedContactId, userA));
        expect(selfResult.caseId).toBeTruthy();
        // Already self-assigned - no auto-claim needed.
        expect(selfResult.autoAssigned).toBe(false);

        const otherAssignedContactId = await insertContactWithActiveCase(companyId);
        await assignContactToUser(
          tenantDb,
          otherAssignedContactId,
          userB,
          userB,
        );
        await expect(
          tenantDb
            .transaction()
            .execute((trx) =>
              requireSendAccess(trx, otherAssignedContactId, userA),
            ),
        ).rejects.toBeInstanceOf(ContactAssignedToOtherError);

        // After userA takes over (reassigns to self), the same user can
        // now send.
        await assignContactToUser(
          tenantDb,
          otherAssignedContactId,
          userA,
          userA,
        );
        const afterTakeover = await tenantDb
          .transaction()
          .execute((trx) =>
            requireSendAccess(trx, otherAssignedContactId, userA),
          );
        expect(afterTakeover.caseId).toBeTruthy();
      });
    },
  );

  integrationTest(
    "still enforces the active-case invariant even when assignment allows the send",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const userId = crypto.randomUUID();

        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: `${crypto.randomUUID()}@s.whatsapp.net`,
            phone_number: crypto.randomUUID().slice(0, 10),
            push_name: "No case contact",
          })
          .returning("id")
          .execute();

        await expect(
          tenantDb
            .transaction()
            .execute((trx) => requireSendAccess(trx, contact.id, userId)),
        ).rejects.toBeInstanceOf(NoActiveCaseError);
      });
    },
  );

  integrationTest(
    "rejects every outbound action into a blocked contact, claims no assignment on the way out, and allows it again once unblocked",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const userId = crypto.randomUUID();

        // Blocked, unassigned, and with a perfectly healthy active case -
        // so the ONLY thing that can reject this send is the block.
        const contactId = await insertContactWithActiveCase(companyId);
        await tenantDb
          .updateTable("contacts")
          .set({ is_blocked: true })
          .where("id", "=", contactId)
          .execute();

        await expect(
          tenantDb
            .transaction()
            .execute((trx) => requireSendAccess(trx, contactId, userId)),
        ).rejects.toBeInstanceOf(ContactBlockedError);

        // The block is checked BEFORE the unassigned auto-claim, so a
        // rejected send must not leave an assignment behind.
        const assignments = await tenantDb
          .selectFrom("contact_assignments")
          .selectAll()
          .where("contact_id", "=", contactId)
          .where("unassigned_at", "is", null)
          .execute();
        expect(assignments).toHaveLength(0);

        // Non-claiming callers (typing/react/scheduled dispatch) are
        // gated identically.
        await expect(
          tenantDb.transaction().execute((trx) =>
            requireSendAccess(trx, contactId, userId, {
              claimUnassigned: false,
            }),
          ),
        ).rejects.toBeInstanceOf(ContactBlockedError);

        await tenantDb
          .updateTable("contacts")
          .set({ is_blocked: false })
          .where("id", "=", contactId)
          .execute();

        const afterUnblock = await tenantDb
          .transaction()
          .execute((trx) => requireSendAccess(trx, contactId, userId));
        expect(afterUnblock.caseId).toBeTruthy();
        expect(afterUnblock.autoAssigned).toBe(true);
      });
    },
  );

  integrationTest(
    "the block gate outranks assignment: a self-assigned contact the acting user could otherwise send to is still rejected while blocked",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const userId = crypto.randomUUID();

        const contactId = await insertContactWithActiveCase(companyId);
        await assignContactToUser(tenantDb, contactId, userId, userId);
        await tenantDb
          .updateTable("contacts")
          .set({ is_blocked: true })
          .where("id", "=", contactId)
          .execute();

        await expect(
          tenantDb
            .transaction()
            .execute((trx) => requireSendAccess(trx, contactId, userId)),
        ).rejects.toBeInstanceOf(ContactBlockedError);
      });
    },
  );

  integrationTest(
    "requireSendAccess's own contact-row lock (SELECT ... FOR UPDATE) serializes two concurrent requireSendAccess calls against each other, agreeing with whatever the assignment settles to",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const userA = crypto.randomUUID();
        const userB = crypto.randomUUID();

        const contactId = await insertContactWithActiveCase(companyId);
        await assignContactToUser(tenantDb, contactId, userA, userA);

        // Both requireSendAccess calls take the SAME lock
        // (`SELECT ... FOR UPDATE` on `contacts`) that
        // `POST /contacts/:id/assign`'s takeover uses - racing two of them
        // here exercises that exact serialization primitive directly, and
        // the result must always agree with whichever assignee is
        // authoritative afterward.
        const [forA, forB] = await Promise.allSettled([
          tenantDb
            .transaction()
            .execute((trx) => requireSendAccess(trx, contactId, userA)),
          tenantDb
            .transaction()
            .execute((trx) => requireSendAccess(trx, contactId, userB)),
        ]);

        // userA is still the sole assignee throughout this race (neither
        // call reassigns anything) - so userA's send must always succeed,
        // and userB's must always be blocked, regardless of lock order.
        expect(forA.status).toBe("fulfilled");
        expect(forB.status).toBe("rejected");
        expect((forB as PromiseRejectedResult).reason).toBeInstanceOf(
          ContactAssignedToOtherError,
        );
      });
    },
  );

  integrationTest(
    "two different users racing the FIRST send into an unassigned contact: exactly one claims/succeeds, the other gets a controlled ContactAssignedToOtherError, and exactly one active assignment ever exists",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const userA = crypto.randomUUID();
        const userB = crypto.randomUUID();

        // Genuinely unassigned - neither user has claimed this contact yet.
        const contactId = await insertContactWithActiveCase(companyId);

        const [forA, forB] = await Promise.allSettled([
          tenantDb
            .transaction()
            .execute((trx) => requireSendAccess(trx, contactId, userA)),
          tenantDb
            .transaction()
            .execute((trx) => requireSendAccess(trx, contactId, userB)),
        ]);

        const fulfilled = [forA, forB].filter((r) => r.status === "fulfilled");
        const rejected = [forA, forB].filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
          ContactAssignedToOtherError,
        );
        expect(
          (fulfilled[0] as PromiseFulfilledResult<{ autoAssigned: boolean }>)
            .value.autoAssigned,
        ).toBe(true);

        // The DB-level UNIQUE(contact_id) WHERE unassigned_at IS NULL index
        // (see migration 061) is the final backstop - exactly one active
        // assignment row exists no matter how the application-level lock
        // race resolved.
        const activeAssignments = await tenantDb
          .selectFrom("contact_assignments")
          .selectAll()
          .where("contact_id", "=", contactId)
          .where("unassigned_at", "is", null)
          .execute();
        expect(activeAssignments).toHaveLength(1);
        const winner: string = activeAssignments[0].assigned_to;
        expect(winner === userA || winner === userB).toBe(true);
      });
    },
  );
});
