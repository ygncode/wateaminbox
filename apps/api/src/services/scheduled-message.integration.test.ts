import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE, toDbDate } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import {
  deleteMedia,
  getMediaObjectReference,
  resolveMediaKeyForCompany,
  uploadMedia,
} from "../lib/storage.js";
import { assignContactToUser } from "./contact.service.js";
import {
  openOrReopenCaseForInboundMessage,
  resolveActiveCase,
} from "./conversation-case.service.js";
import {
  cleanupScheduledMediaObject,
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

interface SeededConversation {
  connectionId: string;
  sessionId: string;
  contactId: string;
  userId: string;
}

async function seedConversation(
  tenantDb: Kysely<TenantDatabase>,
  companyId: string,
  options: { connectionStatus?: "connected" | "disconnected" } = {},
): Promise<SeededConversation> {
  const connectionId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  // Dispatch now re-validates assignment/lifecycle access for non-bulk rows
  // (see scheduled-message.service.ts's `sendScheduledMessage`), which
  // needs a resolvable SLA policy (`getCurrentSlaPolicy`) and an active
  // case owned by the scheduling user. `sla_policies` FKs to `companies`,
  // so a row is needed there too even though this file otherwise creates
  // the tenant schema directly, bypassing `createCompany`.
  await db
    .insertInto("companies")
    .values({
      id: companyId,
      name: "Scheduled message test",
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

  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: "Test line",
      phone_number: `+95977${Math.floor(Math.random() * 1_000_000)}`,
      jid: "959770000001@s.whatsapp.net",
      status: options.connectionStatus ?? "connected",
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
  await tenantDb
    .insertInto("contacts")
    .values({
      id: contactId,
      whatsapp_connection_id: connectionId,
      jid: "959791112223@s.whatsapp.net",
      phone_number: "+959791112223",
      push_name: "Scheduled Test Contact",
    })
    .execute();

  await assignContactToUser(tenantDb, contactId, userId, userId);
  await tenantDb.transaction().execute(async (trx) => {
    const messageId = crypto.randomUUID();
    await trx
      .insertInto("messages")
      .values({
        id: messageId,
        contact_id: contactId,
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
      { id: contactId, isGroup: false },
      { id: messageId, timestamp: new Date() },
    );
  });

  return { connectionId, sessionId, contactId, userId };
}

async function insertScheduled(
  tenantDb: Kysely<TenantDatabase>,
  seeded: SeededConversation,
  overrides: Partial<{
    contactId: string;
    scheduledAt: Date;
    content: string;
    messageType: "text" | "image" | "video" | "document";
    mediaUrl: string;
    mediaMimeType: string;
    mediaFileName: string;
  }> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const scheduledAt = overrides.scheduledAt ?? new Date(Date.now() - 1_000);
  await tenantDb
    .insertInto("scheduled_messages")
    .values({
      id,
      contact_id: overrides.contactId ?? seeded.contactId,
      content: overrides.content ?? "Scheduled hello",
      message_type: overrides.messageType ?? "text",
      media_url: overrides.mediaUrl ?? null,
      media_mime_type: overrides.mediaMimeType ?? null,
      media_file_name: overrides.mediaFileName ?? null,
      reply_to_message_id: null,
      scheduled_at: scheduledAt,
      status: "scheduled",
      attempts: 0,
      next_attempt_at: scheduledAt,
      created_by: seeded.userId,
      created_at: toDbDate(),
      updated_at: toDbDate(),
    })
    .execute();
  return id;
}

describe("scheduled message dispatcher integration", () => {
  integrationTest(
    "dispatches a due message atomically through the send pipeline",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);
        const scheduledId = await insertScheduled(tenantDb, seeded);
        // A future message must not be touched.
        const futureId = await insertScheduled(tenantDb, seeded, {
          scheduledAt: new Date(Date.now() + 60 * 60_000),
        });

        const dispatched = await dispatchCompanyScheduledMessages(companyId);
        expect(dispatched).toBe(1);

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("id", "=", scheduledId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("sent");
        expect(row.sent_message_id).toBeTruthy();
        expect(row.attempts).toBe(1);

        const message = await tenantDb
          .selectFrom("messages")
          .selectAll()
          .where("id", "=", row.sent_message_id as string)
          .executeTakeFirstOrThrow();
        expect(message.status).toBe("pending");
        expect(message.content).toBe("Scheduled hello");
        expect(message.from_me).toBe(true);
        expect(message.sent_by_user_id).toBe(seeded.userId);
        expect(message.whatsapp_connection_id).toBe(seeded.connectionId);

        // The worker command was committed to the transactional outbox with
        // the session-scoped subject; the outbox dispatcher takes it from here.
        const outbox = await tenantDb
          .selectFrom("nats_outbox")
          .selectAll()
          .execute();
        expect(outbox).toHaveLength(1);
        expect(outbox[0].subject).toContain(seeded.sessionId);
        expect(outbox[0].status).toBe("pending");

        const future = await tenantDb
          .selectFrom("scheduled_messages")
          .select("status")
          .where("id", "=", futureId)
          .executeTakeFirstOrThrow();
        expect(future.status).toBe("scheduled");
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
    "concurrent dispatchers never double-send the same message",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);
        await insertScheduled(tenantDb, seeded);

        const results = await Promise.all([
          dispatchCompanyScheduledMessages(companyId),
          dispatchCompanyScheduledMessages(companyId),
          dispatchCompanyScheduledMessages(companyId),
        ]);
        expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);

        const messages = await tenantDb
          .selectFrom("messages")
          .select("id")
          .where("from_me", "=", true)
          .execute();
        expect(messages).toHaveLength(1);
        const outbox = await tenantDb
          .selectFrom("nats_outbox")
          .select("id")
          .execute();
        expect(outbox).toHaveLength(1);
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
    "retries with backoff while the connection is inactive, without sending",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId, {
          connectionStatus: "disconnected",
        });
        const scheduledId = await insertScheduled(tenantDb, seeded);

        const dispatched = await dispatchCompanyScheduledMessages(companyId);
        expect(dispatched).toBe(0);

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("id", "=", scheduledId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("scheduled");
        expect(row.attempts).toBe(1);
        expect(row.last_error).toContain("not active");
        expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());

        const messages = await tenantDb
          .selectFrom("messages")
          .select("id")
          .where("from_me", "=", true)
          .execute();
        expect(messages).toHaveLength(0);
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
    "fails permanently when the contact no longer exists",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);
        const scheduledId = await insertScheduled(tenantDb, seeded, {
          contactId: crypto.randomUUID(),
        });

        await dispatchCompanyScheduledMessages(companyId);

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("id", "=", scheduledId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("failed");
        expect(row.last_error).toContain("Contact");
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
    "leaves canceled messages untouched",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);
        const scheduledId = await insertScheduled(tenantDb, seeded);
        await tenantDb
          .updateTable("scheduled_messages")
          .set({
            status: "canceled",
            canceled_by: seeded.userId,
            canceled_at: toDbDate(),
          })
          .where("id", "=", scheduledId)
          .execute();

        const dispatched = await dispatchCompanyScheduledMessages(companyId);
        expect(dispatched).toBe(0);

        const messages = await tenantDb
          .selectFrom("messages")
          .select("id")
          .where("from_me", "=", true)
          .execute();
        expect(messages).toHaveLength(0);
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
    "dispatches a scheduled image through the media send pipeline",
    async () => {
      const companyId = crypto.randomUUID();
      let mediaKey: string | null = null;
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);

        // A real object in the media bucket, exactly like POST /media/upload.
        const upload = await uploadMedia(
          Buffer.from("fake-png-bytes"),
          "image/png",
          companyId,
          "team-photo.png",
        );
        mediaKey = upload.key;

        const scheduledId = await insertScheduled(tenantDb, seeded, {
          content: "Here is the photo",
          messageType: "image",
          mediaUrl: upload.url,
          mediaMimeType: "image/png",
          mediaFileName: "team-photo.png",
        });

        const dispatched = await dispatchCompanyScheduledMessages(companyId);
        expect(dispatched).toBe(1);

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("id", "=", scheduledId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("sent");

        const message = await tenantDb
          .selectFrom("messages")
          .selectAll()
          .where("id", "=", row.sent_message_id as string)
          .executeTakeFirstOrThrow();
        expect(message.message_type).toBe("image");
        expect(message.media_url).toBe(upload.url);
        expect(message.media_mime_type).toBe("image/png");

        // The worker command must carry the durable object reference and the
        // caption (content moves into caption for media sends).
        const outbox = await tenantDb
          .selectFrom("nats_outbox")
          .selectAll()
          .executeTakeFirstOrThrow();
        const payload = outbox.payload as Record<string, unknown>;
        expect(payload.type).toBe("image");
        expect(payload.media_object_key).toBe(upload.key);
        expect(payload.caption).toBe("Here is the photo");
        expect(payload.content).toBe("");
        expect(payload.file_name).toBe("team-photo.png");
        expect(payload.mime_type).toBe("image/png");

        // The dispatched message references the object; cleanup must keep it.
        await cleanupScheduledMediaObject(
          tenantDb,
          companyId,
          scheduledId,
          row.media_url,
        );
        await expect(
          getMediaObjectReference(upload.url, companyId),
        ).resolves.toMatchObject({ key: upload.key });
      } finally {
        if (mediaKey) await deleteMedia(mediaKey).catch(() => {});
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
    "fails permanently when the media object no longer exists",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);

        const upload = await uploadMedia(
          Buffer.from("ephemeral"),
          "image/png",
          companyId,
          "gone.png",
        );
        await deleteMedia(upload.key);

        const scheduledId = await insertScheduled(tenantDb, seeded, {
          messageType: "image",
          mediaUrl: upload.url,
          mediaMimeType: "image/png",
          mediaFileName: "gone.png",
        });

        await dispatchCompanyScheduledMessages(companyId);

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("id", "=", scheduledId)
          .executeTakeFirstOrThrow();
        // Permanent: failed on the first attempt instead of retrying.
        expect(row.status).toBe("failed");
        expect(row.attempts).toBe(1);
        expect(row.last_error).toContain("no longer exists");

        const messages = await tenantDb
          .selectFrom("messages")
          .select("id")
          .where("from_me", "=", true)
          .execute();
        expect(messages).toHaveLength(0);
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
    "cleanupScheduledMediaObject removes unreferenced objects",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        const upload = await uploadMedia(
          Buffer.from("to-be-discarded"),
          "video/mp4",
          companyId,
          "clip.mp4",
        );
        expect(resolveMediaKeyForCompany(upload.url, companyId)).toBe(
          upload.key,
        );

        await cleanupScheduledMediaObject(
          tenantDb,
          companyId,
          crypto.randomUUID(),
          upload.url,
        );

        await expect(
          getMediaObjectReference(upload.url, companyId),
        ).rejects.toThrow();
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
    "a takeover between scheduling and dispatch fails the old assignee's queued message safely, never sending it",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);
        const scheduledId = await insertScheduled(tenantDb, seeded);

        // Someone else takes over before dispatch runs.
        const newAssignee = crypto.randomUUID();
        await assignContactToUser(
          tenantDb,
          seeded.contactId,
          newAssignee,
          newAssignee,
        );

        const dispatched = await dispatchCompanyScheduledMessages(companyId);
        expect(dispatched).toBe(0);

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("id", "=", scheduledId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("failed");
        expect(row.last_error).toContain("assigned to another team member");

        const sent = await tenantDb
          .selectFrom("messages")
          .select("id")
          .where("from_me", "=", true)
          .execute();
        expect(sent).toHaveLength(0);
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
    "a resolve between scheduling and dispatch fails the queued message safely, never sending it or reopening the conversation",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);
        const scheduledId = await insertScheduled(tenantDb, seeded);

        await resolveActiveCase(tenantDb, seeded.contactId, {
          outcome: "no_reply_needed",
          resolvedBy: seeded.userId,
        });

        const dispatched = await dispatchCompanyScheduledMessages(companyId);
        expect(dispatched).toBe(0);

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .selectAll()
          .where("id", "=", scheduledId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("failed");
        expect(row.last_error).toContain("resolved");

        const sent = await tenantDb
          .selectFrom("messages")
          .select("id")
          .where("from_me", "=", true)
          .execute();
        expect(sent).toHaveLength(0);

        // The failed dispatch attempt must never itself reopen the
        // conversation as a side effect.
        const projection = await tenantDb
          .selectFrom("conversation_states")
          .select(["status", "active_case_id"])
          .where("contact_id", "=", seeded.contactId)
          .executeTakeFirstOrThrow();
        expect(projection.status).toBe("resolved");
        expect(projection.active_case_id).toBeNull();
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
});
