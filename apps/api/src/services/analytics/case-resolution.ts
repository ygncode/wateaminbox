/**
 * Resolution-SLA analytics: case-cycle metrics, replacing the old
 * mutable-state `conversation_states.resolved_at`-based resolution stats.
 *
 * Resolution SLA runs from a case's `opened_at` to its `resolved_at`
 * (manual resolve only - closing with a valid response-SLA exclusion still
 * evaluates resolution normally, since resolution measures "did we close
 * this out," not "did we personally reply"). All durations are BUSINESS
 * minutes against the case's own snapshotted policy (see
 * conversation-case.service.ts) - never wall-clock, and never the
 * company's CURRENT policy for a historical case.
 *
 * Two distinct, independently-bounded queries feed every stat here:
 *   - resolved cases whose `resolved_at` falls in the requested date range
 *     (durations/compliance/trend/team attribution)
 *   - ALL currently active (open/pending) cases, regardless of when they
 *     opened (the overdue-work-queue signal)
 * Deliberately NOT one query unioning "opened in range OR resolved in
 * range": that would (a) miscount a case opened outside the range but
 * resolved inside it, or vice versa, against the wrong bucket, and (b) tie
 * the "how much overdue active work exists right now" question to
 * whatever date range the dashboard happens to be showing, and to the
 * cap - overdue active cases must never disappear just because a
 * company has accumulated more than MAX_CASES_PER_QUERY resolved cases in
 * its lifetime.
 */

import { dayjs } from "@wateaminbox/shared";
import { sql, type RawBuilder } from "kysely";
import { AnalyticsRangeTooWideError, NotFoundError } from "../../lib/errors.js";
import {
  businessMinutesBetween,
  OVERDUE_STRICT_EPSILON_MINUTES,
  type SlaCalendar,
} from "../sla-policy/calendar.js";
import { getCurrentSlaPolicy } from "../sla-policy/policy.service.js";
import { getSchemaName, getTenantConnection } from "../tenant.service.js";

/**
 * Safety bound on rows processed per query. Applied SEPARATELY to the
 * resolved-in-range query and the active-cases query (see module doc
 * comment) - a company with a long resolved history never starves the
 * active-cases query's budget, and vice versa.
 */
export const MAX_CASES_PER_QUERY = 5000;

export type CaseKind = "direct" | "group";

interface CaseWithPolicyRow {
  case_id: string;
  contact_id: string;
  contact_name: string | null;
  kind: CaseKind;
  status: "open" | "pending" | "resolved";
  opened_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_outcome: string | null;
  resolution_target_minutes: number;
  policy_timezone: string | null;
  policy_weekly_schedule: unknown;
  policy_exceptions: unknown;
}

export interface ResolvedCaseRow {
  caseId: string;
  contactId: string;
  contactName: string | null;
  kind: CaseKind;
  status: "open" | "pending" | "resolved";
  openedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionOutcome: string | null;
  resolutionTargetMinutes: number;
  calendar: SlaCalendar | null;
}

function mapRow(row: CaseWithPolicyRow): ResolvedCaseRow {
  return {
    caseId: row.case_id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    kind: row.kind,
    status: row.status,
    openedAt: row.opened_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionOutcome: row.resolution_outcome,
    resolutionTargetMinutes: row.resolution_target_minutes,
    calendar: row.policy_timezone
      ? {
          timezone: row.policy_timezone,
          weeklySchedule: row.policy_weekly_schedule as SlaCalendar["weeklySchedule"],
          exceptions: row.policy_exceptions as SlaCalendar["exceptions"],
        }
      : null,
  };
}

async function queryCasesWithPolicy(
  companyId: string,
  whereClause: RawBuilder<unknown>,
): Promise<ResolvedCaseRow[]> {
  const tenantDb = getTenantConnection(companyId);
  const casesTable = sql.table(
    `${getSchemaName(companyId)}.conversation_cases`,
  );
  const contactsTable = sql.table(`${getSchemaName(companyId)}.contacts`);
  const policiesTable = sql.table("public.sla_policies");

  const result = await sql<CaseWithPolicyRow>`
    SELECT
      cc.id as case_id,
      cc.contact_id,
      COALESCE(c.custom_name, c.push_name, c.phone_number) as contact_name,
      cc.kind,
      cc.status,
      cc.opened_at,
      cc.resolved_at,
      cc.resolved_by,
      cc.resolution_outcome,
      cc.resolution_target_minutes,
      policy.timezone as policy_timezone,
      policy.weekly_schedule as policy_weekly_schedule,
      policy.exceptions as policy_exceptions
    FROM ${casesTable} cc
    INNER JOIN ${contactsTable} c ON c.id = cc.contact_id
    LEFT JOIN LATERAL (
      SELECT timezone, weekly_schedule, exceptions
      FROM ${policiesTable} sp
      WHERE sp.id = cc.policy_id
      LIMIT 1
    ) policy ON true
    WHERE ${whereClause}
    ORDER BY cc.opened_at DESC
    LIMIT ${MAX_CASES_PER_QUERY + 1}
  `.execute(tenantDb);

  if (result.rows.length > MAX_CASES_PER_QUERY) {
    throw new AnalyticsRangeTooWideError(MAX_CASES_PER_QUERY);
  }

  return result.rows.map(mapRow);
}

