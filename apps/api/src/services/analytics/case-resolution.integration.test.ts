import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import type { SlaWeeklySchedule } from "@wateaminbox/shared";
import { AnalyticsRangeTooWideError } from "../../lib/errors.js";
import { getCurrentSlaPolicy, resolveCaseTargets } from "../sla-policy/policy.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  dropTenantSchema,
  getTenantConnection,
} from "../tenant.service.js";
import {
  getCaseResolutionStats,
  getCaseResolutionTrend,
  getOverdueActiveCases,
  getTeamCaseResolutionStats,
  MAX_CASES_PER_QUERY,
} from "./case-resolution.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const OFFICE_HOURS_UTC: SlaWeeklySchedule = [
  { weekday: 0, open: false, intervals: [] },
  { weekday: 1, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 2, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 3, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 4, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 5, open: true, intervals: [{ start: "09:00", end: "17:00" }] },
  { weekday: 6, open: false, intervals: [] },
];

async function withTenant(
  run: (
    companyId: string,
    tenantDb: ReturnType<typeof getTenantConnection>,
  ) => Promise<void>,
  weeklySchedule: SlaWeeklySchedule = DEFAULT_SLA_WEEKLY_SCHEDULE,
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
        name: "Case resolution analytics test",
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
        direct_resolution_target_minutes: 120,
        group_response_target_minutes: 120,
        group_resolution_target_minutes: 240,
        timezone: "UTC",
        weekly_schedule: JSON.stringify(weeklySchedule),
        exceptions: JSON.stringify([]),
        effective_from: new Date("1970-01-01T00:00:00Z"),
        created_by: ownerId,
      })
      .execute();

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

interface CaseSeed {
  kind?: "direct" | "group";
  status: "open" | "pending" | "resolved";
  openedAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  resolutionOutcome?: "handled" | "no_reply_needed" | "spam" | "duplicate" | "other";
}

async function insertCase(
  tenantDb: ReturnType<typeof getTenantConnection>,
  companyId: string,
  contactId: string,
  seed: CaseSeed,
): Promise<string> {
  const policy = await getCurrentSlaPolicy(companyId);
  const kind = seed.kind ?? "direct";
  const targets = resolveCaseTargets(policy, kind);
  const [row] = await tenantDb
    .insertInto("conversation_cases")
    .values({
      contact_id: contactId,
      kind,
      status: seed.status,
      opened_at: seed.openedAt,
      open_source: "live_inbound",
      policy_id: policy.id,
      response_target_minutes: targets.responseTargetMinutes,
      resolution_target_minutes: targets.resolutionTargetMinutes,
      resolved_at: seed.resolvedAt ?? null,
      resolved_by: seed.resolvedBy ?? null,
      resolution_outcome: seed.resolvedAt ? (seed.resolutionOutcome ?? "handled") : null,
    })
    .returning("id")
    .execute();
  return row.id;
}

describe("case resolution analytics - range boundaries", () => {
  integrationTest(
    "counts a resolution by resolved_at in range, even when opened well outside it",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const contactId = await insertContact(tenantDb);
        const openedAt = new Date("2025-01-01T00:00:00Z"); // long before the range
        const resolvedAt = new Date("2026-01-15T00:00:00Z"); // inside the range

        await insertCase(tenantDb, companyId, contactId, {
          status: "resolved",
          openedAt,
          resolvedAt,
          resolvedBy: crypto.randomUUID(),
        });

        const start = new Date("2026-01-01T00:00:00Z");
        const end = new Date("2026-01-31T00:00:00Z");

        const stats = await getCaseResolutionStats(companyId, start, end);
        expect(stats.totalResolvedCases).toBe(1);
      });
    },
  );

  integrationTest(
    "excludes a case opened in range but resolved outside it",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const contactId = await insertContact(tenantDb);
        const openedAt = new Date("2026-01-05T00:00:00Z"); // inside the range
        const resolvedAt = new Date("2026-03-01T00:00:00Z"); // outside the range

        await insertCase(tenantDb, companyId, contactId, {
          status: "resolved",
          openedAt,
          resolvedAt,
          resolvedBy: crypto.randomUUID(),
        });

        const start = new Date("2026-01-01T00:00:00Z");
        const end = new Date("2026-01-31T00:00:00Z");

        const stats = await getCaseResolutionStats(companyId, start, end);
        expect(stats.totalResolvedCases).toBe(0);
      });
    },
  );

  integrationTest(
    "trend buckets resolutions by resolved_at, not opened_at",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const contactId = await insertContact(tenantDb);
        await insertCase(tenantDb, companyId, contactId, {
          status: "resolved",
          openedAt: new Date("2025-06-01T00:00:00Z"),
          resolvedAt: new Date("2026-01-10T12:00:00Z"),
          resolvedBy: crypto.randomUUID(),
        });

        const trend = await getCaseResolutionTrend(
          companyId,
          new Date("2026-01-01T00:00:00Z"),
          new Date("2026-01-31T00:00:00Z"),
        );

        const day = trend.find((d) => d.date === "2026-01-10");
        expect(day?.resolvedCount).toBe(1);
      });
    },
  );
});

