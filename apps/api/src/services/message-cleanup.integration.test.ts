import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { cleanupCompanyMessages } from "./message-cleanup.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface Fixture {
  companyId: string;
  connectionId: string;
  sessionId: string;
  contactId: string;
}

async function withTenant(run: (fixture: Fixture) => Promise<void>) {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const connectionId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const contactId = crypto.randomUUID();

  try {
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Concurrent message cleanup test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        phone_number: "15550004444",
        status: "connected",
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
        jid: "15551235555@s.whatsapp.net",
        phone_number: "15551235555",
      })
      .execute();
    await run({ companyId, connectionId, sessionId, contactId });
  } finally {
    await sql`
      DELETE FROM whatsapp_sessions.processed_commands
      WHERE connection_id = ${sessionId}::uuid
    `.execute(db);
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
  }
}

async function insertPending(fixture: Fixture, messageId: string) {
  const id = crypto.randomUUID();
  await getTenantConnection(fixture.companyId)
    .insertInto("messages")
    .values({
      id,
      whatsapp_connection_id: fixture.connectionId,
      contact_id: fixture.contactId,
      message_id: messageId,
      from_me: true,
      message_type: "text",
      content: "stuck",
      status: "pending",
      timestamp: new Date(Date.now() - 60 * 60 * 1000),
    })
    .execute();
  return id;
}

async function insertSuccessfulWorkerOutcome(
  fixture: Fixture,
  pendingMessageId: string,
  whatsappMessageId: string,
  processedConnectionId = fixture.sessionId,
) {
  const commandId = crypto.randomUUID();
  await getTenantConnection(fixture.companyId)
    .insertInto("nats_outbox")
    .values({
      id: commandId,
      subject: `WHATSAPP.commands.${fixture.companyId}.${fixture.sessionId}`,
      payload: {
        type: "text",
        command_id: commandId,
        message_id: pendingMessageId,
      },
      status: "published",
      published_at: new Date(),
    })
    .execute();
  await sql`
    INSERT INTO whatsapp_sessions.processed_commands (
      connection_id, command_id, command_type, result, event_published
    ) VALUES (
      ${processedConnectionId}::uuid,
      ${commandId}::uuid,
      'text',
      ${JSON.stringify({
        pending_message_id: pendingMessageId,
        command_type: "text",
        response: {
          ID: whatsappMessageId,
          Timestamp: new Date().toISOString(),
        },
      })}::jsonb,
      true
    )
  `.execute(db);
}

type BroadcastPayload = { messageIds?: string[] };

