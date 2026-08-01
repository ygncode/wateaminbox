import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import {
  clearTenantConnection,
  createTenantSchema,
  dropTenantSchema,
  getTenantConnection,
} from "../tenant.service.js";
import { getTeamResponseTimeStats } from "./response-time.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const MINUTE = 60 * 1000;

describe("getTeamResponseTimeStats attribution", () => {
  integrationTest(
    "resolves each episode's true first responder once - no double-count or misattribution across members",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = `test_${companyId.replaceAll("-", "_")}`;
      const memberA = crypto.randomUUID();
      const memberB = crypto.randomUUID();
      const memberC = crypto.randomUUID(); // never replies - must be left-filled with zeros

      try {
        await db
          .insertInto("users")
          .values([
            {
              id: memberA,
              email: `a-${memberA}@example.com`,
              password_hash: "x",
            },
            {
              id: memberB,
              email: `b-${memberB}@example.com`,
              password_hash: "x",
            },
            {
              id: memberC,
              email: `c-${memberC}@example.com`,
              password_hash: "x",
            },
          ])
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Team attribution test",
            schema_name: schemaName,
            status: "active",
          })
          .execute();
        await db
          .insertInto("company_members")
          .values([
            { company_id: companyId, user_id: memberA, role: "owner" },
            { company_id: companyId, user_id: memberB, role: "member" },
            { company_id: companyId, user_id: memberC, role: "member" },
          ])
          .execute();
        await db
          .insertInto("sla_policies")
          .values({
            company_id: companyId,
            target_minutes: 60,
            timezone: "UTC",
            weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
            exceptions: JSON.stringify([]),
            effective_from: new Date("1970-01-01T00:00:00Z"),
            created_by: memberA,
          })
          .execute();

        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: `${crypto.randomUUID()}@s.whatsapp.net`,
            phone_number: crypto.randomUUID().slice(0, 10),
            push_name: "Attribution contact",
          })
          .returning("id")
          .execute();

        const base = new Date("2026-01-01T00:00:00Z");

        // Episode 1: inbound at t0, answered by member A 5 minutes later.
        const episode1Inbound = base;
        const aReply = new Date(base.getTime() + 5 * MINUTE);
        await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            message_id: crypto.randomUUID(),
            from_me: false,
            message_type: "text",
            content: "hello",
            timestamp: episode1Inbound,
          })
          .execute();
        await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            message_id: crypto.randomUUID(),
            from_me: true,
            sent_by_user_id: memberA,
            message_type: "text",
            content: "reply from A",
            timestamp: aReply,
          })
          .execute();

        // Episode 2: a new inbound message an hour later (previous message was
        // outbound, so this starts a fresh episode), answered by member B 5
        // minutes after that. Under a naive per-member-filtered query, B's
        // reply here (which also lands after episode 1's inbound time) could
        // be mistakenly picked up as an "answer" to episode 1 too.
        const episode2Inbound = new Date(base.getTime() + 60 * MINUTE);
        const bReply = new Date(base.getTime() + 65 * MINUTE);
        await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            message_id: crypto.randomUUID(),
            from_me: false,
            message_type: "text",
            content: "another question",
            timestamp: episode2Inbound,
          })
          .execute();
        await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            message_id: crypto.randomUUID(),
            from_me: true,
            sent_by_user_id: memberB,
            message_type: "text",
            content: "reply from B",
            timestamp: bReply,
          })
          .execute();

        const start = new Date(base.getTime() - 60 * MINUTE);
        const end = new Date(base.getTime() + 120 * MINUTE);

        const stats = await getTeamResponseTimeStats(companyId, start, end);

        const byUser = new Map(stats.map((s) => [s.userId, s]));

        expect(byUser.get(memberA)?.totalResponses).toBe(1);
        expect(byUser.get(memberA)?.averageResponseTimeMinutes).toBeCloseTo(
          5,
          5,
        );

        expect(byUser.get(memberB)?.totalResponses).toBe(1);
        expect(byUser.get(memberB)?.averageResponseTimeMinutes).toBeCloseTo(
          5,
          5,
        );

        // Left-filled with zeros, not omitted.
        expect(byUser.get(memberC)?.totalResponses).toBe(0);
        expect(byUser.get(memberC)?.averageResponseTimeMinutes).toBe(0);

        // Exactly 2 episodes total were answered - never 3 or more from
        // misattribution/double-counting the same underlying reply.
        const totalAttributed = stats.reduce(
          (sum, s) => sum + s.totalResponses,
          0,
        );
        expect(totalAttributed).toBe(2);
      } finally {
        await clearTenantConnection(companyId);
        await dropTenantSchema(companyId).catch(() => undefined);
        await db
          .deleteFrom("sla_policies")
          .where("company_id", "=", companyId)
          .execute();
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db
          .deleteFrom("users")
          .where("id", "in", [memberA, memberB, memberC])
          .execute();
      }
    },
  );
});
