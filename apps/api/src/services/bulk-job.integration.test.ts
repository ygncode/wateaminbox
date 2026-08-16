import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE, toDbDate } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { bulkConfig } from "../config/bulk.config.js";
import {
  getMediaObjectReference,
  resolveMediaKeyForCompany,
  uploadMedia,
} from "../lib/storage.js";
import {
  BulkAudienceDriftError,
  cancelBulkJob,
  createBulkJob,
  finalizeBulkJobIfComplete,
  getBulkJobProgress,
  rescheduleBulkJob,
  resolveBulkAudience,
} from "./bulk-job.service.js";
import { assignContactToUser } from "./contact.service.js";
import { openOrReopenCaseForInboundMessage } from "./conversation-case.service.js";
import {
  dispatchCompanyBulkMessages,
  dispatchCompanyScheduledMessages,
} from "./scheduled-message.service.js";
import type { TenantDatabase } from "./tenant.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

interface SeededLine {
  connectionId: string;
  sessionId: string;
  userId: string;
}

async function seedConnection(
  tenantDb: Kysely<TenantDatabase>,
  options: { status?: "connected" | "disconnected" } = {},
): Promise<SeededLine> {
  const connectionId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: "Bulk line",
      phone_number: `+95977${Math.floor(Math.random() * 1_000_000)}`,
      jid: "959770000001@s.whatsapp.net",
      status: options.status ?? "connected",
    })
    .execute();
  await tenantDb
    .insertInto("whatsapp_connection_sessions")
    .values({
      id: sessionId,
      whatsapp_connection_id: connectionId,
      status: "connected",
    })
    .execute();
  return { connectionId, sessionId, userId: crypto.randomUUID() };
}

let jidCounter = 0;
async function seedContact(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string | null,
  overrides: Partial<{
    jid: string | null;
    customName: string;
    pushName: string;
    isBlocked: boolean;
    isGroup: boolean;
  }> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  jidCounter++;
  await tenantDb
    .insertInto("contacts")
    .values({
      id,
      whatsapp_connection_id: connectionId,
      jid:
        overrides.jid === undefined
          ? `95979${1_000_000 + jidCounter}@s.whatsapp.net`
          : overrides.jid,
      phone_number: `+95979${1_000_000 + jidCounter}`,
      push_name: overrides.pushName ?? `Contact ${jidCounter}`,
      custom_name: overrides.customName ?? null,
      is_blocked: overrides.isBlocked ?? false,
      is_group: overrides.isGroup ?? false,
    })
    .execute();
  return id;
}

async function seedTag(
  tenantDb: Kysely<TenantDatabase>,
  contactIds: string[],
): Promise<string> {
  const tagId = crypto.randomUUID();
  await tenantDb
    .insertInto("tags")
    .values({ id: tagId, name: `tag-${tagId.slice(0, 8)}` })
    .execute();
  if (contactIds.length > 0) {
    await tenantDb
      .insertInto("contact_tags")
      .values(
        contactIds.map((contactId) => ({
          contact_id: contactId,
          tag_id: tagId,
        })),
      )
      .execute();
  }
  return tagId;
}

async function createDueJob(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  audience: { tagIds: string[]; contactIds: string[]; connectionId?: string },
  overrides: Partial<{
    content: string;
    name: string;
    mediaUrl: string;
    mediaMimeType: string;
    mediaFileName: string;
    messageType: "text" | "image" | "video" | "document";
    scheduledAt: Date;
  }> = {},
) {
  const resolved = await resolveBulkAudience(tenantDb, audience);
  return createBulkJob(tenantDb, {
    companyId,
    name: overrides.name ?? "Test broadcast",
    audience,
    content: overrides.content ?? "Hello {{name}}",
    messageType: overrides.messageType ?? "text",
    mediaUrl: overrides.mediaUrl ?? null,
    mediaMimeType: overrides.mediaMimeType ?? null,
    mediaFileName: overrides.mediaFileName ?? null,
    scheduledAt: overrides.scheduledAt ?? new Date(Date.now() - 1_000),
    audienceHash: resolved.audienceHash,
    idempotencyKey: crypto.randomUUID(),
    createdBy: crypto.randomUUID(),
  });
}

