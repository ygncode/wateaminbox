import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { app } from "../app.js";
import type { SendConfirmationEvent } from "../lib/nats/index.js";
import { hashPassword } from "../lib/password.js";
import { createCompany } from "../services/company/core.js";
import { handleSendConfirmationEvent } from "../services/handlers/message-handlers.js";
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
          .select(["message_id", "status"])
          .where("id", "=", sent.message.id)
          .executeTakeFirstOrThrow();
        expect(confirmed).toEqual({
          message_id: "whatsapp-confirmed-id",
          status: "sent",
        });
      } finally {
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
