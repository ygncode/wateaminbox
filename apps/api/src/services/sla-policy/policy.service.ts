/**
 * SLA policy service
 *
 * Versioned, immutable company SLA policies. "Editing" the SLA inserts a
 * new policy row that activates immediately (`effective_from = now()`);
 * existing rows are never mutated, so historical analytics keep using
 * whichever policy was active when a given response episode began.
 */

import type { Database } from "@wateaminbox/database";
import { db } from "@wateaminbox/database";
import {
  DEFAULT_SLA_WEEKLY_SCHEDULE,
  type SlaPolicy,
  type SlaScheduleException,
  type SlaWeeklySchedule,
  toDbDate,
} from "@wateaminbox/shared";
import type { Transaction } from "kysely";
import { NotFoundError } from "../../lib/errors.js";
import type { CreateSlaPolicyInput } from "../../lib/schemas/sla-policy.js";

interface SlaPolicyRow {
  id: string;
  company_id: string;
  target_minutes: number;
  timezone: string;
  weekly_schedule: unknown;
  exceptions: unknown;
  effective_from: Date;
  created_by: string | null;
  created_at: Date;
}

function toSlaPolicyResponse(row: SlaPolicyRow): SlaPolicy {
  return {
    id: row.id,
    companyId: row.company_id,
    targetMinutes: row.target_minutes,
    timezone: row.timezone,
    weeklySchedule: row.weekly_schedule as SlaWeeklySchedule,
    exceptions: row.exceptions as SlaScheduleException[],
    effectiveFrom: row.effective_from.toISOString(),
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Creates a new, immediately-active SLA policy version for a company.
 * Never updates an existing row - this is an append-only history.
 */
export async function createSlaPolicy(
  companyId: string,
  input: CreateSlaPolicyInput,
  createdByUserId: string,
): Promise<SlaPolicy> {
  const row = await db
    .insertInto("sla_policies")
    .values({
      company_id: companyId,
      target_minutes: input.targetMinutes,
      timezone: input.timezone,
      weekly_schedule: JSON.stringify(input.weeklySchedule),
      exceptions: JSON.stringify(input.exceptions ?? []),
      effective_from: toDbDate(),
      created_by: createdByUserId,
    })
    .returning([
      "id",
      "company_id",
      "target_minutes",
      "timezone",
      "weekly_schedule",
      "exceptions",
      "effective_from",
      "created_by",
      "created_at",
    ])
    .executeTakeFirstOrThrow();

  return toSlaPolicyResponse(row as unknown as SlaPolicyRow);
}

/**
 * The policy currently in effect for a company (the most recently created
 * version - immediate activation means "most recent" and "current" are the
 * same thing). Every company should have at least one policy (seeded at
 * company creation, or backfilled by migration for pre-existing companies).
 */
export async function getCurrentSlaPolicy(
  companyId: string,
): Promise<SlaPolicy> {
  const row = await db
    .selectFrom("sla_policies")
    .select([
      "id",
      "company_id",
      "target_minutes",
      "timezone",
      "weekly_schedule",
      "exceptions",
      "effective_from",
      "created_by",
      "created_at",
    ])
    .where("company_id", "=", companyId)
    // Tiebreak on created_at then id: `effective_from` is millisecond
    // resolution (see createSlaPolicy), so two versions created in the same
    // millisecond (double-submit, retry, concurrent admins) would otherwise
    // tie with no stable secondary sort key, and Postgres does not
    // guarantee tie order - this keeps "current" consistent across calls
    // and in agreement with the LATERAL join in episode-resolution.ts.
    .orderBy("effective_from", "desc")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!row) {
    throw new NotFoundError("SLA policy");
  }

  return toSlaPolicyResponse(row as unknown as SlaPolicyRow);
}

/** Full version history for a company, most recent first. */
export async function listSlaPolicyHistory(
  companyId: string,
): Promise<SlaPolicy[]> {
  const rows = await db
    .selectFrom("sla_policies")
    .select([
      "id",
      "company_id",
      "target_minutes",
      "timezone",
      "weekly_schedule",
      "exceptions",
      "effective_from",
      "created_by",
      "created_at",
    ])
    .where("company_id", "=", companyId)
    .orderBy("effective_from", "desc")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();

  return rows.map((row) => toSlaPolicyResponse(row as unknown as SlaPolicyRow));
}

/**
 * Seeds the default SLA policy (60-minute target, UTC, open 24/7) for a
 * newly created company, inside the same transaction as company creation.
 * Uses the sentinel epoch `effective_from` so it behaves identically to the
 * migration backfill for pre-existing companies - both resolve for any
 * episode regardless of import history.
 */
export async function seedDefaultSlaPolicy(
  trx: Transaction<Database>,
  companyId: string,
): Promise<void> {
  await trx
    .insertInto("sla_policies")
    .values({
      company_id: companyId,
      target_minutes: 60,
      timezone: "UTC",
      weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
      exceptions: JSON.stringify([]),
      effective_from: new Date("1970-01-01T00:00:00Z"),
      created_by: null,
    })
    .execute();
}
