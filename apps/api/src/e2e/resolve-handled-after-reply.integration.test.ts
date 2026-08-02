import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { app } from "../app.js";
import type { MessageEvent } from "../lib/nats/types/events.js";
import { hashPassword } from "../lib/password.js";
import { createCompany } from "../services/company/core.js";
import { handleMessageEvent } from "../services/handlers/message-handlers.js";
import {
  clearTenantConnection,
  getSchemaName,
  getTenantConnection,
} from "../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * Reproduces a production report: resolving with outcome `handled`
 * rejected with "requires a team reply to the latest inbound message" even
 * though the agent had just sent a normal reply. Exercises the REAL
 * production paths end to end - the worker-relayed inbound handler
 * (`handleMessageEvent`, not a manually inserted row) and the real
 * `POST /api/messages` send route (not a direct service call) - so any bug
 * in either path's persistence (case_id/seq/from_me/ordering) surfaces the
 * same way it would in production.
 */
describe("resolving 'handled' after a real inbound + real reply", () => {
  integrationTest(
    "an inbound message answered by a genuine outbound reply through the real send route can be resolved 'handled'",
    async () => {
      const userId = crypto.randomUUID();
      const email = `resolve-handled-${userId}@example.com`;
      const password = "Correct-Horse-123!";
      let companyId: string | undefined;
      try {
        await db
          .insertInto("users")
          .values({
            id: userId,
            email,
            name: "Resolve Handled Agent",
            password_hash: await hashPassword(password),
            email_verified_at: new Date(),
          })
          .execute();
        const company = await createCompany(
          { name: "Resolve Handled Co" },
          userId,
        );
        companyId = company.id;
        const tenantDb = getTenantConnection(companyId);
        const connectionId = crypto.randomUUID();
        const contactJid = "15559876543@s.whatsapp.net";

        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Resolve handled connection",
            jid: "15550000000@s.whatsapp.net",
            status: "connected",
          })
          .execute();
        // getActiveSessionId (used by the real send route to resolve the
        // NATS command subject) requires an active session row, not just a
        // connected connection - see message-happy-path.integration.test.ts.
        await tenantDb
          .insertInto("whatsapp_connection_sessions")
          .values({
            whatsapp_connection_id: connectionId,
            status: "connected",
            started_at: new Date(),
            connected_at: new Date(),
          })
          .execute();

        // A REAL live inbound through the worker-relayed handler - this is
        // what actually opens the case and creates the contact in
        // production, not a manually inserted row.
        const inboundEvent: MessageEvent = {
          contractVersion: 1,
          type: "message",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            messageId: crypto.randomUUID(),
            from: contactJid,
            to: "15550000000@s.whatsapp.net",
            fromMe: false,
            content: "Hi, I have a question",
            messageType: "text",
            timestamp: new Date().toISOString(),
          },
        };
        await handleMessageEvent(inboundEvent);

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", contactJid)
          .executeTakeFirstOrThrow();

        const openCase = await tenantDb
          .selectFrom("conversation_cases")
          .selectAll()
          .where("contact_id", "=", contact.id)
          .where("status", "=", "open")
          .executeTakeFirstOrThrow();

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
          "content-type": "application/json",
        };

        // The agent's real reply, through the real send route (auto-claims
        // the unassigned contact via requireSendAccess, same as production).
        const sendResponse = await app.request("/api/messages", {
          method: "POST",
          headers: tenantHeaders,
          body: JSON.stringify({
            contactId: contact.id,
            content: "Sure, happy to help - what's the question?",
            messageType: "text",
          }),
        });
        expect(sendResponse.status).toBe(200);
        const sent = (await sendResponse.json()) as {
          message: { id: string; status: string };
          autoAssigned: boolean;
        };
        expect(sent.message.status).toBe("pending");

        // The reply must be durably stamped with the SAME case the inbound
        // opened, from the real user, outbound, and sequenced.
        const replyRow = await tenantDb
          .selectFrom("messages")
          .select(["case_id", "from_me", "seq", "sent_by_user_id"])
          .where("id", "=", sent.message.id)
          .executeTakeFirstOrThrow();
        expect(replyRow.case_id).toBe(openCase.id);
        expect(replyRow.from_me).toBe(true);
        expect(replyRow.seq).not.toBeNull();
        expect(replyRow.sent_by_user_id).toBe(userId);

        // The actual bug under investigation: resolving 'handled' must
        // succeed now that the latest turn in the case is a genuine team
        // reply - not reject with the unanswered-turn validation error.
        const resolveResponse = await app.request(
          `/api/conversations/${contact.id}/resolve`,
          {
            method: "POST",
            headers: tenantHeaders,
            body: JSON.stringify({ outcome: "handled" }),
          },
        );
        const resolveBody = await resolveResponse.json();
        expect(resolveResponse.status, JSON.stringify(resolveBody)).toBe(200);
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

  integrationTest(
    "resolving 'handled' is still rejected when the latest turn is genuinely unanswered",
    async () => {
      const userId = crypto.randomUUID();
      const email = `resolve-handled-unanswered-${userId}@example.com`;
      const password = "Correct-Horse-123!";
      let companyId: string | undefined;
      try {
        await db
          .insertInto("users")
          .values({
            id: userId,
            email,
            name: "Resolve Handled Agent",
            password_hash: await hashPassword(password),
            email_verified_at: new Date(),
          })
          .execute();
        const company = await createCompany(
          { name: "Resolve Handled Unanswered Co" },
          userId,
        );
        companyId = company.id;
        const tenantDb = getTenantConnection(companyId);
        const connectionId = crypto.randomUUID();
        const contactJid = "15559876544@s.whatsapp.net";

        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Resolve handled unanswered connection",
            jid: "15550000001@s.whatsapp.net",
            status: "connected",
          })
          .execute();

        await handleMessageEvent({
          contractVersion: 1,
          type: "message",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            messageId: crypto.randomUUID(),
            from: contactJid,
            to: "15550000001@s.whatsapp.net",
            fromMe: false,
            content: "Anyone there?",
            messageType: "text",
            timestamp: new Date().toISOString(),
          },
        });

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", contactJid)
          .executeTakeFirstOrThrow();

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
          "content-type": "application/json",
        };

        // No reply sent at all - the latest turn is still the customer's.
        const resolveResponse = await app.request(
          `/api/conversations/${contact.id}/resolve`,
          {
            method: "POST",
            headers: tenantHeaders,
            body: JSON.stringify({ outcome: "handled" }),
          },
        );
        expect(resolveResponse.status).toBe(400);
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

  integrationTest(
    "a resolve fired concurrently with (not awaited after) the reply's own send request never corrupts state - and a follow-up resolve succeeds once the reply has actually landed",
    async () => {
      // This is the actual root cause behind the production report: the
      // frontend's optimistic send UI (useSendMessage's onMutate) shows the
      // reply bubble in the thread INSTANTLY, well before the real
      // `POST /api/messages` request has round-tripped and its transaction
      // has committed - so an agent can visually "see" their reply, open
      // the Resolve dialog, and confirm 'handled' before the reply is
      // actually durable. `requireSendAccess` and `resolveActiveCase` both
      // lock the SAME contacts row, so this is safely serialized server-
      // side (never a corrupted/duplicate case), but WHICHEVER request's
      // transaction acquires that lock first wins - if resolve wins the
      // race, it correctly (if confusingly, from the agent's perspective)
      // sees no reply yet and 400s. The real fix is UI-level (see
      // ConversationLifecycleActions/ChatPage: Resolve is now disabled
      // while a send for this contact is in flight) - this test only
      // proves the backend's half of the contract: no corruption, and the
      // system is never permanently stuck once the reply actually lands.
      const userId = crypto.randomUUID();
      const email = `resolve-handled-race-${userId}@example.com`;
      const password = "Correct-Horse-123!";
      let companyId: string | undefined;
      try {
        await db
          .insertInto("users")
          .values({
            id: userId,
            email,
            name: "Resolve Handled Race Agent",
            password_hash: await hashPassword(password),
            email_verified_at: new Date(),
          })
          .execute();
        const company = await createCompany(
          { name: "Resolve Handled Race Co" },
          userId,
        );
        companyId = company.id;
        const tenantDb = getTenantConnection(companyId);
        const connectionId = crypto.randomUUID();
        const contactJid = "15559876545@s.whatsapp.net";

        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Resolve handled race connection",
            jid: "15550000002@s.whatsapp.net",
            status: "connected",
          })
          .execute();
        await tenantDb
          .insertInto("whatsapp_connection_sessions")
          .values({
            whatsapp_connection_id: connectionId,
            status: "connected",
            started_at: new Date(),
            connected_at: new Date(),
          })
          .execute();

        await handleMessageEvent({
          contractVersion: 1,
          type: "message",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            messageId: crypto.randomUUID(),
            from: contactJid,
            to: "15550000002@s.whatsapp.net",
            fromMe: false,
            content: "Racing the resolve click",
            messageType: "text",
            timestamp: new Date().toISOString(),
          },
        });

        const contact = await tenantDb
          .selectFrom("contacts")
          .selectAll()
          .where("jid", "=", contactJid)
          .executeTakeFirstOrThrow();

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
          "content-type": "application/json",
        };

        // Fire the resolve FIRST (biasing it to win the contact-row lock
        // race, so this test actually exercises the "resolve raced ahead"
        // branch below deterministically rather than only ever observing
        // send-wins) and the send concurrently, unawaited relative to each
        // other - simulating the client-perceived race (the optimistic UI
        // shows the reply as "already sent", so the agent's resolve click
        // can reach the server before the real in-flight request commits).
        const [resolveResponse, sendResponse] = await Promise.all([
          app.request(`/api/conversations/${contact.id}/resolve`, {
            method: "POST",
            headers: tenantHeaders,
            body: JSON.stringify({ outcome: "handled" }),
          }),
          app.request("/api/messages", {
            method: "POST",
            headers: tenantHeaders,
            body: JSON.stringify({
              contactId: contact.id,
              content: "Sure, here's the answer",
              messageType: "text",
            }),
          }),
        ]);

        expect(sendResponse.status).toBe(200);
        expect([200, 400]).toContain(resolveResponse.status);

        if (resolveResponse.status === 200) {
          // Resolve's lock acquisition happened to land AFTER the send's
          // transaction had already committed - a legitimate, correct
          // success, not corruption.
          const finalCase = await tenantDb
            .selectFrom("conversation_cases")
            .selectAll()
            .where("contact_id", "=", contact.id)
            .orderBy("created_at", "desc")
            .limit(1)
            .executeTakeFirstOrThrow();
          expect(finalCase.status).toBe("resolved");
          expect(finalCase.resolution_outcome).toBe("handled");
        } else {
          // Resolve raced ahead of the (still-committing) send and was
          // correctly, safely rejected - the case must still be open, and
          // the reply itself must still land right after (never lost).
          const activeCase = await tenantDb
            .selectFrom("conversation_cases")
            .selectAll()
            .where("contact_id", "=", contact.id)
            .where("status", "in", ["open", "pending"])
            .executeTakeFirstOrThrow();
          expect(activeCase.resolved_at).toBeNull();

          const sent = (await sendResponse.json()) as {
            message: { id: string };
          };
          const replyRow = await tenantDb
            .selectFrom("messages")
            .select(["case_id", "from_me"])
            .where("id", "=", sent.message.id)
            .executeTakeFirstOrThrow();
          expect(replyRow.case_id).toBe(activeCase.id);
          expect(replyRow.from_me).toBe(true);

          // Self-healing: now that the reply has actually landed, a
          // follow-up resolve (what a properly-gated UI would do once the
          // send settles) must succeed - the system is never stuck.
          const retryResolve = await app.request(
            `/api/conversations/${contact.id}/resolve`,
            {
              method: "POST",
              headers: tenantHeaders,
              body: JSON.stringify({ outcome: "handled" }),
            },
          );
          const retryBody = await retryResolve.json();
          expect(retryResolve.status, JSON.stringify(retryBody)).toBe(200);
        }
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
