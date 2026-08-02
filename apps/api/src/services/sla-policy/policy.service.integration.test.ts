import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { getResponseTimeStats } from "../analytics/response-time.js";
import { createCompany } from "../company/core.js";
import {
  clearTenantConnection,
  createTenantSchema,
  dropTenantSchema,
  getTenantConnection,
} from "../tenant.service.js";
import {
  createSlaPolicy,
  getCurrentSlaPolicy,
  listSlaPolicyHistory,
} from "./policy.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("SLA policy versioning", () => {
  integrationTest(
    "seeds a 60-minute/UTC/24-7 default policy on company creation",
    async () => {
      const ownerId = crypto.randomUUID();
      let companyId: string | undefined;
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `owner-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        const company = await createCompany(
          { name: "Policy seed test" },
          ownerId,
        );
        companyId = company.id;

        const current = await getCurrentSlaPolicy(companyId);
        expect(current.targetMinutes).toBe(60);
        expect(current.timezone).toBe("UTC");
        expect(current.weeklySchedule).toHaveLength(7);
        expect(current.weeklySchedule.every((d) => d.open)).toBe(true);
        expect(current.exceptions).toEqual([]);
        expect(current.createdBy).toBeNull();

        const history = await listSlaPolicyHistory(companyId);
        expect(history).toHaveLength(1);
      } finally {
        if (companyId) {
          await db
            .deleteFrom("sla_policies")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("company_members")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("companies")
            .where("id", "=", companyId)
            .execute();
        }
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );

  integrationTest(
    "creating a new policy version never mutates prior versions, and becomes current immediately",
    async () => {
      const ownerId = crypto.randomUUID();
      let companyId: string | undefined;
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `owner2-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        const company = await createCompany(
          { name: "Policy version test" },
          ownerId,
        );
        companyId = company.id;

        const original = await getCurrentSlaPolicy(companyId);

        const updated = await createSlaPolicy(
          companyId,
          {
            targetMinutes: 30,
            directResolutionTargetMinutes: 480,
            groupResponseTargetMinutes: 120,
            groupResolutionTargetMinutes: 960,
            timezone: "America/New_York",
            weeklySchedule: [
              { weekday: 0, open: false, intervals: [] },
              {
                weekday: 1,
                open: true,
                intervals: [{ start: "09:00", end: "17:00" }],
              },
              {
                weekday: 2,
                open: true,
                intervals: [{ start: "09:00", end: "17:00" }],
              },
              {
                weekday: 3,
                open: true,
                intervals: [{ start: "09:00", end: "17:00" }],
              },
              {
                weekday: 4,
                open: true,
                intervals: [{ start: "09:00", end: "17:00" }],
              },
              {
                weekday: 5,
                open: true,
                intervals: [{ start: "09:00", end: "17:00" }],
              },
              { weekday: 6, open: false, intervals: [] },
            ],
            exceptions: [
              { date: "2026-12-25", closed: true, label: "Christmas" },
            ],
          },
          ownerId,
        );

        expect(updated.id).not.toBe(original.id);
        expect(updated.targetMinutes).toBe(30);
        expect(updated.timezone).toBe("America/New_York");
        expect(updated.createdBy).toBe(ownerId);

        // The new version is now "current".
        const current = await getCurrentSlaPolicy(companyId);
        expect(current.id).toBe(updated.id);

        // The original version is untouched, still present in history.
        const history = await listSlaPolicyHistory(companyId);
        expect(history).toHaveLength(2);
        const originalInHistory = history.find((p) => p.id === original.id);
        expect(originalInHistory?.targetMinutes).toBe(60);
        expect(originalInHistory?.timezone).toBe("UTC");

        // Most recent first.
        expect(history[0].id).toBe(updated.id);
      } finally {
        if (companyId) {
          await db
            .deleteFrom("sla_policies")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("company_members")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("companies")
            .where("id", "=", companyId)
            .execute();
        }
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );

  integrationTest(
    "resolves a deterministic winner when two policy versions share the exact same effective_from and created_at",
    async () => {
      const ownerId = crypto.randomUUID();
      let companyId: string | undefined;
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `owner-tie-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        const company = await createCompany(
          { name: "Policy tie test" },
          ownerId,
        );
        companyId = company.id;

        // Remove the seeded default so only our two colliding rows exist.
        await db
          .deleteFrom("sla_policies")
          .where("company_id", "=", companyId)
          .execute();

        const tieInstant = new Date("2026-06-01T12:00:00.000Z");
        const [older] = await db
          .insertInto("sla_policies")
          .values({
            company_id: companyId,
            target_minutes: 30,
            direct_resolution_target_minutes: 480,
            group_response_target_minutes: 120,
            group_resolution_target_minutes: 960,
            timezone: "UTC",
            weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
            exceptions: JSON.stringify([]),
            effective_from: tieInstant,
            created_at: tieInstant,
            created_by: ownerId,
          })
          .returning("id")
          .execute();
        const [newer] = await db
          .insertInto("sla_policies")
          .values({
            company_id: companyId,
            target_minutes: 90,
            direct_resolution_target_minutes: 480,
            group_response_target_minutes: 120,
            group_resolution_target_minutes: 960,
            timezone: "UTC",
            weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
            exceptions: JSON.stringify([]),
            effective_from: tieInstant,
            created_at: tieInstant,
            created_by: ownerId,
          })
          .returning("id")
          .execute();

        // With effective_from AND created_at fully tied, the id DESC
        // tiebreak decides - whichever wins, it must be the SAME winner
        // every time this is called, and must agree with the LATERAL join
        // used by analytics episode resolution.
        const winnerId = [older.id, newer.id].sort().reverse()[0];
        const loserId = winnerId === older.id ? newer.id : older.id;
        const winnerTarget = winnerId === older.id ? 30 : 90;

        const first = await getCurrentSlaPolicy(companyId);
        const second = await getCurrentSlaPolicy(companyId);
        const third = await getCurrentSlaPolicy(companyId);
        expect(first.id).toBe(winnerId);
        expect(second.id).toBe(winnerId);
        expect(third.id).toBe(winnerId);

        const history = await listSlaPolicyHistory(companyId);
        expect(history).toHaveLength(2);
        expect(history[0].id).toBe(winnerId);
        expect(history[1].id).toBe(loserId);

        // Episode resolution (the LATERAL join) must agree with
        // getCurrentSlaPolicy on which version applies.
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: `${crypto.randomUUID()}@s.whatsapp.net`,
            phone_number: crypto.randomUUID().slice(0, 10),
            push_name: "Tie test contact",
          })
          .returning("id")
          .execute();
        const inboundTime = new Date(tieInstant.getTime() + 60_000);
        // Response episodes only exist inside an SLA-bearing case's window
        // (see conversation-case.service.ts) - seed one directly, snapshotted
        // to the winning policy, so this test's raw message inserts are
        // still measured as an episode.
        const [seededCase] = await tenantDb
          .insertInto("conversation_cases")
          .values({
            contact_id: contact.id,
            kind: "direct",
            status: "open",
            opened_at: tieInstant,
            open_source: "live_inbound",
            policy_id: winnerId,
            response_target_minutes: winnerTarget,
            resolution_target_minutes: 480,
          })
          .returning("id")
          .execute();
        await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            message_id: crypto.randomUUID(),
            from_me: false,
            message_type: "text",
            content: "hello",
            timestamp: inboundTime,
            created_at: inboundTime,
            case_id: seededCase.id,
          })
          .execute();
        // Reply exactly 60 minutes after inbound - a value strictly between
        // the two candidate targets (30 and 90), so compliance flips
        // depending on which policy actually won the tie.
        const replyTime = new Date(inboundTime.getTime() + 60 * 60_000);
        await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            message_id: crypto.randomUUID(),
            from_me: true,
            message_type: "text",
            content: "reply",
            timestamp: replyTime,
            created_at: replyTime,
            case_id: seededCase.id,
          })
          .execute();

        const stats = await getResponseTimeStats(
          companyId,
          new Date(tieInstant.getTime() - 60_000),
          new Date(tieInstant.getTime() + 3 * 60_000 * 60),
        );
        expect(stats.totalConversations).toBe(1);
        // Compliant only if the winning policy's target is >= 60 (i.e. 90).
        // This confirms the LATERAL join used by analytics picked the exact
        // same winner as getCurrentSlaPolicy, not the tied loser.
        expect(stats.withinSlaCount).toBe(winnerTarget >= 60 ? 1 : 0);
        await clearTenantConnection(companyId);
        await dropTenantSchema(companyId).catch(() => undefined);
      } finally {
        if (companyId) {
          await db
            .deleteFrom("sla_policies")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("company_members")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("companies")
            .where("id", "=", companyId)
            .execute();
        }
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );
});
