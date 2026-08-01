/**
 * Response time analytics - calendar-aware SLA.
 *
 * All figures here (response times, compliance, breaches, team stats) are
 * measured in BUSINESS minutes against each response episode's own
 * historical SLA policy: the policy version that was active when that
 * episode's first inbound message arrived (see episode-resolution.ts).
 * Editing the current policy later never rewrites past results, and a
 * dashboard date range can transparently span multiple policy versions.
 *
 * Business minutes (not wall-clock minutes) are used consistently
 * throughout - see ../sla-policy/calendar.ts for the calendar math and
 * episode-outcome.ts for how each episode's outcome is derived.
 */

import { db } from "@wateaminbox/database";
import { dayjs } from "@wateaminbox/shared";
import { NotFoundError } from "../../lib/errors.js";
import { getCurrentSlaPolicy } from "../sla-policy/policy.service.js";
import {
  computeEpisodeOutcome,
  computeExactPendingBusinessMinutes,
  type EpisodeOutcome,
} from "./episode-outcome.js";
import { fetchEpisodesWithPolicy } from "./episode-resolution.js";
import type {
  ResponseTimeByDate,
  ResponseTimeStats,
  SlaBreach,
  TeamResponseTimeStats,
} from "./types.js";

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Matches Postgres PERCENTILE_CONT(0.5): linear interpolation between the two middle order statistics. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  const lower = Math.floor(mid);
  const upper = Math.ceil(mid);
  return (sorted[lower] + sorted[upper]) / 2;
}

function isCountedInCompliance(outcome: EpisodeOutcome): boolean {
  // Answered episodes always count (whatever their outcome); unanswered
  // episodes count only once they're already overdue (a still-pending
  // unanswered episode younger than the target is neither compliant nor
  // a breach yet, so it's excluded from the denominator either way).
  return outcome.responseTime !== null || outcome.isOverdueUnanswered;
}

function isWithinSla(outcome: EpisodeOutcome): boolean {
  return (
    outcome.responseMinutes !== null &&
    outcome.responseMinutes <= outcome.effectiveTargetMinutes
  );
}

/**
 * Calculate response times for conversations.
 *
 * `totalConversations`/`withinSlaCount` (and therefore `slaComplianceRate`)
 * include every answered episode plus unanswered episodes that are already
 * overdue (elapsed business minutes > target) - matching `getSlaBreaches`.
 * Still-pending unanswered episodes are excluded (neither compliant nor a
 * breach yet).
 *
 * `averageResponseTimeMinutes`/`medianResponseTimeMinutes`/
 * `maxResponseTimeMinutes`/`minResponseTimeMinutes` are computed over
 * ANSWERED episodes only, in business minutes - an unanswered episode has
 * no response time to average.
 */
export async function getResponseTimeStats(
  companyId: string,
  startDate: Date,
  endDate: Date,
  targetOverrideMinutes?: number,
): Promise<ResponseTimeStats> {
  const rows = await fetchEpisodesWithPolicy(companyId, startDate, endDate);
  const now = new Date();
  const outcomes = rows
    .map((row) => computeEpisodeOutcome(row, targetOverrideMinutes, now))
    .filter((o): o is EpisodeOutcome => o !== null);

  const complianceSet = outcomes.filter(isCountedInCompliance);
  const answeredMinutes = outcomes
    .filter((o) => o.responseMinutes !== null)
    .map((o) => o.responseMinutes as number);
  const withinSlaCount = complianceSet.filter(isWithinSla).length;
  const totalConversations = complianceSet.length;

  return {
    averageResponseTimeMinutes: average(answeredMinutes),
    medianResponseTimeMinutes: median(answeredMinutes),
    maxResponseTimeMinutes: answeredMinutes.length
      ? Math.max(...answeredMinutes)
      : 0,
    minResponseTimeMinutes: answeredMinutes.length
      ? Math.min(...answeredMinutes)
      : 0,
    totalConversations,
    withinSlaCount,
    slaComplianceRate:
      totalConversations > 0 ? (withinSlaCount / totalConversations) * 100 : 0,
  };
}

