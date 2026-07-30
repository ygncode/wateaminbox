import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { getDateRange } from "@wateaminbox/shared";
import { sql } from "kysely";
import {
  getContactStats,
  getDashboardStats,
  getEngagementMetrics,
  getEngagementTrend,
  getHourlyMessageStats,
  getMessageStats,
  getMessageTypeStats,
  getNewContactsTrend,
  getResponseTimeStats,
  getResponseTimeTrend,
  getSlaBreaches,
  getTeamActivityStats,
  getTeamResponseTimeStats,
} from "./analytics/index.js";
import { getResolutionStats } from "./conversation-state.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("dashboard analytics", () => {
  integrationTest(
    "queries a tenant schema and supports unread plus resolution state",
    async () => {
      const userId = crypto.randomUUID();
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const { start, end } = getDateRange("30d");

      try {
        await db
          .insertInto("users")
          .values({
            id: userId,
            email: `analytics-${userId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Analytics test",
            schema_name: schemaName,
            status: "active",
          })
          .execute();
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: userId, role: "owner" })
          .execute();
        await createTenantSchema(companyId);

        const tenantDb = getTenantConnection(companyId);
        const results = await Promise.all([
          getDashboardStats(companyId),
          getMessageStats(companyId, start.toDate(), end.toDate()),
          getContactStats(companyId),
          getTeamActivityStats(companyId),
          getMessageTypeStats(companyId, start.toDate(), end.toDate()),
          getHourlyMessageStats(companyId, 30),
          getNewContactsTrend(companyId, start.toDate(), end.toDate()),
          getEngagementMetrics(companyId, start.toDate(), end.toDate()),
          getEngagementTrend(companyId, start.toDate(), end.toDate()),
          getResponseTimeStats(companyId, start.toDate(), end.toDate(), 60),
          getResponseTimeTrend(companyId, start.toDate(), end.toDate(), 60),
          getTeamResponseTimeStats(companyId, start.toDate(), end.toDate(), 60),
          getSlaBreaches(companyId, start.toDate(), end.toDate(), 60, 10),
          getResolutionStats(tenantDb),
        ]);

        expect(results[0]).toMatchObject({
          totalMessages: 0,
          totalContacts: 0,
          activeUsers: 1,
          unreadConversations: 0,
        });
        expect(results[1]).toHaveLength(30);
        expect(results[5]).toHaveLength(24);
        expect(results[6]).toHaveLength(30);
        expect(results[8]).toHaveLength(30);
        expect(results[10]).toHaveLength(30);
        expect(results[13]).toMatchObject({
          totalConversations: 0,
          resolutionRate: 0,
        });
      } finally {
        await clearTenantConnection(companyId);
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .execute(db);
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .execute();
        await db
          .deleteFrom("company_stats")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", userId).execute();
      }
    },
    30_000,
  );
});
