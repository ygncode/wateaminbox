import { describe, expect, test } from "bun:test";

// Response episodes only exist INSIDE an SLA-bearing conversation_cases
// row's [opened_at, resolved_at) window (see conversation-case.service.ts
// and episode-resolution.ts) - every scenario below opens a case spanning
// its messages via `openCase`/`insertContactWithCase` so the underlying
// business-time/burst/policy-snapshot premise each test is actually
// checking still holds under the case-boundary model.

import { db } from "@wateaminbox/database";
import type {
  SlaScheduleException,
  SlaWeeklySchedule,
} from "@wateaminbox/shared";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { AnalyticsRangeTooWideError } from "../../lib/errors.js";
import { resolveActiveCase } from "../conversation-case.service.js";
import { getCurrentSlaPolicy, resolveCaseTargets } from "../sla-policy/policy.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  dropTenantSchema,
  getTenantConnection,
} from "../tenant.service.js";
import { MAX_EPISODES_PER_QUERY } from "./episode-resolution.js";
import {
  getResponseTimeStats,
  getResponseTimeTrend,
  getSlaBreaches,
} from "./response-time.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const LARGE_DATASET_TEST_TIMEOUT_MS = 20_000;

const OFFICE_HOURS_UTC: SlaWeeklySchedule = [
  { weekday: 0, open: false, intervals: [] },
  { weekday: 1, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 2, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 3, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 4, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 5, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 6, open: false, intervals: [] },
];

interface PolicySeed {
  targetMinutes: number;
  timezone: string;
  weeklySchedule: SlaWeeklySchedule;
  effectiveFrom: Date;
  exceptions?: SlaScheduleException[];
}

