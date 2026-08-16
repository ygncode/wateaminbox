import { db, type PurgeCleanupKind } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import { type Kysely, sql, type Transaction } from "kysely";
import { createLogger, formatError } from "../lib/logger.js";
import { deleteMedia, resolveMediaKeyForCompany } from "../lib/storage.js";
import { finalizeBulkJobIfComplete } from "./bulk-job.service.js";
import {
  lockMediaKeys,
  MEDIA_DELETING_MARKER,
} from "./media-reference-lock.js";
import {
  deleteContacts,
  deleteMessagesForContacts,
} from "./meilisearch.service.js";
import { getTenantConnection, type TenantDatabase } from "./tenant.service.js";

const DEFAULT_BATCH_SIZE = 500;
const RETRY_BASE_MS = 60_000;
const RETRY_CEILING_MS = 86_400_000;
/**
 * How long a claimed item stays invisible to other processors. A crashed
 * process holds nothing: the lease simply expires and the item becomes due
 * again, which is what makes this queue recoverable without a janitor.
 */
const CLAIM_LEASE_MS = 5 * 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

/**
 * How long an object that looks unreferenced must stay that way before it is
 * deleted. See `MEDIA_OWNERSHIP_PROTOCOL`.
 */
const MEDIA_SETTLE_MS = 60_000;
/** Marks an item that passed its first reference check and is settling. */
const SETTLE_MARKER = "awaiting-settle";

/**
 * Ownership protocol for stored media.
 *
 * A tenant's object keys are per-upload unique (`media/<companyId>/
 * <timestamp>_<random>.<ext>`) and immutable - nothing ever rewrites a key -
 * so a NEW upload can never collide with an object this queue is about to
 * remove. Every path that persists an EXISTING key does one of two things:
 *
 *   1. Copies it from a row that still exists (forward, retry, bulk leaf).
 *      Those rows are exactly what `findStillReferenced` reads, so the object
 *      is seen as referenced and is never deleted.
 *   2. Accepts a client-supplied URL, which `getMediaObjectReference` resolves
 *      with a HeadObject before persisting. If this queue deleted the object
 *      first, that HeadObject fails and the write is rejected; if the write
 *      commits first, the reference check sees it.
 *
 * The one interleaving neither rule covers is a request whose HeadObject
 * succeeded before a reference check and whose INSERT lands after the delete.
 * Deleting only after the object has looked unreferenced across TWO checks
 * separated by `MEDIA_SETTLE_MS` bounds that window: a writer would have to
 * stall for longer than the settle period between validating its upload and
 * committing the row. A post-delete verification then re-reads the same
 * columns, so if it ever does happen the dangling reference is reported
 * loudly instead of silently 404-ing in the inbox.
 *
 * Writer-side note: no API path takes an explicit lock today. Closing the
 * window completely (rather than bounding it) needs the five sites that
 * resolve client-supplied media - messages/send, messages/scheduled,
 * conversations/messages, bulk-jobs, status - to hold a shared advisory lock
 * on the reference across validate-and-insert. That is deliberately NOT done
 * here; see the residual-risk note in the handoff.
 */
export const MEDIA_OWNERSHIP_PROTOCOL = {
  settleMs: MEDIA_SETTLE_MS,
} as const;

const logger = createLogger("ConnectionPurgeCleanup");
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let cleanupInFlight: Promise<void> | null = null;

export interface PurgeCleanupResult {
  completed: number;
  failed: number;
  /** Looked unreferenced, waiting out the settle window before deletion. */
  deferred: number;
}

/**
 * Collaborators that reach outside PostgreSQL.
 *
 * Injectable so retry, reference, and ownership behaviour can be tested
 * against a real tenant schema without an object store or a search server -
 * matching the seam `runCleanupCycle` already uses for its own collaborators.
 */
export interface PurgeCleanupDeps {
  /** Throws when the reference is not an object in this tenant's namespace. */
  resolveOwnedMediaKey: (reference: string, companyId: string) => string;
  deleteObject: (key: string) => Promise<void>;
  dropSearchMessages: (
    companyId: string,
    contactIds: string[],
  ) => Promise<void>;
  dropSearchContacts: (
    companyId: string,
    contactIds: string[],
  ) => Promise<void>;
  finalizeBulkJob: (
    tenantDb: Kysely<TenantDatabase>,
    companyId: string,
    bulkJobId: string,
  ) => Promise<unknown>;
}

