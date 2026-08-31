/**
 * Conversation-case lifecycle service.
 *
 * A "case" is one immutable lifecycle cycle for a contact/group conversation
 * (see migration 061 for the full data-model rationale). Both SLA
 * guarantees are measured against a case's boundaries:
 *   - response SLA: each live inbound turn while the case is open/pending
 *   - resolution SLA: case opened_at -> resolved_at
 *
 * A reopen - automatic (a live inbound arrives after resolution) or manual
 * (an agent clicks Reopen/Open) - always creates a NEW case row. `pending`
 * is a sub-state of the SAME active case: it does not create a new case and
 * does not pause either SLA clock (a still-open response episode keeps
 * accruing business minutes, and the case's resolution clock keeps
 * running).
 *
 * Audit trail: every case records `open_source` ('live_inbound' | 'manual')
 * and `opened_by` (null for live_inbound - no human actor; the acting user
 * for manual). `reopened_from_case_id` is set for BOTH automatic and manual
 * reopens whenever a prior case exists - it is not exclusive to manual
 * reopens. History/"most recent case" lookups are ordered by `created_at`
 * (the row's actual insertion order), never `opened_at` - `opened_at` for a
 * live-inbound case is the WhatsApp-supplied message timestamp, which can
 * arrive delayed or out of order and must never be trusted to reflect which
 * case cycle came first.
 *
 * Message case membership: every message insert path (live inbound, live
 * outbound send/forward/retry/scheduled-send, and the worker-relayed event
 * handler) assigns `messages.case_id` explicitly, exactly once, from
 * whichever case was actually active at the moment of insertion. This is
 * durable and never re-derived from a timestamp window - see
 * `resolveActiveCaseIdForContact` and migration 061's doc comment.
 *
 * Concurrency: every state-changing mutation here is a single conditional
 * UPDATE/INSERT keyed on the row's CURRENT expected state (e.g. "resolve
 * only if still open/pending", "insert a new case only if none is active"),
 * never a read-then-write across two statements. A losing race observes
 * zero affected rows and raises `ConflictError` (or, for the automatic
 * inbound-open path, self-heals silently - see below) instead of silently
 * overwriting a concurrent transition.
 *
 * Idempotency: opening a case for an inbound message is done with an
 * `INSERT ... ON CONFLICT (contact_id) WHERE status IN ('open', 'pending')
 * DO NOTHING` against the partial unique index on conversation_cases,
 * inside the SAME transaction as the message insert (see
 * message-handlers.ts). That index is the single source of truth for "is
 * there already an active case" - a retried/duplicate event, or two
 * concurrent inbound events for the same contact, can race the insert
 * safely: exactly one wins, the other observes the conflict and no-ops
 * (self-healing conversation_states.active_case_id if it had drifted).
 *
 * Ordering across DIFFERENT transitions (not just two inbounds racing each
 * other) is not something the partial unique index alone can guarantee: a
 * resolve and an inbound-open, or an outbound send and a resolve, touch
 * different rows/read different snapshots, so without an explicit lock they
 * can interleave into a state that is individually valid per-statement but
 * wrong as a whole (e.g. a "new case" inserted with no
 * `reopened_from_case_id` because the reader's snapshot of the projection
 * predates a concurrent resolve, or an outbound reply stamped onto a case
 * that a concurrent resolve just closed). `lockContact` takes a
 * `SELECT ... FOR UPDATE` row lock on the contact - the SAME primitive (and
 * the same row) `POST /contacts/:id/assign`'s takeover and
 * `requireSendAccess` lock - as the FIRST statement in every function below
 * that reads-then-writes lifecycle/case-membership state for a contact. It
 * is released automatically at transaction end (commit or rollback) - no
 * matching unlock call is needed or correct. This makes every such
 * transition for a given contact, AND every assignment/send-access
 * transaction touching the same contact, strictly serialized against each
 * other: whichever one acquires the lock first observes (and leaves) a
 * fully-settled state before the next one starts. (A Postgres advisory
 * lock was used here previously; it never conflicts with a row lock, so it
 * only serialized lifecycle mutations against each other, not against
 * assignment/send-access transactions - see `lockContact`'s own doc
 * comment.)
 */

