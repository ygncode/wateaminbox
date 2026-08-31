import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import type { Context } from "hono";
import { sql } from "kysely";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";
import { writeTools } from "./tools/write.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const startConversation = writeTools.find(
  (tool) => tool.name === "start_conversation",
);
if (!startConversation) throw new Error("start_conversation tool not found");

/**
 * The tool handlers read everything through getRouteContext, so a context
 * standing in for the middleware chain is enough to drive one directly.
 */
function fakeContext(values: Record<string, unknown>): Context {
  return {
    get: (key: string) => values[key],
    req: { header: () => undefined },
  } as unknown as Context;
}

async function withWorkspace(
  run: (ctx: {
    companyId: string;
    userId: string;
    connectionId: string;
    tenantDb: ReturnType<typeof getTenantConnection>;
    c: Context;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();

  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email: `start-conv-${userId}@example.com`,
        password_hash: "x",
        name: "Outreach User",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "start_conversation test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: userId, role: "owner" })
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
        created_by: userId,
      })
      .execute();
    await createTenantSchema(companyId);

    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        jid: "15550009999@s.whatsapp.net",
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

    const c = fakeContext({
      tenantDb,
      companyId,
      user: {
        id: userId,
        email: `start-conv-${userId}@example.com`,
        name: "Outreach User",
      },
      companyPermissions: { can_send_messages: true, can_view_all_chats: true },
      companyRole: "owner",
      apiToken: { id: crypto.randomUUID() },
    });

    await run({ companyId, userId, connectionId, tenantDb, c });
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
    await db.deleteFrom("users").where("id", "=", userId).execute();
  }
}

describe("start_conversation", () => {
  integrationTest(
    "opens a case so the first message to a brand-new number is queued",
    () =>
      withWorkspace(async ({ tenantDb, userId, c }) => {
        const result = (await startConversation.handler(
          { phoneNumber: "6589001305", content: "Hi - quick question" },
          c,
        )) as {
          messageId: string;
          contactId: string;
          status: string;
          contactCreated: boolean;
        };

        expect(result.contactCreated).toBe(true);
        expect(result.status).toBe("queued");

        // The regression this test exists for: requireSendAccess rejects a
        // contact with no active case, so without opening one the contact was
        // committed and the message silently never queued.
        const message = await tenantDb
          .selectFrom("messages")
          .select(["id", "content", "status", "from_me", "case_id"])
          .where("contact_id", "=", result.contactId)
          .executeTakeFirstOrThrow();
        expect(message.content).toBe("Hi - quick question");
        expect(message.status).toBe("pending");
        expect(message.from_me).toBe(true);
        expect(message.case_id).not.toBeNull();

        const activeCase = await tenantDb
          .selectFrom("conversation_cases")
          .select(["id", "status", "open_source", "opened_by"])
          .where("contact_id", "=", result.contactId)
          .executeTakeFirstOrThrow();
        expect(activeCase.status).toBe("open");
        expect(activeCase.open_source).toBe("manual");
        expect(activeCase.opened_by).toBe(userId);
        expect(activeCase.id).toBe(message.case_id as string);

        // The send is only real once the worker has a command to act on.
        const outbox = await tenantDb
          .selectFrom("nats_outbox")
          .select(["id"])
          .execute();
        expect(outbox.length).toBeGreaterThan(0);
      }),
  );

  integrationTest("reuses an existing contact without duplicating it", () =>
    withWorkspace(async ({ tenantDb, c }) => {
      const first = (await startConversation.handler(
        { phoneNumber: "6589001305", content: "First" },
        c,
      )) as { contactId: string; contactCreated: boolean };
      const second = (await startConversation.handler(
        { phoneNumber: "+65 8900 1305", content: "Second" },
        c,
      )) as { contactId: string; contactCreated: boolean };

      expect(first.contactCreated).toBe(true);
      expect(second.contactCreated).toBe(false);
      expect(second.contactId).toBe(first.contactId);

      const messages = await tenantDb
        .selectFrom("messages")
        .select(["content"])
        .where("contact_id", "=", first.contactId)
        .orderBy("created_at", "asc")
        .execute();
      expect(messages.map((m) => m.content)).toEqual(["First", "Second"]);

      // The second send joins the case the first one opened.
      const cases = await tenantDb
        .selectFrom("conversation_cases")
        .select(["id"])
        .where("contact_id", "=", first.contactId)
        .execute();
      expect(cases).toHaveLength(1);
    }),
  );

  integrationTest("rejects an unusable phone number and writes nothing", () =>
    withWorkspace(async ({ tenantDb, c }) => {
      const attempt = startConversation.handler(
        { phoneNumber: "not-a-number", content: "Hi" },
        c,
      );
      await expect(attempt).rejects.toThrow();

      const contacts = await tenantDb
        .selectFrom("contacts")
        .select(["id"])
        .execute();
      expect(contacts).toHaveLength(0);
      const messages = await tenantDb
        .selectFrom("messages")
        .select(["id"])
        .execute();
      expect(messages).toHaveLength(0);
    }),
  );
});