const defaultDeps: PurgeCleanupDeps = {
  resolveOwnedMediaKey: resolveMediaKeyForCompany,
  deleteObject: deleteMedia,
  dropSearchMessages: deleteMessagesForContacts,
  dropSearchContacts: deleteContacts,
  finalizeBulkJob: finalizeBulkJobIfComplete,
};

/** Exponential backoff for a failed item, capped at a day. */
export function getPurgeCleanupRetryDelayMs(attempts: number): number {
  return Math.min(
    RETRY_BASE_MS * 2 ** Math.min(Math.max(attempts, 0), 20),
    RETRY_CEILING_MS,
  );
}

export async function enqueueMediaCleanup(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string,
  reference: string,
): Promise<void> {
  await tenantDb
    .insertInto("purge_cleanup_items")
    .values({
      connection_id: connectionId,
      kind: "media",
      reference,
    })
    .onConflict((oc) =>
      oc.columns(["connection_id", "kind", "reference"]).doNothing(),
    )
    .execute();
}

interface ClaimedItem {
  id: string;
  kind: PurgeCleanupKind;
  reference: string;
  attempts: number;
  /** `awaiting-settle` once the item has passed one clean reference check. */
  lastError: string | null;
}

/**
 * Take a bounded batch of due work and lease it.
 *
 * `FOR UPDATE SKIP LOCKED` plus a pushed `next_attempt_at` is what lets the
 * purge request's own fast pass, the interval runner, and a second API replica
 * all drain the same queue without processing an item twice.
 */
async function claimItems(
  tenantDb: Kysely<TenantDatabase>,
  options: {
    connectionId?: string;
    kinds?: PurgeCleanupKind[];
    limit?: number;
  },
): Promise<ClaimedItem[]> {
  return tenantDb.transaction().execute(async (trx) => {
    let query = trx
      .selectFrom("purge_cleanup_items")
      .select(["id", "kind", "reference", "attempts", "last_error"])
      .where("next_attempt_at", "<=", toDbDate())
      // Parents before their media: a finalized bulk job releases its own
      // upload, so the media item behind it either finds no owner left or is
      // already gone.
      .orderBy(
        sql<number>`CASE kind WHEN 'bulk_job' THEN 0 WHEN 'search_contact' THEN 1 ELSE 2 END`,
      )
      .orderBy("created_at", "asc")
      .limit(options.limit ?? DEFAULT_BATCH_SIZE)
      .forUpdate()
      .skipLocked();
    if (options.connectionId) {
      query = query.where("connection_id", "=", options.connectionId);
    }
    if (options.kinds && options.kinds.length > 0) {
      query = query.where("kind", "in", options.kinds);
    }
    const rows = await query.execute();
    if (rows.length === 0) return [];
    const items: ClaimedItem[] = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      reference: row.reference,
      attempts: row.attempts,
      lastError: row.last_error,
    }));
    await trx
      .updateTable("purge_cleanup_items")
      .set({
        next_attempt_at: new Date(Date.now() + CLAIM_LEASE_MS),
        updated_at: toDbDate(),
      })
      .where(
        "id",
        "in",
        items.map((item) => item.id),
      )
      .execute();
    return items;
  });
}

async function removeItems(
  tenantDb: Kysely<TenantDatabase>,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tenantDb
    .deleteFrom("purge_cleanup_items")
    .where("id", "in", ids)
    .execute();
}

/**
 * Hold an item that looked unreferenced for the settle window. `attempts` is
 * untouched - this is not a failure, and it must not consume retry budget.
 */
async function deferForSettle(
  tenantDb: Kysely<TenantDatabase>,
  items: ClaimedItem[],
): Promise<void> {
  if (items.length === 0) return;
  await tenantDb
    .updateTable("purge_cleanup_items")
    .set({
      next_attempt_at: new Date(Date.now() + MEDIA_SETTLE_MS),
      last_error: SETTLE_MARKER,
      updated_at: toDbDate(),
    })
    .where(
      "id",
      "in",
      items.map((item) => item.id),
    )
    .execute();
}

