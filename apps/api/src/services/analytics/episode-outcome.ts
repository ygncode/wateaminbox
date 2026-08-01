/**
 * Per-episode SLA outcome evaluation.
 *
 * Bridges raw resolved episodes (see episode-resolution.ts) and the
 * business-hours calendar math (see ../sla-policy/calendar.ts) into the
 * numbers analytics aggregates: business minutes to reply, and whether an
 * unanswered episode has become an overdue breach.
 */

import { businessMinutesBetween } from "../sla-policy/calendar.js";
import type { ResolvedEpisodeRow } from "./episode-resolution.js";

export interface EpisodeOutcome {
  contactId: string;
  contactName: string | null;
  inboundTime: Date;
  responseTime: Date | null;
  respondedBy: string | null;
  /** `targetOverrideMinutes` if provided, otherwise the episode's own historical policy target. */
  effectiveTargetMinutes: number;
  /** Business minutes from the episode's inbound message to its first reply. `null` if unanswered. */
  responseMinutes: number | null;
  /**
   * Only meaningful when `responseTime` is null: true once the episode's
   * elapsed BUSINESS minutes (not wall-clock) exceed `effectiveTargetMinutes`.
   * A still-pending unanswered episode younger than the target is not yet a
   * breach either way.
   */
  isOverdueUnanswered: boolean;
}

/**
 * Evaluates one episode's SLA outcome. Returns `null` only if the episode
 * has no resolvable policy (a company should always have at least one -
 * seeded at creation, backfilled by migration - so this is a defensive
 * guard, not an expected path).
 *
 * `targetOverrideMinutes`, when provided, replaces only the target
 * duration used for compliance decisions; the episode's own historical
 * policy calendar is still always used for the business-minutes
 * calculation itself (an override never rewrites which calendar an
 * episode is measured against).
 */
export function computeEpisodeOutcome(
  row: ResolvedEpisodeRow,
  targetOverrideMinutes: number | undefined,
  now: Date,
): EpisodeOutcome | null {
  if (!row.policy) return null;

  const effectiveTargetMinutes =
    targetOverrideMinutes ?? row.policy.targetMinutes;

  if (row.responseTime) {
    const responseMinutes = businessMinutesBetween(
      row.policy.calendar,
      row.inboundTime,
      row.responseTime,
    );
    return {
      contactId: row.contactId,
      contactName: row.contactName,
      inboundTime: row.inboundTime,
      responseTime: row.responseTime,
      respondedBy: row.respondedBy,
      effectiveTargetMinutes,
      responseMinutes,
      isOverdueUnanswered: false,
    };
  }

  const pendingMinutes = businessMinutesBetween(
    row.policy.calendar,
    row.inboundTime,
    now,
    { earlyExitAt: effectiveTargetMinutes },
  );

  return {
    contactId: row.contactId,
    contactName: row.contactName,
    inboundTime: row.inboundTime,
    responseTime: null,
    respondedBy: null,
    effectiveTargetMinutes,
    responseMinutes: null,
    isOverdueUnanswered: pendingMinutes > effectiveTargetMinutes,
  };
}

/**
 * Exact (non-early-exiting) elapsed business minutes for a still-unanswered
 * episode, up to `now`. Only call this for episodes already known to be
 * breaches (see `computeEpisodeOutcome`'s cheap early-exit check) - this is
 * for display/sort magnitude, not the yes/no overdue decision.
 */
export function computeExactPendingBusinessMinutes(
  row: ResolvedEpisodeRow,
  now: Date,
): number {
  if (!row.policy) return 0;
  return businessMinutesBetween(row.policy.calendar, row.inboundTime, now);
}
