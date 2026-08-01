/**
 * Response-episode resolution with per-episode historical SLA policy.
 *
 * A response episode is a burst of one or more consecutive inbound messages
 * from a contact, followed (eventually) by an outbound reply - see the
 * doc comment on the SQL below for the exact detection rule. Each episode
 * is paired with whichever SLA policy version was in effect when the
 * episode began (`effective_from <= inbound_time`, most recent such
 * version), so a dashboard date range spanning multiple policy edits
 * automatically measures each episode against its own historical
 * target/calendar - edits never rewrite past results.
 *
 * Business-hours calendar math (DST, weekends, holidays) isn't practical
 * to express as a single SQL expression, so this module fetches raw
 * episode + policy rows and callers compute business minutes in
 * TypeScript via `businessMinutesBetween` (see ../sla-policy/calendar.ts).
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

export interface ResolvedEpisodeRow {
  contactId: string;
  contactName: string | null;
  inboundTime: Date;
  responseTime: Date | null;
  respondedBy: string | null;
  /** null only if a company somehow has zero SLA policies (shouldn't happen - always seeded/backfilled). */
  policy: {
    id: string;
    targetMinutes: number;
    calendar: SlaCalendar;
  } | null;
}

interface RawRow {
  contact_id: string;
  contact_name: string | null;
  inbound_time: Date;
  response_time: Date | null;
  responded_by: string | null;
  policy_id: string | null;
  policy_target_minutes: number | null;
  policy_timezone: string | null;
  policy_weekly_schedule: unknown;
  policy_exceptions: unknown;
}

/**
 * Fetches response episodes with inbound_time in [startDate, endDate],
 * each paired with the SLA policy version active at that episode's start.
 *
 * Episode detection: for each contact, a message is the start of a new
 * episode iff it's inbound and the immediately preceding message (by
 * timestamp) from that contact was not itself inbound (i.e. there was none,
 * or it was outbound) - so a burst of consecutive inbound messages
 * collapses into one episode starting at the first message of the burst.
 * An episode's response is the first outbound message after it (resolved
 * once via LATERAL join with a deterministic timestamp/id tie-break), with
 * no cutoff on how long after the inbound message that reply can land.
 */
export async function fetchEpisodesWithPolicy(
  companyId: string,
  startDate: Date,
  endDate: Date,
): Promise<ResolvedEpisodeRow[]> {
  const tenantDb = getTenantConnection(companyId);
  const messagesTable = sql.table(`${getSchemaName(companyId)}.messages`);
  const contactsTable = sql.table(`${getSchemaName(companyId)}.contacts`);
  const policiesTable = sql.table("public.sla_policies");

  const result = await sql<RawRow>`
    WITH episode_starts AS (
      SELECT contact_id, timestamp AS inbound_time
      FROM (
        SELECT
          contact_id,
          timestamp,
          from_me,
          LAG(from_me) OVER (
            PARTITION BY contact_id ORDER BY timestamp, id
          ) AS prev_from_me
        FROM ${messagesTable}
      ) ordered
      WHERE from_me = false
        AND (prev_from_me IS NULL OR prev_from_me = true)
    ),
    episode_responses AS (
      SELECT
        es.contact_id,
        es.inbound_time,
        r.timestamp AS response_time,
        r.sent_by_user_id AS responded_by
      FROM episode_starts es
      LEFT JOIN LATERAL (
        SELECT outbound.timestamp, outbound.sent_by_user_id
        FROM ${messagesTable} outbound
        WHERE outbound.contact_id = es.contact_id
          AND outbound.from_me = true
          AND outbound.timestamp > es.inbound_time
        ORDER BY outbound.timestamp ASC, outbound.id ASC
        LIMIT 1
      ) r ON true
      WHERE es.inbound_time >= ${startDate}
        AND es.inbound_time <= ${endDate}
    )
    SELECT
      er.contact_id,
      COALESCE(c.custom_name, c.push_name, c.phone_number) as contact_name,
      er.inbound_time,
      er.response_time,
      er.responded_by,
      policy.id as policy_id,
      policy.target_minutes as policy_target_minutes,
      policy.timezone as policy_timezone,
      policy.weekly_schedule as policy_weekly_schedule,
      policy.exceptions as policy_exceptions
    FROM episode_responses er
    INNER JOIN ${contactsTable} c ON c.id = er.contact_id
    LEFT JOIN LATERAL (
      SELECT id, target_minutes, timezone, weekly_schedule, exceptions
      FROM ${policiesTable} sp
      WHERE sp.company_id = ${companyId}
        AND sp.effective_from <= er.inbound_time
      -- Same tiebreak as getCurrentSlaPolicy/listSlaPolicyHistory
      -- (policy.service.ts): effective_from alone can tie at millisecond
      -- resolution, so this must resolve identically to "current" there.
      ORDER BY sp.effective_from DESC, sp.created_at DESC, sp.id DESC
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
    inboundTime: row.inbound_time,
    responseTime: row.response_time,
    respondedBy: row.responded_by,
    policy: row.policy_id
      ? {
          id: row.policy_id,
          targetMinutes: row.policy_target_minutes as number,
          calendar: {
            timezone: row.policy_timezone as string,
            weeklySchedule: row.policy_weekly_schedule as SlaWeeklySchedule,
            exceptions: row.policy_exceptions as SlaScheduleException[],
          },
        }
      : null,
  }));
}