/** Push failed work out by its own attempt count, replacing the claim lease. */
async function recordFailure(
  tenantDb: Kysely<TenantDatabase>,
  items: ClaimedItem[],
  error: unknown,
): Promise<void> {
  if (items.length === 0) return;
  const message =
    error instanceof Error ? error.message.slice(0, 2_000) : String(error);
  const byAttempts = new Map<number, string[]>();
  for (const item of items) {
    const ids = byAttempts.get(item.attempts) ?? [];
    ids.push(item.id);
    byAttempts.set(item.attempts, ids);
  }
  for (const [attempts, ids] of byAttempts) {
    await tenantDb
      .updateTable("purge_cleanup_items")
      .set({
        attempts: attempts + 1,
        next_attempt_at: new Date(
          Date.now() + getPurgeCleanupRetryDelayMs(attempts),
        ),
        // A committed deletion intent must survive its own retry: clearing the
        // marker would reopen the key to writers while the object is already
        // unreachable or half-deleted.
        last_error: sql<string>`CASE
          WHEN last_error = ${MEDIA_DELETING_MARKER} THEN last_error
          ELSE ${message}
        END`,
        updated_at: toDbDate(),
      })
      .where("id", "in", ids)
      .execute();
  }
}

/**
 * Take each object's lock, re-read the census under it, and commit a deletion
 * intent for the ones still unreferenced.
 *
 * Returns the item ids that hold a committed intent. Anything missing lost the
 * race to a writer and must not be deleted. No object-store call happens here -
 * the transaction, and therefore the lock, is already closed when the caller
 * starts deleting.
 */
async function commitDeletionIntents(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  items: ClaimedItem[],
  keysByReference: Map<string, string>,
): Promise<Set<string>> {
  if (items.length === 0) return new Set();
  return tenantDb.transaction().execute(async (trx) => {
    const keys = [
      ...new Set(
        items.map((item) => keysByReference.get(item.reference) as string),
      ),
    ].sort();
    await lockMediaKeys(trx, keys);

    const stillReferenced = await findStillReferenced(
      trx,
      companyId,
      new Map(
        items.map((item) => [
          item.reference,
          keysByReference.get(item.reference) as string,
        ]),
      ),
    );
    const committed = new Set<string>();
    for (const item of items) {
      if (stillReferenced.has(item.reference)) continue;
      await trx
        .updateTable("purge_cleanup_items")
        .set({
          media_key: keysByReference.get(item.reference) as string,
          last_error: MEDIA_DELETING_MARKER,
          updated_at: toDbDate(),
        })
        .where("id", "=", item.id)
        .execute();
      committed.add(item.id);
    }
    return committed;
  });
}

/**
 * Which of these references some row still points at.
 *
 * One query per referencing column for the whole batch, rather than per
 * object: a purged account can leave tens of thousands of media items behind.
 * Undispatched schedules and live broadcasts are the only rows whose upload is
 * still needed - a settled leaf's object is owned by the message it produced
 * (mirroring `cleanupBulkJobMediaObject`).
 */
async function findStillReferenced(
  tenantDb: Kysely<TenantDatabase> | Transaction<TenantDatabase>,
  companyId: string,
  keysByReference: Map<string, string>,
): Promise<Set<string>> {
  const references = [...keysByReference.keys()];
  const referenced = new Set<string>();
  const collect = (rows: Array<{ reference: string | null }>) => {
    for (const row of rows) if (row.reference) referenced.add(row.reference);
  };

  collect(
    await tenantDb
      .selectFrom("messages")
      .select("media_url as reference")
      .distinct()
      .where("media_url", "in", references)
      .execute(),
  );
  collect(
    await tenantDb
      .selectFrom("messages")
      .select("sender_avatar_url as reference")
      .distinct()
      .where("sender_avatar_url", "in", references)
      .execute(),
  );
  collect(
    await tenantDb
      .selectFrom("contacts")
      .select("profile_picture_url as reference")
      .distinct()
      .where("profile_picture_url", "in", references)
      .execute(),
  );
  collect(
    await tenantDb
      .selectFrom("status_updates")
      .select("media_url as reference")
      .distinct()
      .where("media_url", "in", references)
      .execute(),
  );
  collect(
    await tenantDb
      .selectFrom("scheduled_messages")
      .select("media_url as reference")
      .distinct()
      .where("media_url", "in", references)
      .where("status", "in", ["scheduled", "processing"])
      .execute(),
  );
  collect(
    await tenantDb
      .selectFrom("bulk_jobs")
      .select("media_url as reference")
      .distinct()
      .where("media_url", "in", references)
      .where("status", "in", ["scheduled", "running"])
      .execute(),
  );

  // The workspace logo is uploaded into the same `media/<companyId>/`
  // namespace as inbox attachments, so it is a real consumer of these keys
  // even though no tenant row references it by URL.
  const company = await db
    .selectFrom("companies")
    .select("logo_key")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (company?.logo_key) {
    for (const [reference, key] of keysByReference) {
      if (key === company.logo_key) referenced.add(reference);
    }
  }

  return referenced;
}

