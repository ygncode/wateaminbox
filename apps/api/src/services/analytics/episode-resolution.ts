/**
 * Response-episode resolution, clipped to SLA-bearing case boundaries.
 *
 * A response episode is a burst of one or more consecutive inbound messages
 * (from any participant, for group conversations) followed (eventually) by
 * an outbound reply from any team member - see the doc comment on the SQL
 * below for the exact detection rule. Episodes only exist for messages
 * explicitly linked to a case via `messages.case_id` - membership is NEVER
 * inferred from `messages.timestamp` against `conversation_cases.opened_at`/
 * `resolved_at`. `timestamp` is client/WhatsApp-supplied and can arrive
 * delayed, out of order, or (for imported history, which is never linked to
 * a case at all) dated arbitrarily far in the past or future - comparing it
 * against a case's boundaries cannot safely decide membership, and could
 * leak a message across cycles or match it to more than one case. `case_id`
 * is instead assigned exactly once, at insert/case-resolution time, in
 * every message insert path (see conversation-case.service.ts and
 * message-handlers.ts) - this query trusts that assignment completely and
 * needs no window logic at all.
 *
 * Ordering (which message is the "start" of a burst, which outbound
 * "answers" it) uses `messages.seq` - a strictly monotonic per-tenant
 * IDENTITY sequence assigned at insert time (see migration 061) - rather
 * than `timestamp` OR `created_at`/`id`. `timestamp` is the untrusted
 * WhatsApp-supplied clock described above; `created_at`/`id` can still tie
 * within the same millisecond (an inbound message and the outbound reply
 * it triggers can land in the same millisecond under load), which would
 * silently reorder or mispair turns. `seq` cannot tie.
 *
 * The ELAPSED-TIME math (business minutes to reply) and date-range
 * filtering also use `created_at` - the authoritative server ingestion
 * instant - NOT `timestamp`. A future- or past-dated client clock would
 * otherwise be able to fabricate a negative, zero, or wildly inflated
 * response duration, or cause an episode to silently fall outside (or
 * inside) a requested date range it doesn't actually belong to.
 * `displayInboundTime`/`displayResponseTime` still carry the original
 * WhatsApp-supplied `timestamp` for UI display, kept deliberately separate
 * from the authoritative fields used for compliance decisions.
 *
 * Each episode is paired with its OWN case's snapshotted policy
 * (`conversation_cases.policy_id`/`response_target_minutes`, resolved for
 * the case's kind - direct or group - at the moment the case opened), not
 * re-resolved by `effective_from`. That is what makes "a case snapshots the
 * policy active at opening" true for response follow-ups within the case:
 * editing the SLA later never changes how an already-open or historical
 * case's episodes are measured, even a dashboard date range spanning
 * several policy edits.
 *
 * Business-hours calendar math (DST, weekends, holidays) isn't practical to
 * express as a single SQL expression, so this module fetches raw episode +
 * policy-calendar rows and callers compute business minutes in TypeScript
 * via `businessMinutesBetween` (see ../sla-policy/calendar.ts).
 */

import type {
  SlaScheduleException,
  SlaWeeklySchedule,
} from "@wateaminbox/shared";
import { sql } from "kysely";
import { AnalyticsRangeTooWideError } from "../../lib/errors.js";
import type { SlaCalendar } from "../sla-policy/calendar.js";
import { getSchemaName, getTenantConnection } from "../tenant.service.js";

/**
 * Safety bound on how many episodes a single analytics query will process.
 * This trades pure-SQL O(1)-round-trip aggregation for JS-side business-time
 * math - a deliberate tradeoff for calendar/DST correctness (see module doc
 * comment) - so bounding the JS-side work and result payload matters.
 *
 * Exceeding this is NEVER silently truncated: `fetchEpisodesWithPolicy`
 * fetches one row beyond the cap specifically to detect the overage, and
 * throws `AnalyticsRangeTooWideError` instead of returning a partial (and
 * therefore misleading) compliance calculation. Callers should surface that
 * error to the user as "narrow your date range," not swallow it.
 */
export const MAX_EPISODES_PER_QUERY = 5000;

