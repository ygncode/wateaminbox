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
import type { GroupEvent } from "../lib/nats/index.js";
import {
  finalizeBulkJobIfComplete,
  getBulkJobProgress,
  getBulkJobProgressMap,
} from "./bulk-job.service.js";
import { processConnectionPurgeCleanup } from "./connection-purge-cleanup.service.js";
import { openOrReopenCaseForInboundMessage } from "./conversation-case.service.js";
import { lockActiveConnectionForEvent } from "./handlers/connection-event-guard.js";
import { handleGroupEvent } from "./handlers/group-handlers.js";
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
  // Group administration caches WhatsApp's pending join requests per group;
  // they are connection-owned data and must not survive a purge either.
  await tenantDb
    .insertInto("group_join_requests")
    .values({
      group_id: groupId,
      requester_jid: `${options.label}-requester@s.whatsapp.net`,
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
    groupJoinRequests: await count(
      tenantDb
        .selectFrom("group_join_requests")
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
    "a group event racing archive and purge cannot recreate group rows",
    async () => {
      await withTenant(async ({ companyId }) => {
        const tenantDb = getTenantConnection(companyId);
        const connectionId = crypto.randomUUID();
        const groupJid = "120363000000000771@g.us";
        const laterGroupJid = "120363000000000772@g.us";
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "racing group event",
            status: "connected",
          })
          .execute();
        const groupEvent = (
          action: "snapshot" | "created",
          jid: string,
        ): GroupEvent => ({
          contractVersion: 1,
          type: "group",
          companyId,
          connectionId,
          timestamp: "2026-03-01T10:00:00Z",
          payload: { action, jid, snapshot: { jid, name: "Launch team" } },
        });

        // The group exists while the connection is live, so the purge has real
        // rows to remove and the racing event has a real group to update.
        await handleGroupEvent(groupEvent("snapshot", groupJid));

        let archiveHolding!: () => void;
        const holding = new Promise<void>((resolve) => {
          archiveHolding = resolve;
        });
        let releaseArchive!: () => void;
        const release = new Promise<void>((resolve) => {
          releaseArchive = resolve;
        });
        const archive = tenantDb.transaction().execute(async (trx) => {
          await trx
            .selectFrom("whatsapp_connections")
            .select("id")
            .where("id", "=", connectionId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          archiveHolding();
          await release;
          await trx
            .updateTable("whatsapp_connections")
            .set({
              status: "disconnected",
              archived_at: new Date("2026-03-01T11:00:00Z"),
            })
            .where("id", "=", connectionId)
            .execute();
        });
        await holding;

        // Both events block on the connection fence behind the archive.
        const racing = Promise.all([
          handleGroupEvent(groupEvent("snapshot", groupJid)),
          handleGroupEvent(groupEvent("created", laterGroupJid)),
        ]);
        releaseArchive();
        await Promise.all([archive, racing]);

        await purgeArchivedConnection(tenantDb, connectionId);

        // A late event that reaches the API after the connection row is gone
        // has nothing to fence against - and must still write nothing.
        await handleGroupEvent(groupEvent("created", laterGroupJid));

        const survivingContacts = await tenantDb
          .selectFrom("contacts")
          .select("id")
          .where("whatsapp_connection_id", "=", connectionId)
          .execute();
        expect(survivingContacts).toEqual([]);
        const survivingGroups = await tenantDb
          .selectFrom("groups")
          .select("id")
          .where("jid", "in", [groupJid, laterGroupJid])
          .execute();
        expect(survivingGroups).toEqual([]);
        const survivingParticipants = await tenantDb
          .selectFrom("group_participants")
          .select("id")
          .execute();
        expect(survivingParticipants).toEqual([]);
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

  // Deterministic regression coverage for the cross-snapshot double-count race
  // between the progress readers and the connection purge. The purge commits
  // the scheduled_messages leaf DELETE and the bulk_jobs.purged_* increment in
  // one transaction. A reader that paired the live leaf count (a pre-commit
  // snapshot) with the incremented purged_* (a post-commit snapshot) would
  // double-count the purged recipient. The readers now take both reads from
  // one REPEATABLE READ snapshot, so even a purge forced to commit between the
  // reads cannot inflate the totals. The `betweenReads` test seam places the
  // purge commit exactly there, inside the reader's transaction, removing the
  // timing dependence that makes the race otherwise unreachable by tests.
  integrationTest(
    "progress readers share one snapshot across both reads so a purge that commits between them cannot double-count",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const at = new Date("2026-03-01T10:00:00Z");
        const steady = {
          total: 1,
          pending: 0,
          processing: 0,
          sent: 1,
          failed: 0,
          canceled: 0,
          skipped: 0,
        };

        // Seeds an archived connection with one contact, one bulk job, and one
        // 'sent' leaf. Pre-purge progress is { sent: 1, total: 1 }; after a
        // purge the leaf is gone and purged_sent=1, so steady-state progress is
        // STILL { sent: 1, total: 1 }. The only way to observe sent=2 is to read
        // the live leaf from a pre-commit snapshot AND the purged_sent increment
        // from a post-commit snapshot — exactly the straddle this reader avoids.
        const seedRaceFixture = async (label: string, phone: string) => {
          const connectionId = crypto.randomUUID();
          await tenantDb
            .insertInto("whatsapp_connections")
            .values({
              id: connectionId,
              name: label,
              jid: `${label}@s.whatsapp.net`,
              status: "disconnected",
              archived_at: new Date("2026-02-01T00:00:00Z"),
            })
            .execute();
          const contactId = crypto.randomUUID();
          await tenantDb
            .insertInto("contacts")
            .values({
              id: contactId,
              whatsapp_connection_id: connectionId,
              jid: `${label}-direct@s.whatsapp.net`,
              phone_number: phone,
              push_name: label,
            })
            .execute();
          const bulkJobId = crypto.randomUUID();
          await tenantDb
            .insertInto("bulk_jobs")
            .values({
              id: bulkJobId,
              name: `${label} broadcast`,
              content: "hello",
              audience: { tagIds: [], contactIds: [] },
              audience_hash: "hash",
              scheduled_at: at,
              total_recipients: 1,
              created_by: ownerId,
            })
            .execute();
          await tenantDb
            .insertInto("scheduled_messages")
            .values({
              id: crypto.randomUUID(),
              contact_id: contactId,
              bulk_job_id: bulkJobId,
              content: "broadcast",
              status: "sent",
              scheduled_at: at,
              next_attempt_at: at,
              sent_at: at,
              created_by: ownerId,
            })
            .execute();
          return { connectionId, bulkJobId };
        };

        // --- getBulkJobProgress ---
        {
          const { connectionId, bulkJobId } = await seedRaceFixture(
            "race-single",
            "14150007",
          );
          expect(await getBulkJobProgress(tenantDb, bulkJobId)).toEqual(steady);

          // Force the straddle: the reader takes SELECT 1, then the seam starts
          // the purge and waits for it to commit, then the reader takes SELECT 2
          // from the same REPEATABLE READ snapshot. A buggy two-snapshot reader
          // would return sent = 1 + 1 = 2 here; the shared-snapshot reader sees
          // the pre-purge state for both reads and stays at sent = 1.
          let purgePromise!: ReturnType<typeof purgeArchivedConnection>;
          const progress = await getBulkJobProgress(tenantDb, bulkJobId, {
            betweenReads: async () => {
              purgePromise = purgeArchivedConnection(tenantDb, connectionId);
              await purgePromise;
            },
          });
          const purgeResult = await purgePromise;

          expect(progress).toEqual(steady);
          expect(purgeResult.affectedBulkJobIds).toEqual([bulkJobId]);
          // After the purge settles the retained purged_sent counter keeps the
          // steady-state totals honest.
          expect(await getBulkJobProgress(tenantDb, bulkJobId)).toEqual(steady);
        }

        // --- getBulkJobProgressMap (same race, same fix) ---
        {
          const { connectionId, bulkJobId } = await seedRaceFixture(
            "race-map",
            "14150008",
          );
          expect(await getBulkJobProgressMap(tenantDb, [bulkJobId])).toEqual(
            new Map([[bulkJobId, steady]]),
          );

          let purgePromise!: ReturnType<typeof purgeArchivedConnection>;
          const map = await getBulkJobProgressMap(tenantDb, [bulkJobId], {
            betweenReads: async () => {
              purgePromise = purgeArchivedConnection(tenantDb, connectionId);
              await purgePromise;
            },
          });
          const purgeResult = await purgePromise;

          expect(map.get(bulkJobId)).toEqual(steady);
          expect(purgeResult.affectedBulkJobIds).toEqual([bulkJobId]);
          expect(await getBulkJobProgressMap(tenantDb, [bulkJobId])).toEqual(
            new Map([[bulkJobId, steady]]),
          );
        }
      });
    },
    60_000,
  );

  // The list route (GET /bulk-jobs) reads every job's progress in one
  // getBulkJobProgressMap call. Before this regression it had no direct
  // coverage at all; this pins that the map reflects the retained purged_*
  // counters for a fully purged job without leaking them onto a sibling job
  // that was never touched by the purge.
  integrationTest(
    "getBulkJobProgressMap reflects retained purged counts after a purge and does not leak them to a sibling job",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const at = new Date("2026-03-01T10:00:00Z");

        const purgedConnectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: purgedConnectionId,
            name: "purged",
            jid: "map-purged@s.whatsapp.net",
            status: "disconnected",
            archived_at: new Date("2026-02-01T00:00:00Z"),
          })
          .execute();
        const purgedContactId = crypto.randomUUID();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: purgedContactId,
            whatsapp_connection_id: purgedConnectionId,
            jid: "map-purged-direct@s.whatsapp.net",
            phone_number: "14150011",
            push_name: "purged",
          })
          .execute();

        const liveConnectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: liveConnectionId,
            name: "live",
            jid: "map-live@s.whatsapp.net",
            status: "connected",
            archived_at: null,
          })
          .execute();
        const liveContactId = crypto.randomUUID();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: liveContactId,
            whatsapp_connection_id: liveConnectionId,
            jid: "map-live-direct@s.whatsapp.net",
            phone_number: "14150012",
            push_name: "live",
          })
          .execute();

        const purgedJobId = crypto.randomUUID();
        const liveJobId = crypto.randomUUID();
        for (const job of [
          { id: purgedJobId, name: "Purged broadcast", total: 2 },
          { id: liveJobId, name: "Live broadcast", total: 3 },
        ]) {
          await tenantDb
            .insertInto("bulk_jobs")
            .values({
              id: job.id,
              name: job.name,
              content: "hello",
              audience: { tagIds: [], contactIds: [] },
              audience_hash: "hash",
              scheduled_at: at,
              total_recipients: job.total,
              created_by: ownerId,
            })
            .execute();
        }

        const leaf = (
          jobId: string,
          contactId: string,
        ): Array<{
          id: string;
          contact_id: string;
          bulk_job_id: string;
          content: string;
          status: "sent";
          scheduled_at: Date;
          next_attempt_at: Date;
          sent_at: Date;
          created_by: string;
        }> =>
          Array.from({ length: 2 }, () => ({
            id: crypto.randomUUID(),
            contact_id: contactId,
            bulk_job_id: jobId,
            content: "broadcast",
            status: "sent" as const,
            scheduled_at: at,
            next_attempt_at: at,
            sent_at: at,
            created_by: ownerId,
          }));
        await tenantDb
          .insertInto("scheduled_messages")
          .values(leaf(purgedJobId, purgedContactId))
          .execute();
        await tenantDb
          .insertInto("scheduled_messages")
          .values([
            ...leaf(liveJobId, liveContactId),
            {
              id: crypto.randomUUID(),
              contact_id: liveContactId,
              bulk_job_id: liveJobId,
              content: "broadcast",
              status: "sent",
              scheduled_at: at,
              next_attempt_at: at,
              sent_at: at,
              created_by: ownerId,
            },
          ])
          .execute();

        const purged = {
          total: 2,
          pending: 0,
          processing: 0,
          sent: 2,
          failed: 0,
          canceled: 0,
          skipped: 0,
        };
        const live = {
          total: 3,
          pending: 0,
          processing: 0,
          sent: 3,
          failed: 0,
          canceled: 0,
          skipped: 0,
        };

        expect(
          await getBulkJobProgressMap(tenantDb, [purgedJobId, liveJobId]),
        ).toEqual(
          new Map([
            [purgedJobId, purged],
            [liveJobId, live],
          ]),
        );

        const result = await purgeArchivedConnection(
          tenantDb,
          purgedConnectionId,
        );
        expect(result.affectedBulkJobIds).toEqual([purgedJobId]);

        // The purged job's leaves are gone; its retained purged_sent counter
        // keeps its totals at exactly 2. The sibling live job is untouched —
        // the retained counters must never sum onto the wrong job.
        expect(
          await getBulkJobProgressMap(tenantDb, [purgedJobId, liveJobId]),
        ).toEqual(
          new Map([
            [purgedJobId, purged],
            [liveJobId, live],
          ]),
        );
      });
    },
    60_000,
  );

  // Deterministic regression coverage for the permanent-inflation path the
  // report calls out: finalizeBulkJobIfComplete reads progress through
  // getBulkJobProgress and writes progress.sent/failed/skipped into audit_logs
  // on the single winning finalization CAS (bulk-job.service.ts:838-851). A
  // purge committing between that read's two SELECTs would, on the buggy
  // reader, persist inflated counters into the audit record forever. With the
  // shared-snapshot fix the audit row reflects the self-consistent counts even
  // when the purge commits mid-read.
  integrationTest(
    "finalizeBulkJobIfComplete persists snapshot-consistent counts to audit_logs even when a purge commits during the progress read",
    async () => {
      await withTenant(async ({ companyId, ownerId }) => {
        const tenantDb = getTenantConnection(companyId);
        const at = new Date("2026-03-01T10:00:00Z");

        // Two connections: one archived (purged mid-read), one live (retained).
        // A cross-connection job has two 'sent' leaves, one per contact, so the
        // honest total is sent=2 with no failed/skipped.
        const archivedConnectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: archivedConnectionId,
            name: "archived",
            jid: "finalize-archived@s.whatsapp.net",
            status: "disconnected",
            archived_at: new Date("2026-02-01T00:00:00Z"),
          })
          .execute();
        const archivedContactId = crypto.randomUUID();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: archivedContactId,
            whatsapp_connection_id: archivedConnectionId,
            jid: "finalize-archived-direct@s.whatsapp.net",
            phone_number: "14150031",
            push_name: "archived",
          })
          .execute();
        const liveConnectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: liveConnectionId,
            name: "live",
            jid: "finalize-live@s.whatsapp.net",
            status: "connected",
            archived_at: null,
          })
          .execute();
        const liveContactId = crypto.randomUUID();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: liveContactId,
            whatsapp_connection_id: liveConnectionId,
            jid: "finalize-live-direct@s.whatsapp.net",
            phone_number: "14150032",
            push_name: "live",
          })
          .execute();

        const bulkJobId = crypto.randomUUID();
        await tenantDb
          .insertInto("bulk_jobs")
          .values({
            id: bulkJobId,
            name: "Finalize race broadcast",
            content: "hello",
            audience: { tagIds: [], contactIds: [] },
            audience_hash: "hash",
            scheduled_at: at,
            status: "running",
            total_recipients: 2,
            created_by: ownerId,
          })
          .execute();
        const leaf = (contactId: string) => ({
          id: crypto.randomUUID(),
          contact_id: contactId,
          bulk_job_id: bulkJobId,
          content: "broadcast",
          status: "sent" as const,
          scheduled_at: at,
          next_attempt_at: at,
          sent_at: at,
          created_by: ownerId,
        });
        await tenantDb
          .insertInto("scheduled_messages")
          .values([leaf(archivedContactId), leaf(liveContactId)])
          .execute();

        // Force the straddle inside finalization's progress read: the
        // betweenReads hook commits the purge of the archived connection
        // between the reader's two SELECTs. A buggy two-snapshot reader would
        // double-count the purged 'sent' leaf (live sent=2 + purged_sent=1 = 3)
        // and persist sent=3 into the audit log. The shared-snapshot reader
        // stays at sent=2 (the live retained leaf + the purged leaf via
        // either both-pre or both-post-purge consistency).
        let purgedArchived!: ReturnType<typeof purgeArchivedConnection>;
        const finalized = await finalizeBulkJobIfComplete(
          tenantDb,
          companyId,
          bulkJobId,
          {
            betweenReads: async () => {
              purgedArchived = purgeArchivedConnection(
                tenantDb,
                archivedConnectionId,
              );
              await purgedArchived;
            },
          },
        );
        const purgeResult = await purgedArchived;

        expect(finalized).toBe(true);
        expect(purgeResult.affectedBulkJobIds).toEqual([bulkJobId]);

        const auditRow = await tenantDb
          .selectFrom("audit_logs")
          .select(["action", "entity_id", "details"])
          .where("action", "=", "bulk_job.completed")
          .where("entity_id", "=", bulkJobId)
          .executeTakeFirstOrThrow();

        const details = auditRow.details as Record<string, unknown>;
        // The honest total: 2 sent (one live, one purged-via-purged_sent), no
        // failed/skipped. The buggy reader would have written sent=3 here.
        expect(details.sent).toBe(2);
        expect(details.failed).toBe(0);
        expect(details.skipped).toBe(0);
        expect(details.outcome).toBe("completed");

        // The job itself transitioned to completed exactly once.
        const jobRow = await tenantDb
          .selectFrom("bulk_jobs")
          .select("status")
          .where("id", "=", bulkJobId)
          .executeTakeFirstOrThrow();
        expect(jobRow.status).toBe("completed");
      });
    },
    60_000,
  );
});
