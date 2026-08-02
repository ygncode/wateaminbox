/**
 * Per-episode SLA outcome evaluation.
 *
 * Bridges raw resolved episodes (see episode-resolution.ts) and the
 * business-hours calendar math (see ../sla-policy/calendar.ts) into the
 * numbers analytics aggregates: business minutes to reply, and whether an
 * unanswered episode has become an overdue breach.
 */

import {
  businessMinutesBetween,
  OVERDUE_STRICT_EPSILON_MINUTES,
} from "../sla-policy/calendar.js";
import type {
  ResolvedEpisodeRow,
  ResponseSlaExclusionOutcome,
} from "./episode-resolution.js";

export interface EpisodeOutcome {
  contactId: string;
  contactName: string | null;
  caseId: string;
  caseKind: "direct" | "group";
  inboundTime: Date;
  responseTime: Date | null;
  respondedBy: string | null;
  /** `targetOverrideMinutes` if provided, otherwise the episode's own historical policy target. */
  effectiveTargetMinutes: number;
  /** Business minutes from the episode's inbound message to its first reply. `null` if unanswered. */
  responseMinutes: number | null;
  /**
   * True when this episode is a breach: either answered late, or unanswered
   * and either already overdue (still-open case) or terminally unanswered
   * (case closed without a valid exclusion - see below). Named
   * `isOverdueUnanswered` for backward compatibility even though a terminal
   * breach isn't "overdue" in the waiting-for-target sense - it's already
   * final.
   */
  isOverdueUnanswered: boolean;
  /**
   * True once the episode's case has closed (`resolved_at` is set). A
   * terminal unanswered episode is measured to that fixed instant, not to
   * "now" - its outcome can never change again, unlike a still-open case's
   * unanswered episode, which is provisional (could still be answered, or
   * could still tip over into a breach as time passes).
   */
  isTerminal: boolean;
  /**
   * Set only when this unanswered episode's case was closed with a valid
   * response-SLA exclusion outcome (no_reply_needed/spam/duplicate) - it is
   * reported separately and NEVER counted compliant. `handled`/`other`
   * never populate this field, so they can never silently launder an
   * unanswered episode into compliance.
   */
  exclusionOutcome: ResponseSlaExclusionOutcome | null;
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
      caseId: row.caseId,
      caseKind: row.caseKind,
      inboundTime: row.inboundTime,
      responseTime: row.responseTime,
      respondedBy: row.respondedBy,
      effectiveTargetMinutes,
      responseMinutes,
      isOverdueUnanswered: false,
      isTerminal: row.caseResolvedAt !== null,
      exclusionOutcome: null,
    };
  }

  // Unanswered. A still-open case's unanswered episode is provisional -
  // measure elapsed time up to "now" and only call it a breach once it
  // exceeds the target. A CLOSED case's unanswered episode is final: it is
  // measured up to the fixed resolved_at instant (never "now", which would
  // let a long-closed episode's magnitude silently keep growing), and -
  // unless the case closed with a valid exclusion outcome - it is an
  // immediate breach regardless of how much business time actually
  // elapsed. Closing a conversation "handled" or "other" without ever
  // replying to the customer is a broken promise the moment it happens,
  // not something that only counts once enough time has passed.
  const isTerminal = row.caseResolvedAt !== null;
  const measureEnd = row.caseResolvedAt ?? now;
  const pendingMinutes = businessMinutesBetween(
    row.policy.calendar,
    row.inboundTime,
    measureEnd,
    isTerminal
      ? {}
      : {
          earlyExitAt: effectiveTargetMinutes + OVERDUE_STRICT_EPSILON_MINUTES,
        },
  );

  const isOverdueUnanswered = isTerminal
    ? row.caseExclusionOutcome === null
    : pendingMinutes > effectiveTargetMinutes;

  return {
    contactId: row.contactId,
    contactName: row.contactName,
    caseId: row.caseId,
    caseKind: row.caseKind,
    inboundTime: row.inboundTime,
    responseTime: null,
    respondedBy: null,
    effectiveTargetMinutes,
    responseMinutes: null,
    isOverdueUnanswered,
    isTerminal,
    exclusionOutcome: row.caseExclusionOutcome,
  };
}

/**
 * Exact (non-early-exiting) elapsed business minutes for a still-unanswered
 * episode. For a still-open case this is up to `now`; for a closed case it
 * is the FIXED magnitude up to the case's `resolved_at` (its outcome can
 * never change after that, so its displayed magnitude must not either).
 * Only call this for episodes already known to be breaches (see
 * `computeEpisodeOutcome`'s cheap early-exit check for still-open cases) -
 * this is for display/sort magnitude, not the yes/no breach decision.
 */
export function computeExactPendingBusinessMinutes(
  row: ResolvedEpisodeRow,
  now: Date,
): number {
  if (!row.policy) return 0;
  const measureEnd = row.caseResolvedAt ?? now;
  return businessMinutesBetween(row.policy.calendar, row.inboundTime, measureEnd);
}
