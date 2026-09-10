import { describe, expect, test } from "bun:test";
import type { MessageStatus } from "@wateaminbox/database";
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
    replyToMessageId: string;
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
      reply_to_message_id: overrides.replyToMessageId ?? null,
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

/** Insert a quote-eligible message row owned by the seeded connection. */
async function insertQuoteMessage(
  tenantDb: Kysely<TenantDatabase>,
  seeded: SeededConversation,
  options: {
    fromMe: boolean;
    messageId: string;
    status: MessageStatus;
    senderJid?: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await tenantDb
    .insertInto("messages")
    .values({
      id,
      contact_id: seeded.contactId,
      whatsapp_connection_id: seeded.connectionId,
      message_id: options.messageId,
      from_me: options.fromMe,
      status: options.status,
      sender_jid: options.senderJid ?? null,
      message_type: "text",
      content: "original",
      timestamp: new Date(),
    })
    .execute();
  return id;
}

/** Assert the dispatched send referenced (or omitted) a quote as expected. */
async function assertDispatchedQuote(
  tenantDb: Kysely<TenantDatabase>,
  sentMessageId: string,
  expected: { replyTo: string | null },
): Promise<void> {
  const message = await tenantDb
    .selectFrom("messages")
    .select(["id", "quoted_message_id", "status"])
    .where("id", "=", sentMessageId)
    .executeTakeFirstOrThrow();
  expect(message.status).toBe("pending");
  expect(message.quoted_message_id).toBe(expected.replyTo);

  const outbox = await tenantDb
    .selectFrom("nats_outbox")
    .select("payload")
    .execute();
  expect(outbox).toHaveLength(1);
  const payload = outbox[0].payload as Record<string, unknown>;
  // The send command drops an undefined `reply_to` during JSON serialization,
  // so an unquoted dispatch reads back as `undefined`; coalesce to null so a
  // missing stanza id and an explicit null expectation compare equal.
  expect(payload.reply_to ?? null).toBe(expected.replyTo);
  // A confirmed quote must also carry the quoted sender's JID so the worker
  // can populate ContextInfo.Participant.
  if (expected.replyTo !== null) {
    expect(payload.reply_to_sender).toBeTruthy();
  }
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

describe("scheduled reply quote confirmation at dispatch", () => {
  // A pending/failed outgoing quote's `message_id` is the synthetic
  // `pending_<uuid>` WhatsApp never issued; the dispatcher must drop the
  // quote instead of sending a malformed `ContextInfo.StanzaID`. A confirmed
  // quote (own or incoming) still references the real WhatsApp stanza ID.
  const quoteScenarios = [
    {
      name: "drops a still-pending own-message quote and sends unquoted",
      quote: { fromMe: true, messageId: null, status: "pending" },
      expectedReplyTo: null,
    },
    {
      name: "drops an already-failed own-message quote and sends unquoted",
      quote: { fromMe: true, messageId: null, status: "failed" },
      expectedReplyTo: null,
    },
    {
      name: "keeps a confirmed own-message quote with its real stanza id",
      quote: { fromMe: true, messageId: "confirmed-own-wa-id", status: "sent" },
      expectedReplyTo: "confirmed-own-wa-id",
    },
    {
      name: "keeps an incoming-message quote with its real stanza id",
      quote: {
        fromMe: false,
        messageId: "incoming-wa-id",
        status: "delivered",
      },
      expectedReplyTo: "incoming-wa-id",
    },
  ] as const;

  for (const scenario of quoteScenarios) {
    integrationTest(
      scenario.name,
      async () => {
        const companyId = crypto.randomUUID();
        try {
          await createTenantSchema(companyId);
          const tenantDb = getTenantConnection(companyId);
          const seeded = await seedConversation(tenantDb, companyId);
          const quoteId = await insertQuoteMessage(tenantDb, seeded, {
            fromMe: scenario.quote.fromMe,
            messageId:
              scenario.quote.messageId ?? `pending_${crypto.randomUUID()}`,
            status: scenario.quote.status,
          });
          const scheduledId = await insertScheduled(tenantDb, seeded, {
            replyToMessageId: quoteId,
          });

          expect(await dispatchCompanyScheduledMessages(companyId)).toBe(1);

          const row = await tenantDb
            .selectFrom("scheduled_messages")
            .select(["status", "sent_message_id"])
            .where("id", "=", scheduledId)
            .executeTakeFirstOrThrow();
          expect(row.status).toBe("sent");
          expect(row.sent_message_id).toBeTruthy();

          await assertDispatchedQuote(tenantDb, row.sent_message_id as string, {
            replyTo: scenario.expectedReplyTo,
          });
        } finally {
          await dropTenantSchema(companyId);
          await db
            .deleteFrom("sla_policies")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("companies")
            .where("id", "=", companyId)
            .execute();
        }
      },
      30_000,
    );
  }

  integrationTest(
    "sends unquoted when the quoted message was deleted after scheduling",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const seeded = await seedConversation(tenantDb, companyId);
        const scheduledId = await insertScheduled(tenantDb, seeded, {
          replyToMessageId: crypto.randomUUID(),
        });

        expect(await dispatchCompanyScheduledMessages(companyId)).toBe(1);

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .select(["status", "sent_message_id"])
          .where("id", "=", scheduledId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("sent");
        await assertDispatchedQuote(tenantDb, row.sent_message_id as string, {
          replyTo: null,
        });
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

describe("first-contact auto-reply dispatch regression", () => {
  const scenarios = [
    {
      name: "allows a follow-up in the trigger's second",
      history: "followup",
      mode: "always",
      open: true,
      sends: true,
    },
    {
      name: "rejects older history imported after queueing",
      history: "older",
      mode: "always",
      open: true,
      sends: false,
    },
    {
      name: "rejects same-second history persisted before the trigger",
      history: "prior",
      mode: "always",
      open: true,
      sends: false,
    },
    {
      name: "cancels an after-hours reply when business hours have started",
      history: "none",
      mode: "outside_business_hours",
      open: true,
      sends: false,
    },
    {
      name: "sends an after-hours reply while the office is closed",
      history: "none",
      mode: "outside_business_hours",
      open: false,
      sends: true,
    },
  ] as const;

  for (const scenario of scenarios) {
    integrationTest(
      scenario.name,
      async () => {
        const companyId = crypto.randomUUID();
        try {
          await createTenantSchema(companyId);
          const tenantDb = getTenantConnection(companyId);
          const seeded = await seedConversation(tenantDb, companyId);
          const trigger = await tenantDb
            .selectFrom("messages")
            .select("id")
            .where("contact_id", "=", seeded.contactId)
            .executeTakeFirstOrThrow();
          const timestamp = new Date("2026-03-02T08:59:00Z");
          const createdAt = new Date("2026-03-02T08:59:00.100Z");
          await tenantDb
            .updateTable("messages")
            .set({ timestamp, created_at: createdAt })
            .where("id", "=", trigger.id)
            .execute();
          if (scenario.history !== "none") {
            await tenantDb
              .insertInto("messages")
              .values({
                contact_id: seeded.contactId,
                message_id: crypto.randomUUID(),
                from_me: false,
                message_type: "text",
                content: "Another inbound",
                timestamp:
                  scenario.history === "older"
                    ? new Date(timestamp.getTime() - 1000)
                    : timestamp,
                created_at: new Date(
                  createdAt.getTime() +
                    (scenario.history === "prior" ? -50 : 50),
                ),
              })
              .execute();
          }
          const reply = await tenantDb
            .insertInto("quick_replies")
            .values({
              title: "Welcome",
              shortcut: "welcome",
              content: "Welcome!",
              created_by: seeded.userId,
            })
            .returning("id")
            .executeTakeFirstOrThrow();
          await tenantDb
            .insertInto("auto_reply_settings")
            .values({
              id: 1,
              enabled: true,
              quick_reply_id: reply.id,
              send_mode: scenario.mode,
              delay_minutes: 5,
              updated_by: seeded.userId,
            })
            .execute();
          // The queued rule was evaluated earlier. Dispatch must use the live
          // calendar, regardless of the calendar/time when it was queued.
          await db
            .updateTable("sla_policies")
            .set({
              weekly_schedule: JSON.stringify(
                DEFAULT_SLA_WEEKLY_SCHEDULE.map((day) => ({
                  ...day,
                  open: scenario.open,
                })),
              ),
            })
            .where("company_id", "=", companyId)
            .execute();
          const scheduledId = await insertScheduled(tenantDb, seeded);
          await tenantDb
            .updateTable("scheduled_messages")
            .set({
              auto_reply_trigger_message_id: trigger.id,
              auto_reply_quick_reply_id: reply.id,
            })
            .where("id", "=", scheduledId)
            .execute();

          expect(await dispatchCompanyScheduledMessages(companyId)).toBe(
            scenario.sends ? 1 : 0,
          );
          const result = await tenantDb
            .selectFrom("scheduled_messages")
            .select(["status", "sent_message_id"])
            .where("id", "=", scheduledId)
            .executeTakeFirstOrThrow();
          expect(result.status).toBe(scenario.sends ? "sent" : "canceled");
          expect(Boolean(result.sent_message_id)).toBe(scenario.sends);
          const commands = await tenantDb
            .selectFrom("nats_outbox")
            .select("id")
            .execute();
          expect(commands).toHaveLength(scenario.sends ? 1 : 0);
        } finally {
          await dropTenantSchema(companyId);
          await db
            .deleteFrom("sla_policies")
            .where("company_id", "=", companyId)
            .execute();
          await db
            .deleteFrom("companies")
            .where("id", "=", companyId)
            .execute();
        }
      },
      30_000,
    );
  }
});