/**
 * Drain durable work left by a committed connection purge.
 *
 * Every operation is idempotent and every item is leased, so a crashed process
 * or a second replica running the same cycle can only ever repeat work, never
 * skip or corrupt it. An object is deleted only after this pass proves no row
 * anywhere in the tenant still points at it.
 */
export async function processConnectionPurgeCleanup(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  options: {
    connectionId?: string;
    kinds?: PurgeCleanupKind[];
    limit?: number;
    deps?: Partial<PurgeCleanupDeps>;
  } = {},
): Promise<PurgeCleanupResult> {
  const deps: PurgeCleanupDeps = { ...defaultDeps, ...options.deps };
  const items = await claimItems(tenantDb, options);
  const result: PurgeCleanupResult = { completed: 0, failed: 0, deferred: 0 };
  if (items.length === 0) return result;

  const searchItems = items.filter((item) => item.kind === "search_contact");
  if (searchItems.length > 0) {
    const contactIds = searchItems.map((item) => item.reference);
    try {
      await deps.dropSearchMessages(companyId, contactIds);
      await deps.dropSearchContacts(companyId, contactIds);
      await removeItems(
        tenantDb,
        searchItems.map((item) => item.id),
      );
      result.completed += searchItems.length;
    } catch (error) {
      await recordFailure(tenantDb, searchItems, error);
      result.failed += searchItems.length;
    }
  }

  // Finalize parents before evaluating their media references. Once a parent
  // is terminal it no longer needs its upload; the media item below becomes
  // the durable retry if the finalizer's own best-effort deletion failed.
  for (const item of items.filter((row) => row.kind === "bulk_job")) {
    try {
      await deps.finalizeBulkJob(tenantDb, companyId, item.reference);
      await removeItems(tenantDb, [item.id]);
      result.completed++;
    } catch (error) {
      await recordFailure(tenantDb, [item], error);
      result.failed++;
    }
  }

  const mediaItems = items.filter((row) => row.kind === "media");
  if (mediaItems.length > 0) {
    // Ownership resolution is pure. A WhatsApp-hosted avatar or catalog image
    // is settled here without a single storage call: its database reference is
    // gone and the remote resource was never ours to delete.
    const keysByReference = new Map<string, string>();
    const foreign: string[] = [];
    for (const item of mediaItems) {
      if (keysByReference.has(item.reference)) continue;
      try {
        keysByReference.set(
          item.reference,
          deps.resolveOwnedMediaKey(item.reference, companyId),
        );
      } catch {
        foreign.push(item.reference);
      }
    }
    const foreignReferences = new Set(foreign);
    const foreignItems = mediaItems.filter((item) =>
      foreignReferences.has(item.reference),
    );
    await removeItems(
      tenantDb,
      foreignItems.map((item) => item.id),
    );
    result.completed += foreignItems.length;

    const ownedItems = mediaItems.filter((item) =>
      keysByReference.has(item.reference),
    );
    if (ownedItems.length > 0) {
      try {
        const referenced = await findStillReferenced(
          tenantDb,
          companyId,
          keysByReference,
        );
        const settled: string[] = [];
        const deferring: ClaimedItem[] = [];
        const failed: ClaimedItem[] = [];
        const toDelete: ClaimedItem[] = [];
        let lastError: unknown;
        for (const item of ownedItems) {
          try {
            if (referenced.has(item.reference)) {
              // A row still points at it - the object is in use (a sibling
              // connection's message, a queued schedule, a live broadcast) and
              // this item's work is simply done.
              settled.push(item.id);
              continue;
            }
            if (
              item.lastError !== SETTLE_MARKER &&
              item.lastError !== MEDIA_DELETING_MARKER
            ) {
              // First clean look. Hold it for the settle window rather than
              // committing to deletion now, so a request that validated this
              // object before the check has committed its row by the time the
              // intent is taken.
              deferring.push(item);
              continue;
            }
            toDelete.push(item);
          } catch (error) {
            failed.push(item);
            lastError = error;
          }
        }
        // Commit the deletion intent under the object's lock. After this
        // transaction commits, no writer can attach the key to a new row: it
        // takes the same lock and refuses on seeing the intent. The lock is
        // released here, BEFORE any object-store call.
        const committed = await commitDeletionIntents(
          tenantDb,
          companyId,
          toDelete,
          keysByReference,
        );
        for (const item of toDelete) {
          if (!committed.has(item.id)) {
            // Its census went stale between the scan and the lock - a writer
            // got there first. Retire the item; the object has an owner.
            settled.push(item.id);
          }
        }

        const deletedKeys = new Set<string>();
        for (const item of toDelete) {
          if (!committed.has(item.id)) continue;
          const key = keysByReference.get(item.reference) as string;
          try {
            // Idempotent: the same object can back two items in one batch, and
            // a repeat delete is a no-op anyway.
            if (!deletedKeys.has(key)) {
              await deps.deleteObject(key);
              deletedKeys.add(key);
            }
            settled.push(item.id);
          } catch (error) {
            // The intent stays committed, so the key remains closed to writers
            // until the retry finishes the job. That means `last_error` keeps
            // the marker rather than the message, so log the reason here or it
            // would be lost.
            logger.warn(
              { companyId, key, err: formatError(error) },
              "Failed to delete a media object committed for deletion",
            );
            failed.push(item);
            lastError = error;
          }
        }

        await removeItems(tenantDb, settled);
        result.completed += settled.length;
        if (deferring.length > 0) {
          await deferForSettle(tenantDb, deferring);
          result.deferred += deferring.length;
        }
        if (failed.length > 0) {
          await recordFailure(tenantDb, failed, lastError);
          result.failed += failed.length;
        }
      } catch (error) {
        // The reference scan itself failed, so nothing is safe to delete.
        await recordFailure(tenantDb, ownedItems, error);
        result.failed += ownedItems.length;
      }
    }
  }

  return result;
}

