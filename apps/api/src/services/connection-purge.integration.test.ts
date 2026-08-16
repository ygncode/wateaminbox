/**
 * PostgreSQL regression coverage for "Connections > Permanently delete".
 *
 * The unit contract (whatsapp/connection-purge.test.ts) pins the statement
 * order; this pins what the tenant schema actually enforces - above all that a
 * conversation case referencing its opening message no longer blocks the purge
 * - and that a sibling connection in the same workspace keeps everything.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { type Kysely, sql } from "kysely";
import {
  ConnectionNotArchivedError,
  ConnectionNotFoundError,
} from "../lib/errors.js";
import { getBulkJobProgress } from "./bulk-job.service.js";
import { processConnectionPurgeCleanup } from "./connection-purge-cleanup.service.js";
import { openOrReopenCaseForInboundMessage } from "./conversation-case.service.js";
import { lockActiveConnectionForEvent } from "./handlers/connection-event-guard.js";
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
        email: `purge-owner-${ownerId}@example.com`,
        password_hash: "test",
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Connection purge test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await db
      .insertInto("sla_policies")
      .values({
        company_id: companyId,
        target_minutes: 60,
        direct_resolution_target_minutes: 480,
        group_response_target_minutes: 120,
        group_resolution_target_minutes: 960,
        timezone: "UTC",
        weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
        exceptions: JSON.stringify([]),
        effective_from: new Date("1970-01-01T00:00:00Z"),
        created_by: ownerId,
      })
      .execute();

    await createTenantSchema(companyId);
    await run({ companyId, ownerId });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("sla_policies")
      .where("company_id", "=", companyId)
      .execute();
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
  }
}

interface ConnectionFixture {
  connectionId: string;
  contactId: string;
  groupContactId: string;
  groupId: string;
  messageIds: string[];
  caseId: string;
  scheduledMessageId: string;
  bulkLeafId: string;
  notificationId: string;
  mediaReference: string;
}

/**
 * Builds one connection carrying a row in every tenant table the purge is
 * responsible for, including a real conversation case opened through the
 * production code path (so `opening_message_id` and `messages.case_id` are
 * genuine foreign keys, not hand-written values).
 */