async function withTenant(
  run: (
    companyId: string,
    tenantDb: ReturnType<typeof getTenantConnection>,
  ) => Promise<void>,
  policies: PolicySeed[] = [
    {
      targetMinutes: 60,
      timezone: "UTC",
      weeklySchedule: DEFAULT_SLA_WEEKLY_SCHEDULE,
      effectiveFrom: new Date("1970-01-01T00:00:00Z"),
    },
  ],
) {
  const companyId = crypto.randomUUID();
  const schemaName = `test_${companyId.replaceAll("-", "_")}`;
  const ownerId = crypto.randomUUID();

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: `owner-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Response time analytics test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    for (const policy of policies) {
      await db
        .insertInto("sla_policies")
        .values({
          company_id: companyId,
          target_minutes: policy.targetMinutes,
          direct_resolution_target_minutes: 480,
          group_response_target_minutes: 120,
          group_resolution_target_minutes: 960,
          timezone: policy.timezone,
          weekly_schedule: JSON.stringify(policy.weeklySchedule),
          exceptions: JSON.stringify(policy.exceptions ?? []),
          effective_from: policy.effectiveFrom,
          created_by: ownerId,
        })
        .execute();
    }

    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await run(companyId, tenantDb);
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
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

async function insertContact(tenantDb: ReturnType<typeof getTenantConnection>) {
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      jid: `${crypto.randomUUID()}@s.whatsapp.net`,
      phone_number: crypto.randomUUID().slice(0, 10),
      push_name: "Test contact",
    })
    .returning("id")
    .execute();
  return contact.id;
}

/** Opens an (unresolved) case for a contact, snapshotting the company's CURRENT policy at call time. */
async function openCase(
  tenantDb: ReturnType<typeof getTenantConnection>,
  companyId: string,
  contactId: string,
  openedAt: Date,
  kind: "direct" | "group" = "direct",
): Promise<void> {
  const policy = await getCurrentSlaPolicy(companyId);
  const targets = resolveCaseTargets(policy, kind);
  await tenantDb
    .insertInto("conversation_cases")
    .values({
      contact_id: contactId,
      kind,
      status: "open",
      opened_at: openedAt,
      open_source: "live_inbound",
      policy_id: policy.id,
      response_target_minutes: targets.responseTargetMinutes,
      resolution_target_minutes: targets.resolutionTargetMinutes,
    })
    .execute();
}

/** Convenience: a fresh contact with an open case starting at `openedAt`. */
async function insertContactWithCase(
  tenantDb: ReturnType<typeof getTenantConnection>,
  companyId: string,
  openedAt: Date,
  kind: "direct" | "group" = "direct",
): Promise<string> {
  const contactId = await insertContact(tenantDb);
  await openCase(tenantDb, companyId, contactId, openedAt, kind);
  return contactId;
}

async function insertMessage(
  tenantDb: ReturnType<typeof getTenantConnection>,
  contactId: string,
  fromMe: boolean,
  timestamp: Date,
) {
  // Mirrors production: every message insert path stamps `case_id`
  // explicitly from whichever case is currently active for the contact -
  // never inferred from a timestamp window (see migration 061 / episode
  // -resolution.ts).
  const activeCase = await tenantDb
    .selectFrom("conversation_cases")
    .select("id")
    .where("contact_id", "=", contactId)
    .where("status", "in", ["open", "pending"])
    .executeTakeFirst();

  await tenantDb
    .insertInto("messages")
    .values({
      contact_id: contactId,
      message_id: crypto.randomUUID(),
      from_me: fromMe,
      message_type: "text",
      content: fromMe ? "reply" : "hello",
      timestamp,
      // SLA/duration math and range filtering use `created_at` (the
      // authoritative server ingestion instant), never the WhatsApp-
      // supplied `timestamp` - see episode-resolution.ts. These tests
      // deliberately control the instant used for that math, so `timestamp`
      // and `created_at` are set to the same controlled value here; tests
      // that specifically exercise a delayed/future/mismatched WhatsApp
      // timestamp pass one explicitly instead (see insertMessageWithTimes).
      created_at: timestamp,
      case_id: activeCase?.id ?? null,
    })
    .execute();
}

/**
 * Like `insertMessage`, but lets a test deliberately diverge the
 * WhatsApp-supplied `timestamp` from the authoritative `created_at` (server
 * ingestion instant) - e.g. a delayed or future-dated client clock. Compliance
 * math and range filtering must follow `created_at` only.
 */
async function insertMessageWithTimes(
  tenantDb: ReturnType<typeof getTenantConnection>,
  contactId: string,
  fromMe: boolean,
  timestamp: Date,
  createdAt: Date,
) {
  const activeCase = await tenantDb
    .selectFrom("conversation_cases")
    .select("id")
    .where("contact_id", "=", contactId)
    .where("status", "in", ["open", "pending"])
    .executeTakeFirst();

  await tenantDb
    .insertInto("messages")
    .values({
      contact_id: contactId,
      message_id: crypto.randomUUID(),
      from_me: fromMe,
      message_type: "text",
      content: fromMe ? "reply" : "hello",
      timestamp,
      created_at: createdAt,
      case_id: activeCase?.id ?? null,
    })
    .execute();
}

describe("response-time analytics correctness (24/7 UTC policy)", () => {
  integrationTest(
    "collapses a burst of consecutive inbound messages into a single response episode",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const base = new Date("2026-01-01T00:00:00Z"); // Thursday
        const contactId = await insertContactWithCase(tenantDb, companyId, base);

        await insertMessage(tenantDb, contactId, false, base);
        await insertMessage(
          tenantDb,
          contactId,
          false,
          new Date(base.getTime() + 2 * MINUTE),
        );
        await insertMessage(
          tenantDb,
          contactId,
          false,
          new Date(base.getTime() + 4 * MINUTE),
        );
        await insertMessage(
          tenantDb,
          contactId,
          true,
          new Date(base.getTime() + 10 * MINUTE),
        );

        const start = new Date(base.getTime() - HOUR);
        const end = new Date(base.getTime() + HOUR);

        const stats = await getResponseTimeStats(companyId, start, end);
        expect(stats.totalConversations).toBe(1);
        expect(stats.averageResponseTimeMinutes).toBeCloseTo(10, 5);

        const breaches = await getSlaBreaches(companyId, start, end, 5, 10);
        expect(breaches).toHaveLength(1);
        expect(breaches[0].responseMinutes).toBeCloseTo(10, 5);
        expect(breaches[0].inboundMessageTime.getTime()).toBe(base.getTime());
      });
    },
  );

  integrationTest(
    "starts a new episode after an interleaved reply mid-burst",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const base = new Date("2026-01-01T00:00:00Z");
        const contactId = await insertContactWithCase(tenantDb, companyId, base);

        await insertMessage(tenantDb, contactId, false, base);
        await insertMessage(
          tenantDb,
          contactId,
          true,
          new Date(base.getTime() + 1 * MINUTE),
        );
        await insertMessage(
          tenantDb,
          contactId,
          false,
          new Date(base.getTime() + 5 * MINUTE),
        );
        await insertMessage(
          tenantDb,
          contactId,
          false,
          new Date(base.getTime() + 6 * MINUTE),
        );
        await insertMessage(
          tenantDb,
          contactId,
          true,
          new Date(base.getTime() + 20 * MINUTE),
        );

        const start = new Date(base.getTime() - HOUR);
        const end = new Date(base.getTime() + HOUR);

        const stats = await getResponseTimeStats(companyId, start, end);
        expect(stats.totalConversations).toBe(2);
        expect(stats.averageResponseTimeMinutes).toBeCloseTo(8, 5);
      });
    },
  );

  integrationTest(
    "counts a late reply beyond 24 hours as a breach instead of excluding it",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const base = new Date("2026-01-01T00:00:00Z");
        const replyTime = new Date(base.getTime() + 30 * HOUR);
        const contactId = await insertContactWithCase(tenantDb, companyId, base);

        await insertMessage(tenantDb, contactId, false, base);
        await insertMessage(tenantDb, contactId, true, replyTime);

        const start = new Date(base.getTime() - HOUR);
        const end = new Date(base.getTime() + HOUR);

        const stats = await getResponseTimeStats(companyId, start, end);
        expect(stats.totalConversations).toBe(1);
        expect(stats.averageResponseTimeMinutes).toBeCloseTo(30 * 60, 5);

        const breaches = await getSlaBreaches(companyId, start, end, 60, 10);
        expect(breaches).toHaveLength(1);
        expect(breaches[0].responseTime?.getTime()).toBe(replyTime.getTime());
      });
    },
  );

  integrationTest(
    "unanswered messages are breaches only once their age exceeds the SLA target",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const inboundTime = new Date(Date.now() - 30 * MINUTE);
        const contactId = await insertContactWithCase(
          tenantDb,
          companyId,
          inboundTime,
        );
        await insertMessage(tenantDb, contactId, false, inboundTime);

        const start = new Date(inboundTime.getTime() - HOUR);
        const end = new Date(inboundTime.getTime() + HOUR);

        const notYetBreached = await getSlaBreaches(
          companyId,
          start,
          end,
          60,
          10,
        );
        expect(notYetBreached).toHaveLength(0);

        const alreadyBreached = await getSlaBreaches(
          companyId,
          start,
          end,
          20,
          10,
        );
        expect(alreadyBreached).toHaveLength(1);
        expect(alreadyBreached[0].responseTime).toBeNull();
      });
    },
  );

  integrationTest(
    "overall compliance counts overdue unanswered episodes as non-compliant, but excludes pending ones",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const threshold = 60;

        const compliantInbound = new Date(Date.now() - 3 * HOUR);
        const contactCompliant = await insertContactWithCase(
          tenantDb,
          companyId,
          compliantInbound,
        );
        await insertMessage(
          tenantDb,
          contactCompliant,
          false,
          compliantInbound,
        );
        await insertMessage(
          tenantDb,
          contactCompliant,
          true,
          new Date(compliantInbound.getTime() + 5 * MINUTE),
        );

        const overdueInbound = new Date(Date.now() - 90 * MINUTE);
        const contactOverdue = await insertContactWithCase(
          tenantDb,
          companyId,
          overdueInbound,
        );
        await insertMessage(tenantDb, contactOverdue, false, overdueInbound);

        const pendingInbound = new Date(Date.now() - 10 * MINUTE);
        const contactPending = await insertContactWithCase(
          tenantDb,
          companyId,
          pendingInbound,
        );
        await insertMessage(tenantDb, contactPending, false, pendingInbound);

        const start = new Date(Date.now() - 4 * HOUR);
        const end = new Date(Date.now() + HOUR);

        const breaches = await getSlaBreaches(
          companyId,
          start,
          end,
          threshold,
          10,
        );
        expect(breaches).toHaveLength(1);
        expect(breaches[0].responseTime).toBeNull();

        const stats = await getResponseTimeStats(
          companyId,
          start,
          end,
          threshold,
        );
        expect(stats.totalConversations).toBe(2);
        expect(stats.withinSlaCount).toBe(1);
        expect(stats.slaComplianceRate).toBeCloseTo(50, 5);
        expect(stats.averageResponseTimeMinutes).toBeCloseTo(5, 5);

        const trend = await getResponseTimeTrend(
          companyId,
          start,
          end,
          threshold,
        );
        const totalTrendCount = trend.reduce(
          (sum, day) => sum + day.conversationCount,
          0,
        );
        expect(totalTrendCount).toBe(2);
      });
    },
  );
});

describe("response-time analytics correctness (business-hours calendar)", () => {
  integrationTest(
    "a closed weekend pauses the elapsed clock, unlike wall-clock time",
    async () => {
      await withTenant(
        async (companyId, tenantDb) => {
          // Friday 2026-01-02 16:50 UTC (10 min before the 17:00 close),
          // answered Monday 2026-01-05 09:10 UTC (10 min after the 09:00
          // open). ~56 wall-clock hours pass, but only 20 business minutes
          // (10 Friday + 10 Monday) - Sat/Sun are closed. With a 30-minute
          // target this must NOT be a breach, even though it very much would
          // be under wall-clock time.
          const inboundTime = new Date("2026-01-02T16:50:00Z");
          const replyTime = new Date("2026-01-05T09:10:00Z");
          const contactId = await insertContactWithCase(
            tenantDb,
            companyId,
            inboundTime,
          );
          await insertMessage(tenantDb, contactId, false, inboundTime);
          await insertMessage(tenantDb, contactId, true, replyTime);

          const start = new Date("2026-01-02T00:00:00Z");
          const end = new Date("2026-01-06T00:00:00Z");

          const stats = await getResponseTimeStats(companyId, start, end, 60);
          expect(stats.averageResponseTimeMinutes).toBeCloseTo(20, 5);

          const breachesAtThirtyMinuteTarget = await getSlaBreaches(
            companyId,
            start,
            end,
            30,
            10,
          );
          expect(breachesAtThirtyMinuteTarget).toHaveLength(0);

          const breachesAtTenMinuteTarget = await getSlaBreaches(
            companyId,
            start,
            end,
            10,
            10,
          );
          expect(breachesAtTenMinuteTarget).toHaveLength(1);
          expect(breachesAtTenMinuteTarget[0].responseMinutes).toBeCloseTo(
            20,
            5,
          );
        },
        [
          {
            targetMinutes: 60,
            timezone: "UTC",
            weeklySchedule: OFFICE_HOURS_UTC,
            effectiveFrom: new Date("1970-01-01T00:00:00Z"),
          },
        ],
      );
    },
  );

  integrationTest(
    "a reply that lands after a holiday closure is measured only in business minutes",
    async () => {
      await withTenant(
        async (companyId, tenantDb) => {
          // Wednesday 2026-01-07, closed as a holiday exception; reply lands
          // Thursday 2026-01-08 09:10 (10 minutes after Thursday's opening).
          const inboundTime = new Date("2026-01-07T10:00:00Z");
          const replyTime = new Date("2026-01-08T09:10:00Z");
          const contactId = await insertContactWithCase(
            tenantDb,
            companyId,
            inboundTime,
          );
          await insertMessage(tenantDb, contactId, false, inboundTime);
          await insertMessage(tenantDb, contactId, true, replyTime);

          const start = new Date("2026-01-06T00:00:00Z");
          const end = new Date("2026-01-09T00:00:00Z");

          const stats = await getResponseTimeStats(companyId, start, end);
          expect(stats.totalConversations).toBe(1);
          // The holiday (all of Wed) contributes 0; Thursday 09:00-09:10 = 10.
          expect(stats.averageResponseTimeMinutes).toBeCloseTo(10, 5);
        },
        [
          {
            targetMinutes: 60,
            timezone: "UTC",
            weeklySchedule: OFFICE_HOURS_UTC,
            effectiveFrom: new Date("1970-01-01T00:00:00Z"),
            exceptions: [
              { date: "2026-01-07", closed: true, label: "Company holiday" },
            ],
          },
        ],
      );
    },
  );

  integrationTest(
    "a case snapshots the policy active when it opened, even after a later edit",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = `test_${companyId.replaceAll("-", "_")}`;
      const ownerId = crypto.randomUUID();
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `owner-${ownerId}@example.com`,
            password_hash: "test",
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Policy history test",
            schema_name: schemaName,
            status: "active",
          })
          .execute();
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: ownerId, role: "owner" })
          .execute();

        // Original policy: 24/7 UTC, 120-minute target, effective from epoch.
        await db
          .insertInto("sla_policies")
          .values({
            company_id: companyId,
            target_minutes: 120,
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
        const tenantDb = getTenantConnection(companyId);

        // The case opens under the original (120-minute) policy.
        const inboundTime = new Date("2026-01-01T00:00:00Z");
        const contactId = await insertContactWithCase(
          tenantDb,
          companyId,
          inboundTime,
        );
        await insertMessage(tenantDb, contactId, false, inboundTime);
        await insertMessage(
          tenantDb,
          contactId,
          true,
          new Date(inboundTime.getTime() + 90 * MINUTE), // 90 min: compliant under 120, breach under a tighter target
        );

        // Admin now edits the policy to a much stricter 30-minute target,
        // effective immediately (after the case already opened).
        await db
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
            effective_from: new Date(), // now - well after the case opened
            created_by: ownerId,
          })
          .execute();

        const start = new Date("2025-12-31T00:00:00Z");
        const end = new Date("2026-01-02T00:00:00Z");

        // The case snapshotted the 120-minute policy at opening - the later
        // edit never rewrites it, so the 90-minute reply is still
        // compliant, not a breach.
        const breaches = await getSlaBreaches(
          companyId,
          start,
          end,
          undefined,
          10,
        );
        expect(breaches).toHaveLength(0);

        const stats = await getResponseTimeStats(companyId, start, end);
        expect(stats.totalConversations).toBe(1);
        expect(stats.withinSlaCount).toBe(1);
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
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );

  integrationTest(
    "an explicit slaThreshold override changes only the target, not the historical calendar",
    async () => {
      await withTenant(
        async (companyId, tenantDb) => {
          // Friday 16:50 UTC -> Monday 09:10 UTC, same office-hours calendar
          // as above (20 business minutes elapsed despite ~56 wall-clock
          // hours). The policy's own target is 60 minutes (never a breach on
          // its own); a tiny override target must still measure against the
          // SAME calendar, not fall back to wall-clock time.
          const inboundTime = new Date("2026-01-02T16:50:00Z");
          const replyTime = new Date("2026-01-05T09:10:00Z");
          const contactId = await insertContactWithCase(
            tenantDb,
            companyId,
            inboundTime,
          );
          await insertMessage(tenantDb, contactId, false, inboundTime);
          await insertMessage(tenantDb, contactId, true, replyTime);

          const start = new Date("2026-01-02T00:00:00Z");
          const end = new Date("2026-01-06T00:00:00Z");

          // With the default (60-minute) policy target: compliant.
          const breachesAtPolicyTarget = await getSlaBreaches(
            companyId,
            start,
            end,
            undefined,
            10,
          );
          expect(breachesAtPolicyTarget).toHaveLength(0);

          // With a tiny override target (5 min): now a breach, but still
          // measured in business minutes (20), not the ~3360 wall-clock
          // minutes that actually passed.
          const breachesWithTinyTarget = await getSlaBreaches(
            companyId,
            start,
            end,
            5,
            10,
          );
          expect(breachesWithTinyTarget).toHaveLength(1);
          expect(breachesWithTinyTarget[0].responseMinutes).toBeCloseTo(20, 5);
        },
        [
          {
            targetMinutes: 60,
            timezone: "UTC",
            weeklySchedule: OFFICE_HOURS_UTC,
            effectiveFrom: new Date("1970-01-01T00:00:00Z"),
          },
        ],
      );
    },
  );
});

describe("response-time trend - reporting timezone boundary correctness", () => {
  integrationTest(
    "a positive-offset timezone (UTC+14) never drops an episode that rolls into the next local day",
    async () => {
      await withTenant(
        async (companyId, tenantDb) => {
          // 23:00 UTC is 13:00 the NEXT calendar day in Pacific/Kiritimati
          // (UTC+14) - this is exactly the edge case that a UTC-enumerated
          // axis would never visit, even though the episode's inbound_time
          // is well inside [startDate, endDate].
          const inboundTime = new Date("2026-01-01T23:00:00Z");
          const contactId = await insertContactWithCase(
            tenantDb,
            companyId,
            inboundTime,
          );
          await insertMessage(tenantDb, contactId, false, inboundTime);
          await insertMessage(
            tenantDb,
            contactId,
            true,
            new Date(inboundTime.getTime() + 5 * MINUTE),
          );

          const start = new Date("2026-01-01T00:00:00Z");
          const end = new Date("2026-01-01T23:59:59Z");

          const stats = await getResponseTimeStats(companyId, start, end);
          expect(stats.totalConversations).toBe(1);

          const trend = await getResponseTimeTrend(companyId, start, end);
          const trendTotal = trend.reduce(
            (sum, d) => sum + d.conversationCount,
            0,
          );
          expect(trendTotal).toBe(stats.totalConversations);

          // The episode must land on 2026-01-02 local time, and that date
          // must actually be present on the axis.
          const day = trend.find((d) => d.date === "2026-01-02");
          expect(day?.conversationCount).toBe(1);
        },
        [
          {
            targetMinutes: 60,
            timezone: "Pacific/Kiritimati",
            weeklySchedule: DEFAULT_SLA_WEEKLY_SCHEDULE,
            effectiveFrom: new Date("1970-01-01T00:00:00Z"),
          },
        ],
      );
    },
  );

  integrationTest(
    "a negative-offset timezone (UTC-8) never drops an episode that rolls into the previous local day",
    async () => {
      await withTenant(
        async (companyId, tenantDb) => {
          // 02:00 UTC on 2026-01-01 is 18:00 on 2025-12-31 in
          // America/Los_Angeles (UTC-8) - the symmetric edge case at the
          // START of the range for a negative-offset zone.
          const inboundTime = new Date("2026-01-01T02:00:00Z");
          const contactId = await insertContactWithCase(
            tenantDb,
            companyId,
            inboundTime,
          );
          await insertMessage(tenantDb, contactId, false, inboundTime);
          await insertMessage(
            tenantDb,
            contactId,
            true,
            new Date(inboundTime.getTime() + 5 * MINUTE),
          );

          const start = new Date("2026-01-01T00:00:00Z");
          const end = new Date("2026-01-01T23:59:59Z");

          const stats = await getResponseTimeStats(companyId, start, end);
          expect(stats.totalConversations).toBe(1);

          const trend = await getResponseTimeTrend(companyId, start, end);
          const trendTotal = trend.reduce(
            (sum, d) => sum + d.conversationCount,
            0,
          );
          expect(trendTotal).toBe(stats.totalConversations);

          const day = trend.find((d) => d.date === "2025-12-31");
          expect(day?.conversationCount).toBe(1);
        },
        [
          {
            targetMinutes: 60,
            timezone: "America/Los_Angeles",
            weeklySchedule: DEFAULT_SLA_WEEKLY_SCHEDULE,
            effectiveFrom: new Date("1970-01-01T00:00:00Z"),
          },
        ],
      );
    },
  );

  integrationTest(
    "trend and aggregate stats agree across a wider multi-day range regardless of timezone",
    async () => {
      await withTenant(
        async (companyId, tenantDb) => {
          for (const offsetHours of [1, 30, 55] as const) {
            const inboundTime = new Date(
              Date.UTC(2026, 0, 1, 0, 0, 0) + offsetHours * HOUR,
            );
            const contactId = await insertContactWithCase(
              tenantDb,
              companyId,
              inboundTime,
            );
            await insertMessage(tenantDb, contactId, false, inboundTime);
            await insertMessage(
              tenantDb,
              contactId,
              true,
              new Date(inboundTime.getTime() + 5 * MINUTE),
            );
          }

          const start = new Date("2026-01-01T00:00:00Z");
          const end = new Date("2026-01-04T00:00:00Z");

          const stats = await getResponseTimeStats(companyId, start, end);
          const trend = await getResponseTimeTrend(companyId, start, end);
          const trendTotal = trend.reduce(
            (sum, d) => sum + d.conversationCount,
            0,
          );
          expect(trendTotal).toBe(stats.totalConversations);
          expect(trendTotal).toBe(3);
        },
        [
          {
            targetMinutes: 60,
            timezone: "Pacific/Kiritimati",
            weeklySchedule: DEFAULT_SLA_WEEKLY_SCHEDULE,
            effectiveFrom: new Date("1970-01-01T00:00:00Z"),
          },
        ],
      );
    },
  );
});

describe("response-time analytics - exceeding the episode cap fails explicitly", () => {
  integrationTest(
    "throws AnalyticsRangeTooWideError instead of silently returning a partial result",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const overCap = MAX_EPISODES_PER_QUERY + 1;
        const base = new Date("2026-01-01T00:00:00Z");
        const policy = await getCurrentSlaPolicy(companyId);
        const targets = resolveCaseTargets(policy, "direct");

        const contacts = Array.from({ length: overCap }, (_, i) => ({
          jid: `${crypto.randomUUID()}@s.whatsapp.net`,
          phone_number: `overcap-${i}`,
          push_name: `Over-cap contact ${i}`,
        }));
        const insertedContacts = await tenantDb
          .insertInto("contacts")
          .values(contacts)
          .returning("id")
          .execute();

        const cases = insertedContacts.map((contact, i) => ({
          contact_id: contact.id,
          kind: "direct" as const,
          status: "open" as const,
          opened_at: new Date(base.getTime() + i * 1000),
          open_source: "live_inbound" as const,
          policy_id: policy.id,
          response_target_minutes: targets.responseTargetMinutes,
          resolution_target_minutes: targets.resolutionTargetMinutes,
        }));
        const insertedCases = await tenantDb
          .insertInto("conversation_cases")
          .values(cases)
          .returning(["id", "contact_id"])
          .execute();
        const caseIdByContact = new Map(
          insertedCases.map((c) => [c.contact_id, c.id]),
        );

        const messages = insertedContacts.map((contact, i) => ({
          contact_id: contact.id,
          message_id: crypto.randomUUID(),
          from_me: false,
          message_type: "text" as const,
          content: "hello",
          // Each contact's single inbound message is its own episode (no
          // shared bursts), spread a second apart so ordering is
          // deterministic without needing overCap distinct timestamps.
          timestamp: new Date(base.getTime() + i * 1000),
          created_at: new Date(base.getTime() + i * 1000),
          case_id: caseIdByContact.get(contact.id) ?? null,
        }));
        await tenantDb.insertInto("messages").values(messages).execute();

        const start = new Date(base.getTime() - HOUR);
        const end = new Date(base.getTime() + overCap * 1000 + HOUR);

        await expect(
          getResponseTimeStats(companyId, start, end),
        ).rejects.toBeInstanceOf(AnalyticsRangeTooWideError);
        await expect(
          getResponseTimeTrend(companyId, start, end),
        ).rejects.toBeInstanceOf(AnalyticsRangeTooWideError);
        await expect(
          getSlaBreaches(companyId, start, end, undefined, 10),
        ).rejects.toBeInstanceOf(AnalyticsRangeTooWideError);
      });
    },
    LARGE_DATASET_TEST_TIMEOUT_MS,
  );

  integrationTest("does not throw when exactly at the cap", async () => {
    await withTenant(async (companyId, tenantDb) => {
      const atCap = MAX_EPISODES_PER_QUERY;
      const base = new Date("2026-01-01T00:00:00Z");
      const policy = await getCurrentSlaPolicy(companyId);
      const targets = resolveCaseTargets(policy, "direct");

      const contacts = Array.from({ length: atCap }, (_, i) => ({
        jid: `${crypto.randomUUID()}@s.whatsapp.net`,
        phone_number: `atcap-${i}`,
        push_name: `At-cap contact ${i}`,
      }));
      const insertedContacts = await tenantDb
        .insertInto("contacts")
        .values(contacts)
        .returning("id")
        .execute();

      const cases = insertedContacts.map((contact, i) => ({
        contact_id: contact.id,
        kind: "direct" as const,
        status: "open" as const,
        opened_at: new Date(base.getTime() + i * 1000),
        open_source: "live_inbound" as const,
        policy_id: policy.id,
        response_target_minutes: targets.responseTargetMinutes,
        resolution_target_minutes: targets.resolutionTargetMinutes,
      }));
      const insertedCases = await tenantDb
        .insertInto("conversation_cases")
        .values(cases)
        .returning(["id", "contact_id"])
        .execute();
      const caseIdByContact = new Map(
        insertedCases.map((c) => [c.contact_id, c.id]),
      );

      const messages = insertedContacts.map((contact, i) => ({
        contact_id: contact.id,
        message_id: crypto.randomUUID(),
        from_me: false,
        message_type: "text" as const,
        content: "hello",
        timestamp: new Date(base.getTime() + i * 1000),
        created_at: new Date(base.getTime() + i * 1000),
        case_id: caseIdByContact.get(contact.id) ?? null,
      }));
      await tenantDb.insertInto("messages").values(messages).execute();

      const start = new Date(base.getTime() - HOUR);
      const end = new Date(base.getTime() + atCap * 1000 + HOUR);

      const stats = await getResponseTimeStats(companyId, start, end);
      expect(stats.totalConversations).toBe(atCap);
    });
  }, LARGE_DATASET_TEST_TIMEOUT_MS);
});

describe("response-time analytics - exact target boundary", () => {
  integrationTest(
    "a reply exactly at the target is compliant and not a breach; one minute over is both",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const target = 30;
        const base = new Date("2026-01-01T00:00:00Z");

        const exactInbound = base;
        const exactContact = await insertContactWithCase(
          tenantDb,
          companyId,
          exactInbound,
        );
        await insertMessage(tenantDb, exactContact, false, exactInbound);
        await insertMessage(
          tenantDb,
          exactContact,
          true,
          new Date(exactInbound.getTime() + target * MINUTE),
        );

        const overInbound = new Date(base.getTime() + HOUR);
        const overContact = await insertContactWithCase(
          tenantDb,
          companyId,
          overInbound,
        );
        await insertMessage(tenantDb, overContact, false, overInbound);
        await insertMessage(
          tenantDb,
          overContact,
          true,
          new Date(overInbound.getTime() + (target + 1) * MINUTE),
        );

        const start = new Date(base.getTime() - HOUR);
        const end = new Date(base.getTime() + 3 * HOUR);

        const stats = await getResponseTimeStats(companyId, start, end, target);
        expect(stats.totalConversations).toBe(2);
        // Only the exact-at-target reply counts as within SLA.
        expect(stats.withinSlaCount).toBe(1);

        const breaches = await getSlaBreaches(
          companyId,
          start,
          end,
          target,
          10,
        );
        expect(breaches).toHaveLength(1);
        expect(breaches[0].contactId).toBe(overContact);
        expect(breaches[0].responseMinutes).toBeCloseTo(target + 1, 5);
      });
    },
  );

  integrationTest(
    "an unanswered episode comfortably under the target age is not yet overdue; comfortably over is",
    async () => {
      // Not testing the exact-equality instant here (see
      // episode-outcome.test.ts for that, deterministically, via an
      // injected `now`) - a live end-to-end DB test can't pin "now" to the
      // millisecond without flaking, so this uses a safe margin on each
      // side while still exercising the full fetch -> outcome -> breach
      // pipeline against a real target boundary.
      await withTenant(async (companyId, tenantDb) => {
        const target = 30;

        const underTargetInbound = new Date(Date.now() - (target - 5) * MINUTE);
        const underTargetContact = await insertContactWithCase(
          tenantDb,
          companyId,
          underTargetInbound,
        );
        await insertMessage(
          tenantDb,
          underTargetContact,
          false,
          underTargetInbound,
        );

        const overTargetInbound = new Date(Date.now() - (target + 5) * MINUTE);
        const overTargetContact = await insertContactWithCase(
          tenantDb,
          companyId,
          overTargetInbound,
        );
        await insertMessage(
          tenantDb,
          overTargetContact,
          false,
          overTargetInbound,
        );

        const start = new Date(Date.now() - HOUR);
        const end = new Date(Date.now() + HOUR);

        const breaches = await getSlaBreaches(
          companyId,
          start,
          end,
          target,
          10,
        );
        expect(breaches).toHaveLength(1);
        expect(breaches[0].contactId).toBe(overTargetContact);
      });
    },
  );
});

describe("response-time analytics - authoritative ingestion time, not the WhatsApp-supplied timestamp", () => {
  integrationTest(
    "a future-dated inbound WhatsApp timestamp never produces a fake negative/zero compliance - duration and range filtering follow created_at",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const target = 30;
        const t0 = new Date("2026-01-01T00:00:00Z");
        // WhatsApp claims this arrived 10 days in the future relative to
        // t0 - an untrustworthy client clock. The real (authoritative)
        // ingestion instant is t0.
        const futureClaimedTimestamp = new Date(t0.getTime() + 10 * 24 * HOUR);
        const contact = await insertContactWithCase(tenantDb, companyId, t0);
        await insertMessageWithTimes(
          tenantDb,
          contact,
          false,
          futureClaimedTimestamp,
          t0,
        );

        // The reply's claimed WhatsApp timestamp is BEFORE the inbound's
        // claimed timestamp - naive timestamp-based duration math would
        // yield a negative (or nonsensical) value. Its real ingestion
        // instant is genuinely 45 minutes after t0, a real breach.
        const replyClaimedTimestamp = new Date(t0.getTime() - HOUR);
        const replyCreatedAt = new Date(t0.getTime() + 45 * MINUTE);
        await insertMessageWithTimes(
          tenantDb,
          contact,
          true,
          replyClaimedTimestamp,
          replyCreatedAt,
        );

        const start = new Date(t0.getTime() - HOUR);
        const end = new Date(t0.getTime() + HOUR);

        const stats = await getResponseTimeStats(companyId, start, end, target);
        // Found at all (created_at falls in range even though the claimed
        // WhatsApp timestamp is 10 days outside it), and correctly measured
        // as a genuine 45-minute breach - never a fake negative/zero
        // "instant reply".
        expect(stats.totalConversations).toBe(1);
        expect(stats.withinSlaCount).toBe(0);

        const breaches = await getSlaBreaches(companyId, start, end, target, 10);
        expect(breaches).toHaveLength(1);
        expect(breaches[0].responseMinutes).toBeCloseTo(45, 1);
      });
    },
  );

  integrationTest(
    "same-millisecond inbound -> outbound -> inbound orders correctly by seq, never by created_at/id ties",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const target = 30;
        const t0 = new Date("2026-01-01T00:00:00Z");
        const contact = await insertContactWithCase(tenantDb, companyId, t0);

        // All three messages share the EXACT SAME created_at/timestamp
        // instant - only insertion order (seq) can tell them apart.
        await insertMessageWithTimes(tenantDb, contact, false, t0, t0);
        await insertMessageWithTimes(tenantDb, contact, true, t0, t0);
        await insertMessageWithTimes(tenantDb, contact, false, t0, t0);

        // Resolve so the still-unanswered second episode is measured
        // against the case's fixed `resolved_at`, not wall-clock "now" -
        // this test only cares about turn ORDERING, not elapsed magnitude.
        await resolveActiveCase(tenantDb, contact, {
          outcome: "no_reply_needed",
          resolvedBy: crypto.randomUUID(),
        });

        const start = new Date(t0.getTime() - HOUR);
        const end = new Date(t0.getTime() + HOUR);

        const stats = await getResponseTimeStats(companyId, start, end, target);
        // Exactly one COUNTED episode: the first inbound, answered
        // immediately by the outbound (0 minutes, compliant). The second
        // inbound is unanswered but excluded (valid exclusion outcome) -
        // never one episode with the outbound matched to the wrong
        // inbound, and never a crash from an ambiguous same-millisecond
        // tie.
        expect(stats.totalConversations).toBe(1);
        expect(stats.withinSlaCount).toBe(1);
      });
    },
  );
});
