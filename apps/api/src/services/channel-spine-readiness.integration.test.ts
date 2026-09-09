import { describe, expect, test } from "bun:test";
import {
  db,
  reconcileChannelSpineConcurrentIndexes,
} from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { isChannelSpineTenantReady } from "./channel-spine-readiness.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function createWorkspace(): Promise<{
  companyId: string;
  schemaName: string;
  ownerId: string;
}> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  await db
    .insertInto("users")
    .values({
      id: ownerId,
      email: `spine-ready-${ownerId}@example.com`,
      password_hash: "test",
    })
    .execute();
  await db
    .insertInto("companies")
    .values({
      id: companyId,
      name: "Spine readiness test",
      schema_name: schemaName,
      status: "active",
    })
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
  return { companyId, schemaName, ownerId };
}

async function dropWorkspace(workspace: {
  companyId: string;
  schemaName: string;
  ownerId: string;
}): Promise<void> {
  await clearTenantConnection(workspace.companyId);
  await sql
    .raw(`DROP SCHEMA IF EXISTS "${workspace.schemaName}" CASCADE`)
    .execute(db);
  await db
    .deleteFrom("sla_policies")
    .where("company_id", "=", workspace.companyId)
    .execute();
  await db
    .deleteFrom("companies")
    .where("id", "=", workspace.companyId)
    .execute();
  await db.deleteFrom("users").where("id", "=", workspace.ownerId).execute();
}

describe("isChannelSpineTenantReady", () => {
  integrationTest(
    "turns ready once the reconciler has run, and never borrows another workspace's indexes",
    async () => {
      const ready = await createWorkspace();
      const bare = await createWorkspace();
      try {
        // Before the concurrent index runner, nothing may be enabled.
        expect(
          await isChannelSpineTenantReady(
            getTenantConnection(ready.companyId),
            ready.companyId,
          ),
        ).toBe(false);

        await reconcileChannelSpineConcurrentIndexes(db, ready.schemaName);
        expect(
          await isChannelSpineTenantReady(
            getTenantConnection(ready.companyId),
            ready.companyId,
          ),
        ).toBe(true);

        // The index names are identical in every tenant schema, so a lookup
        // that is not schema-scoped would report this second workspace ready
        // on the strength of the first one's indexes.
        expect(
          await isChannelSpineTenantReady(
            getTenantConnection(bare.companyId),
            bare.companyId,
          ),
        ).toBe(false);
      } finally {
        await dropWorkspace(bare);
        await dropWorkspace(ready);
      }
    },
    120_000,
  );
});