async function seedConnection(
  companyId: string,
  ownerId: string,
  options: {
    label: string;
    archived: boolean;
    tagId: string;
    bulkJobId: string;
  },
): Promise<ConnectionFixture> {
  const tenantDb = getTenantConnection(companyId);
  const connectionId = crypto.randomUUID();
  const now = new Date("2026-03-01T10:00:00Z");

  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: options.label,
      phone_number: `1415555${options.label.charCodeAt(0)}`,
      jid: `${options.label}@s.whatsapp.net`,
      status: options.archived ? "disconnected" : "connected",
      archived_at: options.archived ? now : null,
    })
    .execute();
  await tenantDb
    .insertInto("whatsapp_connection_sessions")
    .values({ whatsapp_connection_id: connectionId, status: "ended" })
    .execute();

  const contactId = crypto.randomUUID();
  const groupContactId = crypto.randomUUID();
  await tenantDb
    .insertInto("contacts")
    .values([
      {
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid: `${options.label}-direct@s.whatsapp.net`,
        phone_number: `1415000${options.label.charCodeAt(0)}`,
        push_name: `${options.label} direct`,
      },
      {
        id: groupContactId,
        whatsapp_connection_id: connectionId,
        jid: `${options.label}-group@g.us`,
        push_name: `${options.label} group`,
        is_group: true,
      },
    ])
    .execute();

  const groupId = crypto.randomUUID();
  await tenantDb
    .insertInto("groups")
    .values({
      id: groupId,
      contact_id: groupContactId,
      jid: `${options.label}-group@g.us`,
      name: `${options.label} group`,
    })
    .execute();
  await tenantDb
    .insertInto("group_participants")
    .values({
      group_id: groupId,
      participant_jid: `${options.label}-member@s.whatsapp.net`,
    })
    .execute();

  // The opening message plus the case that references it - the combination
  // that used to abort the purge with a foreign key violation.
  const openingMessageId = crypto.randomUUID();
  const mediaReference = `s3://whatsapp-media/media/${companyId}/${options.label}.jpg`;
  const openedCase = await tenantDb.transaction().execute(async (trx) => {
    await trx
      .insertInto("messages")
      .values({
        id: openingMessageId,
        whatsapp_connection_id: connectionId,
        contact_id: contactId,
        message_id: `${options.label}-opening`,
        from_me: false,
        message_type: "text",
        content: "hello",
        media_url: mediaReference,
        timestamp: now,
      })
      .execute();
    return openOrReopenCaseForInboundMessage(
      trx,
      companyId,
      { id: contactId, isGroup: false },
      { id: openingMessageId, timestamp: now },
    );
  });
  if (!openedCase) throw new Error("expected a case to be opened");

  const replyMessageId = crypto.randomUUID();
  await tenantDb
    .insertInto("messages")
    .values({
      id: replyMessageId,
      whatsapp_connection_id: connectionId,
      contact_id: contactId,
      message_id: `${options.label}-reply`,
      from_me: true,
      message_type: "text",
      content: "hi there",
      timestamp: now,
      case_id: openedCase.case.id,
    })
    .execute();
  await tenantDb
    .insertInto("message_reactions")
    .values({
      message_id: replyMessageId,
      reactor_jid: `${options.label}-member@s.whatsapp.net`,
      emoji: "👍",
    })
    .execute();

  await tenantDb
    .insertInto("contact_tags")
    .values({ contact_id: contactId, tag_id: options.tagId })
    .execute();
  await tenantDb
    .insertInto("contact_assignments")
    .values({
      contact_id: contactId,
      assigned_to: ownerId,
      assigned_by: ownerId,
    })
    .execute();
  await tenantDb
    .insertInto("contact_notes_private")
    .values({ contact_id: contactId, user_id: ownerId, content: "private" })
    .execute();
  await tenantDb
    .insertInto("contact_notes_shared")
    .values({
      contact_id: contactId,
      user_id: ownerId,
      author_name: "Owner",
      content: "shared",
    })
    .execute();

  const scheduledMessageId = crypto.randomUUID();
  const bulkLeafId = crypto.randomUUID();
  await tenantDb
    .insertInto("scheduled_messages")
    .values([
      {
        id: scheduledMessageId,
        contact_id: contactId,
        content: "later",
        scheduled_at: now,
        next_attempt_at: now,
        created_by: ownerId,
      },
      {
        id: bulkLeafId,
        contact_id: contactId,
        content: "broadcast",
        scheduled_at: now,
        next_attempt_at: now,
        created_by: ownerId,
        bulk_job_id: options.bulkJobId,
      },
    ])
    .execute();

  await tenantDb
    .insertInto("status_updates")
    .values({
      whatsapp_connection_id: connectionId,
      status_id: `${options.label}-status`,
      from_jid: `${options.label}-member@s.whatsapp.net`,
      timestamp: now,
      expires_at: new Date(now.getTime() + 86_400_000),
    })
    .execute();
  await tenantDb
    .insertInto("whatsapp_labels")
    .values({
      whatsapp_connection_id: connectionId,
      label_id: `${options.label}-label`,
      name: `${options.label} label`,
      synced_tag_id: options.tagId,
    })
    .execute();
  await tenantDb
    .insertInto("whatsapp_catalogs")
    .values({
      whatsapp_connection_id: connectionId,
      catalog_id: `${options.label}-catalog`,
      name: `${options.label} catalog`,
      header_image_url: mediaReference,
    })
    .execute();
  await tenantDb
    .insertInto("catalog_products")
    .values({
      whatsapp_connection_id: connectionId,
      catalog_id: `${options.label}-catalog`,
      product_id: `${options.label}-product`,
      name: `${options.label} product`,
      image_urls: [mediaReference],
    })
    .execute();
  await tenantDb
    .insertInto("bulk_connection_budgets")
    .values({ whatsapp_connection_id: connectionId })
    .execute();

  const notificationId = crypto.randomUUID();
  await tenantDb
    .insertInto("notification_history")
    .values({
      id: notificationId,
      user_id: ownerId,
      notification_type: "assignment",
      title: `${options.label} assignment`,
      action_url: `/chat/${contactId}`,
      metadata: { contactId },
    })
    .execute();

  return {
    connectionId,
    contactId,
    groupContactId,
    groupId,
    messageIds: [openingMessageId, replyMessageId],
    caseId: openedCase.case.id,
    scheduledMessageId,
    bulkLeafId,
    notificationId,
    mediaReference,
  };
}