/** Close outcomes that are valid response-SLA exclusions for an unanswered episode. */
export type ResponseSlaExclusionOutcome = "no_reply_needed" | "spam" | "duplicate";

export interface ResolvedEpisodeRow {
  contactId: string;
  contactName: string | null;
  caseId: string;
  caseKind: "direct" | "group";
  /** Authoritative server ingestion instant (`messages.created_at`) - used for all SLA/duration math and date-range filtering. */
  inboundTime: Date;
  /** Authoritative server ingestion instant (`messages.created_at`) of the answering reply, if any. */
  responseTime: Date | null;
  /** Original WhatsApp-supplied `timestamp` of the inbound message - display only, never used for compliance decisions. */
  displayInboundTime: Date;
  /** Original WhatsApp-supplied `timestamp` of the reply, if any - display only. */
  displayResponseTime: Date | null;
  respondedBy: string | null;
  /**
   * Set when the episode's case has closed (resolved_at is not null). A
   * still-unanswered episode whose case is terminal must be measured to
   * THIS instant, never to "now" - the outcome is final the moment the case
   * closes, not a moving target that keeps accruing business minutes
   * forever (or magically resolves itself once enough time passes).
   */
  caseResolvedAt: Date | null;
  /**
   * Set only when the episode's case was resolved with a valid response-SLA
   * exclusion outcome (no_reply_needed/spam/duplicate) AND the episode was
   * never answered - `handled`/`other` never excuse an unanswered episode
   * from compliance, so those outcomes are deliberately not surfaced here.
   */
  caseExclusionOutcome: ResponseSlaExclusionOutcome | null;
  /** The episode's case's snapshotted policy - null only if the case's policy row is somehow missing. */
  policy: {
    id: string;
    /** The case's own kind-resolved response target (direct or group), not necessarily `sla_policies.target_minutes`. */
    targetMinutes: number;
    calendar: SlaCalendar;
  } | null;
}

interface RawRow {
  contact_id: string;
  contact_name: string | null;
  case_id: string;
  case_kind: "direct" | "group";
  inbound_time: Date;
  response_time: Date | null;
  display_inbound_time: Date;
  display_response_time: Date | null;
  responded_by: string | null;
  case_response_target_minutes: number;
  case_resolved_at: Date | null;
  case_resolution_outcome: string | null;
  policy_id: string | null;
  policy_timezone: string | null;
  policy_weekly_schedule: unknown;
  policy_exceptions: unknown;
}

const RESPONSE_SLA_EXCLUSION_OUTCOMES: ReadonlySet<string> = new Set([
  "no_reply_needed",
  "spam",
  "duplicate",
]);

/**
 * Fetches response episodes with inbound_time in [startDate, endDate],
 * each paired with its case's own snapshotted policy.
 *
 * Episode detection: within each case's own messages (linked by
 * `case_id`), a message is the start of a new episode iff it's inbound and
 * the immediately preceding message in that SAME case (by ingestion order)
 * was not itself inbound (i.e. there was none, or it was outbound) - so a
 * burst of consecutive inbound messages (any participant, for groups)
 * collapses into one episode starting at the first message of the burst.
 * An episode's response is the first outbound message after it BY
 * INGESTION ORDER, WITHIN THE SAME CASE (resolved once via LATERAL join,
 * ordered by the authoritative `seq` - see the module doc comment above) -
 * a reply that lands after the case closes (and therefore was never linked
 * to it) can never answer it.
 */
