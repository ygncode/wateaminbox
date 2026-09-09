import { db, type TenantDatabase } from "@wateaminbox/database";
import { type Kysely, sql } from "kysely";
import {
  ensureLinkedDeviceBridge,
  journalLinkedDeviceShadowFailure,
  shadowLinkedDeviceMessage,
  shadowLinkedDeviceWorkflow,
} from "../channel-spine/providers/whatsapp-linked-device/shadow.js";
import { createLogger, formatError } from "../lib/logger.js";
import { getChannelSpineWorkspaceAuthority } from "./channel-spine-authority.service.js";
import { isChannelSpineTenantReady } from "./channel-spine-readiness.service.js";
import { getTenantConnection } from "./tenant.service.js";

/**
 * RFC phase 2's continuous reconciler.
 *
 * Dual-write is best-effort by design: a shadow write that fails must never
 * abort the legacy mutation that is still authoritative, so it records a
 * journal row and returns. Without something draining that journal the
 * failures were permanent, and a workspace could sit indefinitely with legacy
 * rows that have no neutral counterpart - which is exactly the state neutral
 * reads must not be switched on over.
 *
 * Two responsibilities, because journal rows only cover failures the writer
 * saw. Rows an old or crashed writer never journaled at all are found by the
 * anti-join sweep instead, which is what makes convergence independent of any
 * one writer having behaved correctly.
 */
const logger = createLogger("ChannelSpineReconciler");

const CYCLE_INTERVAL_MS = 5 * 60_000;
const JOURNAL_BATCH = 200;
/**
 * Deliberately small. The sweep is a safety net for rows a writer dropped,
 * not the bulk history path - that is the backfill script - and each row costs
 * roughly ten statements. Nineteen workspaces at this batch is a few dozen
 * statements a second, which the single production host absorbs without
 * competing with live traffic.
 */
const SWEEP_BATCH = 100;
const RETRY_BASE_MS = 60_000;
const RETRY_CEILING_MS = 6 * 60 * 60_000;
/**
 * After this many failures a row stops being retried and is quarantined for
 * explicit repair. Retrying a genuinely broken row forever would hide it
 * behind a permanently non-empty backlog, and the backlog being empty is the
 * signal that gates neutral reads.
 */
const MAX_ATTEMPTS = 8;

let cycleTimer: ReturnType<typeof setInterval> | null = null;
let cycleInFlight: Promise<void> | null = null;

export interface ReconcileResult {
  repaired: number;
  quarantined: number;
  stillFailing: number;
  swept: number;
}

const EMPTY: ReconcileResult = {
  repaired: 0,
  quarantined: 0,
  stillFailing: 0,
  swept: 0,
};

/**
 * Repair one workspace. Safe to run on every API replica at once: rows are
 * claimed with SKIP LOCKED, so two reconcilers divide the backlog instead of
 * fighting over it.
 */
export async function reconcileWorkspace(
  companyId: string,
): Promise<ReconcileResult> {
  const authority = await getChannelSpineWorkspaceAuthority(companyId);
  // Nothing to converge toward until the workspace is actually dual-writing.
  if (authority.source !== "configured" || !authority.dualWriteEnabled) {
    return EMPTY;
  }
  const tenantDb = await getTenantConnection(companyId);
  if (!(await isChannelSpineTenantReady(tenantDb, companyId))) return EMPTY;

  const journal = await drainJournal(tenantDb, companyId);
  const swept = await sweepUnmirroredMessages(tenantDb, companyId);
  return { ...journal, swept };
}

async function drainJournal(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
): Promise<Omit<ReconcileResult, "swept">> {
  let repaired = 0;
  let quarantined = 0;
  let stillFailing = 0;

  const due = await tenantDb
    .selectFrom("channel_spine_reconciliation_journal")
    .select(["id", "kind", "legacy_id", "attempts"])
    .where("status", "=", "pending")
    .where("next_attempt_at", "<=", new Date())
    .orderBy("next_attempt_at", "asc")
    .limit(JOURNAL_BATCH)
    .execute();

  for (const row of due) {
    // One transaction per row: a row that cannot be repaired must not roll
    // back the rows already repaired in this cycle.
    const outcome = await tenantDb
      .transaction()
      .execute(async (trx): Promise<"repaired" | "failed" | "skipped"> => {
        const claimed = await trx
          .selectFrom("channel_spine_reconciliation_journal")
          .select("id")
          .where("id", "=", row.id)
          .where("status", "=", "pending")
          .forUpdate()
          .skipLocked()
          .executeTakeFirst();
        if (!claimed) return "skipped";
        try {
          const result =
            row.kind === "message"
              ? await shadowLinkedDeviceMessage(trx, row.legacy_id)
              : row.kind === "workflow"
                ? await shadowLinkedDeviceWorkflow(
                    trx,
                    companyId,
                    row.legacy_id,
                  )
                : await ensureLinkedDeviceBridge(trx, row.legacy_id);
          if (result.status !== "ready") return "failed";
        } catch {
          return "failed";
        }
        await trx
          .updateTable("channel_spine_reconciliation_journal")
          .set({ status: "repaired", updated_at: new Date() })
          .where("id", "=", row.id)
          .execute();
        return "repaired";
      })
      .catch(() => "failed" as const);

    if (outcome === "skipped") continue;
    if (outcome === "repaired") {
      repaired++;
      continue;
    }

    const attempts = row.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    if (exhausted) quarantined++;
    else stillFailing++;
    await tenantDb
      .updateTable("channel_spine_reconciliation_journal")
      .set({
        attempts,
        status: exhausted ? "quarantined" : "pending",
        next_attempt_at: new Date(Date.now() + backoffMs(attempts)),
        updated_at: new Date(),
      })
      .where("id", "=", row.id)
      .execute();
  }

  return { repaired, quarantined, stillFailing };
}

