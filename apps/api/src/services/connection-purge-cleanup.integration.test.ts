/**
 * PostgreSQL coverage for the durable cleanup queue a permanent connection
 * purge leaves behind.
 *
 * Object deletion is exercised through the injected storage seam - these tests
 * assert which keys *would* be deleted and never touch a real bucket. What is
 * real here is everything that decides that: the captured references, the
 * cross-table reference scan, the claim lease, and the retry state.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { type Kysely, sql } from "kysely";
import { MediaObjectReclaimedError } from "../lib/errors.js";
import { getPrivateMediaReference } from "../lib/storage.js";
import {
  type PurgeCleanupDeps,
  type PurgeCleanupResult,
  processConnectionPurgeCleanup,
} from "./connection-purge-cleanup.service.js";
import { reserveMediaReferences } from "./media-reference-lock.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
  type TenantDatabase,
} from "./tenant.service.js";
import { purgeArchivedConnection } from "./whatsapp/connection.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/** A reference to an object this workspace owns, in the canonical stored form. */
function ownedReference(companyId: string, name: string): string {
  return getPrivateMediaReference(`media/${companyId}/${name}`);
}

/** WhatsApp-hosted media: referenced by our rows, but never ours to delete. */
const FOREIGN_REFERENCE =
  "https://mmg.whatsapp.net/v/t62.7118-24/12345_67890.enc";

interface RecordingDeps {
  deps: Partial<PurgeCleanupDeps>;
  deletedKeys: string[];
  searchedContactIds: string[];
  finalizedBulkJobs: string[];
}

function recordingDeps(
  overrides: Partial<PurgeCleanupDeps> = {},
): RecordingDeps {
  const deletedKeys: string[] = [];
  const searchedContactIds: string[] = [];
  const finalizedBulkJobs: string[] = [];
  return {
    deletedKeys,
    searchedContactIds,
    finalizedBulkJobs,
    deps: {
      deleteObject: async (key) => {
        deletedKeys.push(key);
      },
      dropSearchMessages: async (_companyId, contactIds) => {
        searchedContactIds.push(...contactIds);
      },
      dropSearchContacts: async () => undefined,
      finalizeBulkJob: async (_tenantDb, _companyId, bulkJobId) => {
        finalizedBulkJobs.push(bulkJobId);
      },
      ...overrides,
    },
  };
}

