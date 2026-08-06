import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  getMembershipCacheStats,
  invalidateCompanyMembership,
  resetMembershipCache,
  setMembershipCacheTtlMs,
} from "./company-membership.service.js";
import { resolveContactViewerIds } from "./message-broadcast.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface Fixture {
  companyId: string;
  ownerId: string;
  contactId: string;
}

async function withWorkspace(run: (fixture: Fixture) => Promise<void>) {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: `load-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Fan-out load test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        phone_number: "15550004444",
        status: "connected",
      })
      .execute();
    await tenantDb
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid: "15551235555@s.whatsapp.net",
        phone_number: "15551235555",
      })
      .execute();
    await run({ companyId, ownerId, contactId });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

/**
 * Typing and presence used to cost a `company_members` read per event. These
 * measure the actual reduction against PostgreSQL's own statistics, and pin
 * that assignments were NOT also cached - caching those would delay a
 * reassignment taking effect.
 */
describe("realtime fan-out query load", () => {
  beforeEach(() => {
    resetMembershipCache();
  });
  afterEach(() => {
    resetMembershipCache();
  });

  integrationTest(
    "a burst of events reads company_members once, not once per event",
    async () => {
      await withWorkspace(async (fixture) => {
        // Pinned rather than inherited from configuration: 25 sequential round
        // trips against a loaded CI box can outlast the 5s default TTL, which
        // would turn an exact assertion into an intermittent failure.
        setMembershipCacheTtlMs(60_000);
        // Counted from the cache's own miss counter rather than pg_stat:
        // PostgreSQL collects statistics asynchronously, which made the same
        // assertion fuzzy enough to need slack. This is exact.
        const before = getMembershipCacheStats();
        for (let i = 0; i < 25; i++) {
          await resolveContactViewerIds(fixture.companyId, fixture.contactId);
        }
        const after = getMembershipCacheStats();

        // Deltas, not absolutes: the counters are process-global, so an
        // absolute assertion would depend on whatever ran before this test.
        expect(after.misses - before.misses).toBe(1);
        expect(after.hits - before.hits).toBe(24);
      });
    },
  );

  integrationTest(
    "assignments are still read live on every single event",
    async () => {
      await withWorkspace(async (fixture) => {
        const tenantDb = getTenantConnection(fixture.companyId);
        const otherUserId = crypto.randomUUID();
        await db
          .insertInto("users")
          .values({
            id: otherUserId,
            email: `live-${otherUserId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("company_members")
          .values({
            company_id: fixture.companyId,
            user_id: otherUserId,
            role: "member",
          })
          .execute();
        invalidateCompanyMembership(fixture.companyId);

        try {
          expect(
            await resolveContactViewerIds(fixture.companyId, fixture.contactId),
          ).toEqual([fixture.ownerId]);

          // Assign WITHOUT invalidating anything: if assignments were cached
          // this would not be observed until a TTL lapsed.
          await tenantDb
            .insertInto("contact_assignments")
            .values({
              contact_id: fixture.contactId,
              assigned_to: otherUserId,
              assigned_by: fixture.ownerId,
            })
            .execute();

          expect(
            (
              await resolveContactViewerIds(
                fixture.companyId,
                fixture.contactId,
              )
            ).sort(),
          ).toEqual([fixture.ownerId, otherUserId].sort());
        } finally {
          await db
            .deleteFrom("company_members")
            .where("user_id", "=", otherUserId)
            .execute();
          await db.deleteFrom("users").where("id", "=", otherUserId).execute();
        }
      });
    },
  );

  integrationTest("disabling the cache restores a read per event", () => {
    // Proves the reduction comes from the cache and can be turned off, without
    // mutating the shared `env` object - that would leak into other test files.
    return withWorkspace(async (fixture) => {
      setMembershipCacheTtlMs(0);
      try {
        const before = getMembershipCacheStats();
        for (let i = 0; i < 10; i++) {
          await resolveContactViewerIds(fixture.companyId, fixture.contactId);
        }
        const after = getMembershipCacheStats();
        expect(after.misses - before.misses).toBe(10);
        expect(after.hits - before.hits).toBe(0);
      } finally {
        // resetMembershipCache in afterEach restores the configured TTL.
        setMembershipCacheTtlMs(1);
      }
    });
  });
});