describe("case resolution analytics - compliance denominator", () => {
  integrationTest(
    "an overdue active case counts as a failure even though it's not resolved",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const contactId = await insertContact(tenantDb);
        // direct_resolution_target_minutes = 120 (2h); opened 3 hours ago -> overdue.
        await insertCase(tenantDb, companyId, contactId, {
          status: "open",
          openedAt: new Date(Date.now() - 3 * HOUR),
        });

        const stats = await getCaseResolutionStats(
          companyId,
          new Date(Date.now() - HOUR),
          new Date(Date.now() + HOUR),
        );
        expect(stats.overdueActiveCases).toBe(1);
        expect(stats.totalEvaluated).toBe(1);
        expect(stats.withinSlaCount).toBe(0);
        expect(stats.slaComplianceRate).toBe(0);
      });
    },
  );

  integrationTest(
    "an active case still under its target is excluded entirely (neither compliant nor a breach)",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const contactId = await insertContact(tenantDb);
        await insertCase(tenantDb, companyId, contactId, {
          status: "open",
          openedAt: new Date(Date.now() - 10 * MINUTE),
        });

        const stats = await getCaseResolutionStats(
          companyId,
          new Date(Date.now() - HOUR),
          new Date(Date.now() + HOUR),
        );
        expect(stats.overdueActiveCases).toBe(0);
        expect(stats.totalEvaluated).toBe(0);
      });
    },
  );

  integrationTest(
    "overdue active cases are counted regardless of the requested date range",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const contactId = await insertContact(tenantDb);
        // Opened long ago, far outside any reasonable dashboard range - must
        // still show up as currently overdue.
        await insertCase(tenantDb, companyId, contactId, {
          status: "open",
          openedAt: new Date("2020-01-01T00:00:00Z"),
        });

        const stats = await getCaseResolutionStats(
          companyId,
          new Date(Date.now() - HOUR),
          new Date(Date.now() + HOUR),
        );
        expect(stats.overdueActiveCases).toBe(1);

        const overdueList = await getOverdueActiveCases(companyId);
        expect(overdueList).toHaveLength(1);
        expect(overdueList[0].contactId).toBe(contactId);
      });
    },
  );
});

describe("case resolution analytics - direct/group targets and byKind", () => {
  integrationTest(
    "direct and group cases use their own resolution targets in the breakdown",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const directContact = await insertContact(tenantDb);
        const groupContact = await insertContact(tenantDb);

        // Direct target = 120 min; resolved in 60 min -> compliant.
        const directOpened = new Date("2026-01-05T00:00:00Z");
        await insertCase(tenantDb, companyId, directContact, {
          kind: "direct",
          status: "resolved",
          openedAt: directOpened,
          resolvedAt: new Date(directOpened.getTime() + 60 * MINUTE),
          resolvedBy: crypto.randomUUID(),
        });

        // Group target = 240 min; resolved in 300 min -> breach.
        const groupOpened = new Date("2026-01-05T00:00:00Z");
        await insertCase(tenantDb, companyId, groupContact, {
          kind: "group",
          status: "resolved",
          openedAt: groupOpened,
          resolvedAt: new Date(groupOpened.getTime() + 300 * MINUTE),
          resolvedBy: crypto.randomUUID(),
        });

        const stats = await getCaseResolutionStats(
          companyId,
          new Date("2026-01-01T00:00:00Z"),
          new Date("2026-01-31T00:00:00Z"),
        );
        expect(stats.byKind.direct.totalResolvedCases).toBe(1);
        expect(stats.byKind.direct.withinSlaCount).toBe(1);
        expect(stats.byKind.group.totalResolvedCases).toBe(1);
        expect(stats.byKind.group.withinSlaCount).toBe(0);
      });
    },
  );
});

describe("case resolution analytics - business calendar (weekend/holiday)", () => {
  integrationTest(
    "a weekend closure pauses the resolution clock, unlike wall-clock time",
    async () => {
      await withTenant(
        async (companyId, tenantDb) => {
          const contactId = await insertContact(tenantDb);
          // Friday 16:50 UTC -> Monday 09:10 UTC: ~56 wall-clock hours, but
          // only 20 business minutes (10 Fri + 10 Mon) - well under the
          // 120-minute direct resolution target.
          const openedAt = new Date("2026-01-02T16:50:00Z");
          const resolvedAt = new Date("2026-01-05T09:10:00Z");
          await insertCase(tenantDb, companyId, contactId, {
            status: "resolved",
            openedAt,
            resolvedAt,
            resolvedBy: crypto.randomUUID(),
          });

          const stats = await getCaseResolutionStats(
            companyId,
            new Date("2026-01-02T00:00:00Z"),
            new Date("2026-01-06T00:00:00Z"),
          );
          expect(stats.averageResolutionMinutes).toBeCloseTo(20, 5);
          expect(stats.withinSlaCount).toBe(1);
        },
        OFFICE_HOURS_UTC,
      );
    },
  );
});

