import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { app } from "../app.js";
import type { ReceiptEvent, SendConfirmationEvent } from "../lib/nats/index.js";
import { hashPassword } from "../lib/password.js";
import { createCompany } from "../services/company/core.js";
import {
  handleReceiptEvent,
  handleSendConfirmationEvent,
} from "../services/handlers/message-handlers.js";
import {
  clearTenantConnection,
  getSchemaName,
  getTenantConnection,
} from "../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("login to send confirmation happy path", () => {
  integrationTest(
    "logs in, selects a contact, sends, and reconciles confirmation",
    async () => {
      const userId = crypto.randomUUID();
      const email = `e2e-${userId}@example.com`;
      const password = "Correct-Horse-123!";
      let companyId: string | undefined;
      let sessionId: string | undefined;
      try {
        await db
          .insertInto("users")
          .values({
            id: userId,
            email,
            name: "E2E Agent",
            password_hash: await hashPassword(password),
            email_verified_at: new Date(),
          })
          .execute();
        const company = await createCompany({ name: "E2E Company" }, userId);
        companyId = company.id;
        const tenantDb = getTenantConnection(companyId);
        const connectionId = crypto.randomUUID();
        const contactId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "E2E connection",
            jid: "15550000000@s.whatsapp.net",
            status: "connected",
          })
          .execute();
        // A pending outbound send resolves its NATS command subject via the
        // connection's ACTIVE session (see getActiveSessionId) - a
        // connection alone is not enough; this pre-existing gap left this
        // e2e test unable to reach the send handler at all.
        sessionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connection_sessions")
          .values({
            id: sessionId,
            whatsapp_connection_id: connectionId,
            status: "connected",
            started_at: new Date(),
            connected_at: new Date(),
          })
          .execute();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: contactId,
            whatsapp_connection_id: connectionId,
            jid: "15551111111@s.whatsapp.net",
            phone_number: "15551111111",
            push_name: "E2E Contact",
          })
          .execute();

        const loginResponse = await app.request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        expect(loginResponse.status).toBe(200);
        const login = (await loginResponse.json()) as {
          tokens: { accessToken: string };
        };
        const tenantHeaders = {
          authorization: `Bearer ${login.tokens.accessToken}`,
          "x-company-id": companyId,
        };

        const contactsResponse = await app.request("/api/contacts", {
          headers: tenantHeaders,
        });
        expect(contactsResponse.status).toBe(200);
        expect(JSON.stringify(await contactsResponse.json())).toContain(
          contactId,
        );

        // A brand-new contact has no active case (post-061 baseline is
        // "resolved" until explicitly opened) - sending requires opening
        // the conversation first, same as any resolved conversation. See
        // conversation-case.service.ts's `requireActiveCaseForSend`.
        const openResponse = await app.request(
          `/api/conversations/${contactId}/open`,
          {
            method: "POST",
            headers: { ...tenantHeaders, "content-type": "application/json" },
            body: "{}",
          },
        );
        expect(openResponse.status).toBe(200);

        const sendResponse = await app.request("/api/messages", {
          method: "POST",
          headers: { ...tenantHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            contactId,
            content: "hello end to end",
            messageType: "text",
          }),
        });
        expect(sendResponse.status).toBe(200);
        const sent = (await sendResponse.json()) as {
          message: { id: string; messageId: string; status: string };
        };
        expect(sent.message.status).toBe("pending");

        // Model WhatsApp's fastest ordering: the worker has durably recorded
        // the result, then a delivery receipt reaches a second API replica
        // before send_confirmation replaces the temporary message ID.
        const command = await tenantDb
          .selectFrom("nats_outbox")
          .select("id")
          .where(
            sql<boolean>`payload->>'message_id' = ${sent.message.messageId}`,
          )
          .executeTakeFirstOrThrow();
        await sql`
          INSERT INTO whatsapp_sessions.processed_commands (
            connection_id, command_id, command_type, result, event_published
          ) VALUES (
            ${sessionId}::uuid,
            ${command.id}::uuid,
            'send',
            ${JSON.stringify({
              pending_message_id: sent.message.messageId,
              response: {
                ID: "whatsapp-confirmed-id",
                Timestamp: new Date().toISOString(),
              },
            })}::jsonb,
            false
          )
        `.execute(db);
        await handleReceiptEvent({
          contractVersion: 1,
          type: "receipt",
          companyId,
          connectionId,
          sessionId,
          payload: {
            messageId: "whatsapp-confirmed-id",
            status: "delivered",
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        } satisfies ReceiptEvent);
        const receiptBeforeConfirmation = await tenantDb
          .selectFrom("messages")
          .select(["message_id", "status"])
          .where("id", "=", sent.message.id)
          .executeTakeFirstOrThrow();
        expect(receiptBeforeConfirmation).toEqual({
          message_id: sent.message.messageId,
          status: "delivered",
        });

        // Simulate the cleanup race from production: WhatsApp accepted the
        // send, but its confirmation was delayed behind other events long
        // enough for the API to record a timeout first.
        await tenantDb
          .updateTable("messages")
          .set({
            status: "failed",
            metadata: {
              error: "delivery_timeout",
              error_message: "Message delivery timed out after 5 minutes",
              failed_at: new Date().toISOString(),
              preserved: "message metadata",
            },
          })
          .where("id", "=", sent.message.id)
          .execute();

        await handleSendConfirmationEvent({
          contractVersion: 1,
          type: "send_confirmation",
          companyId,
          connectionId,
          payload: {
            pendingMessageId: sent.message.messageId,
            messageId: "whatsapp-confirmed-id",
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        } satisfies SendConfirmationEvent);

        const confirmed = await tenantDb
          .selectFrom("messages")
          .select(["message_id", "status", "metadata"])
          .where("id", "=", sent.message.id)
          .executeTakeFirstOrThrow();
        expect(confirmed).toEqual({
          message_id: "whatsapp-confirmed-id",
          status: "sent",
          metadata: { preserved: "message metadata" },
        });

        // Receipts are another authoritative late-success path and must repair
        // the same stale timeout metadata without losing unrelated fields.
        await tenantDb
          .updateTable("messages")
          .set({
            status: "failed",
            metadata: {
              error: "delivery_timeout",
              error_message: "Message delivery timed out after 5 minutes",
              failed_at: new Date().toISOString(),
              preserved: "message metadata",
            },
          })
          .where("id", "=", sent.message.id)
          .execute();
        await handleReceiptEvent({
          contractVersion: 1,
          type: "receipt",
          companyId,
          connectionId,
          payload: {
            messageId: "whatsapp-confirmed-id",
            status: "delivered",
            timestamp: new Date().toISOString(),
          },
          timestamp: new Date().toISOString(),
        } satisfies ReceiptEvent);

        const delivered = await tenantDb
          .selectFrom("messages")
          .select(["status", "metadata"])
          .where("id", "=", sent.message.id)
          .executeTakeFirstOrThrow();
        expect(delivered).toEqual({
          status: "delivered",
          metadata: { preserved: "message metadata" },
        });
      } finally {
        if (sessionId) {
          await sql`
            DELETE FROM whatsapp_sessions.processed_commands
            WHERE connection_id = ${sessionId}::uuid
          `.execute(db);
        }
        if (companyId) {
          await clearTenantConnection(companyId);
          await sql
            .raw(`DROP SCHEMA IF EXISTS "${getSchemaName(companyId)}" CASCADE`)
            .execute(db);
          await db
            .deleteFrom("companies")
            .where("id", "=", companyId)
            .execute();
        }
        await db.deleteFrom("users").where("id", "=", userId).execute();
      }
    },
    60_000,
  );
});