async function executeCleanupCycle(): Promise<void> {
  const companies = await db
    .selectFrom("companies")
    .select("id")
    .where("status", "in", ["active", "suspended"])
    .execute();
  for (const company of companies) {
    try {
      const result = await processConnectionPurgeCleanup(
        getTenantConnection(company.id),
        company.id,
      );
      if (result.completed > 0 || result.failed > 0) {
        logger.info(
          { companyId: company.id, ...result },
          "Processed purge cleanup",
        );
      }
    } catch (error) {
      logger.error(
        { companyId: company.id, err: formatError(error) },
        "Failed to process purge cleanup",
      );
    }
  }
}

export function runConnectionPurgeCleanupCycle(): Promise<void> {
  if (cleanupInFlight) return cleanupInFlight;
  cleanupInFlight = executeCleanupCycle().finally(() => {
    cleanupInFlight = null;
  });
  return cleanupInFlight;
}

export function initializeConnectionPurgeCleanup(): void {
  if (cleanupTimer) return;
  const run = () => {
    void runConnectionPurgeCleanupCycle().catch((error) => {
      logger.error(
        { err: formatError(error) },
        "Failed to list companies for purge cleanup",
      );
    });
  };
  run();
  cleanupTimer = setInterval(run, CLEANUP_INTERVAL_MS);
}

export async function shutdownConnectionPurgeCleanup(): Promise<void> {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  await cleanupInFlight;
}