describe("case resolution analytics - team attribution", () => {
  integrationTest(
    "attributes resolution to the resolving user, left-fills members with zero",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const memberA = crypto.randomUUID();
        const memberB = crypto.randomUUID();
        await db
          .insertInto("users")
          .values([
            { id: memberA, email: `a-${memberA}@example.com`, password_hash: "x" },
            { id: memberB, email: `b-${memberB}@example.com`, password_hash: "x" },
          ])
          .execute();
        await db
          .insertInto("company_members")
          .values([
            { company_id: companyId, user_id: memberA, role: "member" },
            { company_id: companyId, user_id: memberB, role: "member" },
          ])
          .execute();

        const contactId = await insertContact(tenantDb);
        const openedAt = new Date("2026-01-05T00:00:00Z");
        await insertCase(tenantDb, companyId, contactId, {
          status: "resolved",
          openedAt,
          resolvedAt: new Date(openedAt.getTime() + 30 * MINUTE),
          resolvedBy: memberA,
        });

        try {
          const stats = await getTeamCaseResolutionStats(
            companyId,
            new Date("2026-01-01T00:00:00Z"),
            new Date("2026-01-31T00:00:00Z"),
            [
              { user_id: memberA, email: `a-${memberA}@example.com` },
              { user_id: memberB, email: `b-${memberB}@example.com` },
            ],
          );
          const byUser = new Map(stats.map((s) => [s.userId, s]));
          expect(byUser.get(memberA)?.totalResolvedCases).toBe(1);
          expect(byUser.get(memberB)?.totalResolvedCases).toBe(0);
        } finally {
          await db
            .deleteFrom("company_members")
            .where("company_id", "=", companyId)
            .where("user_id", "in", [memberA, memberB])
            .execute();
          await db
            .deleteFrom("users")
            .where("id", "in", [memberA, memberB])
            .execute();
        }
      });
    },
  );
});

describe("case resolution analytics - exceeding the cap fails explicitly", () => {
  integrationTest(
    "throws AnalyticsRangeTooWideError for the resolved-in-range query instead of truncating",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const overCap = MAX_CASES_PER_QUERY + 1;
        const policy = await getCurrentSlaPolicy(companyId);
        const targets = resolveCaseTargets(policy, "direct");
        const base = new Date("2026-01-01T00:00:00Z");

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
          status: "resolved" as const,
          opened_at: new Date(base.getTime() + i * 1000),
          open_source: "live_inbound" as const,
          resolved_at: new Date(base.getTime() + i * 1000 + 60_000),
          resolved_by: crypto.randomUUID(),
          resolution_outcome: "handled" as const,
          policy_id: policy.id,
          response_target_minutes: targets.responseTargetMinutes,
          resolution_target_minutes: targets.resolutionTargetMinutes,
        }));
        await tenantDb.insertInto("conversation_cases").values(cases).execute();

        const start = new Date(base.getTime() - HOUR);
        const end = new Date(base.getTime() + overCap * 1000 + HOUR);

        await expect(
          getCaseResolutionStats(companyId, start, end),
        ).rejects.toBeInstanceOf(AnalyticsRangeTooWideError);
      });
    },
  );

  integrationTest(
    "a large resolved history never breaks the overdue-active-cases query",
    async () => {
      await withTenant(async (companyId, tenantDb) => {
        const overCap = MAX_CASES_PER_QUERY + 1;
        const policy = await getCurrentSlaPolicy(companyId);
        const targets = resolveCaseTargets(policy, "direct");
        const base = new Date("2020-01-01T00:00:00Z");

        const contacts = Array.from({ length: overCap }, (_, i) => ({
          jid: `${crypto.randomUUID()}@s.whatsapp.net`,
          phone_number: `hist-${i}`,
          push_name: `History contact ${i}`,
        }));
        const insertedContacts = await tenantDb
          .insertInto("contacts")
          .values(contacts)
          .returning("id")
          .execute();

        const resolvedCases = insertedContacts.map((contact, i) => ({
          contact_id: contact.id,
          kind: "direct" as const,
          status: "resolved" as const,
          opened_at: new Date(base.getTime() + i * 1000),
          open_source: "live_inbound" as const,
          resolved_at: new Date(base.getTime() + i * 1000 + 60_000),
          resolved_by: crypto.randomUUID(),
          resolution_outcome: "handled" as const,
          policy_id: policy.id,
          response_target_minutes: targets.responseTargetMinutes,
          resolution_target_minutes: targets.resolutionTargetMinutes,
        }));
        await tenantDb
          .insertInto("conversation_cases")
          .values(resolvedCases)
          .execute();

        // One single currently-overdue active case, on top of the huge
        // resolved history above.
        const overdueContact = await insertContact(tenantDb);
        await insertCase(tenantDb, companyId, overdueContact, {
          status: "open",
          openedAt: new Date(Date.now() - 3 * HOUR),
        });

        const overdue = await getOverdueActiveCases(companyId);
        expect(overdue).toHaveLength(1);
        expect(overdue[0].contactId).toBe(overdueContact);
      });
    },
  );
});