/**
 * Get response time trends over time.
 *
 * Presentation (which day an episode's bar/point belongs to, and which
 * dates appear on the axis at all - including zero-filled days) uses ONE
 * coherent reporting timezone: the company's CURRENT SLA policy timezone.
 * This is deliberately different from the SLA math above, which always
 * uses each episode's own historical policy calendar - two different
 * concerns: "was this episode compliant" (historical calendar) vs. "which
 * calendar day do we draw this point under" (current, single timezone, so
 * the chart has one coherent axis instead of episodes silently jumping
 * between timezones mid-chart if the policy's timezone ever changed).
 *
 * Both the axis enumeration and the per-episode bucket key are derived
 * from the same `reportingTimezone`, so no fetched episode can land on a
 * bucket key the axis walk never visits (local date is monotonic in the
 * underlying UTC instant, so walking from local-date(startDate) to
 * local-date(endDate) in that one timezone covers every possible bucket
 * for episodes whose inboundTime falls in [startDate, endDate]).
 *
 * Every company should always have a current policy (seeded at creation,
 * backfilled by migration), but resolving the reporting timezone is a
 * presentation concern, not part of the SLA compliance math itself - so if
 * that lookup ever fails (a data-integrity gap, not something the caller
 * can fix by retrying), this falls back to UTC for the axis rather than
 * failing the whole trend request; each episode's own compliance
 * calculation is unaffected either way.
 */
export async function getResponseTimeTrend(
  companyId: string,
  startDate: Date,
  endDate: Date,
  targetOverrideMinutes?: number,
): Promise<ResponseTimeByDate[]> {
  const [rows, currentPolicy] = await Promise.all([
    fetchEpisodesWithPolicy(companyId, startDate, endDate),
    getCurrentSlaPolicy(companyId).catch((error) => {
      if (error instanceof NotFoundError) return null;
      throw error;
    }),
  ]);
  const now = new Date();
  const reportingTimezone = currentPolicy?.timezone ?? "UTC";

  const byDate = new Map<
    string,
    { responseMinutes: number[]; total: number; withinSla: number }
  >();

  for (const row of rows) {
    const outcome = computeEpisodeOutcome(row, targetOverrideMinutes, now);
    if (!outcome) continue;

    const dateKey = dayjs
      .tz(row.inboundTime, reportingTimezone)
      .format("YYYY-MM-DD");
    const bucket = byDate.get(dateKey) ?? {
      responseMinutes: [],
      total: 0,
      withinSla: 0,
    };
    if (isCountedInCompliance(outcome)) {
      bucket.total += 1;
      if (isWithinSla(outcome)) bucket.withinSla += 1;
    }
    if (outcome.responseMinutes !== null) {
      bucket.responseMinutes.push(outcome.responseMinutes);
    }
    byDate.set(dateKey, bucket);
  }

  const trend: ResponseTimeByDate[] = [];
  let currentDate = dayjs.tz(startDate, reportingTimezone).startOf("day");
  const lastDate = dayjs.tz(endDate, reportingTimezone).startOf("day");

  while (
    currentDate.isBefore(lastDate) ||
    currentDate.isSame(lastDate, "day")
  ) {
    const dateStr = currentDate.format("YYYY-MM-DD");
    const bucket = byDate.get(dateStr);
    trend.push({
      date: dateStr,
      averageResponseTimeMinutes: bucket ? average(bucket.responseMinutes) : 0,
      conversationCount: bucket?.total ?? 0,
      slaComplianceRate:
        bucket && bucket.total > 0
          ? (bucket.withinSla / bucket.total) * 100
          : 0,
    });
    currentDate = currentDate.add(1, "day");
  }

  return trend;
}

/**
 * Get response time stats by team member.
 *
 * Each episode's response is resolved exactly once (see
 * episode-resolution.ts) and grouped by its true responder - a member's
 * later, unrelated reply can never be misattributed to another member's
 * earlier episode. Only answered episodes are considered: unresolved work
 * has no responder to attribute it to. Members with zero attributed
 * episodes in the window are left-filled with zeroed stats.
 */