import type {
  ConversationCaseKind,
  ConversationCaseOpenSource,
  ConversationCaseResolutionOutcome,
} from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import type { Kysely, Transaction } from "kysely";
import { sql } from "kysely";
import {
  ConflictError,
  ContactAssignedToOtherError,
  NoActiveCaseError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import { getCurrentAssignment, unassignContact } from "./contact.service.js";
import {
  getCurrentSlaPolicy,
  resolveCaseTargets,
} from "./sla-policy/policy.service.js";
import { getSchemaName, type TenantDatabase } from "./tenant.service.js";

export type {
  ConversationCaseKind,
  ConversationCaseOpenSource,
  ConversationCaseResolutionOutcome,
};

export interface ConversationCase {
  id: string;
  contactId: string;
  kind: ConversationCaseKind;
  status: "open" | "pending" | "resolved";
  openedAt: Date;
  openingMessageId: string | null;
  openSource: ConversationCaseOpenSource;
  openedBy: string | null;
  policyId: string;
  responseTargetMinutes: number;
  resolutionTargetMinutes: number;
  reopenedFromCaseId: string | null;
  reopenReason: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionOutcome: ConversationCaseResolutionOutcome | null;
  resolutionNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Close outcomes that are valid response-SLA exclusions - reported separately, never counted compliant. */
export const RESPONSE_SLA_EXCLUSION_OUTCOMES: ConversationCaseResolutionOutcome[] =
  ["no_reply_needed", "spam", "duplicate"];

export const RESOLUTION_OUTCOMES: ConversationCaseResolutionOutcome[] = [
  "handled",
  "no_reply_needed",
  "spam",
  "duplicate",
  "other",
];

interface ConversationCaseRow {
  id: string;
  contact_id: string;
  kind: ConversationCaseKind;
  status: "open" | "pending" | "resolved";
  opened_at: Date;
  opening_message_id: string | null;
  open_source: ConversationCaseOpenSource;
  opened_by: string | null;
  policy_id: string;
  response_target_minutes: number;
  resolution_target_minutes: number;
  reopened_from_case_id: string | null;
  reopen_reason: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_outcome: ConversationCaseResolutionOutcome | null;
  resolution_notes: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Serializes lifecycle/case-membership transitions for one contact - see
 * the module doc comment's "Ordering across DIFFERENT transitions" section.
 *
 * Uses the exact same primitive as the assignment route's takeover and
 * `requireSendAccess` (`SELECT ... FOR UPDATE` on the `contacts` row) -
 * NOT a Postgres advisory lock. Advisory locks and row locks are entirely
 * separate lock tables that never conflict with each other; an earlier
 * version of this function used `pg_advisory_xact_lock`, which serialized
 * every lifecycle mutation against every OTHER lifecycle mutation
 * correctly, but never against a concurrent assignment takeover or
 * `requireSendAccess` auto-claim, since those take a row lock the advisory
 * lock is entirely blind to. `assertActorOwnsContact`'s assignment read
 * could therefore still observe a stale assignee mid-takeover. Locking the
 * SAME row with the SAME primitive here closes that gap: whichever
 * transaction (a lifecycle mutation, a takeover, or a send) acquires the
 * lock first is fully serialized against all the others, not just its own
 * kind.
 *
 * Throws `NotFoundError` if the contact no longer exists (contacts are
 * never deleted in normal operation, but callers should never see a raw
 * constraint violation from a phantom row instead of a controlled error).
 */
async function lockContact(
  trx: Transaction<TenantDatabase>,
  contactId: string,
): Promise<void> {
  const contact = await trx
    .selectFrom("contacts")
    .select("id")
    .where("id", "=", contactId)
    .forUpdate()
    .executeTakeFirst();
  if (!contact) {
    throw new NotFoundError("Contact");
  }
}

/**
 * Enforces the same assignment invariant `requireSendAccess` enforces for
 * outbound sends, but for manual lifecycle mutations (resolve/pending/
 * resume/open/reopen): a contact actively assigned to someone OTHER than
 * the acting user is off-limits, even for a user with `can_view_all_chats`
 * or an admin/owner role - assignment is a hard ownership boundary, not a
 * visibility preference, and the route layer alone cannot enforce it
 * atomically (a route-level check-then-call has a TOCTOU window against a
 * concurrent takeover). An unassigned contact, or one self-assigned to the
 * actor, is always allowed - these mutations never themselves claim an
 * unassigned contact (unlike `requireSendAccess`'s `claimUnassigned`); they
 * only gate.
 *
 * MUST be called after `lockContact` (inside the same transaction, under
 * the same per-contact `SELECT ... FOR UPDATE` lock) so this read can never
 * observe a stale assignment that a concurrent takeover is about to
 * invalidate, or vice versa - `lockContact` takes the exact same row lock
 * the assignment/send-access routes take, so they are fully serialized
 * against each other, not just against other lifecycle mutations.
 */
async function assertActorOwnsContact(
  trx: Transaction<TenantDatabase>,
  contactId: string,
  actorUserId: string,
): Promise<void> {
  const assignment = await getCurrentAssignment(trx, contactId);
  if (assignment && assignment.assigned_to !== actorUserId) {
    throw new ContactAssignedToOtherError(assignment.assigned_to);
  }
}

function toConversationCase(row: ConversationCaseRow): ConversationCase {
  return {
    id: row.id,
    contactId: row.contact_id,
    kind: row.kind,
    status: row.status,
    openedAt: row.opened_at,
    openingMessageId: row.opening_message_id,
    openSource: row.open_source,
    openedBy: row.opened_by,
    policyId: row.policy_id,
    responseTargetMinutes: row.response_target_minutes,
    resolutionTargetMinutes: row.resolution_target_minutes,
    reopenedFromCaseId: row.reopened_from_case_id,
    reopenReason: row.reopen_reason,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionOutcome: row.resolution_outcome,
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getActiveCase(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<ConversationCase | null> {
  const row = await tenantDb
    .selectFrom("conversation_cases")
    .selectAll()
    .where("contact_id", "=", contactId)
    .where("status", "in", ["open", "pending"])
    .executeTakeFirst();
  return row ? toConversationCase(row as unknown as ConversationCaseRow) : null;
}

/** Most recent case for a contact, ordered by insertion order (`created_at`) - never `opened_at`, which is untrusted client-supplied data for live-inbound cases. */
export async function getMostRecentCase(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<ConversationCase | null> {
  const row = await tenantDb
    .selectFrom("conversation_cases")
    .selectAll()
    .where("contact_id", "=", contactId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  return row ? toConversationCase(row as unknown as ConversationCaseRow) : null;
}

/** True iff a contact has ever had any case (active or historical) - distinguishes a first-ever manual Open from a manual Reopen. */
export async function hasCaseHistory(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<boolean> {
  const row = await tenantDb
    .selectFrom("conversation_cases")
    .select("id")
    .where("contact_id", "=", contactId)
    .limit(1)
    .executeTakeFirst();
  return Boolean(row);
}

/**
 * The contact's currently active case id, if any - for stamping
 * `messages.case_id` on OUTBOUND message inserts (send/forward/retry/
 * scheduled/worker-relayed), which never open or mutate a case themselves.
 * Returns null when there is no active case (e.g. sending into an already
 * resolved conversation) - such a message simply has no case, and can never
 * answer a response episode.
 */
export async function resolveActiveCaseIdForContact(
  trx: Transaction<TenantDatabase>,
  contactId: string,
): Promise<string | null> {
  // Holds the lock through the rest of this transaction (including the
  // caller's subsequent message insert), so a concurrent resolve can never
  // close the case in between this read and that insert - see the module
  // doc comment.
  await lockContact(trx, contactId);
  const row = await trx
    .selectFrom("conversation_cases")
    .select("id")
    .where("contact_id", "=", contactId)
    .where("status", "in", ["open", "pending"])
    .executeTakeFirst();
  return row?.id ?? null;
}

/**
 * Like `resolveActiveCaseIdForContact`, but for INTERACTIVE outbound sends
 * (the compose box, forward, retry) - these must never silently attach to
 * "no case" the way a background/scheduled dispatch may. A resolved
 * conversation's Open/Reopen workflow exists precisely to make the
 * lifecycle transition explicit and audited; an agent typing into a
 * resolved chat must be blocked, not quietly allowed to send a message
 * that answers no episode and reopens nothing. Throws `NoActiveCaseError`
 * (409) when there is no active case. Non-bulk scheduled-message dispatch
 * DOES use this now (via `requireSendAccess`, re-validated against
 * `row.created_by` at dispatch time) - only BULK/broadcast dispatch still
 * calls the nullable `resolveActiveCaseIdForContact` directly and allows
 * `case_id: null`, since a company-wide broadcast has no single "assignee"
 * to enforce this invariant against; see scheduled-message.service.ts's own
 * doc comment.
 */
export async function requireActiveCaseForSend(
  trx: Transaction<TenantDatabase>,
  contactId: string,
): Promise<string> {
  const caseId = await resolveActiveCaseIdForContact(trx, contactId);
  if (!caseId) {
    throw new NoActiveCaseError();
  }
  return caseId;
}

/**
 * True iff the most recent message in this case (by authoritative
 * ingestion order - `seq`, NOT WhatsApp timestamp, and not `created_at`/
 * `id`, which can tie within the same millisecond) is inbound (no team
 * reply has answered it yet). Used to reject a `handled` resolve that
 * would otherwise silently launder an unanswered turn into compliance.
 */
async function hasUnansweredLatestTurn(
  trx: Transaction<TenantDatabase>,
  activeCaseId: string,
): Promise<boolean> {
  const last = await trx
    .selectFrom("messages")
    .select(["from_me"])
    .where("case_id", "=", activeCaseId)
    .orderBy("seq", "desc")
    .limit(1)
    .executeTakeFirst();
  return last ? last.from_me === false : false;
}

interface ProjectionSync {
  activeCaseId: string | null;
  status: "open" | "pending" | "resolved";
  /** Omit a field entirely to leave it untouched on an existing row (only applies on UPDATE - a fresh INSERT always writes null for any omitted field). */
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
  reopenedAt?: Date | null;
  reopenedBy?: string | null;
}

async function syncProjection(
  trx: Transaction<TenantDatabase>,
  contactId: string,
  sync: ProjectionSync,
): Promise<void> {
  const updateSet: Record<string, unknown> = {
    active_case_id: sync.activeCaseId,
    status: sync.status,
    updated_at: toDbDate(),
  };
  if (sync.resolvedAt !== undefined) updateSet.resolved_at = sync.resolvedAt;
  if (sync.resolvedBy !== undefined) updateSet.resolved_by = sync.resolvedBy;
  if (sync.resolutionNotes !== undefined)
    updateSet.resolution_notes = sync.resolutionNotes;
  if (sync.reopenedAt !== undefined) updateSet.reopened_at = sync.reopenedAt;
  if (sync.reopenedBy !== undefined) updateSet.reopened_by = sync.reopenedBy;

  await trx
    .insertInto("conversation_states")
    .values({
      contact_id: contactId,
      active_case_id: sync.activeCaseId,
      status: sync.status,
      resolved_at: sync.resolvedAt ?? null,
      resolved_by: sync.resolvedBy ?? null,
      resolution_notes: sync.resolutionNotes ?? null,
      reopened_at: sync.reopenedAt ?? null,
      reopened_by: sync.reopenedBy ?? null,
      updated_at: toDbDate(),
    })
    .onConflict((oc) =>
      oc
        .column("contact_id")
        .doUpdateSet(
          updateSet as Parameters<
            ReturnType<typeof oc.column>["doUpdateSet"]
          >[0],
        ),
    )
    .execute();
}

/**
 * Opens (or reuses/flips-back-to-open) the active case for a newly stored
 * live inbound message. Must be called inside the same transaction as the
 * message insert (see message-handlers.ts), AFTER the message row already
 * exists (so `opening_message_id`/`case_id` can reference it) but BEFORE
 * any other write to `conversation_states` in that transaction (so the
 * "was this contact's projection resolved" read below reflects reality,
 * not a row this same transaction just created). Returns null if the
 * message did not change lifecycle state (there was already an open case -
 * the common "next message in an ongoing conversation" path) - the
 * message's `case_id` is still stamped in that case.
 *
 * An AUTOMATIC reopen (a live inbound arriving after the contact's case
 * was resolved) also atomically clears any existing contact assignment -
 * see the inline comment at the unassign call below for why. The caller
 * (message-handlers.ts) uses `unassignedPreviousAssignee` to broadcast/
 * audit that outside this transaction.
 */
export async function openOrReopenCaseForInboundMessage(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  contact: { id: string; isGroup: boolean },
  message: { id: string; timestamp: Date },
): Promise<{
  case: ConversationCase;
  wasAutoReopen: boolean;
  unassignedPreviousAssignee: string | null;
} | null> {
  await lockContact(trx, contact.id);
  // Authoritative server ingestion time - NEVER the WhatsApp-supplied
  // `message.timestamp`, which can be delayed, out of order, or (for a
  // first-ever live inbound with a future-dated client clock) even later
  // than an immediate resolve, which would violate
  // `resolved_at >= opened_at`. `message.timestamp` is preserved on the
  // message row itself (and via `opening_message_id`) for display; it is
  // never used for case boundaries, policy-snapshot timing, or SLA math.
  const serverNow = toDbDate();
  const kind: ConversationCaseKind = contact.isGroup ? "group" : "direct";
  const policy = await getCurrentSlaPolicy(companyId);
  const targets = resolveCaseTargets(policy, kind);

  // Determine reopen semantics from the PROJECTION, not case history: the
  // 061 baseline closes every pre-existing conversation as resolved
  // without fabricating a case row, so a contact can be legitimately
  // "being reopened" with zero conversation_cases rows behind it. A
  // missing row (no `existingProjection` at all) means this contact has
  // never had ANY conversation tracked - a genuine first-ever open, not a
  // reopen - regardless of what the row would eventually default to.
  const existingProjection = await trx
    .selectFrom("conversation_states")
    .select(["status"])
    .where("contact_id", "=", contact.id)
    .executeTakeFirst();
  const isReopen = existingProjection?.status === "resolved";
  const priorCase = isReopen ? await getMostRecentCase(trx, contact.id) : null;

  // Kysely's `withSchema()` only qualifies table names generated by the
  // fluent query builder - a raw `sql` tag (needed here for the partial
  // unique index's ON CONFLICT clause) is emitted verbatim, so the target
  // table must be schema-qualified explicitly or this would silently run
  // against the wrong schema's search_path.
  const casesTable = sql.table(
    `${getSchemaName(companyId)}.conversation_cases`,
  );
  const insertResult = await sql<ConversationCaseRow>`
    INSERT INTO ${casesTable} (
      contact_id, kind, status, opened_at, opening_message_id,
      open_source, opened_by, policy_id, response_target_minutes,
      resolution_target_minutes, reopened_from_case_id
    )
    VALUES (
      ${contact.id}, ${kind}, 'open', ${serverNow}, ${message.id},
      'live_inbound', NULL, ${policy.id}, ${targets.responseTargetMinutes},
      ${targets.resolutionTargetMinutes}, ${priorCase?.id ?? null}
    )
    ON CONFLICT (contact_id) WHERE status IN ('open', 'pending') DO NOTHING
    RETURNING *
  `.execute(trx);

  let result: {
    case: ConversationCase;
    wasAutoReopen: boolean;
    unassignedPreviousAssignee: string | null;
  } | null = null;
  let finalCaseId: string | null = null;

  if (insertResult.rows.length > 0) {
    const newCase = insertResult.rows[0];

    // Ownership must NOT automatically carry over across an AUTOMATIC
    // reopen: the prior assignee may be unavailable (offline, on leave, no
    // longer on the team) and silently re-attaching their name to a
    // brand-new case would block every other teammate from claiming it
    // (`requireSendAccess` treats an assigned contact as off-limits to
    // everyone else, even with `can_view_all_chats`) even though nothing
    // about this reopen was their decision - the customer simply messaged
    // again. A MANUAL reopen (an agent explicitly clicking Reopen) is a
    // deliberate choice by a specific human and intentionally does NOT go
    // through this - see `reopenAsNewCase`, which never touches
    // assignment. This unassign happens under the SAME contact-row lock
    // `lockContact` already took above (this function's first statement),
    // so it can never race a concurrent takeover/self-claim; the
    // assignment row is soft-closed (`unassigned_at` set), never deleted,
    // so assignment history/audit trail is fully preserved - see
    // `unassignContact`.
    let unassignedPreviousAssignee: string | null = null;
    if (isReopen) {
      const priorAssignment = await getCurrentAssignment(trx, contact.id);
      if (priorAssignment) {
        await unassignContact(trx, contact.id);
        unassignedPreviousAssignee = priorAssignment.assigned_to;
      }
    }

    await syncProjection(trx, contact.id, {
      activeCaseId: newCase.id,
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      ...(isReopen ? { reopenedAt: serverNow, reopenedBy: null } : {}),
    });
    finalCaseId = newCase.id;
    result = {
      case: toConversationCase(newCase),
      wasAutoReopen: isReopen,
      unassignedPreviousAssignee,
    };
  } else {
    // A case was already active - self-heal the projection pointer, and
    // flip a `pending` case back to `open` since the customer/group has
    // replied (it's our turn again). This never opens a second case. The
    // status guard makes the flip conditional: if the case was
    // concurrently resolved between our conflict and this update, we
    // silently re-sync from whatever is true now rather than resurrecting
    // a closed case - this is an automatic system path, not a user-facing
    // mutation, so it self-heals instead of raising.
    const activeCase = await getActiveCase(trx, contact.id);
    if (activeCase?.status === "pending") {
      const updated = await trx
        .updateTable("conversation_cases")
        .set({ status: "open", updated_at: toDbDate() })
        .where("id", "=", activeCase.id)
        .where("status", "=", "pending")
        .returningAll()
        .executeTakeFirst();
      if (updated) {
        await syncProjection(trx, contact.id, {
          activeCaseId: activeCase.id,
          status: "open",
        });
        finalCaseId = activeCase.id;
        result = {
          case: toConversationCase(updated as unknown as ConversationCaseRow),
          wasAutoReopen: false,
          unassignedPreviousAssignee: null,
        };
      }
    }
    if (!finalCaseId) {
      const current = activeCase ?? (await getActiveCase(trx, contact.id));
      if (current) {
        await syncProjection(trx, contact.id, {
          activeCaseId: current.id,
          status: current.status,
        });
        finalCaseId = current.id;
      }
    }
  }

  // Durable, explicit case membership for this message - see module doc
  // comment. Left null (no-op) only in the unreachable defensive case
  // where the insert conflicted but no active case could be found.
  if (finalCaseId) {
    await trx
      .updateTable("messages")
      .set({ case_id: finalCaseId })
      .where("id", "=", message.id)
      .execute();
  }

  return result;
}

export interface ResolveCaseInput {
  outcome: ConversationCaseResolutionOutcome;
  notes?: string | null;
  resolvedBy: string;
}

/**
 * Manually resolves the contact's active case. Throws `ConflictError` if
 * there is none, or if it was concurrently changed (resolved/reopened)
 * between validation and the atomic transition. `handled` is rejected when
 * the latest turn in the case has no team reply yet - closing as "handled"
 * must mean we actually replied; an unanswered close needs an explicit
 * exclusion outcome (no_reply_needed/spam/duplicate) or `other` with notes.
 */
export async function resolveActiveCase(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  input: ResolveCaseInput,
): Promise<ConversationCase> {
  if (input.outcome === "other" && !input.notes?.trim()) {
    throw new ValidationError("Notes are required when the outcome is 'other'");
  }

  return tenantDb.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    await assertActorOwnsContact(trx, contactId, input.resolvedBy);
    const active = await getActiveCase(trx, contactId);
    if (!active) {
      throw new ConflictError(
        "This conversation has no active case to resolve",
      );
    }

    if (input.outcome === "handled") {
      const unanswered = await hasUnansweredLatestTurn(trx, active.id);
      if (unanswered) {
        throw new ValidationError(
          "'handled' requires a team reply to the latest inbound message - choose no_reply_needed, spam, or duplicate, or 'other' with notes",
        );
      }
    }

    const resolvedAt = toDbDate();
    const updated = await trx
      .updateTable("conversation_cases")
      .set({
        status: "resolved",
        resolved_at: resolvedAt,
        resolved_by: input.resolvedBy,
        resolution_outcome: input.outcome,
        resolution_notes: input.notes?.trim() || null,
        updated_at: toDbDate(),
      })
      .where("id", "=", active.id)
      .where("status", "in", ["open", "pending"])
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      throw new ConflictError(
        "This conversation's active case changed before the resolve could be applied",
      );
    }

    const resolvedCase = updated as unknown as ConversationCaseRow;
    await syncProjection(trx, contactId, {
      activeCaseId: null,
      status: "resolved",
      resolvedAt: resolvedCase.resolved_at,
      resolvedBy: resolvedCase.resolved_by,
      resolutionNotes: resolvedCase.resolution_notes,
    });
    return toConversationCase(resolvedCase);
  });
}

/**
 * Sets the contact's active case to pending. No-ops (idempotently) if
 * already pending. Throws `ConflictError` if there is no active case, or if
 * it was concurrently resolved before this could apply. `actorUserId` must
 * be the current assignee (or the contact must be unassigned) - see
 * `assertActorOwnsContact`.
 */
export async function setActiveCasePending(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  actorUserId: string,
): Promise<ConversationCase> {
  return tenantDb.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    await assertActorOwnsContact(trx, contactId, actorUserId);
    const updated = await trx
      .updateTable("conversation_cases")
      .set({ status: "pending", updated_at: toDbDate() })
      .where("contact_id", "=", contactId)
      .where("status", "=", "open")
      .returningAll()
      .executeTakeFirst();

    if (updated) {
      const pendingCase = updated as unknown as ConversationCaseRow;
      await syncProjection(trx, contactId, {
        activeCaseId: pendingCase.id,
        status: "pending",
      });
      return toConversationCase(pendingCase);
    }

    // Nothing transitioned: either it's already pending (an idempotent
    // no-op, not an error) or it was resolved/never active (a real
    // conflict) - re-read within the same transaction to tell them apart.
    const current = await getActiveCase(trx, contactId);
    if (current?.status === "pending") return current;
    throw new ConflictError(
      current
        ? "This conversation's active case changed before it could be marked pending"
        : "This conversation has no active case to mark pending",
    );
  });
}

/**
 * Resumes a pending case back to open - the SAME case (never a new one),
 * so `opened_at`/the response and resolution SLA clocks are entirely
 * unaffected; `pending` never paused them in the first place (see the
 * module doc comment), so "resuming" is purely a status flip, symmetric
 * with `setActiveCasePending`. Idempotent if already open. Throws
 * `ConflictError` if there is no active case, or if it was concurrently
 * resolved before this could apply. `actorUserId` must be the current
 * assignee (or the contact must be unassigned) - see
 * `assertActorOwnsContact`.
 */
export async function resumePendingCase(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
  actorUserId: string,
): Promise<ConversationCase> {
  return tenantDb.transaction().execute(async (trx) => {
    await lockContact(trx, contactId);
    await assertActorOwnsContact(trx, contactId, actorUserId);
    const updated = await trx
      .updateTable("conversation_cases")
      .set({ status: "open", updated_at: toDbDate() })
      .where("contact_id", "=", contactId)
      .where("status", "=", "pending")
      .returningAll()
      .executeTakeFirst();

    if (updated) {
      const openCase = updated as unknown as ConversationCaseRow;
      await syncProjection(trx, contactId, {
        activeCaseId: openCase.id,
        status: "open",
      });
      return toConversationCase(openCase);
    }

    const current = await getActiveCase(trx, contactId);
    if (current?.status === "open") return current;
    throw new ConflictError(
      current
        ? "This conversation's active case changed before it could be resumed"
        : "This conversation has no active case to resume",
    );
  });
}

export interface ManualOpenCaseInput {
  companyId: string;
  openedBy: string;
  /** Required when a prior case exists (a true reopen); optional for a genuine first-ever open. */
  reason?: string | null;
  /**
   * Which transition the CALLER (the specific endpoint hit - `/open` or
   * `/reopen`) expects this to be. Enforced against the actual case
   * history under the contact lock: `/open` on a contact that already has
   * prior case history, or `/reopen` on one that has none, is a genuine
   * client/UI-state mismatch (a stale "no history" view that raced a
   * concurrent auto-reopen, or vice versa) - it must surface as a
   * controlled `ConflictError` instructing the caller to refetch and use
   * the other endpoint, never silently perform the other transition on the
   * client's behalf.
   */
  expectedMode: "open" | "reopen";
}

/**
 * Manually opens a brand-new case for a contact with no active case -
 * either a genuine first-ever Open (no prior case) or a Reopen (a prior,
 * resolved case exists). `input.expectedMode` must match which of those
 * this actually is (see `ManualOpenCaseInput.expectedMode`); the result is
 * also reflected in the returned case's `reopenedFromCaseId`. A reason is
 * required for a Reopen (an agent must justify reopening previously-closed
 * work) but optional for a first-ever Open (there's nothing to justify
 * reopening). Throws `ConflictError` if a case is already active, or if
 * `expectedMode` doesn't match reality, including when a race (a live
 * inbound, or a concurrent manual open/reopen) changes case history between
 * the client's last fetch and this call.
 */
export async function reopenAsNewCase(
  tenantDb: Kysely<TenantDatabase>,
  contact: { id: string; isGroup: boolean },
  input: ManualOpenCaseInput,
): Promise<ConversationCase> {
  return tenantDb
    .transaction()
    .execute((trx) => openCaseWithin(trx, contact, input));
}

/**
 * The body of {@link reopenAsNewCase}, taking a transaction instead of opening
 * one.
 *
 * Callers that must land a case and something else atomically - an outbound
 * message that starts the conversation, for instance - need the case insert
 * inside their own transaction, not in a second one that could commit while
 * theirs rolls back.
 */
export async function openCaseWithin(
  trx: Transaction<TenantDatabase>,
  contact: { id: string; isGroup: boolean },
  input: ManualOpenCaseInput,
): Promise<ConversationCase> {
  {
    await lockContact(trx, contact.id);
    await assertActorOwnsContact(trx, contact.id, input.openedBy);
    const priorCase = await getMostRecentCase(trx, contact.id);

    if (input.expectedMode === "open" && priorCase) {
      throw new ConflictError(
        "This conversation already has prior case history - use Reopen instead of Open",
      );
    }
    if (input.expectedMode === "reopen" && !priorCase) {
      throw new ConflictError(
        "This conversation has no prior case history - use Open instead of Reopen",
      );
    }
    if (priorCase && !input.reason?.trim()) {
      throw new ValidationError(
        "A reason is required to reopen a previously-closed conversation",
      );
    }

    const kind: ConversationCaseKind = contact.isGroup ? "group" : "direct";
    const policy = await getCurrentSlaPolicy(input.companyId);
    const targets = resolveCaseTargets(policy, kind);
    const openedAt = toDbDate();
    const reason = input.reason?.trim() || null;

    const casesTable = sql.table(
      `${getSchemaName(input.companyId)}.conversation_cases`,
    );
    const insertResult = await sql<ConversationCaseRow>`
      INSERT INTO ${casesTable} (
        contact_id, kind, status, opened_at, opening_message_id,
        open_source, opened_by, policy_id, response_target_minutes,
        resolution_target_minutes, reopened_from_case_id, reopen_reason
      )
      VALUES (
        ${contact.id}, ${kind}, 'open', ${openedAt}, NULL,
        'manual', ${input.openedBy}, ${policy.id}, ${targets.responseTargetMinutes},
        ${targets.resolutionTargetMinutes}, ${priorCase?.id ?? null}, ${reason}
      )
      ON CONFLICT (contact_id) WHERE status IN ('open', 'pending') DO NOTHING
      RETURNING *
    `.execute(trx);

    if (insertResult.rows.length === 0) {
      throw new ConflictError("This conversation already has an active case");
    }
    const created = insertResult.rows[0];

    await syncProjection(trx, contact.id, {
      activeCaseId: created.id,
      status: "open",
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      ...(priorCase
        ? { reopenedAt: created.opened_at, reopenedBy: input.openedBy }
        : {}),
    });
    return toConversationCase(created);
  }
}

/**
 * Return the contact's active case, opening one when there is none.
 *
 * An outbound message can be the first thing that ever happens on a contact,
 * which is exactly the case the inbound path handles via
 * openOrReopenCaseForInboundMessage. This is the outbound-initiated mirror of
 * it: a contact with no history gets a first-ever open, and one whose last case
 * was resolved gets a reopen carrying `reason`.
 */
export async function ensureActiveCaseWithin(
  trx: Transaction<TenantDatabase>,
  contact: { id: string; isGroup: boolean },
  // expectedMode is derived here from the real history, so callers neither
  // supply nor guess it.
  input: Omit<ManualOpenCaseInput, "expectedMode" | "reason"> & {
    reason: string;
  },
): Promise<string> {
  const activeCaseId = await resolveActiveCaseIdForContact(trx, contact.id);
  if (activeCaseId) return activeCaseId;

  const priorCase = await getMostRecentCase(trx, contact.id);
  const opened = await openCaseWithin(trx, contact, {
    ...input,
    // openCaseWithin asserts this against the real history under the contact
    // lock, so read it there rather than trusting anything the caller believes.
    expectedMode: priorCase ? "reopen" : "open",
    // A first-ever open takes no reason; a reopen requires one.
    reason: priorCase ? input.reason : null,
  });
  return opened.id;
}

export async function getConversationCaseHistory(
  tenantDb: Kysely<TenantDatabase>,
  contactId: string,
): Promise<ConversationCase[]> {
  const rows = await tenantDb
    .selectFrom("conversation_cases")
    .selectAll()
    .where("contact_id", "=", contactId)
    .orderBy("created_at", "desc")
    .execute();
  return rows.map((row) =>
    toConversationCase(row as unknown as ConversationCaseRow),
  );
}

export class CaseNotFoundError extends NotFoundError {
  constructor() {
    super("Active conversation case");
  }
}
