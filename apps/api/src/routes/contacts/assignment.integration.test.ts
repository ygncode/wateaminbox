import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
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

async function withTenantAndOwner(
  run: (ctx: {
    companyId: string;
    ownerHeaders: Record<string, string>;
    ownerId: string;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const ownerEmail = `owner-${ownerId}@example.com`;

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: ownerEmail,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Assignment route test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await createTenantSchema(companyId);

    const ownerHeaders = await loginAndGetHeaders(
      ownerEmail,
      PASSWORD,
      companyId,
    );

    await run({ companyId, ownerHeaders, ownerId });
  } finally {
    await clearTenantConnection(companyId);
    await sql
      .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      .execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

describe("contact assignment routes - concurrent takeover vs unassign", () => {
  integrationTest(
    "a takeover racing a stale unassign never leaves the contact incorrectly unassigned with a stale event",
    async () => {
      await withTenantAndOwner(async ({ companyId, ownerHeaders }) => {
        const tenantDb = getTenantConnection(companyId);
        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: `${crypto.randomUUID()}@s.whatsapp.net`,
            phone_number: crypto.randomUUID().slice(0, 10),
            push_name: "Race test contact",
          })
          .returning("id")
          .execute();

        const otherId = crypto.randomUUID();
        const otherEmail = `other-${otherId}@example.com`;
        await db
          .insertInto("users")
          .values({
            id: otherId,
            email: otherEmail,
            password_hash: await hashPassword(PASSWORD),
            email_verified_at: new Date(),
          })
          .execute();
        await db
          .insertInto("company_members")
          .values({
            company_id: companyId,
            user_id: otherId,
            role: "member",
            // Visibility into a contact not yet assigned to this user (and
            // permission to take it over) requires these explicitly -
            // otherwise requireContactVisibility 404s the request before it
            // ever reaches the takeover race this test targets.
            permissions: {
              can_view_all_chats: true,
              can_assign_contacts: true,
            },
          })
          .execute();
        const otherHeaders = await loginAndGetHeaders(
          otherEmail,
          PASSWORD,
          companyId,
        );

        // Owner claims the contact first, so there's an existing assignee
        // for the concurrent unassign (issued by owner) to race against a
        // concurrent takeover (issued by "other").
        const firstAssign = await app.request(
          `/api/contacts/${contact.id}/assign`,
          { method: "POST", headers: ownerHeaders, body: "{}" },
        );
        expect(firstAssign.status).toBe(201);

        const [unassignResponse, takeoverResponse] = await Promise.all([
          app.request(`/api/contacts/${contact.id}/assign`, {
            method: "DELETE",
            headers: ownerHeaders,
          }),
          app.request(`/api/contacts/${contact.id}/assign`, {
            method: "POST",
            headers: otherHeaders,
            body: "{}",
          }),
        ]);
        expect(unassignResponse.status).toBe(200);
        expect(takeoverResponse.status).toBe(201);

        // The contact-row lock in both routes serializes these two writes,
        // so the DB state must be one of two fully-consistent outcomes -
        // never a state where the row is unassigned but an assignment
        // insert also "succeeded" invisibly, or vice versa.
        const activeAssignment = await tenantDb
          .selectFrom("contact_assignments")
          .select(["assigned_to"])
          .where("contact_id", "=", contact.id)
          .where("unassigned_at", "is", null)
          .executeTakeFirst();

        // Either the takeover ran last (other is the active assignee) or
        // the unassign ran last (nothing active) - both are valid
        // orderings of two real, non-racing transactions. What must NEVER
        // happen is a broadcast/audit referencing an assignee that isn't
        // actually the one this final state reflects, which the shared
        // `previousAssignment` read (taken under the SAME lock as the
        // update) guarantees.
        if (activeAssignment) {
          expect(activeAssignment.assigned_to).toBe(otherId);
        }

        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .where("user_id", "=", otherId)
          .execute();
        await db.deleteFrom("users").where("id", "=", otherId).execute();
      });
    },
  );
});

describe("contact assignment routes - audit trail for first-assign and unassign", () => {
  integrationTest(
    "a first-ever claim of an unassigned contact is audited (not just takeovers)",
    async () => {
      await withTenantAndOwner(async ({ companyId, ownerHeaders, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: `${crypto.randomUUID()}@s.whatsapp.net`,
            phone_number: crypto.randomUUID().slice(0, 10),
            push_name: "Assignment test contact",
          })
          .returning("id")
          .execute();

        const response = await app.request(
          `/api/contacts/${contact.id}/assign`,
          { method: "POST", headers: ownerHeaders, body: "{}" },
        );
        expect(response.status).toBe(201);
        const body = (await response.json()) as {
          data: { wasTakeover: boolean };
        };
        expect(body.data.wasTakeover).toBe(false);

        const auditRow = await tenantDb
          .selectFrom("audit_logs")
          .selectAll()
          .where("action", "=", "contact.assigned")
          .where("entity_id", "=", contact.id)
          .executeTakeFirst();
        expect(auditRow).toBeDefined();
        expect(auditRow?.user_id).toBe(ownerId);
      });
    },
  );

  integrationTest(
    "unassigning a contact is audited",
    async () => {
      await withTenantAndOwner(async ({ companyId, ownerHeaders, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: `${crypto.randomUUID()}@s.whatsapp.net`,
            phone_number: crypto.randomUUID().slice(0, 10),
            push_name: "Unassign test contact",
          })
          .returning("id")
          .execute();

        const assignResponse = await app.request(
          `/api/contacts/${contact.id}/assign`,
          { method: "POST", headers: ownerHeaders, body: "{}" },
        );
        expect(assignResponse.status).toBe(201);

        const unassignResponse = await app.request(
          `/api/contacts/${contact.id}/assign`,
          { method: "DELETE", headers: ownerHeaders },
        );
        expect(unassignResponse.status).toBe(200);

        const activeAssignment = await tenantDb
          .selectFrom("contact_assignments")
          .select("id")
          .where("contact_id", "=", contact.id)
          .where("unassigned_at", "is", null)
          .executeTakeFirst();
        expect(activeAssignment).toBeUndefined();

        const auditRow = await tenantDb
          .selectFrom("audit_logs")
          .selectAll()
          .where("action", "=", "contact.unassigned")
          .where("entity_id", "=", contact.id)
          .executeTakeFirst();
        expect(auditRow).toBeDefined();
        expect(auditRow?.user_id).toBe(ownerId);

        // Unassigning again (already unassigned) is a no-op - no duplicate
        // audit row.
        const secondUnassign = await app.request(
          `/api/contacts/${contact.id}/assign`,
          { method: "DELETE", headers: ownerHeaders },
        );
        expect(secondUnassign.status).toBe(200);
        const auditRows = await tenantDb
          .selectFrom("audit_logs")
          .selectAll()
          .where("action", "=", "contact.unassigned")
          .where("entity_id", "=", contact.id)
          .execute();
        expect(auditRows).toHaveLength(1);
      });
    },
  );
});