async function withTenant(
  run: (ctx: { companyId: string; ownerId: string }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: `purge-media-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Purge media test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await createTenantSchema(companyId);
    await run({ companyId, ownerId });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

async function insertConnection(
  companyId: string,
  options: { archived: boolean; label: string },
): Promise<string> {
  const connectionId = crypto.randomUUID();
  await getTenantConnection(companyId)
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: options.label,
      status: options.archived ? "disconnected" : "connected",
      archived_at: options.archived ? new Date("2026-03-01T10:00:00Z") : null,
    })
    .execute();
  return connectionId;
}

async function insertContactWithMessage(
  companyId: string,
  connectionId: string,
  options: { mediaUrl?: string | null; profilePictureUrl?: string | null },
): Promise<{ contactId: string; messageId: string }> {
  const tenantDb = getTenantConnection(companyId);
  const contactId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  await tenantDb
    .insertInto("contacts")
    .values({
      id: contactId,
      whatsapp_connection_id: connectionId,
      jid: `${contactId}@s.whatsapp.net`,
      phone_number: contactId.slice(0, 10),
      profile_picture_url: options.profilePictureUrl ?? null,
    })
    .execute();
  await tenantDb
    .insertInto("messages")
    .values({
      id: messageId,
      whatsapp_connection_id: connectionId,
      contact_id: contactId,
      message_id: messageId,
      from_me: false,
      message_type: "image",
      content: "attachment",
      media_url: options.mediaUrl ?? null,
      timestamp: new Date("2026-03-01T10:00:00Z"),
    })
    .execute();
  return { contactId, messageId };
}

/** Bring every queued item due again (settle/backoff windows are wall-clock). */
async function makeDue(companyId: string): Promise<void> {
  await getTenantConnection(companyId)
    .updateTable("purge_cleanup_items")
    .set({ next_attempt_at: new Date(Date.now() - 1_000) })
    .execute();
}

function listItems(companyId: string, connectionId?: string) {
  let query = getTenantConnection(companyId)
    .selectFrom("purge_cleanup_items")
    .select(["id", "kind", "reference", "attempts", "next_attempt_at"]);
  if (connectionId) query = query.where("connection_id", "=", connectionId);
  return query.execute();
}

/**
 * Drain a media item to completion.
 *
 * An object that looks unreferenced is held for a settle window before being
 * deleted (see MEDIA_OWNERSHIP_PROTOCOL), so a full drain is: first pass
 * defers, the window is brought forward, second pass acts.
 */
async function drainWithSettle(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  options: Parameters<typeof processConnectionPurgeCleanup>[2] = {},
): Promise<PurgeCleanupResult> {
  const results: PurgeCleanupResult[] = [];
  for (let pass = 0; pass < 3; pass++) {
    results.push(
      await processConnectionPurgeCleanup(tenantDb, companyId, options),
    );
    if (pass === 2) break;
    // Bring any remaining fixture rows forward. Two follow-up passes cover
    // both a freshly inserted row not yet visible to the first due-time claim
    // on a loaded CI host and the intentional media settle deferral.
    await tenantDb
      .updateTable("purge_cleanup_items")
      .set({ next_attempt_at: new Date(Date.now() - 1_000) })
      .execute();
  }
  return {
    completed: results.reduce((total, result) => total + result.completed, 0),
    failed: results.reduce((total, result) => total + result.failed, 0),
    deferred: results.at(-1)?.deferred ?? 0,
  };
}

describe("permanent purge media cleanup against PostgreSQL", () => {
  integrationTest(
    "deletes only the objects no row still references, and never a foreign one",
    async () => {
      await withTenant(async ({ companyId }) => {
        const tenantDb = getTenantConnection(companyId);
        const shared = ownedReference(companyId, "shared-attachment.jpg");
        const unique = ownedReference(companyId, "only-on-purged.jpg");

        const purgedConnection = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        const siblingConnection = await insertConnection(companyId, {
          archived: false,
          label: "sibling",
        });

        // The purged account holds one object it shares with the sibling, one
        // it alone references, and a WhatsApp-hosted avatar.
        await insertContactWithMessage(companyId, purgedConnection, {
          mediaUrl: shared,
          profilePictureUrl: FOREIGN_REFERENCE,
        });
        await insertContactWithMessage(companyId, purgedConnection, {
          mediaUrl: unique,
        });
        const sibling = await insertContactWithMessage(
          companyId,
          siblingConnection,
          { mediaUrl: shared },
        );

        await purgeArchivedConnection(tenantDb, purgedConnection);

        const captured = await listItems(companyId, purgedConnection);
        expect(
          captured
            .filter((item) => item.kind === "media")
            .map((item) => item.reference)
            .sort(),
        ).toEqual([FOREIGN_REFERENCE, shared, unique].sort());

        const recorded = recordingDeps();
        const result = await drainWithSettle(tenantDb, companyId, {
          deps: recorded.deps,
        });

        // The shared object still has the sibling's message pointing at it;
        // only the exclusively-owned one is reclaimed, and the WhatsApp URL is
        // settled without any storage call at all.
        expect(recorded.deletedKeys).toEqual([
          `media/${companyId}/only-on-purged.jpg`,
        ]);
        expect(result.failed).toBe(0);
        expect(await listItems(companyId)).toHaveLength(0);

        // The sibling connection keeps its row - and therefore its object.
        expect(
          await tenantDb
            .selectFrom("messages")
            .select("media_url")
            .where("id", "=", sibling.messageId)
            .executeTakeFirst(),
        ).toEqual({ media_url: shared });
      });
    },
    60_000,
  );

  integrationTest(
    "keeps an object an undispatched schedule or live broadcast still needs",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const scheduleRef = ownedReference(companyId, "queued-send.jpg");
        const broadcastRef = ownedReference(companyId, "broadcast.jpg");
        const settledRef = ownedReference(companyId, "already-sent.jpg");
        const connectionId = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        const sibling = await insertConnection(companyId, {
          archived: false,
          label: "sibling",
        });
        const contact = await insertContactWithMessage(companyId, sibling, {
          mediaUrl: null,
        });

        await tenantDb
          .insertInto("scheduled_messages")
          .values([
            {
              contact_id: contact.contactId,
              content: "queued",
              media_url: scheduleRef,
              scheduled_at: new Date("2026-04-01T10:00:00Z"),
              next_attempt_at: new Date("2026-04-01T10:00:00Z"),
              created_by: ownerId,
              status: "scheduled",
            },
            {
              contact_id: contact.contactId,
              content: "done",
              media_url: settledRef,
              scheduled_at: new Date("2026-03-01T10:00:00Z"),
              next_attempt_at: new Date("2026-03-01T10:00:00Z"),
              created_by: ownerId,
              status: "sent",
            },
          ])
          .execute();
        await tenantDb
          .insertInto("bulk_jobs")
          .values({
            name: "Live broadcast",
            content: "hello",
            media_url: broadcastRef,
            audience: { tagIds: [], contactIds: [] },
            audience_hash: "hash",
            scheduled_at: new Date("2026-04-01T10:00:00Z"),
            created_by: ownerId,
            status: "scheduled",
          })
          .execute();

        for (const reference of [scheduleRef, broadcastRef, settledRef]) {
          await tenantDb
            .insertInto("purge_cleanup_items")
            .values({ connection_id: connectionId, kind: "media", reference })
            .execute();
        }

        const recorded = recordingDeps();
        await drainWithSettle(tenantDb, companyId, { deps: recorded.deps });

        // A settled leaf's upload belongs to the message it produced, so it is
        // reclaimable; the pending schedule's and the live job's are not.
        expect(recorded.deletedKeys).toEqual([
          `media/${companyId}/already-sent.jpg`,
        ]);
        expect(await listItems(companyId)).toHaveLength(0);
      });
    },
    60_000,
  );

  integrationTest(
    "retries a failed deletion with backoff and settles it on the next pass",
    async () => {
      await withTenant(async ({ companyId }) => {
        const tenantDb = getTenantConnection(companyId);
        const reference = ownedReference(companyId, "retry-me.jpg");
        const connectionId = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        await tenantDb
          .insertInto("purge_cleanup_items")
          .values({ connection_id: connectionId, kind: "media", reference })
          .execute();

        // A first clean look only defers; storage is not touched yet.
        const settling = recordingDeps();
        expect(
          await processConnectionPurgeCleanup(tenantDb, companyId, {
            deps: settling.deps,
          }),
        ).toEqual({ completed: 0, failed: 0, deferred: 1 });
        expect(settling.deletedKeys).toEqual([]);
        await makeDue(companyId);

        const failing = recordingDeps({
          deleteObject: async () => {
            throw new Error("object storage unavailable");
          },
        });
        const firstPass = await processConnectionPurgeCleanup(
          tenantDb,
          companyId,
          { deps: failing.deps },
        );
        expect(firstPass).toEqual({ completed: 0, failed: 1, deferred: 0 });

        const [afterFailure] = await listItems(companyId);
        expect(afterFailure.attempts).toBe(1);
        expect(afterFailure.next_attempt_at.getTime()).toBeGreaterThan(
          Date.now() + 30_000,
        );
        // The deletion intent deliberately survives its own retry: clearing it
        // would reopen the key to writers while the object is already gone or
        // half-deleted. The failure reason is logged rather than stored.
        const [{ last_error: lastError, media_key: mediaKey }] = await tenantDb
          .selectFrom("purge_cleanup_items")
          .select(["last_error", "media_key"])
          .execute();
        expect(lastError).toBe("deleting");
        expect(mediaKey).toBe(`media/${companyId}/retry-me.jpg`);

        // A backed-off item is invisible until it comes due again.
        const tooSoon = recordingDeps();
        expect(
          await processConnectionPurgeCleanup(tenantDb, companyId, {
            deps: tooSoon.deps,
          }),
        ).toEqual({ completed: 0, failed: 0, deferred: 0 });
        expect(tooSoon.deletedKeys).toEqual([]);

        await tenantDb
          .updateTable("purge_cleanup_items")
          .set({ next_attempt_at: new Date(Date.now() - 1_000) })
          .execute();
        const recovered = recordingDeps();
        expect(
          await drainWithSettle(tenantDb, companyId, { deps: recovered.deps }),
        ).toEqual({ completed: 1, failed: 0, deferred: 0 });
        expect(recovered.deletedKeys).toEqual([
          `media/${companyId}/retry-me.jpg`,
        ]);
        expect(await listItems(companyId)).toHaveLength(0);
      });
    },
    60_000,
  );

  integrationTest(
    "leases claimed work so a concurrent pass cannot delete the same object twice",
    async () => {
      await withTenant(async ({ companyId }) => {
        const tenantDb = getTenantConnection(companyId);
        const connectionId = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        await tenantDb
          .insertInto("purge_cleanup_items")
          .values({
            connection_id: connectionId,
            kind: "media",
            reference: ownedReference(companyId, "contended.jpg"),
          })
          .execute();

        // Bring the item to its settle phase so the contended pass is the one
        // that actually reaches storage.
        const warmup = recordingDeps();
        expect(
          (
            await processConnectionPurgeCleanup(tenantDb, companyId, {
              deps: warmup.deps,
            })
          ).deferred,
        ).toBe(1);
        await makeDue(companyId);

        let releaseFirst!: () => void;
        const release = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        let firstReachedStorage!: () => void;
        const reachedStorage = new Promise<void>((resolve) => {
          firstReachedStorage = resolve;
        });

        const first = recordingDeps({
          deleteObject: async (key) => {
            firstReachedStorage();
            await release;
            firstDeleted.push(key);
          },
        });
        const firstDeleted: string[] = [];
        const firstPass = processConnectionPurgeCleanup(tenantDb, companyId, {
          deps: first.deps,
        });

        // The item is claimed and leased while the first pass is mid-flight,
        // so a second processor finds nothing due rather than racing it.
        await reachedStorage;
        const second = recordingDeps();
        expect(
          await processConnectionPurgeCleanup(tenantDb, companyId, {
            deps: second.deps,
          }),
        ).toEqual({ completed: 0, failed: 0, deferred: 0 });
        expect(second.deletedKeys).toEqual([]);

        releaseFirst();
        expect(await firstPass).toEqual({
          completed: 1,
          failed: 0,
          deferred: 0,
        });
        expect(firstDeleted).toEqual([`media/${companyId}/contended.jpg`]);
        expect(await listItems(companyId)).toHaveLength(0);
      });
    },
    60_000,
  );

  /**
   * The one interleaving the reference check alone cannot see: a request
   * validated an object (HeadObject succeeded) BEFORE the check ran, and only
   * commits its row afterwards. The settle window is what closes it - the
   * second look sees the row and the object is kept.
   */
  integrationTest(
    "keeps an object whose reference is written during the settle window",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const reference = ownedReference(companyId, "raced-upload.jpg");
        const connectionId = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        const sibling = await insertConnection(companyId, {
          archived: false,
          label: "sibling",
        });
        const contact = await insertContactWithMessage(companyId, sibling, {
          mediaUrl: null,
        });
        await tenantDb
          .insertInto("purge_cleanup_items")
          .values({ connection_id: connectionId, kind: "media", reference })
          .execute();

        // Pass one: genuinely unreferenced, so it is only deferred.
        const first = recordingDeps();
        expect(
          (
            await processConnectionPurgeCleanup(tenantDb, companyId, {
              deps: first.deps,
            })
          ).deferred,
        ).toBe(1);
        expect(first.deletedKeys).toEqual([]);

        // The racing writer commits inside the settle window.
        await tenantDb
          .insertInto("scheduled_messages")
          .values({
            contact_id: contact.contactId,
            content: "queued with the raced upload",
            media_url: reference,
            scheduled_at: new Date("2026-04-01T10:00:00Z"),
            next_attempt_at: new Date("2026-04-01T10:00:00Z"),
            created_by: ownerId,
            status: "scheduled",
          })
          .execute();
        await makeDue(companyId);

        // Pass two sees the new row: the object is kept and the item retires.
        const second = recordingDeps();
        expect(
          await processConnectionPurgeCleanup(tenantDb, companyId, {
            deps: second.deps,
          }),
        ).toEqual({ completed: 1, failed: 0, deferred: 0 });
        expect(second.deletedKeys).toEqual([]);
        expect(await listItems(companyId)).toHaveLength(0);
      });
    },
    60_000,
  );

  integrationTest(
    "never deletes media a bulk job and its leaves share",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const shared = ownedReference(companyId, "broadcast-shared.jpg");
        const connectionId = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        const sibling = await insertConnection(companyId, {
          archived: false,
          label: "sibling",
        });
        const contact = await insertContactWithMessage(companyId, sibling, {
          mediaUrl: null,
        });
        const bulkJobId = crypto.randomUUID();
        await tenantDb
          .insertInto("bulk_jobs")
          .values({
            id: bulkJobId,
            name: "Live broadcast",
            content: "hello",
            media_url: shared,
            audience: { tagIds: [], contactIds: [] },
            audience_hash: "hash",
            scheduled_at: new Date("2026-04-01T10:00:00Z"),
            created_by: ownerId,
            status: "running",
          })
          .execute();
        // A leaf of that job, still queued, pointing at the same object.
        await tenantDb
          .insertInto("scheduled_messages")
          .values({
            contact_id: contact.contactId,
            content: "hello",
            media_url: shared,
            scheduled_at: new Date("2026-04-01T10:00:00Z"),
            next_attempt_at: new Date("2026-04-01T10:00:00Z"),
            created_by: ownerId,
            status: "scheduled",
            bulk_job_id: bulkJobId,
          })
          .execute();
        await tenantDb
          .insertInto("purge_cleanup_items")
          .values({
            connection_id: connectionId,
            kind: "media",
            reference: shared,
          })
          .execute();

        const recorded = recordingDeps();
        await drainWithSettle(tenantDb, companyId, { deps: recorded.deps });

        expect(recorded.deletedKeys).toEqual([]);
        expect(await listItems(companyId)).toHaveLength(0);
        // Both owners are untouched.
        expect(
          await tenantDb
            .selectFrom("bulk_jobs")
            .select("media_url")
            .where("id", "=", bulkJobId)
            .executeTakeFirst(),
        ).toEqual({ media_url: shared });
      });
    },
    60_000,
  );

  /**
   * The writer half of the ownership protocol.
   *
   * A writer that has already validated its upload opens its transaction and
   * takes the object's lock before inserting. Cleanup takes the same lock to
   * commit its deletion intent, so the two serialize: whichever arrives second
   * sees the first one's decision.
   */
  integrationTest(
    "a writer holding the object lock blocks cleanup until it commits",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const reference = ownedReference(companyId, "held-by-writer.jpg");
        const connectionId = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        const sibling = await insertConnection(companyId, {
          archived: false,
          label: "sibling",
        });
        const contact = await insertContactWithMessage(companyId, sibling, {
          mediaUrl: null,
        });
        await tenantDb
          .insertInto("purge_cleanup_items")
          .values({ connection_id: connectionId, kind: "media", reference })
          .execute();

        // Bring the item to the point where the next pass would delete.
        const warmup = recordingDeps();
        expect(
          (
            await processConnectionPurgeCleanup(tenantDb, companyId, {
              deps: warmup.deps,
            })
          ).deferred,
        ).toBe(1);
        await makeDue(companyId);

        // The writer takes the lock and holds it, mid-transaction, exactly as
        // it would between validating its upload and inserting its row.
        let releaseWriter!: () => void;
        const released = new Promise<void>((resolve) => {
          releaseWriter = resolve;
        });
        let writerLocked!: () => void;
        const locked = new Promise<void>((resolve) => {
          writerLocked = resolve;
        });
        const writer = tenantDb.transaction().execute(async (trx) => {
          await reserveMediaReferences(trx, companyId, [reference]);
          writerLocked();
          await released;
          await trx
            .insertInto("scheduled_messages")
            .values({
              contact_id: contact.contactId,
              content: "queued",
              media_url: reference,
              scheduled_at: new Date("2026-04-01T10:00:00Z"),
              next_attempt_at: new Date("2026-04-01T10:00:00Z"),
              created_by: ownerId,
              status: "scheduled",
            })
            .execute();
        });
        await locked;

        const recorded = recordingDeps();
        const cleanup = processConnectionPurgeCleanup(tenantDb, companyId, {
          deps: recorded.deps,
        });
        // Cleanup is now parked on the advisory lock; let the writer finish.
        releaseWriter();
        await writer;
        await cleanup;

        // Serialized behind the writer, cleanup re-read the census under the
        // lock, saw the new row, and left the object alone.
        expect(recorded.deletedKeys).toEqual([]);
        expect(await listItems(companyId)).toHaveLength(0);
      });
    },
    60_000,
  );

  integrationTest(
    "a writer refuses an object cleanup has already committed to deleting",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const reference = ownedReference(companyId, "already-claimed.jpg");
        const connectionId = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        const sibling = await insertConnection(companyId, {
          archived: false,
          label: "sibling",
        });
        const contact = await insertContactWithMessage(companyId, sibling, {
          mediaUrl: null,
        });
        await tenantDb
          .insertInto("purge_cleanup_items")
          .values({ connection_id: connectionId, kind: "media", reference })
          .execute();

        // Drive cleanup to a committed intent, but make the object-store call
        // fail so the intent stays on the row.
        const warmup = recordingDeps();
        await processConnectionPurgeCleanup(tenantDb, companyId, {
          deps: warmup.deps,
        });
        await makeDue(companyId);
        const failing = recordingDeps({
          deleteObject: async () => {
            throw new Error("object storage unavailable");
          },
        });
        expect(
          (
            await processConnectionPurgeCleanup(tenantDb, companyId, {
              deps: failing.deps,
            })
          ).failed,
        ).toBe(1);

        // The key is now closed: a writer that validated this object earlier
        // must refuse rather than persist a row pointing at it.
        await expect(
          tenantDb.transaction().execute(async (trx) => {
            await reserveMediaReferences(trx, companyId, [reference]);
            await trx
              .insertInto("scheduled_messages")
              .values({
                contact_id: contact.contactId,
                content: "too late",
                media_url: reference,
                scheduled_at: new Date("2026-04-01T10:00:00Z"),
                next_attempt_at: new Date("2026-04-01T10:00:00Z"),
                created_by: ownerId,
                status: "scheduled",
              })
              .execute();
          }),
        ).rejects.toBeInstanceOf(MediaObjectReclaimedError);

        expect(
          await tenantDb
            .selectFrom("scheduled_messages")
            .select("id")
            .where("media_url", "=", reference)
            .executeTakeFirst(),
        ).toBeUndefined();
      });
    },
    60_000,
  );

  /**
   * Lock order. Both sides sort keys before locking, so two transactions
   * holding overlapping sets cannot deadlock. Acquiring the same pair in
   * opposite request order must still serialize cleanly.
   */
  integrationTest(
    "overlapping lock sets acquired in opposite order do not deadlock",
    async () => {
      await withTenant(async ({ companyId }) => {
        const tenantDb = getTenantConnection(companyId);
        const first = ownedReference(companyId, "aaa-object.jpg");
        const second = ownedReference(companyId, "zzz-object.jpg");

        let releaseA!: () => void;
        const aReleased = new Promise<void>((resolve) => {
          releaseA = resolve;
        });
        let aLocked!: () => void;
        const aHasLocks = new Promise<void>((resolve) => {
          aLocked = resolve;
        });

        const transactionA = tenantDb.transaction().execute(async (trx) => {
          await reserveMediaReferences(trx, companyId, [first, second]);
          aLocked();
          await aReleased;
        });
        await aHasLocks;

        // B asks for the same two objects in the opposite order. Because both
        // sides sort, B waits for A rather than taking one lock and blocking.
        const transactionB = tenantDb.transaction().execute(async (trx) => {
          await reserveMediaReferences(trx, companyId, [second, first]);
        });
        releaseA();
        await Promise.all([transactionA, transactionB]);
        // No deadlock error: both transactions committed.
        expect(true).toBe(true);
      });
    },
    60_000,
  );

  integrationTest(
    "drains only the requested connection and kinds",
    async () => {
      await withTenant(async ({ companyId }) => {
        const tenantDb = getTenantConnection(companyId);
        const purged = await insertConnection(companyId, {
          archived: true,
          label: "purged",
        });
        const other = await insertConnection(companyId, {
          archived: true,
          label: "other",
        });
        const contactId = crypto.randomUUID();
        await tenantDb
          .insertInto("purge_cleanup_items")
          .values([
            {
              connection_id: purged,
              kind: "search_contact",
              reference: contactId,
            },
            {
              connection_id: purged,
              kind: "media",
              reference: ownedReference(companyId, "purged.jpg"),
            },
            {
              connection_id: other,
              kind: "media",
              reference: ownedReference(companyId, "other.jpg"),
            },
          ])
          .execute();

        const recorded = recordingDeps();
        expect(
          await processConnectionPurgeCleanup(tenantDb, companyId, {
            connectionId: purged,
            kinds: ["search_contact"],
            deps: recorded.deps,
          }),
        ).toEqual({ completed: 1, failed: 0, deferred: 0 });

        expect(recorded.searchedContactIds).toEqual([contactId]);
        expect(recorded.deletedKeys).toEqual([]);
        expect(
          (await listItems(companyId)).map((item) => item.kind).sort(),
        ).toEqual(["media", "media"]);
      });
    },
    60_000,
  );
});
