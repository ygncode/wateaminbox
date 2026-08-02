import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  broadcastAutoAssignment,
  broadcastContactAssignmentEvent,
} from "./assignment-broadcast.service.js";
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
        email: `broadcast-owner-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Assignment broadcast test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await createTenantSchema(companyId);
    await run(companyId);
  } finally {
    await clearTenantConnection(companyId);
    await sql
      .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      .execute(db);
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

describe("assignment-broadcast.service", () => {
  integrationTest(
    "broadcastAutoAssignment resolves the contact's display name and never throws even when realtime publish fails (no Centrifugo in test env)",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: `${crypto.randomUUID()}@s.whatsapp.net`,
            phone_number: crypto.randomUUID().slice(0, 10),
            push_name: "Auto-claim broadcast contact",
          })
          .returning("id")
          .execute();

        const userId = crypto.randomUUID();
        await expect(
          broadcastAutoAssignment(tenantDb, companyId, contact.id, userId),
        ).resolves.toBeUndefined();
      });
    },
  );

  integrationTest(
    "broadcastAutoAssignment falls back to 'Unknown Contact' for a contact id that no longer exists",
    async () => {
      await withTenant(async (companyId) => {
        const tenantDb = getTenantConnection(companyId);
        await expect(
          broadcastAutoAssignment(
            tenantDb,
            companyId,
            crypto.randomUUID(),
            crypto.randomUUID(),
          ),
        ).resolves.toBeUndefined();
      });
    },
  );

  integrationTest(
    "broadcastContactAssignmentEvent never throws even when realtime publish fails",
    async () => {
      await withTenant(async (companyId) => {
        await expect(
          broadcastContactAssignmentEvent(companyId, {
            event: "unassigned",
            contactId: crypto.randomUUID(),
            contactName: "Test Contact",
            previousAssignee: crypto.randomUUID(),
            newAssignee: null,
            assignedBy: crypto.randomUUID(),
          }),
        ).resolves.toBeUndefined();
      });
    },
  );
});