async function countRows(
  tenantDb: Kysely<TenantDatabase>,
  fixture: ConnectionFixture,
): Promise<Record<string, number>> {
  const contactIds = [fixture.contactId, fixture.groupContactId];
  const count = async (rows: Promise<Array<unknown>>) => (await rows).length;

  return {
    connections: await count(
      tenantDb
        .selectFrom("whatsapp_connections")
        .select("id")
        .where("id", "=", fixture.connectionId)
        .execute(),
    ),
    sessions: await count(
      tenantDb
        .selectFrom("whatsapp_connection_sessions")
        .select("id")
        .where("whatsapp_connection_id", "=", fixture.connectionId)
        .execute(),
    ),
    contacts: await count(
      tenantDb
        .selectFrom("contacts")
        .select("id")
        .where("whatsapp_connection_id", "=", fixture.connectionId)
        .execute(),
    ),
    messages: await count(
      tenantDb
        .selectFrom("messages")
        .select("id")
        .where("whatsapp_connection_id", "=", fixture.connectionId)
        .execute(),
    ),
    reactions: await count(
      tenantDb
        .selectFrom("message_reactions")
        .select("id")
        .where("message_id", "in", fixture.messageIds)
        .execute(),
    ),
    cases: await count(
      tenantDb
        .selectFrom("conversation_cases")
        .select("id")
        .where("contact_id", "in", contactIds)
        .execute(),
    ),
    conversationStates: await count(
      tenantDb
        .selectFrom("conversation_states")
        .select("id")
        .where("contact_id", "in", contactIds)
        .execute(),
    ),
    contactTags: await count(
      tenantDb
        .selectFrom("contact_tags")
        .select("tag_id")
        .where("contact_id", "in", contactIds)
        .execute(),
    ),
    assignments: await count(
      tenantDb
        .selectFrom("contact_assignments")
        .select("id")
        .where("contact_id", "in", contactIds)
        .execute(),
    ),
    privateNotes: await count(
      tenantDb
        .selectFrom("contact_notes_private")
        .select("id")
        .where("contact_id", "in", contactIds)
        .execute(),
    ),
    sharedNotes: await count(
      tenantDb
        .selectFrom("contact_notes_shared")
        .select("id")
        .where("contact_id", "in", contactIds)
        .execute(),
    ),
    groups: await count(
      tenantDb
        .selectFrom("groups")
        .select("id")
        .where("id", "=", fixture.groupId)
        .execute(),
    ),
    groupParticipants: await count(
      tenantDb
        .selectFrom("group_participants")
        .select("id")
        .where("group_id", "=", fixture.groupId)
        .execute(),
    ),
    scheduledMessages: await count(
      tenantDb
        .selectFrom("scheduled_messages")
        .select("id")
        .where("contact_id", "in", contactIds)
        .execute(),
    ),
    statusUpdates: await count(
      tenantDb
        .selectFrom("status_updates")
        .select("id")
        .where("whatsapp_connection_id", "=", fixture.connectionId)
        .execute(),
    ),
    labels: await count(
      tenantDb
        .selectFrom("whatsapp_labels")
        .select("id")
        .where("whatsapp_connection_id", "=", fixture.connectionId)
        .execute(),
    ),
    catalogs: await count(
      tenantDb
        .selectFrom("whatsapp_catalogs")
        .select("id")
        .where("whatsapp_connection_id", "=", fixture.connectionId)
        .execute(),
    ),
    catalogProducts: await count(
      tenantDb
        .selectFrom("catalog_products")
        .select("id")
        .where("whatsapp_connection_id", "=", fixture.connectionId)
        .execute(),
    ),
    bulkBudgets: await count(
      tenantDb
        .selectFrom("bulk_connection_budgets")
        .select("whatsapp_connection_id")
        .where("whatsapp_connection_id", "=", fixture.connectionId)
        .execute(),
    ),
    notifications: await count(
      tenantDb
        .selectFrom("notification_history")
        .select("id")
        .where("id", "=", fixture.notificationId)
        .execute(),
    ),
  };
}