/**
 * Messages a writer left behind entirely. A legacy WhatsApp row that still has
 * no `conversation_id` was never mirrored, whether because it predates dual
 * write, an old replica wrote it, or the writer died between the two writes.
 * Repairing them here is what lets parity converge without a bulk backfill
 * pass for every such gap.
 */
async function sweepUnmirroredMessages(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
): Promise<number> {
  const orphans = await tenantDb
    .selectFrom("messages")
    .select("messages.id")
    .where("messages.conversation_id", "is", null)
    .where("messages.contact_id", "is not", null)
    .where("messages.whatsapp_connection_id", "is not", null)
    // A row the journal already tracks belongs to the drain path, which knows
    // how to back it off and eventually quarantine it. Re-sweeping it here
    // would retry it every cycle at full rate and never converge.
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("channel_spine_reconciliation_journal as journal")
            .select("journal.id")
            .whereRef(
              "journal.legacy_id",
              "=",
              sql<string>`${eb.ref("messages.id")}::text`,
            )
            .where("journal.legacy_table", "=", "messages"),
        ),
      ),
    )
    .orderBy("messages.created_at", "desc")
    .limit(SWEEP_BATCH)
    .execute();
  if (orphans.length === 0) return 0;

  let swept = 0;
  for (const orphan of orphans) {
    const ok = await tenantDb
      .transaction()
      .execute(async (trx) => {
        const result = await shadowLinkedDeviceMessage(trx, orphan.id);
        if (result.status !== "ready") return false;
        await shadowLinkedDeviceWorkflow(
          trx,
          companyId,
          // The bridge resolved the contact, so the workflow rows share it.
          (
            await trx
              .selectFrom("messages")
              .select("contact_id")
              .where("id", "=", orphan.id)
              .executeTakeFirstOrThrow()
          ).contact_id as string,
        );
        return true;
      })
      .catch(() => false);
    if (ok) {
      swept++;
      continue;
    }
    // Journal the failure so the drain path's backoff and quarantine take
    // over. Without this the same unrepairable rows sort to the top of every
    // sweep forever, which is a hot loop that never makes progress.
    await tenantDb
      .transaction()
      .execute((trx) =>
        journalLinkedDeviceShadowFailure(
          trx,
          "message",
          "messages",
          orphan.id,
          "sweep_repair_failed",
        ),
      )
      .catch(() => undefined);
  }
  return swept;
}

function backoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_CEILING_MS);
}

export async function runReconcilerCycle(): Promise<ReconcileResult> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "in", ["active", "suspended"])
    .execute();
  const totals = { ...EMPTY };
  for (const company of companies) {
    try {
      const result = await reconcileWorkspace(company.id);
      totals.repaired += result.repaired;
      totals.quarantined += result.quarantined;
      totals.stillFailing += result.stillFailing;
      totals.swept += result.swept;
    } catch (error) {
      // One unhealthy workspace must not stop the others converging.
      logger.error(
        { err: formatError(error), companyId: company.id },
        "Channel-spine reconciliation failed for a workspace",
      );
    }
  }
  if (
    totals.repaired ||
    totals.quarantined ||
    totals.stillFailing ||
    totals.swept
  ) {
    logger.info(totals, "Channel-spine reconciliation cycle");
  }
  return totals;
}

export function initializeChannelSpineReconciler(): void {
  if (cycleTimer) return;
  const run = () => {
    if (cycleInFlight) return;
    cycleInFlight = runReconcilerCycle()
      .then(() => undefined)
      .catch((error) => {
        logger.error(
          { err: formatError(error) },
          "Channel-spine reconciliation cycle failed",
        );
      })
      .finally(() => {
        cycleInFlight = null;
      });
  };
  run();
  cycleTimer = setInterval(run, CYCLE_INTERVAL_MS);
}

export function shutdownChannelSpineReconciler(): void {
  if (cycleTimer) clearInterval(cycleTimer);
  cycleTimer = null;
}

/** Exposed for the operator script and tests. */
export const RECONCILER_PROTOCOL = {
  cycleIntervalMs: CYCLE_INTERVAL_MS,
  maxAttempts: MAX_ATTEMPTS,
  backoffMs,
} as const;