/** Cases resolved with `resolved_at` in [startDate, endDate] - the basis for durations/compliance/trend/team attribution. */
export async function fetchResolvedCasesInRange(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<ResolvedCaseRow[]> {
  return queryCasesWithPolicy(
    companyId,
    sql`cc.status = 'resolved' AND cc.resolved_at >= ${startDate} AND cc.resolved_at <= ${endDate}`,
  );
}

/** Every currently-active (open/pending) case, regardless of when it opened. */
export async function fetchActiveCases(
  companyId: string,
): Promise<ResolvedCaseRow[]> {
  return queryCasesWithPolicy(companyId, sql`cc.status IN ('open', 'pending')`);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
}

function resolutionMinutes(row: ResolvedCaseRow): number | null {
  if (!row.calendar) return null;
  if (row.status !== "resolved" || !row.resolvedAt) return null;
  return businessMinutesBetween(row.calendar, row.openedAt, row.resolvedAt, {});
}

/** True once a still-active case's elapsed business minutes exceed its resolution target. */
function isOverdueActive(row: ResolvedCaseRow, now: Date): boolean {
  if (!row.calendar || row.status === "resolved") return false;
  const elapsed = businessMinutesBetween(row.calendar, row.openedAt, now, {
    earlyExitAt: row.resolutionTargetMinutes + OVERDUE_STRICT_EPSILON_MINUTES,
  });
  return elapsed > row.resolutionTargetMinutes;
}

export interface CaseResolutionStatsCore {
  totalResolvedCases: number;
  averageResolutionMinutes: number;
  medianResolutionMinutes: number;
  withinSlaCount: number;
  /** resolved-in-range count + currently-overdue-active count - the compliance denominator. */
  totalEvaluated: number;
  slaComplianceRate: number;
  overdueActiveCases: number;
}

export interface CaseResolutionStats extends CaseResolutionStatsCore {
  byKind: Record<CaseKind, CaseResolutionStatsCore>;
}

function statsForRows(
  resolved: ResolvedCaseRow[],
  overdueActive: ResolvedCaseRow[],
): CaseResolutionStatsCore {
  const durations = resolved
    .map((r) => resolutionMinutes(r))
    .filter((m): m is number => m !== null);
  const withinSla = resolved.filter((r) => {
    const minutes = resolutionMinutes(r);
    return minutes !== null && minutes <= r.resolutionTargetMinutes;
  });
  // Compliance denominator: every resolved case in range, PLUS every
  // currently-overdue active case (they have already broken the SLA even
  // though no one has closed them yet - they must count as failures, not
  // silently wait for resolution to be counted at all). A pending/open
  // case that hasn't yet crossed its target is excluded entirely - neither
  // compliant nor a breach yet.
  const totalEvaluated = resolved.length + overdueActive.length;

  return {
    totalResolvedCases: resolved.length,
    averageResolutionMinutes: average(durations),
    medianResolutionMinutes: median(durations),
    withinSlaCount: withinSla.length,
    totalEvaluated,
    slaComplianceRate:
      totalEvaluated > 0 ? (withinSla.length / totalEvaluated) * 100 : 0,
    overdueActiveCases: overdueActive.length,
  };
}

export async function getCaseResolutionStats(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<CaseResolutionStats> {
  const now = new Date();
  const [resolved, active] = await Promise.all([
    fetchResolvedCasesInRange(companyId, startDate, endDate),
    fetchActiveCases(companyId),
  ]);
  const overdueActive = active.filter((r) => isOverdueActive(r, now));

  const overall = statsForRows(resolved, overdueActive);
  const direct = statsForRows(
    resolved.filter((r) => r.kind === "direct"),
    overdueActive.filter((r) => r.kind === "direct"),
  );
  const group = statsForRows(
    resolved.filter((r) => r.kind === "group"),
    overdueActive.filter((r) => r.kind === "group"),
  );

  return { ...overall, byKind: { direct, group } };
}

export interface CaseResolutionTrendPoint {
  date: string;
  resolvedCount: number;
  averageResolutionMinutes: number;
  slaComplianceRate: number;
}

export async function getCaseResolutionTrend(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<CaseResolutionTrendPoint[]> {
  const [rows, currentPolicy] = await Promise.all([
    fetchResolvedCasesInRange(companyId, startDate, endDate),
    getCurrentSlaPolicy(companyId).catch((error) => {
      if (error instanceof NotFoundError) return null;
      throw error;
    }),
  ]);
  const reportingTimezone = currentPolicy?.timezone ?? "UTC";

  const byDate = new Map<
    string,
    { minutes: number[]; total: number; withinSla: number }
  >();

  for (const row of rows) {
    if (!row.resolvedAt) continue;
    const minutes = resolutionMinutes(row);
    if (minutes === null) continue;

    const dateKey = dayjs.tz(row.resolvedAt, reportingTimezone).format("YYYY-MM-DD");
    const bucket = byDate.get(dateKey) ?? { minutes: [], total: 0, withinSla: 0 };
    bucket.minutes.push(minutes);
    bucket.total += 1;
    if (minutes <= row.resolutionTargetMinutes) bucket.withinSla += 1;
    byDate.set(dateKey, bucket);
  }

  const trend: CaseResolutionTrendPoint[] = [];
  let current = dayjs.tz(startDate, reportingTimezone).startOf("day");
  const last = dayjs.tz(endDate, reportingTimezone).startOf("day");
  while (current.isBefore(last) || current.isSame(last, "day")) {
    const dateStr = current.format("YYYY-MM-DD");
    const bucket = byDate.get(dateStr);
    trend.push({
      date: dateStr,
      resolvedCount: bucket?.total ?? 0,
      averageResolutionMinutes: bucket ? average(bucket.minutes) : 0,
      slaComplianceRate:
        bucket && bucket.total > 0 ? (bucket.withinSla / bucket.total) * 100 : 0,
    });
    current = current.add(1, "day");
  }

  return trend;
}

export interface TeamCaseResolutionStats {
  userId: string;
  email: string;
  totalResolvedCases: number;
  averageResolutionMinutes: number;
  slaComplianceRate: number;
}

export async function getTeamCaseResolutionStats(
  companyId: string,
  startDate: Date,
  endDate: Date,
  members: Array<{ user_id: string; email: string }>,
): Promise<TeamCaseResolutionStats[]> {
  const rows = await fetchResolvedCasesInRange(companyId, startDate, endDate);

  const byUser = new Map<string, { minutes: number[]; withinSla: number }>();
  for (const row of rows) {
    if (!row.resolvedBy) continue;
    const minutes = resolutionMinutes(row);
    if (minutes === null) continue;
    const bucket = byUser.get(row.resolvedBy) ?? { minutes: [], withinSla: 0 };
    bucket.minutes.push(minutes);
    if (minutes <= row.resolutionTargetMinutes) bucket.withinSla += 1;
    byUser.set(row.resolvedBy, bucket);
  }

  return members
    .map((member) => {
      const bucket = byUser.get(member.user_id);
      const total = bucket?.minutes.length ?? 0;
      return {
        userId: member.user_id,
        email: member.email,
        totalResolvedCases: total,
        averageResolutionMinutes: bucket ? average(bucket.minutes) : 0,
        slaComplianceRate: total > 0 ? (bucket!.withinSla / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.totalResolvedCases - a.totalResolvedCases);
}

export interface OverdueCase {
  caseId: string;
  contactId: string;
  contactName: string | null;
  kind: CaseKind;
  status: "open" | "pending";
  openedAt: Date;
  elapsedMinutes: number;
  resolutionTargetMinutes: number;
}

/**
 * Currently-overdue active cases (a "work queue" of resolution breaches),
 * sorted worst-first. Queries ALL active cases directly (see module doc
 * comment) - never a byproduct of a resolved-history scan, so this can
 * never fail or omit results because a company has a long resolved history.
 */
export async function getOverdueActiveCases(
  companyId: string,
  limit: number = 50,
): Promise<OverdueCase[]> {
  const rows = await fetchActiveCases(companyId);
  const now = new Date();

  const overdue: OverdueCase[] = [];
  for (const row of rows) {
    if (!row.calendar) continue;
    const elapsedMinutes = businessMinutesBetween(row.calendar, row.openedAt, now);
    if (elapsedMinutes <= row.resolutionTargetMinutes) continue;
    overdue.push({
      caseId: row.caseId,
      contactId: row.contactId,
      contactName: row.contactName,
      kind: row.kind,
      status: row.status as "open" | "pending",
      openedAt: row.openedAt,
      elapsedMinutes,
      resolutionTargetMinutes: row.resolutionTargetMinutes,
    });
  }

  overdue.sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);
  return overdue.slice(0, limit);
}
