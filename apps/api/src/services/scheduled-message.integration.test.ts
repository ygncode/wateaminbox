import { describe, expect, test } from "bun:test";
import { toDbDate } from "@wateaminbox/shared";
import type { Kysely } from "kysely";
import { dispatchCompanyScheduledMessages } from "./scheduled-message.service.js";
import type { TenantDatabase } from "./tenant.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
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
  options: { connectionStatus?: "connected" | "disconnected" } = {},
): Promise<SeededConversation> {
  const connectionId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const userId = crypto.randomUUID();

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

  return { connectionId, sessionId, contactId, userId };
}

async function insertScheduled(
  tenantDb: Kysely<TenantDatabase>,
  seeded: SeededConversation,
  overrides: Partial<{
    contactId: string;
    scheduledAt: Date;
    content: string;
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
      message_type: "text",
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
        const seeded = await seedConversation(tenantDb);
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
        const seeded = await seedConversation(tenantDb);
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
          .execute();
        expect(messages).toHaveLength(1);
        const outbox = await tenantDb
          .selectFrom("nats_outbox")
          .select("id")
          .execute();
        expect(outbox).toHaveLength(1);
      } finally {
        await dropTenantSchema(companyId);
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
        const seeded = await seedConversation(tenantDb, {
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
          .execute();
        expect(messages).toHaveLength(0);
      } finally {
        await dropTenantSchema(companyId);
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
        const seeded = await seedConversation(tenantDb);
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
        const seeded = await seedConversation(tenantDb);
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
          .execute();
        expect(messages).toHaveLength(0);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    30_000,
  );
});