export async function fetchEpisodesWithPolicy(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<ResolvedEpisodeRow[]> {
  const tenantDb = getTenantConnection(companyId);
  const messagesTable = sql.table(`${getSchemaName(companyId)}.messages`);
  const contactsTable = sql.table(`${getSchemaName(companyId)}.contacts`);
  const casesTable = sql.table(
    `${getSchemaName(companyId)}.conversation_cases`,
  );
  const policiesTable = sql.table("public.sla_policies");

  const result = await sql<RawRow>`
    WITH case_messages AS (
      SELECT
        m.id,
        m.contact_id,
        m.timestamp,
        m.created_at,
        m.seq,
        m.from_me,
        m.sent_by_user_id,
        cc.id AS case_id,
        cc.kind AS case_kind,
        cc.policy_id AS case_policy_id,
        cc.response_target_minutes AS case_response_target_minutes
      FROM ${messagesTable} m
      INNER JOIN ${casesTable} cc ON cc.id = m.case_id
    ),
    episode_starts AS (
      SELECT
        case_id, case_kind, case_policy_id, case_response_target_minutes,
        contact_id, created_at AS inbound_time, timestamp AS display_inbound_time,
        seq AS inbound_seq
      FROM (
        SELECT
          case_id, case_kind, case_policy_id, case_response_target_minutes,
          contact_id, timestamp, created_at, seq, from_me,
          LAG(from_me) OVER (
            PARTITION BY case_id ORDER BY seq
          ) AS prev_from_me
        FROM case_messages
      ) ordered
      WHERE from_me = false
        AND (prev_from_me IS NULL OR prev_from_me = true)
    ),
    episode_responses AS (
      SELECT
        es.case_id, es.case_kind, es.case_policy_id, es.case_response_target_minutes,
        es.contact_id, es.inbound_time, es.display_inbound_time,
        r.created_at AS response_time,
        r.timestamp AS display_response_time,
        r.sent_by_user_id AS responded_by,
        cc.resolved_at AS case_resolved_at,
        cc.resolution_outcome AS case_resolution_outcome
      FROM episode_starts es
      INNER JOIN ${casesTable} cc ON cc.id = es.case_id
      LEFT JOIN LATERAL (
        SELECT outbound.created_at, outbound.timestamp, outbound.sent_by_user_id
        FROM case_messages outbound
        WHERE outbound.case_id = es.case_id
          AND outbound.from_me = true
          AND outbound.seq > es.inbound_seq
        ORDER BY outbound.seq ASC
        LIMIT 1
      ) r ON true
      WHERE es.inbound_time >= ${startDate}
        AND es.inbound_time <= ${endDate}
    )
    SELECT
      er.contact_id,
      COALESCE(c.custom_name, c.push_name, c.phone_number) as contact_name,
      er.case_id,
      er.case_kind,
      er.inbound_time,
      er.response_time,
      er.display_inbound_time,
      er.display_response_time,
      er.responded_by,
      er.case_response_target_minutes,
      er.case_resolved_at,
      er.case_resolution_outcome,
      policy.id as policy_id,
      policy.timezone as policy_timezone,
      policy.weekly_schedule as policy_weekly_schedule,
      policy.exceptions as policy_exceptions
    FROM episode_responses er
    INNER JOIN ${contactsTable} c ON c.id = er.contact_id
    LEFT JOIN LATERAL (
      SELECT id, timezone, weekly_schedule, exceptions
      FROM ${policiesTable} sp
      WHERE sp.id = er.case_policy_id
      LIMIT 1
    ) policy ON true
    ORDER BY er.inbound_time DESC
    LIMIT ${MAX_EPISODES_PER_QUERY + 1}
  `.execute(tenantDb);

  if (result.rows.length > MAX_EPISODES_PER_QUERY) {
    throw new AnalyticsRangeTooWideError(MAX_EPISODES_PER_QUERY);
  }

  return result.rows.map((row) => ({
    contactId: row.contact_id,
    contactName: row.contact_name,
    caseId: row.case_id,
    caseKind: row.case_kind,
    inboundTime: row.inbound_time,
    responseTime: row.response_time,
    displayInboundTime: row.display_inbound_time,
    displayResponseTime: row.display_response_time,
    respondedBy: row.responded_by,
    caseResolvedAt: row.case_resolved_at,
    caseExclusionOutcome:
      row.response_time === null &&
      row.case_resolution_outcome &&
      RESPONSE_SLA_EXCLUSION_OUTCOMES.has(row.case_resolution_outcome)
        ? (row.case_resolution_outcome as ResponseSlaExclusionOutcome)
        : null,
    policy: row.policy_id
      ? {
          id: row.policy_id,
          targetMinutes: row.case_response_target_minutes,
          calendar: {
            timezone: row.policy_timezone as string,
            weeklySchedule: row.policy_weekly_schedule as SlaWeeklySchedule,
            exceptions: row.policy_exceptions as SlaScheduleException[],
          },
        }
      : null,
  }));
}
