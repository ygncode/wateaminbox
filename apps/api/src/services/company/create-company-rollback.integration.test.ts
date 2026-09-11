import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { getUserCompanies } from "./members.js";
import { createCompany } from "./core.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  tenantSchemaExists,
} from "../tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function createOwner() {
  const ownerId = crypto.randomUUID();
  await db
    .insertInto("users")
    .values({
      id: ownerId,
      email: `owner-${ownerId}@example.com`,
      password_hash: "not-used-by-these-tests",
      email_verified_at: new Date(),
    })
    .execute();
  return ownerId;
}

async function cleanup(companyId: string, ownerId: string) {
  const schemaName = getSchemaName(companyId);
  await clearTenantConnection(companyId);
  await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
  await db
    .deleteFrom("company_members")
    .where("company_id", "=", companyId)
    .execute();
  await db
    .deleteFrom("company_stats")
    .where("company_id", "=", companyId)
    .execute();
  await db.deleteFrom("companies").where("id", "=", companyId).execute();
  await db.deleteFrom("users").where("id", "=", ownerId).execute();
}

async function companyStatus(companyId: string) {
  const row = await db
    .selectFrom("companies")
    .select(["status"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  return row?.status;
}

describe("createCompany tenant provisioning", () => {
  integrationTest(
    "leaves no active workspace behind when provisioning fails",
    async () => {
      const ownerId = await createOwner();
      let companyId: string | null = null;

      try {
        // Provisioning is injected because a real transient failure is what the
        // rollback exists for; the failing step receives the workspace id the
        // committed row was created with.
        await expect(
          createCompany({ name: "Never provisioned" }, ownerId, async (id) => {
            companyId = id;
            throw new Error("setup_tenant_schema failed");
          }),
        ).rejects.toThrow("setup_tenant_schema failed");

        expect(companyId).not.toBeNull();
        // The row used to stay `active`, so the workspace appeared in the
        // user's list and every tenant-scoped request 500'd on a schema that
        // was never created.
        expect(await companyStatus(companyId!)).toBe("deleted");
        expect(await tenantSchemaExists(companyId!)).toBe(false);
        expect(await getUserCompanies(ownerId)).toEqual([]);
      } finally {
        if (companyId) await cleanup(companyId, ownerId);
        else await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );

  integrationTest(
    "drops a half-built tenant schema before hiding the workspace",
    async () => {
      const ownerId = await createOwner();
      let companyId: string | null = null;

      try {
        await expect(
          createCompany({ name: "Half provisioned" }, ownerId, async (id) => {
            companyId = id;
            // Model a failure in the second of createTenantSchema's two steps,
            // after `setup_tenant_schema` has already created the schema.
            await createTenantSchema(id);
            throw new Error("reconcileTenantSchema failed");
          }),
        ).rejects.toThrow("reconcileTenantSchema failed");

        expect(await companyStatus(companyId!)).toBe("deleted");
        expect(await tenantSchemaExists(companyId!)).toBe(false);
        expect(await getUserCompanies(ownerId)).toEqual([]);
      } finally {
        if (companyId) await cleanup(companyId, ownerId);
        else await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );

  integrationTest(
    "still returns an active workspace when provisioning succeeds",
    async () => {
      const ownerId = await createOwner();
      let companyId: string | null = null;

      try {
        const company = await createCompany({ name: "Provisioned" }, ownerId);
        companyId = company.id;

        expect(company.status).toBe("active");
        expect(await tenantSchemaExists(company.id)).toBe(true);
        const workspaces = await getUserCompanies(ownerId);
        expect(workspaces.map((workspace) => workspace.id)).toEqual([
          company.id,
        ]);
        expect(workspaces[0]?.role).toBe("owner");
      } finally {
        if (companyId) await cleanup(companyId, ownerId);
      }
    },
  );
});