describe("message cleanup multi-replica safety", () => {
  integrationTest(
    "concurrent runners transition and broadcast a stale row exactly once",
    async () => {
      await withTenant(async (fixture) => {
        const internalId = await insertPending(fixture, "wa-stale-once");
        const broadcasts: string[][] = [];
        const broadcast: NonNullable<
          Parameters<typeof cleanupCompanyMessages>[3]
        > = async (_companyId, _contactId, _eventType, payload) => {
          broadcasts.push((payload as BroadcastPayload).messageIds ?? []);
        };

        // These are separate queries checked out from the real PostgreSQL pool,
        // not serialized calls through a mocked repository.
        const counts = await Promise.all([
          cleanupCompanyMessages(fixture.companyId, 30, 100, broadcast),
          cleanupCompanyMessages(fixture.companyId, 30, 100, broadcast),
        ]);

        expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
        expect(broadcasts.flat()).toEqual(["wa-stale-once"]);

        const row = await getTenantConnection(fixture.companyId)
          .selectFrom("messages")
          .select(["status", "metadata"])
          .where("id", "=", internalId)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("failed");
        expect(row.metadata?.error).toBe("delivery_timeout");
      });
    },
  );

  integrationTest(
    "uses the worker ledger instead of falsely timing out an accepted send",
    async () => {
      await withTenant(async (fixture) => {
        const pendingMessageId = `pending_${crypto.randomUUID()}`;
        const internalId = await insertPending(fixture, pendingMessageId);
        const commandId = crypto.randomUUID();
        const whatsappMessageId = "3EB0LEDGERCONFIRMED";
        const tenantDb = getTenantConnection(fixture.companyId);

        await tenantDb
          .insertInto("nats_outbox")
          .values({
            id: commandId,
            subject: `WHATSAPP.commands.${fixture.companyId}.${fixture.sessionId}`,
            payload: {
              type: "text",
              command_id: commandId,
              message_id: pendingMessageId,
            },
            status: "published",
            published_at: new Date(),
          })
          .execute();
        const workerResult = {
          pending_message_id: pendingMessageId,
          command_type: "text",
          response: {
            ID: whatsappMessageId,
            Timestamp: new Date().toISOString(),
          },
          correlation_id: "test-correlation",
        };
        await sql`
          INSERT INTO whatsapp_sessions.processed_commands (
            connection_id, command_id, command_type, result, event_published
          ) VALUES (
            ${fixture.sessionId}::uuid,
            ${commandId}::uuid,
            'text',
            ${JSON.stringify(workerResult)}::jsonb,
            true
          )
        `.execute(db);

        const broadcasts: Array<{
          conversationId?: string;
          messageId?: string;
          status?: string;
        }> = [];
        const expired = await cleanupCompanyMessages(
          fixture.companyId,
          30,
          100,
          async (_companyId, _contactId, _eventType, payload) => {
            broadcasts.push(payload as { messageId?: string; status?: string });
          },
        );

        expect(expired).toBe(0);
        expect(broadcasts).toEqual([
          {
            conversationId: fixture.contactId,
            messageId: internalId,
            status: "sent",
          },
        ]);
        const row = await tenantDb
          .selectFrom("messages")
          .select(["message_id", "status", "metadata"])
          .where("id", "=", internalId)
          .executeTakeFirstOrThrow();
        expect(row.message_id).toBe(whatsappMessageId);
        expect(row.status).toBe("sent");
        expect(row.metadata).toBeNull();
      });
    },
  );

  integrationTest(
    "old timeout rows without ledger outcomes do not starve reconciliation",
    async () => {
      await withTenant(async (fixture) => {
        const oldPendingId = `pending_${crypto.randomUUID()}`;
        const oldInternalId = await insertPending(fixture, oldPendingId);
        await getTenantConnection(fixture.companyId)
          .updateTable("messages")
          .set({
            status: "failed",
            timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
            metadata: {
              error: "delivery_timeout",
              error_message: "old timeout",
            },
          })
          .where("id", "=", oldInternalId)
          .execute();

        const ledgerPendingId = `pending_${crypto.randomUUID()}`;
        const ledgerInternalId = await insertPending(fixture, ledgerPendingId);
        await insertSuccessfulWorkerOutcome(
          fixture,
          ledgerPendingId,
          "WA-NOT-STARVED",
        );

        expect(
          await cleanupCompanyMessages(
            fixture.companyId,
            30,
            1,
            async () => {},
          ),
        ).toBe(0);
        const ledgerRow = await getTenantConnection(fixture.companyId)
          .selectFrom("messages")
          .select(["message_id", "status"])
          .where("id", "=", ledgerInternalId)
          .executeTakeFirstOrThrow();
        expect(ledgerRow).toEqual({
          message_id: "WA-NOT-STARVED",
          status: "sent",
        });
      });
    },
  );

  integrationTest(
    "never times out ledger-backed rows beyond the reconciliation batch",
    async () => {
      await withTenant(async (fixture) => {
        const firstPending = `pending_${crypto.randomUUID()}`;
        const secondPending = `pending_${crypto.randomUUID()}`;
        const firstId = await insertPending(fixture, firstPending);
        const secondId = await insertPending(fixture, secondPending);
        await insertSuccessfulWorkerOutcome(fixture, firstPending, "WA-FIRST");
        await insertSuccessfulWorkerOutcome(
          fixture,
          secondPending,
          "WA-SECOND",
        );

        const firstExpired = await cleanupCompanyMessages(
          fixture.companyId,
          30,
          1,
          async () => {},
        );
        expect(firstExpired).toBe(0);

        const afterFirstPass = await getTenantConnection(fixture.companyId)
          .selectFrom("messages")
          .select(["status", "metadata"])
          .where("id", "in", [firstId, secondId])
          .execute();
        expect(afterFirstPass.some((row) => row.status === "failed")).toBe(
          false,
        );

        const secondExpired = await cleanupCompanyMessages(
          fixture.companyId,
          30,
          1,
          async () => {},
        );
        expect(secondExpired).toBe(0);
        const sentCount = await getTenantConnection(fixture.companyId)
          .selectFrom("messages")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .where("message_id", "in", ["WA-FIRST", "WA-SECOND"])
          .where("status", "=", "sent")
          .executeTakeFirstOrThrow();
        expect(Number(sentCount.count)).toBe(2);
      });
    },
  );

  integrationTest(
    "does not trust a processed command from another worker session",
    async () => {
      await withTenant(async (fixture) => {
        const pendingMessageId = `pending_${crypto.randomUUID()}`;
        const internalId = await insertPending(fixture, pendingMessageId);
        const otherSessionId = crypto.randomUUID();
        try {
          await insertSuccessfulWorkerOutcome(
            fixture,
            pendingMessageId,
            "WA-WRONG-SESSION",
            otherSessionId,
          );

          expect(
            await cleanupCompanyMessages(
              fixture.companyId,
              30,
              1,
              async () => {},
            ),
          ).toBe(1);
          const row = await getTenantConnection(fixture.companyId)
            .selectFrom("messages")
            .select(["message_id", "status"])
            .where("id", "=", internalId)
            .executeTakeFirstOrThrow();
          expect(row).toEqual({
            message_id: pendingMessageId,
            status: "failed",
          });
        } finally {
          await sql`
            DELETE FROM whatsapp_sessions.processed_commands
            WHERE connection_id = ${otherSessionId}::uuid
          `.execute(db);
        }
      });
    },
  );

  integrationTest(
    "repairs a timeout when the worker ledger outcome arrives later",
    async () => {
      await withTenant(async (fixture) => {
        const pendingMessageId = `pending_${crypto.randomUUID()}`;
        const internalId = await insertPending(fixture, pendingMessageId);
        expect(
          await cleanupCompanyMessages(
            fixture.companyId,
            30,
            1,
            async () => {},
          ),
        ).toBe(1);

        await insertSuccessfulWorkerOutcome(
          fixture,
          pendingMessageId,
          "WA-LATE-LEDGER",
        );
        expect(
          await cleanupCompanyMessages(
            fixture.companyId,
            30,
            1,
            async () => {},
          ),
        ).toBe(0);

        const row = await getTenantConnection(fixture.companyId)
          .selectFrom("messages")
          .select(["message_id", "status", "metadata"])
          .where("id", "=", internalId)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({
          message_id: "WA-LATE-LEDGER",
          status: "sent",
          metadata: null,
        });
      });
    },
  );

  integrationTest(
    "concurrent runners keep disjoint, strictly bounded batches",
    async () => {
      await withTenant(async (fixture) => {
        await insertPending(fixture, "wa-batch-one");
        await insertPending(fixture, "wa-batch-two");
        await insertPending(fixture, "wa-batch-three");
        const tenantDb = getTenantConnection(fixture.companyId);

        const counts = await Promise.all([
          cleanupCompanyMessages(fixture.companyId, 30, 1, async () => {}),
          cleanupCompanyMessages(fixture.companyId, 30, 1, async () => {}),
        ]);

        expect(counts).toEqual([1, 1]);
        const statuses = await tenantDb
          .selectFrom("messages")
          .select("status")
          .where("message_id", "in", [
            "wa-batch-one",
            "wa-batch-two",
            "wa-batch-three",
          ])
          .execute();
        expect(statuses.filter((row) => row.status === "failed")).toHaveLength(
          2,
        );
        expect(statuses.filter((row) => row.status === "pending")).toHaveLength(
          1,
        );
      });
    },
  );

  integrationTest(
    "a receipt committed while cleanup waits cannot be overwritten by cleanup",
    async () => {
      await withTenant(async (fixture) => {
        const id = await insertPending(fixture, "wa-receipt-race");
        const broadcasts: string[][] = [];
        let cleanupPromise: Promise<number> | undefined;

        await getTenantConnection(fixture.companyId)
          .transaction()
          .execute(async (trx) => {
            await trx
              .selectFrom("messages")
              .select("id")
              .where("id", "=", id)
              .forUpdate()
              .executeTakeFirstOrThrow();

            cleanupPromise = cleanupCompanyMessages(
              fixture.companyId,
              30,
              100,
              async (_companyId, _contactId, _eventType, payload) => {
                broadcasts.push((payload as BroadcastPayload).messageIds ?? []);
              },
            );

            // Give the independently checked-out cleanup query time to reach
            // the row lock, then commit the newer receipt state first.
            await new Promise((resolve) => setTimeout(resolve, 25));
            await trx
              .updateTable("messages")
              .set({ status: "read" })
              .where("id", "=", id)
              .execute();
          });

        expect(await cleanupPromise).toBe(0);
        expect(broadcasts).toEqual([]);
        const row = await getTenantConnection(fixture.companyId)
          .selectFrom("messages")
          .select(["status", "metadata"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
        expect(row.status).toBe("read");
        expect(row.metadata).toBeNull();
      });
    },
  );
});