/** Let the connection's next bulk send happen immediately. */
async function rewindBudget(
  tenantDb: Kysely<TenantDatabase>,
  connectionId: string,
): Promise<void> {
  await tenantDb
    .updateTable("bulk_connection_budgets")
    .set({ next_eligible_at: new Date(Date.now() - 1_000) })
    .where("whatsapp_connection_id", "=", connectionId)
    .execute();
}

describe("bulk job integration", () => {
  integrationTest(
    "snapshots a deterministic audience with rendered personalization and skip reasons",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);

        const named = await seedContact(tenantDb, line.connectionId, {
          customName: "Aye Chan",
        });
        const tagOnly = await seedContact(tenantDb, line.connectionId, {
          pushName: "Tagged Person",
        });
        const noJid = await seedContact(tenantDb, line.connectionId, {
          jid: null,
        });
        const blocked = await seedContact(tenantDb, line.connectionId, {
          isBlocked: true,
        });
        const orphan = await seedContact(tenantDb, null);
        const tagId = await seedTag(tenantDb, [
          tagOnly,
          noJid,
          blocked,
          orphan,
        ]);

        const { job, created } = await createDueJob(
          tenantDb,
          companyId,
          { tagIds: [tagId], contactIds: [named] },
          { content: "Hi {{firstName}}!" },
        );
        expect(created).toBe(true);
        expect(job.total_recipients).toBe(2);
        expect(job.skipped_recipients).toBe(3);

        const leaves = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("bulk_job_id", "=", job.id)
          .execute();
        expect(leaves).toHaveLength(5);

        const byContact = new Map(
          leaves.map((leaf) => [leaf.contact_id, leaf]),
        );
        expect(byContact.get(named)?.status).toBe("scheduled");
        expect(byContact.get(named)?.content).toBe("Hi Aye!");
        expect(byContact.get(tagOnly)?.content).toBe("Hi Tagged!");
        expect(byContact.get(noJid)?.status).toBe("skipped");
        expect(byContact.get(noJid)?.skip_reason).toBe("no_jid");
        expect(byContact.get(blocked)?.skip_reason).toBe("blocked");
        expect(byContact.get(orphan)?.skip_reason).toBe("no_connection");

        // Re-resolving yields the same hash; a mutated audience does not.
        const again = await resolveBulkAudience(tenantDb, {
          tagIds: [tagId],
          contactIds: [named],
        });
        expect(again.audienceHash).toBe(job.audience_hash);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "rejects creation when the audience drifted since preview",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactId = await seedContact(tenantDb, line.connectionId);

        await expect(
          createBulkJob(tenantDb, {
            companyId,
            name: "Drifted",
            audience: { tagIds: [], contactIds: [contactId] },
            content: "hello",
            messageType: "text",
            mediaUrl: null,
            mediaMimeType: null,
            mediaFileName: null,
            scheduledAt: new Date(Date.now() + 60_000),
            audienceHash: "stale-hash-from-an-old-preview",
            idempotencyKey: crypto.randomUUID(),
            createdBy: crypto.randomUUID(),
          }),
        ).rejects.toBeInstanceOf(BulkAudienceDriftError);

        const jobs = await tenantDb
          .selectFrom("bulk_jobs")
          .selectAll()
          .execute();
        expect(jobs).toHaveLength(0);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "creation is idempotent under retries and concurrent duplicates",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactId = await seedContact(tenantDb, line.connectionId);
        const resolved = await resolveBulkAudience(tenantDb, {
          tagIds: [],
          contactIds: [contactId],
        });
        const idempotencyKey = crypto.randomUUID();
        const params = {
          companyId,
          name: "Retry me",
          audience: { tagIds: [], contactIds: [contactId] },
          content: "hello",
          messageType: "text" as const,
          mediaUrl: null,
          mediaMimeType: null,
          mediaFileName: null,
          scheduledAt: new Date(Date.now() + 60_000),
          audienceHash: resolved.audienceHash,
          idempotencyKey,
          createdBy: crypto.randomUUID(),
        };

        const [first, second] = await Promise.all([
          createBulkJob(tenantDb, params),
          createBulkJob(tenantDb, params),
        ]);
        const retry = await createBulkJob(tenantDb, params);

        expect(first.job.id).toBe(second.job.id);
        expect(retry.job.id).toBe(first.job.id);
        expect(retry.created).toBe(false);
        expect([first.created, second.created].filter(Boolean)).toHaveLength(1);

        const jobs = await tenantDb
          .selectFrom("bulk_jobs")
          .select("id")
          .execute();
        expect(jobs).toHaveLength(1);
        const leaves = await tenantDb
          .selectFrom("scheduled_messages")
          .select("id")
          .execute();
        expect(leaves).toHaveLength(1);

        // The same key with a materially different body must never replay an
        // unrelated job; it is a client bug and conflicts.
        await expect(
          createBulkJob(tenantDb, {
            ...params,
            content: "different body",
          }),
        ).rejects.toThrow(/idempotency key/);
        await expect(
          createBulkJob(tenantDb, {
            ...params,
            scheduledAt: new Date(Date.now() + 3_600_000),
          }),
        ).rejects.toThrow(/idempotency key/);
        // A replay is bound to the original creator: another user reusing
        // the key never adopts someone else's job.
        await expect(
          createBulkJob(tenantDb, {
            ...params,
            createdBy: crypto.randomUUID(),
          }),
        ).rejects.toThrow(/idempotency key/);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "paces one send per connection per cycle across overlapping jobs, race-safely",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactA = await seedContact(tenantDb, line.connectionId);
        const contactB = await seedContact(tenantDb, line.connectionId);
        const contactC = await seedContact(tenantDb, line.connectionId);

        // Two overlapping jobs on the same connection.
        await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactA, contactB],
        });
        await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactC],
        });

        // Concurrent replicas: the budget row lock admits exactly one send.
        const results = await Promise.all([
          dispatchCompanyBulkMessages(companyId),
          dispatchCompanyBulkMessages(companyId),
          dispatchCompanyBulkMessages(companyId),
        ]);
        expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);

        // Within the pacing interval nothing else goes out.
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(0);

        const budget = await tenantDb
          .selectFrom("bulk_connection_budgets")
          .selectAll()
          .where("whatsapp_connection_id", "=", line.connectionId)
          .executeTakeFirstOrThrow();
        expect(budget.sent_today).toBe(1);
        expect(budget.next_eligible_at.getTime()).toBeGreaterThan(Date.now());

        // After the interval elapses, the next single send is admitted.
        await rewindBudget(tenantDb, line.connectionId);
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(1);
        await rewindBudget(tenantDb, line.connectionId);
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(1);

        const messages = await tenantDb
          .selectFrom("messages")
          .select("id")
          .execute();
        expect(messages).toHaveLength(3);
        const finalBudget = await tenantDb
          .selectFrom("bulk_connection_budgets")
          .select("sent_today")
          .where("whatsapp_connection_id", "=", line.connectionId)
          .executeTakeFirstOrThrow();
        expect(finalBudget.sent_today).toBe(3);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "normal scheduled messages keep priority and ignore bulk leaves entirely",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const bulkContact = await seedContact(tenantDb, line.connectionId);
        const normalContact = await seedContact(tenantDb, line.connectionId);

        // Non-bulk dispatch re-validates assignment/lifecycle access (see
        // scheduled-message.service.ts) - give the normal row's contact a
        // resolvable SLA policy and an active case owned by its creator.
        const normalCreatedBy = crypto.randomUUID();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Bulk priority test",
            schema_name: getSchemaName(companyId),
            status: "active",
          })
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
          })
          .execute();
        await assignContactToUser(
          tenantDb,
          normalContact,
          normalCreatedBy,
          normalCreatedBy,
        );
        await tenantDb.transaction().execute(async (trx) => {
          const messageId = crypto.randomUUID();
          await trx
            .insertInto("messages")
            .values({
              id: messageId,
              contact_id: normalContact,
              message_id: crypto.randomUUID(),
              from_me: false,
              message_type: "text",
              content: "hello",
              timestamp: new Date(),
            })
            .execute();
          return openOrReopenCaseForInboundMessage(
            trx,
            companyId,
            { id: normalContact, isGroup: false },
            { id: messageId, timestamp: new Date() },
          );
        });

        await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [bulkContact],
        });
        const normalId = crypto.randomUUID();
        await tenantDb
          .insertInto("scheduled_messages")
          .values({
            id: normalId,
            contact_id: normalContact,
            content: "Normal scheduled",
            message_type: "text",
            scheduled_at: new Date(Date.now() - 1_000),
            status: "scheduled",
            attempts: 0,
            next_attempt_at: new Date(Date.now() - 1_000),
            created_by: normalCreatedBy,
            created_at: toDbDate(),
            updated_at: toDbDate(),
          })
          .execute();

        // The normal dispatcher sends only the normal row and never claims
        // bulk leaves (existing single-message behavior is unchanged).
        const normalDispatched =
          await dispatchCompanyScheduledMessages(companyId);
        expect(normalDispatched).toBe(1);

        const bulkLeaf = await tenantDb
          .selectFrom("scheduled_messages")
          .select(["status", "attempts"])
          .where("contact_id", "=", bulkContact)
          .executeTakeFirstOrThrow();
        expect(bulkLeaf.status).toBe("scheduled");
        expect(bulkLeaf.attempts).toBe(0);

        const normalRow = await tenantDb
          .selectFrom("scheduled_messages")
          .select("status")
          .where("id", "=", normalId)
          .executeTakeFirstOrThrow();
        expect(normalRow.status).toBe("sent");
      } finally {
        await dropTenantSchema(companyId);
        await db
          .deleteFrom("sla_policies")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
      }
    },
    30_000,
  );

  integrationTest(
    "enforces the daily per-connection quota and pauses on disconnect",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactId = await seedContact(tenantDb, line.connectionId);
        await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactId],
        });

        // Exhausted daily quota: nothing is admitted.
        await tenantDb
          .insertInto("bulk_connection_budgets")
          .values({
            whatsapp_connection_id: line.connectionId,
            next_eligible_at: new Date(Date.now() - 1_000),
            quota_date: sql`CURRENT_DATE`,
            sent_today: bulkConfig.dailyCapPerConnection,
          })
          .execute();
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(0);

        // A stale quota row from a previous day rolls over and admits sends.
        await tenantDb
          .updateTable("bulk_connection_budgets")
          .set({
            quota_date: sql`CURRENT_DATE - INTERVAL '1 day'`,
            next_eligible_at: new Date(Date.now() - 1_000),
          })
          .where("whatsapp_connection_id", "=", line.connectionId)
          .execute();

        // Disconnected connections claim nothing and burn no attempts.
        await tenantDb
          .updateTable("whatsapp_connections")
          .set({ status: "disconnected" })
          .where("id", "=", line.connectionId)
          .execute();
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(0);
        const leaf = await tenantDb
          .selectFrom("scheduled_messages")
          .select(["status", "attempts"])
          .where("contact_id", "=", contactId)
          .executeTakeFirstOrThrow();
        expect(leaf.status).toBe("scheduled");
        expect(leaf.attempts).toBe(0);

        // Reconnect: the rolled-over quota admits the send.
        await tenantDb
          .updateTable("whatsapp_connections")
          .set({ status: "connected" })
          .where("id", "=", line.connectionId)
          .execute();
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(1);
        const budget = await tenantDb
          .selectFrom("bulk_connection_budgets")
          .select("sent_today")
          .where("whatsapp_connection_id", "=", line.connectionId)
          .executeTakeFirstOrThrow();
        expect(budget.sent_today).toBe(1);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "reschedules every materialized leaf without changing recipients, content, or media",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const eligible = await seedContact(tenantDb, line.connectionId, {
          customName: "Preserved Recipient",
        });
        const skipped = await seedContact(tenantDb, line.connectionId, {
          isBlocked: true,
        });
        const { job } = await createDueJob(
          tenantDb,
          companyId,
          { tagIds: [], contactIds: [eligible, skipped] },
          {
            content: "Hello {{name}}",
            messageType: "image",
            mediaUrl: "https://media.example.test/preserved.jpg",
            mediaMimeType: "image/jpeg",
            mediaFileName: "preserved.jpg",
          },
        );
        const before = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("bulk_job_id", "=", job.id)
          .orderBy("id")
          .execute();
        const nextTime = new Date(Date.now() + 3_600_000);

        const result = await rescheduleBulkJob(tenantDb, job.id, nextTime);

        expect(result.didReschedule).toBe(true);
        expect(result.updatedLeaves).toBe(2);
        expect(result.previousScheduledAt?.getTime()).toBe(
          job.scheduled_at.getTime(),
        );
        const after = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("bulk_job_id", "=", job.id)
          .orderBy("id")
          .execute();
        expect(after.map((leaf) => leaf.id)).toEqual(
          before.map((leaf) => leaf.id),
        );
        for (let index = 0; index < after.length; index++) {
          expect(after[index].scheduled_at.getTime()).toBe(nextTime.getTime());
          expect(after[index].next_attempt_at.getTime()).toBe(
            nextTime.getTime(),
          );
          expect(after[index].contact_id).toBe(before[index].contact_id);
          expect(after[index].content).toBe(before[index].content);
          expect(after[index].media_url).toBe(before[index].media_url);
          expect(after[index].status).toBe(before[index].status);
        }
        const parent = await tenantDb
          .selectFrom("bulk_jobs")
          .select(["scheduled_at", "content", "media_url", "audience_hash"])
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        expect(parent.scheduled_at.getTime()).toBe(nextTime.getTime());
        expect(parent.content).toBe(job.content);
        expect(parent.media_url).toBe(job.media_url);
        expect(parent.audience_hash).toBe(job.audience_hash);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "rejects in-progress and terminal jobs without partially moving queued leaves",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactA = await seedContact(tenantDb, line.connectionId);
        const contactB = await seedContact(tenantDb, line.connectionId);
        const { job } = await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactA, contactB],
        });
        const originalTime = job.scheduled_at.getTime();
        await tenantDb
          .updateTable("scheduled_messages")
          .set({ status: "processing" })
          .where("contact_id", "=", contactA)
          .execute();

        const inProgress = await rescheduleBulkJob(
          tenantDb,
          job.id,
          new Date(Date.now() + 3_600_000),
        );
        expect(inProgress.didReschedule).toBe(false);
        const unchanged = await tenantDb
          .selectFrom("scheduled_messages")
          .select(["status", "scheduled_at"])
          .where("bulk_job_id", "=", job.id)
          .execute();
        expect(
          unchanged.every(
            (leaf) => leaf.scheduled_at.getTime() === originalTime,
          ),
        ).toBe(true);

        await tenantDb
          .updateTable("bulk_jobs")
          .set({ status: "completed", completed_at: toDbDate() })
          .where("id", "=", job.id)
          .execute();
        const terminal = await rescheduleBulkJob(
          tenantDb,
          job.id,
          new Date(Date.now() + 7_200_000),
        );
        expect(terminal.didReschedule).toBe(false);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "reschedule and dispatcher claim race has exactly one winner",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactId = await seedContact(tenantDb, line.connectionId);
        const { job } = await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactId],
        });
        const nextTime = new Date(Date.now() + 3_600_000);

        const [rescheduled, dispatched] = await Promise.all([
          rescheduleBulkJob(tenantDb, job.id, nextTime),
          dispatchCompanyBulkMessages(companyId),
        ]);

        expect(
          Number(rescheduled.didReschedule) + Number(dispatched === 1),
        ).toBe(1);
        const stored = await tenantDb
          .selectFrom("bulk_jobs")
          .select(["status", "scheduled_at"])
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        if (rescheduled.didReschedule) {
          expect(dispatched).toBe(0);
          expect(stored.status).toBe("scheduled");
          expect(stored.scheduled_at.getTime()).toBe(nextTime.getTime());
        } else {
          expect(dispatched).toBe(1);
          expect(stored.status).toBe("completed");
          expect(stored.scheduled_at.getTime()).toBe(
            job.scheduled_at.getTime(),
          );
        }
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "concurrent cancel and reschedule use parent-first locks with one winner and no partial schedule move",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactA = await seedContact(tenantDb, line.connectionId);
        const contactB = await seedContact(tenantDb, line.connectionId);
        const { job } = await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactA, contactB],
        });
        const nextTime = new Date(Date.now() + 3_600_000);

        // Hold the parent so cancel can queue first. With the old inverse lock
        // order, reschedule then held leaves while waiting behind cancel for
        // this parent, and cancel circular-waited on those leaves.
        let parentLocked!: () => void;
        const parentLockedPromise = new Promise<void>((resolve) => {
          parentLocked = resolve;
        });
        let releaseParent!: () => void;
        const releaseParentPromise = new Promise<void>((resolve) => {
          releaseParent = resolve;
        });
        const blocker = tenantDb.transaction().execute(async (trx) => {
          await trx
            .selectFrom("bulk_jobs")
            .select("id")
            .where("id", "=", job.id)
            .forUpdate()
            .executeTakeFirstOrThrow();
          parentLocked();
          await releaseParentPromise;
        });
        await parentLockedPromise;

        const cancelPromise = cancelBulkJob(
          tenantDb,
          companyId,
          job,
          crypto.randomUUID(),
        );
        // Give cancel's parent UPDATE time to enter the lock wait queue before
        // starting reschedule; both remain concurrently in flight.
        await Bun.sleep(25);
        const reschedulePromise = rescheduleBulkJob(tenantDb, job.id, nextTime);
        await Bun.sleep(25);
        releaseParent();

        const [canceled, rescheduled] = await withTimeout(
          Promise.all([cancelPromise, reschedulePromise]),
          5_000,
        );
        await blocker;

        expect(canceled.didCancel).toBe(true);
        expect(rescheduled.didReschedule).toBe(false);
        expect(
          Number(canceled.didCancel) + Number(rescheduled.didReschedule),
        ).toBe(1);

        const stored = await tenantDb
          .selectFrom("bulk_jobs")
          .select(["status", "scheduled_at"])
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        const leaves = await tenantDb
          .selectFrom("scheduled_messages")
          .select(["status", "scheduled_at", "next_attempt_at"])
          .where("bulk_job_id", "=", job.id)
          .execute();
        expect(stored.status).toBe("canceled");
        expect(stored.scheduled_at.getTime()).toBe(job.scheduled_at.getTime());
        expect(leaves).toHaveLength(2);
        expect(leaves.every((leaf) => leaf.status === "canceled")).toBe(true);
        expect(
          leaves.every(
            (leaf) =>
              leaf.scheduled_at.getTime() === job.scheduled_at.getTime() &&
              leaf.next_attempt_at.getTime() === job.scheduled_at.getTime(),
          ),
        ).toBe(true);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "cancellation stops unsent leaves and rolls up once in-flight work drains",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactA = await seedContact(tenantDb, line.connectionId);
        const contactB = await seedContact(tenantDb, line.connectionId);
        const { job } = await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactA, contactB],
        });

        // Simulate a dispatcher mid-flight on one leaf.
        const processingLease = new Date(Date.now() + 60_000);
        await tenantDb
          .updateTable("scheduled_messages")
          .set({ status: "processing", next_attempt_at: processingLease })
          .where("contact_id", "=", contactA)
          .execute();

        const result = await cancelBulkJob(
          tenantDb,
          companyId,
          job,
          crypto.randomUUID(),
        );
        expect(result.didCancel).toBe(true);
        expect(result.canceledLeaves).toBe(1);
        expect(result.stillProcessing).toBe(1);

        // A second cancel races a job that already left scheduled/running
        // and must lose cleanly instead of re-stamping it.
        const repeat = await cancelBulkJob(
          tenantDb,
          companyId,
          job,
          crypto.randomUUID(),
        );
        expect(repeat.didCancel).toBe(false);

        const jobRow = await tenantDb
          .selectFrom("bulk_jobs")
          .select(["status", "completed_at"])
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        expect(jobRow.status).toBe("canceled");
        expect(jobRow.completed_at).toBeNull();

        // The in-flight leaf finishes under its fence, then rollup completes.
        await tenantDb
          .updateTable("scheduled_messages")
          .set({ status: "sent", sent_at: toDbDate() })
          .where("contact_id", "=", contactA)
          .execute();
        await finalizeBulkJobIfComplete(tenantDb, companyId, job.id);

        const finalJob = await tenantDb
          .selectFrom("bulk_jobs")
          .select(["status", "completed_at"])
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        expect(finalJob.status).toBe("canceled");
        expect(finalJob.completed_at).not.toBeNull();

        // No further bulk sends happen for this job.
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(0);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "concurrent and repeated cancellations: exactly one transition wins",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactId = await seedContact(tenantDb, line.connectionId);
        const { job } = await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactId],
        });

        // Two concurrent cancels: the CAS admits exactly one winner; the
        // loser reports didCancel:false so no second success/audit can occur.
        const [a, b] = await Promise.all([
          cancelBulkJob(tenantDb, companyId, job, crypto.randomUUID()),
          cancelBulkJob(tenantDb, companyId, job, crypto.randomUUID()),
        ]);
        expect([a.didCancel, b.didCancel].filter(Boolean)).toHaveLength(1);
        const winner = a.didCancel ? a : b;
        expect(winner.canceledLeaves).toBe(1);

        const jobRow = await tenantDb
          .selectFrom("bulk_jobs")
          .select(["status", "canceled_at", "completed_at"])
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        expect(jobRow.status).toBe("canceled");
        expect(jobRow.canceled_at).not.toBeNull();
        expect(jobRow.completed_at).not.toBeNull();
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "cancellation racing finalization resolves to exactly one authority",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactId = await seedContact(tenantDb, line.connectionId);
        const { job } = await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [contactId],
        });

        // The only leaf just finished dispatching, so the job is finalizable
        // and cancelable at the same instant.
        await tenantDb
          .updateTable("scheduled_messages")
          .set({ status: "sent", sent_at: toDbDate() })
          .where("bulk_job_id", "=", job.id)
          .execute();

        const [finalized, cancel] = await Promise.all([
          finalizeBulkJobIfComplete(tenantDb, companyId, job.id),
          cancelBulkJob(tenantDb, companyId, job, crypto.randomUUID()),
        ]);

        // Exactly one authority claims the terminal transition, and the
        // stored status agrees with whichever won.
        expect([finalized, cancel.didCancel].filter(Boolean)).toHaveLength(1);
        const jobRow = await tenantDb
          .selectFrom("bulk_jobs")
          .select(["status"])
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        expect(jobRow.status).toBe(finalized ? "completed" : "canceled");
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "dispatch-time skips finalize as completed_with_errors",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const okContact = await seedContact(tenantDb, line.connectionId);
        const doomedContact = await seedContact(tenantDb, line.connectionId);
        const { job } = await createDueJob(tenantDb, companyId, {
          tagIds: [],
          contactIds: [okContact, doomedContact],
        });

        // First paced send succeeds.
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(1);

        // The second recipient is deleted after the snapshot: the dispatch
        // revalidation records a skip, not a failure, and the job completes.
        await tenantDb
          .deleteFrom("contacts")
          .where("id", "=", doomedContact)
          .execute();
        await rewindBudget(tenantDb, line.connectionId);
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(0);

        const progress = await getBulkJobProgress(tenantDb, job.id);
        expect(progress.sent).toBe(1);
        expect(progress.skipped).toBe(1);
        expect(progress.pending + progress.processing).toBe(0);

        // A skipped recipient means not everyone snapshotted got a send, so
        // the terminal state is the honest partial outcome.
        const jobRow = await tenantDb
          .selectFrom("bulk_jobs")
          .select(["status"])
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        expect(jobRow.status).toBe("completed_with_errors");

        const skippedLeaf = await tenantDb
          .selectFrom("scheduled_messages")
          .select(["status", "skip_reason"])
          .where("contact_id", "=", doomedContact)
          .executeTakeFirstOrThrow();
        expect(skippedLeaf.status).toBe("skipped");
        expect(skippedLeaf.skip_reason).toBe("contact_missing");
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "shared media survives per-leaf cancellation and is reclaimed only at job end",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactA = await seedContact(tenantDb, line.connectionId);
        const contactB = await seedContact(tenantDb, line.connectionId);

        const upload = await uploadMedia(
          Buffer.from("bulk-media-test"),
          "image/jpeg",
          companyId,
          "promo.jpg",
        );
        const { job } = await createDueJob(
          tenantDb,
          companyId,
          { tagIds: [], contactIds: [contactA, contactB] },
          {
            messageType: "image",
            mediaUrl: upload.url,
            mediaMimeType: "image/jpeg",
            mediaFileName: "promo.jpg",
            content: "caption",
          },
        );

        // Cancel one leaf via the leaf path: media must survive because the
        // sibling leaf still needs it.
        await tenantDb
          .updateTable("scheduled_messages")
          .set({ status: "canceled", canceled_at: toDbDate() })
          .where("contact_id", "=", contactA)
          .execute();
        await finalizeBulkJobIfComplete(tenantDb, companyId, job.id);
        await expect(
          getMediaObjectReference(upload.url, companyId),
        ).resolves.toBeTruthy();

        // Cancel the whole job with no sent messages: media is reclaimed.
        await cancelBulkJob(tenantDb, companyId, job, crypto.randomUUID());
        await expect(
          getMediaObjectReference(upload.url, companyId),
        ).rejects.toThrow();
        // Sanity: the key resolver still accepts the URL shape.
        expect(resolveMediaKeyForCompany(upload.url, companyId)).toContain(
          `media/${companyId}/`,
        );
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "ineligible connections never occupy the per-cycle limit and starve eligible ones",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        // More connections than the per-cycle candidate limit (20), each
        // with one due recipient. All but one are quota-exhausted; under the
        // old unordered DISTINCT+LIMIT selection they could fill every slot.
        const lines: SeededLine[] = [];
        const contactIds: string[] = [];
        for (let i = 0; i < 21; i++) {
          const line = await seedConnection(tenantDb);
          lines.push(line);
          contactIds.push(await seedContact(tenantDb, line.connectionId));
        }
        await createDueJob(tenantDb, companyId, { tagIds: [], contactIds });

        const eligible = lines[lines.length - 1];
        await tenantDb
          .insertInto("bulk_connection_budgets")
          .values(
            lines
              .filter((line) => line !== eligible)
              .map((line) => ({
                whatsapp_connection_id: line.connectionId,
                next_eligible_at: new Date(Date.now() - 1_000),
                quota_date: sql`CURRENT_DATE`,
                sent_today: bulkConfig.dailyCapPerConnection,
              })),
          )
          .execute();

        // The single eligible connection must send in this very cycle.
        expect(await dispatchCompanyBulkMessages(companyId)).toBe(1);
        const message = await tenantDb
          .selectFrom("messages")
          .select("whatsapp_connection_id")
          .executeTakeFirstOrThrow();
        expect(message.whatsapp_connection_id).toBe(eligible.connectionId);

        // Exhausted connections spent nothing extra.
        const budgets = await tenantDb
          .selectFrom("bulk_connection_budgets")
          .select(["whatsapp_connection_id", "sent_today"])
          .execute();
        for (const budget of budgets) {
          expect(budget.sent_today).toBe(
            budget.whatsapp_connection_id === eligible.connectionId
              ? 1
              : bulkConfig.dailyCapPerConnection,
          );
        }
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );

  integrationTest(
    "shared media is kept after job completion when a sent message references it",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const line = await seedConnection(tenantDb);
        const contactA = await seedContact(tenantDb, line.connectionId);

        const upload = await uploadMedia(
          Buffer.from("bulk-media-kept"),
          "image/jpeg",
          companyId,
          "kept.jpg",
        );
        const { job } = await createDueJob(
          tenantDb,
          companyId,
          { tagIds: [], contactIds: [contactA] },
          {
            messageType: "image",
            mediaUrl: upload.url,
            mediaMimeType: "image/jpeg",
            mediaFileName: "kept.jpg",
            content: "caption",
          },
        );

        expect(await dispatchCompanyBulkMessages(companyId)).toBe(1);

        const jobRow = await tenantDb
          .selectFrom("bulk_jobs")
          .select("status")
          .where("id", "=", job.id)
          .executeTakeFirstOrThrow();
        expect(jobRow.status).toBe("completed");

        // Dispatch copied media_url into the messages row, so cleanup keeps it.
        await expect(
          getMediaObjectReference(upload.url, companyId),
        ).resolves.toBeTruthy();
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );
});