describe("permanent connection purge against PostgreSQL", () => {
  integrationTest(
    "erases the archived account's data - conversation cases included - and leaves the sibling connection intact",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const tagId = crypto.randomUUID();
        await tenantDb
          .insertInto("tags")
          .values({ id: tagId, name: "Workspace tag", created_by: ownerId })
          .execute();
        const bulkJobId = crypto.randomUUID();
        await tenantDb
          .insertInto("bulk_jobs")
          .values({
            id: bulkJobId,
            name: "Cross-connection broadcast",
            content: "hello everyone",
            audience: { tagIds: [tagId], contactIds: [] },
            audience_hash: "hash",
            scheduled_at: new Date("2026-03-01T10:00:00Z"),
            total_recipients: 2,
            created_by: ownerId,
          })
          .execute();
        const unrelatedNotificationId = crypto.randomUUID();
        await tenantDb
          .insertInto("notification_history")
          .values({
            id: unrelatedNotificationId,
            user_id: ownerId,
            notification_type: "system",
            title: "Workspace notice",
          })
          .execute();

        const purged = await seedConnection(companyId, ownerId, {
          label: "purged",
          archived: true,
          tagId,
          bulkJobId,
        });
        const retained = await seedConnection(companyId, ownerId, {
          label: "retained",
          archived: false,
          tagId,
          bulkJobId,
        });

        const before = await countRows(tenantDb, purged);
        for (const [table, rows] of Object.entries(before)) {
          expect(rows, `seed produced no ${table} rows`).toBeGreaterThan(0);
        }

        const result = await purgeArchivedConnection(
          tenantDb,
          purged.connectionId,
        );

        expect([...result.contactIds].sort()).toEqual(
          [purged.contactId, purged.groupContactId].sort(),
        );
        expect(result.deletedMessageCount).toBe(2);
        expect(result.affectedBulkJobIds).toEqual([bulkJobId]);

        // Removing the purged recipient's leaf must not shrink or falsify the
        // retained cross-connection job's progress. Its pending leaf belongs
        // to the sibling; the erased pending leaf is retained as skipped.
        expect(await getBulkJobProgress(tenantDb, bulkJobId)).toEqual({
          total: 2,
          pending: 1,
          processing: 0,
          sent: 0,
          failed: 0,
          canceled: 0,
          skipped: 1,
        });
        const cleanupItems = await tenantDb
          .selectFrom("purge_cleanup_items")
          .select(["kind", "reference"])
          .where("connection_id", "=", purged.connectionId)
          .execute();
        expect(
          cleanupItems.filter((item) => item.kind === "search_contact").length,
        ).toBe(2);
        expect(cleanupItems).toContainEqual({
          kind: "bulk_job",
          reference: bulkJobId,
        });
        expect(cleanupItems).toContainEqual({
          kind: "media",
          reference: purged.mediaReference,
        });
        expect(
          await processConnectionPurgeCleanup(tenantDb, companyId, {
            connectionId: purged.connectionId,
            kinds: ["bulk_job"],
          }),
        ).toEqual({ completed: 1, failed: 0, deferred: 0 });
        expect(
          await tenantDb
            .selectFrom("purge_cleanup_items")
            .select("id")
            .where("connection_id", "=", purged.connectionId)
            .where("kind", "=", "bulk_job")
            .executeTakeFirst(),
        ).toBeUndefined();

        const deletedMedia: string[] = [];
        const mediaDeps = {
          resolveOwnedMediaKey: (reference: string) => reference,
          deleteObject: async (reference: string) => {
            deletedMedia.push(reference);
          },
        };
        const drainMedia = () =>
          processConnectionPurgeCleanup(tenantDb, companyId, {
            connectionId: purged.connectionId,
            kinds: ["media"],
            deps: mediaDeps,
          });
        // First look defers; nothing reaches storage until the settle window
        // has passed and the object still looks unreferenced.
        expect((await drainMedia()).deferred).toBe(1);
        expect(deletedMedia).toEqual([]);
        await tenantDb
          .updateTable("purge_cleanup_items")
          .set({ next_attempt_at: new Date(Date.now() - 1_000) })
          .execute();
        expect(await drainMedia()).toEqual({
          completed: 1,
          failed: 0,
          deferred: 0,
        });
        expect(deletedMedia).toEqual([purged.mediaReference]);

        // A transient object-store failure leaves the item durable with
        // backoff instead of losing the only pointer after source deletion.
        const retryReference = `s3://whatsapp-media/media/${companyId}/retry.jpg`;
        await tenantDb
          .insertInto("purge_cleanup_items")
          .values({
            connection_id: purged.connectionId,
            kind: "media",
            reference: retryReference,
            // Explicitly due. The column default is the SERVER's now(), while
            // the claim filters on a client-side timestamp, so a fresh row is
            // not reliably claimable in the same instant.
            next_attempt_at: new Date(Date.now() - 1_000),
          })
          .execute();
        const settleDeps = {
          resolveOwnedMediaKey: (reference: string) => reference,
          deleteObject: async () => undefined,
        };
        // The first clean look only defers - storage is never touched until an
        // object has looked unreferenced twice.
        expect(
          (
            await processConnectionPurgeCleanup(tenantDb, companyId, {
              connectionId: purged.connectionId,
              kinds: ["media"],
              deps: settleDeps,
            })
          ).deferred,
        ).toBeGreaterThan(0);
        await tenantDb
          .updateTable("purge_cleanup_items")
          .set({ next_attempt_at: new Date(Date.now() - 1_000) })
          .where("reference", "=", retryReference)
          .execute();

        const failedAt = new Date();
        expect(
          await processConnectionPurgeCleanup(tenantDb, companyId, {
            connectionId: purged.connectionId,
            kinds: ["media"],
            deps: {
              resolveOwnedMediaKey: (reference) => reference,
              deleteObject: async () => {
                throw new Error("object store unavailable");
              },
            },
          }),
        ).toEqual({ completed: 0, failed: 1, deferred: 0 });
        const retryItem = await tenantDb
          .selectFrom("purge_cleanup_items")
          .select(["attempts", "next_attempt_at", "last_error"])
          .where("connection_id", "=", purged.connectionId)
          .where("reference", "=", retryReference)
          .executeTakeFirstOrThrow();
        expect(retryItem.attempts).toBe(1);
        expect(retryItem.next_attempt_at.getTime()).toBeGreaterThan(
          failedAt.getTime(),
        );
        // The committed deletion intent survives its own retry - clearing it
        // would reopen the key to writers mid-deletion - so the marker, not the
        // message, is what remains on the row.
        expect(retryItem.last_error).toBe("deleting");

        const after = await countRows(tenantDb, purged);
        for (const [table, rows] of Object.entries(after)) {
          expect(rows, `${table} rows survived the purge`).toBe(0);
        }

        const survivors = await countRows(tenantDb, retained);
        expect(survivors).toEqual(before);

        // The sibling's case still points at its own opening message.
        const retainedCase = await tenantDb
          .selectFrom("conversation_cases")
          .select(["id", "opening_message_id"])
          .where("id", "=", retained.caseId)
          .executeTakeFirst();
        expect(retainedCase?.opening_message_id).toBe(retained.messageIds[0]);

        // Workspace-level records are shared with the sibling connection and
        // are never collateral damage of a per-account purge.
        expect(
          await tenantDb
            .selectFrom("tags")
            .select("id")
            .where("id", "=", tagId)
            .executeTakeFirst(),
        ).toBeDefined();
        expect(
          await tenantDb
            .selectFrom("bulk_jobs")
            .select("id")
            .where("id", "=", bulkJobId)
            .executeTakeFirst(),
        ).toBeDefined();
        expect(
          await tenantDb
            .selectFrom("notification_history")
            .select("id")
            .where("id", "=", unrelatedNotificationId)
            .executeTakeFirst(),
        ).toBeDefined();
      });
    },
    60_000,
  );

  integrationTest(
    "serializes an in-flight worker write before archive and removes it during purge",
    async () => {
      await withTenant(async ({ companyId }) => {
        const tenantDb = getTenantConnection(companyId);
        const connectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "racing event",
            status: "connected",
          })
          .execute();

        let eventLocked!: () => void;
        const locked = new Promise<void>((resolve) => {
          eventLocked = resolve;
        });
        let releaseEvent!: () => void;
        const release = new Promise<void>((resolve) => {
          releaseEvent = resolve;
        });
        const statusId = crypto.randomUUID();
        const eventWrite = tenantDb.transaction().execute(async (trx) => {
          expect(await lockActiveConnectionForEvent(trx, connectionId)).toBe(
            true,
          );
          eventLocked();
          await release;
          await trx
            .insertInto("status_updates")
            .values({
              id: statusId,
              whatsapp_connection_id: connectionId,
              timestamp: new Date("2026-03-01T10:00:00Z"),
              expires_at: new Date("2026-03-02T10:00:00Z"),
            })
            .execute();
        });
        await locked;

        const archive = tenantDb.transaction().execute(async (trx) => {
          await trx
            .selectFrom("whatsapp_connections")
            .select("id")
            .where("id", "=", connectionId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          await trx
            .updateTable("whatsapp_connections")
            .set({
              status: "disconnected",
              archived_at: new Date("2026-03-01T11:00:00Z"),
            })
            .where("id", "=", connectionId)
            .execute();
        });

        // Releasing the event lets it commit first; archive's FOR UPDATE then
        // wins the lifecycle transition, and purge sees/removes the event row.
        releaseEvent();
        await Promise.all([eventWrite, archive]);
        expect(
          await tenantDb
            .selectFrom("status_updates")
            .select("id")
            .where("id", "=", statusId)
            .executeTakeFirst(),
        ).toBeDefined();

        await purgeArchivedConnection(tenantDb, connectionId);
        expect(
          await tenantDb
            .selectFrom("status_updates")
            .select("id")
            .where("id", "=", statusId)
            .executeTakeFirst(),
        ).toBeUndefined();
      });
    },
    60_000,
  );

  integrationTest(
    "refuses to purge a connection that is still linked",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const tagId = crypto.randomUUID();
        await tenantDb
          .insertInto("tags")
          .values({ id: tagId, name: "Workspace tag", created_by: ownerId })
          .execute();
        const bulkJobId = crypto.randomUUID();
        await tenantDb
          .insertInto("bulk_jobs")
          .values({
            id: bulkJobId,
            name: "Broadcast",
            content: "hello",
            audience: { tagIds: [], contactIds: [] },
            audience_hash: "hash",
            scheduled_at: new Date("2026-03-01T10:00:00Z"),
            created_by: ownerId,
          })
          .execute();
        const live = await seedConnection(companyId, ownerId, {
          label: "live",
          archived: false,
          tagId,
          bulkJobId,
        });

        const before = await countRows(tenantDb, live);
        await expect(
          purgeArchivedConnection(tenantDb, live.connectionId),
        ).rejects.toBeInstanceOf(ConnectionNotArchivedError);
        expect(await countRows(tenantDb, live)).toEqual(before);

        await expect(
          purgeArchivedConnection(tenantDb, crypto.randomUUID()),
        ).rejects.toBeInstanceOf(ConnectionNotFoundError);
      });
    },
    60_000,
  );
});