export async function getTeamResponseTimeStats(
  companyId: string,
  startDate: Date,
  endDate: Date,
  targetOverrideMinutes?: number,
): Promise<TeamResponseTimeStats[]> {
  const rows = await fetchEpisodesWithPolicy(companyId, startDate, endDate);
  const now = new Date();

  const members = await db
    .selectFrom("company_members as cm")
    .innerJoin("users as u", "u.id", "cm.user_id")
    .select(["cm.user_id", "u.email"])
    .where("cm.company_id", "=", companyId)
    .execute();

  const byUser = new Map<
    string,
    { responseMinutes: number[]; withinSla: number }
  >();

  for (const row of rows) {
    if (!row.responseTime || !row.respondedBy) continue;
    const outcome = computeEpisodeOutcome(row, targetOverrideMinutes, now);
    if (!outcome || outcome.responseMinutes === null) continue;

    const bucket = byUser.get(row.respondedBy) ?? {
      responseMinutes: [],
      withinSla: 0,
    };
    bucket.responseMinutes.push(outcome.responseMinutes);
    if (isWithinSla(outcome)) bucket.withinSla += 1;
    byUser.set(row.respondedBy, bucket);
  }

  const stats: TeamResponseTimeStats[] = members.map((member) => {
    const bucket = byUser.get(member.user_id);
    const totalResponses = bucket?.responseMinutes.length ?? 0;
    return {
      userId: member.user_id,
      email: member.email,
      averageResponseTimeMinutes: bucket ? average(bucket.responseMinutes) : 0,
      totalResponses,
      slaComplianceRate:
        totalResponses > 0 ? (bucket!.withinSla / totalResponses) * 100 : 0,
    };
  });

  return stats.sort(
    (a, b) => a.averageResponseTimeMinutes - b.averageResponseTimeMinutes,
  );
}

/**
 * Get conversations that exceeded SLA threshold.
 *
 * A response episode is a breach when:
 * - it has already been answered and the reply took longer (in business
 *   minutes) than the SLA target - however long after the inbound message
 *   that reply landed, no arbitrary time window excludes it - or
 * - it is still unanswered AND its elapsed BUSINESS minutes have exceeded
 *   the target. An unanswered episode younger than the target is still
 *   pending, not a breach yet.
 *
 * For unanswered breaches, the exact elapsed-minutes magnitude (used for
 * sorting/display) is only computed for episodes already confirmed to be
 * breaches via the cheap early-exit check - avoiding a full calendar walk
 * for the (usually much larger) set of still-compliant pending episodes.
 */
export async function getSlaBreaches(
  companyId: string,
  startDate: Date,
  endDate: Date,
  targetOverrideMinutes?: number,
  limit: number = 50,
): Promise<SlaBreach[]> {
  const rows = await fetchEpisodesWithPolicy(companyId, startDate, endDate);
  const now = new Date();

  const breaches: SlaBreach[] = [];
  for (const row of rows) {
    const outcome = computeEpisodeOutcome(row, targetOverrideMinutes, now);
    if (!outcome) continue;

    const isAnsweredBreach =
      outcome.responseTime !== null &&
      outcome.responseMinutes !== null &&
      outcome.responseMinutes > outcome.effectiveTargetMinutes;
    const isUnansweredBreach =
      outcome.responseTime === null && outcome.isOverdueUnanswered;

    if (!isAnsweredBreach && !isUnansweredBreach) continue;

    const responseMinutes = isAnsweredBreach
      ? (outcome.responseMinutes as number)
      : computeExactPendingBusinessMinutes(row, now);

    breaches.push({
      contactId: row.contactId,
      contactName: row.contactName,
      inboundMessageTime: row.inboundTime,
      responseTime: row.responseTime,
      responseMinutes,
      respondedBy: row.respondedBy,
    });
  }

  breaches.sort((a, b) => b.responseMinutes - a.responseMinutes);
  return breaches.slice(0, limit);
}
