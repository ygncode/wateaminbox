import { seedDefaultSlaPolicy } from "../../services/sla-policy/policy.service.js";
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
import { settingsReadTools, settingsWriteTools } from "./tools/settings.js";
const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const all = [...settingsReadTools, ...settingsWriteTools];
function call(name: string, args: unknown, c: Context) {
  const tool = all.find((tool) => tool.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool.handler(args, c);
}
function fakeContext(values: Record<string, unknown>): Context {
  return {
    get: (key: string) => values[key],
    req: { header: () => undefined },
  } as unknown as Context;
}

async function withWorkspace(
  run: (ctx: {
    tenantDb: ReturnType<typeof getTenantConnection>;
    c: Context;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email: `conn-${userId}@example.com`,
        password_hash: "x",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "list_connections test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: userId, role: "owner" })
      .execute();
    await db
      .transaction()
      .execute((trx) => seedDefaultSlaPolicy(trx, companyId));
    await createTenantSchema(companyId);

    const tenantDb = getTenantConnection(companyId);
    await run({
      tenantDb,
      c: fakeContext({
        tenantDb,
        companyId,
        user: { id: userId, email: `conn-${userId}@example.com` },
        companyPermissions: { can_view_all_chats: true },
        companyRole: "owner",
        apiToken: { id: crypto.randomUUID() },
      }),
    });
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

describe("MCP workspace settings", () => {
  integrationTest(
    "isolates templates and auto-reply configuration between tenants",
    () =>
      withWorkspace(async ({ c }) => {
        await withWorkspace(async ({ c: other }) => {
          const reply = (await call(
            "create_quick_reply",
            {
              shortcut: " Welcome ",
              title: "Hello",
              content: "Welcome aboard",
            },
            c,
          )) as { id: string; shortcut: string };
          expect(reply.shortcut).toBe("welcome");
          const own = (await call("list_quick_replies", {}, c)) as {
            quickReplies: unknown[];
          };
          expect(own.quickReplies).toHaveLength(1);
          const foreign = (await call("list_quick_replies", {}, other)) as {
            quickReplies: unknown[];
          };
          expect(foreign.quickReplies).toHaveLength(0);
          for (const name of [
            "get_quick_reply",
            "update_quick_reply",
            "delete_quick_reply",
          ]) {
            await expect(
              call(
                name,
                { quickReplyId: reply.id, content: "Wrong tenant" },
                other,
              ),
            ).rejects.toThrow("Quick reply not found");
          }
          await expect(
            call(
              "update_auto_reply_settings",
              {
                enabled: true,
                quickReplyId: reply.id,
                delayMinutes: 5,
                sendMode: "always",
              },
              other,
            ),
          ).rejects.toThrow();
          await call(
            "update_auto_reply_settings",
            {
              enabled: true,
              quickReplyId: reply.id,
              delayMinutes: 5,
              sendMode: "outside_business_hours",
            },
            c,
          );
          expect(await call("get_auto_reply_settings", {}, c)).toMatchObject({
            enabled: true,
            quickReplyId: reply.id,
            sendMode: "outside_business_hours",
          });
          await call(
            "update_quick_reply",
            { quickReplyId: reply.id, content: "Updated welcome" },
            c,
          );
          expect(
            await call("get_quick_reply", { quickReplyId: reply.id }, c),
          ).toMatchObject({ content: "Updated welcome" });
          await call("delete_quick_reply", { quickReplyId: reply.id }, c);
          expect(await call("get_auto_reply_settings", {}, c)).toMatchObject({
            enabled: false,
            quickReplyId: null,
          });
        });
      }),
    60000,
  );

  integrationTest(
    "template edits and rule saves preserve automatic-reply side effects",
    () =>
      withWorkspace(async ({ c, tenantDb }) => {
        const reply = (await call(
          "create_quick_reply",
          { shortcut: "hi", title: "Hi", content: "Hello" },
          c,
        )) as { id: string };
        const rule = {
          enabled: true,
          quickReplyId: reply.id,
          delayMinutes: 5,
          sendMode: "always",
        };
        await call("update_auto_reply_settings", rule, c);
        const connection = await tenantDb
          .insertInto("whatsapp_connections")
          .values({ name: "Test" })
          .returning("id")
          .executeTakeFirstOrThrow();
        const contact = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connection.id,
            jid: "15550000000@s.whatsapp.net",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const message = await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            message_id: crypto.randomUUID(),
            from_me: false,
            message_type: "text",
            content: "Hi",
            timestamp: new Date(),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const schedule = await tenantDb
          .insertInto("scheduled_messages")
          .values({
            contact_id: contact.id,
            content: "Hello",
            scheduled_at: new Date(Date.now() + 300000),
            next_attempt_at: new Date(Date.now() + 300000),
            created_by: c.get("user").id,
            auto_reply_trigger_message_id: message.id,
            auto_reply_quick_reply_id: reply.id,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const scheduled = () =>
          tenantDb
            .selectFrom("scheduled_messages")
            .select(["content", "status"])
            .where("id", "=", schedule.id)
            .executeTakeFirstOrThrow();
        await call(
          "update_quick_reply",
          { quickReplyId: reply.id, content: "Welcome" },
          c,
        );
        expect(await scheduled()).toMatchObject({
          content: "Welcome",
          status: "scheduled",
        });
        await call(
          "update_auto_reply_settings",
          { ...rule, enabled: false },
          c,
        );
        expect(await scheduled()).toMatchObject({ status: "canceled" });
      }),
    30000,
  );

  integrationTest(
    "creates immutable SLA versions and checks the live role",
    () =>
      withWorkspace(async ({ c }) => {
        const input = {
          targetMinutes: 15,
          directResolutionTargetMinutes: 240,
          groupResponseTargetMinutes: 30,
          groupResolutionTargetMinutes: 480,
          timezone: "UTC",
          weeklySchedule: DEFAULT_SLA_WEEKLY_SCHEDULE,
          exceptions: [],
        };
        const first = await call("update_sla_policy", input, c);
        await call("update_sla_policy", { ...input, targetMinutes: 20 }, c);
        expect(await call("get_sla_policy", {}, c)).toMatchObject({
          targetMinutes: 20,
        });
        const history = (await call(
          "list_sla_policy_history",
          {},
          c,
        )) as unknown[];
        expect(history).toContainEqual(first);
        expect(history).toHaveLength(3);
        const member = fakeContext({
          companyId: c.get("companyId"),
          user: c.get("user"),
          companyRole: "member",
        });
        await expect(call("update_sla_policy", input, member)).rejects.toThrow(
          "owners and admins",
        );
        expect(await call("list_sla_policy_history", {}, c)).toHaveLength(3);
      }),
    30000,
  );
});
