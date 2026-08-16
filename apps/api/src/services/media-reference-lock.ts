import { type Kysely, sql, type Transaction } from "kysely";
import { MediaObjectReclaimedError } from "../lib/errors.js";
import { resolveMediaKeyForCompany } from "../lib/storage.js";
import type { TenantDatabase } from "./tenant.service.js";

/**
 * Ownership protocol for stored media objects.
 *
 * Two parties race over a private object: a writer attaching an EXISTING key to
 * a new row, and the purge cleanup queue reclaiming a key nothing points at.
 * Neither can see the other through the database alone - the writer's row does
 * not exist yet when cleanup takes its reference census - so both serialize on
 * a transaction-scoped advisory lock derived from the object key.
 *
 * The rules, in full:
 *
 *   1. Both sides lock the same value: the canonical `media/<companyId>/…`
 *      key, never the reference spelling. `s3://bucket/<key>` and an
 *      endpoint URL resolve to one key and therefore to one lock.
 *   2. Locks are taken in sorted key order, so two transactions holding
 *      overlapping sets can never form a cycle.
 *   3. No network call happens while a lock is held. Writers validate their
 *      upload (HeadObject) BEFORE opening the transaction; cleanup commits a
 *      deletion intent and releases the lock BEFORE calling object storage.
 *   4. A writer that finds a deletion intent for its key refuses. That is what
 *      makes the protocol fail closed: once cleanup has committed the intent,
 *      no reference to that key can be created, so the object it is about to
 *      remove cannot acquire a new owner.
 *
 * The lock lives in its own advisory-lock domain, so it can never collide with
 * the company-scoped locks used elsewhere (see `spawnConnection`).
 */
const MEDIA_LOCK_DOMAIN = 0x6d65_6469;

/** Marks a queue item whose object is committed for deletion. */
export const MEDIA_DELETING_MARKER = "deleting";

type TenantExecutor = Kysely<TenantDatabase> | Transaction<TenantDatabase>;

/**
 * Resolve references to the object keys this tenant owns.
 *
 * A remote WhatsApp URL or any reference outside `media/<companyId>/` is not an
 * object of ours; it has no lock and no intent, so it is dropped here.
 */
export function ownedMediaKeys(
  references: ReadonlyArray<string | null | undefined>,
  companyId: string,
): string[] {
  const keys = new Set<string>();
  for (const reference of references) {
    if (!reference) continue;
    try {
      keys.add(resolveMediaKeyForCompany(reference, companyId));
    } catch {
      // Not an object in this tenant's namespace.
    }
  }
  // Sorted: rule 2. Every participant locks in the same order.
  return [...keys].sort();
}

/** Take the transaction-scoped lock for each key, in canonical order. */
export async function lockMediaKeys(
  trx: Transaction<TenantDatabase>,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    await sql`
      SELECT pg_advisory_xact_lock(
        ${sql.lit(MEDIA_LOCK_DOMAIN)}::int,
        hashtext(${key})::int
      )
    `.execute(trx);
  }
}

/** Keys among these that cleanup has already committed to deleting. */
export async function findMediaDeletionIntents(
  executor: TenantExecutor,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await executor
    .selectFrom("purge_cleanup_items")
    .select("media_key")
    .where("kind", "=", "media")
    .where("last_error", "=", MEDIA_DELETING_MARKER)
    .where("media_key", "in", keys)
    .execute();
  return new Set(
    rows
      .map((row) => row.media_key)
      .filter((key): key is string => key !== null),
  );
}

/**
 * Reserve every media reference this transaction is about to persist.
 *
 * Call this INSIDE the transaction that writes the reference and AFTER any
 * HeadObject validation, then write the row. Throws when the object is already
 * committed for deletion, which the route surfaces as a conflict rather than
 * persisting a row that points at something about to vanish.
 */
export async function reserveMediaReferences(
  trx: Transaction<TenantDatabase>,
  companyId: string,
  references: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const keys = ownedMediaKeys(references, companyId);
  if (keys.length === 0) return;
  await lockMediaKeys(trx, keys);
  const reclaimed = await findMediaDeletionIntents(trx, keys);
  if (reclaimed.size > 0) throw new MediaObjectReclaimedError();
}
