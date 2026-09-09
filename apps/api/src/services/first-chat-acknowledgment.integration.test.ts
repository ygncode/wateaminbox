import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { findOrCreateContactByPhone } from "./contact.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function withTenantFixture(
  run: (ctx: {
    companyId: string;
    userId: string;
    tenantDb: ReturnType<typeof getTenantConnection>;
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
        email: `outbound-${userId}@example.com`,
        password_hash: "x",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Outbound contact test",
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

    await run({ companyId, userId, tenantDb: getTenantConnection(companyId) });
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

async function addConnection(
  tenantDb: ReturnType<typeof getTenantConnection>,
  jid: string,
  status: "connected" | "disconnected" = "connected",
): Promise<string> {
  const id = crypto.randomUUID();
  await tenantDb
    .insertInto("whatsapp_connections")
    .values({ id, name: `conn-${id.slice(0, 6)}`, jid, status })
    .execute();
  return id;
}

import {
  acknowledgeFirstChat,
  needsFirstChatAcknowledgment,
  FIRST_CHAT_ACTION,
  FIRST_CHAT_NOTICE_VERSION,
} from "./first-chat-acknowledgment.service.js";
import { firstChatAcknowledgmentSchema } from "../routes/contacts/first-chat-acknowledgment.js";
import { NotFoundError } from "../lib/errors.js";

test("requires an explicit checked box and the displayed notice version", () => {
  expect(
    firstChatAcknowledgmentSchema.safeParse({
      checked: true,
      noticeVersion: FIRST_CHAT_NOTICE_VERSION,
    }).success,
  ).toBe(true);
  for (const checked of [false, undefined, "true", 1]) {
    expect(
      firstChatAcknowledgmentSchema.safeParse({
        checked,
        noticeVersion: FIRST_CHAT_NOTICE_VERSION,
      }).success,
    ).toBe(false);
  }
  expect(
    firstChatAcknowledgmentSchema.safeParse({
      checked: true,
      noticeVersion: "old",
    }).success,
  ).toBe(false);
});

describe("first chat acknowledgment", () => {
  integrationTest(
    "persists one audit record under concurrent requests and isolates tenants",
    () =>
      withTenantFixture(async ({ tenantDb, userId }) => {
        await addConnection(tenantDb, "15550000001@s.whatsapp.net");
        const { contact } = await findOrCreateContactByPhone(tenantDb, {
          phoneNumber: "6589001305",
        });
        expect(await needsFirstChatAcknowledgment(tenantDb, contact.id)).toBe(
          true,
        );
        await Promise.all([
          acknowledgeFirstChat(tenantDb, contact.id, userId, "127.0.0.1"),
          acknowledgeFirstChat(tenantDb, contact.id, userId, "127.0.0.1"),
        ]);
        expect(await needsFirstChatAcknowledgment(tenantDb, contact.id)).toBe(
          false,
        );
        const rows = await tenantDb
          .selectFrom("audit_logs")
          .selectAll()
          .where("action", "=", FIRST_CHAT_ACTION)
          .execute();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.user_id).toBe(userId);
        expect(rows[0]?.entity_id).toBe(contact.id);
        expect(rows[0]?.details).toMatchObject({
          checked: true,
          noticeVersion: FIRST_CHAT_NOTICE_VERSION,
          source: "inbox",
        });
        expect(rows[0]?.created_at).toBeInstanceOf(Date);
        await withTenantFixture(async ({ tenantDb: other }) => {
          await expect(
            needsFirstChatAcknowledgment(other, contact.id),
          ).rejects.toThrow("Contact");
          await expect(
            acknowledgeFirstChat(other, contact.id, userId),
          ).rejects.toThrow("Contact");
        });
      }),
  );

  integrationTest(
    "exempts groups and established conversations without recording acceptance",
    () =>
      withTenantFixture(async ({ tenantDb, userId }) => {
        const connectionId = await addConnection(
          tenantDb,
          "15550000001@s.whatsapp.net",
        );
        const { contact } = await findOrCreateContactByPhone(tenantDb, {
          phoneNumber: "6589001305",
        });
        await tenantDb
          .updateTable("contacts")
          .set({ is_group: true })
          .where("id", "=", contact.id)
          .execute();
        expect(await needsFirstChatAcknowledgment(tenantDb, contact.id)).toBe(
          false,
        );
        await acknowledgeFirstChat(tenantDb, contact.id, userId);
        await tenantDb
          .updateTable("contacts")
          .set({ is_group: false })
          .where("id", "=", contact.id)
          .execute();
        await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            whatsapp_connection_id: connectionId,
            message_id: crypto.randomUUID(),
            from_me: false,
            message_type: "text",
            content: "Hello",
            timestamp: new Date(),
          })
          .execute();
        expect(await needsFirstChatAcknowledgment(tenantDb, contact.id)).toBe(
          false,
        );
        await acknowledgeFirstChat(tenantDb, contact.id, userId);
        expect(
          await tenantDb
            .selectFrom("audit_logs")
            .selectAll()
            .where("action", "=", FIRST_CHAT_ACTION)
            .execute(),
        ).toHaveLength(0);
      }),
  );

  integrationTest("fails closed if the audit insert fails", () =>
    withTenantFixture(async ({ tenantDb }) => {
      await addConnection(tenantDb, "15550000001@s.whatsapp.net");
      const { contact } = await findOrCreateContactByPhone(tenantDb, {
        phoneNumber: "6589001305",
      });
      await expect(
        acknowledgeFirstChat(tenantDb, contact.id, "invalid-uuid"),
      ).rejects.toThrow();
      expect(await needsFirstChatAcknowledgment(tenantDb, contact.id)).toBe(
        true,
      );
    }),
  );

  integrationTest(
    "does not gate a non-WhatsApp conversation behind the WhatsApp notice",
    () =>
      withTenantFixture(async ({ userId, tenantDb }) => {
        const accountId = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: accountId,
            channel: "telegram",
            provider: "telegram_bot",
            display_name: "Support bot",
            status: "connected",
          })
          .execute();
        const conversation = await tenantDb
          .insertInto("conversations")
          .values({
            channel_account_id: accountId,
            client_thread_key: `telegram:${crypto.randomUUID()}`,
            kind: "direct",
            subject: null,
            legacy_contact_id: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        // The notice states WhatsApp policy, so it cannot apply here. Before
        // this, the missing contact row raised and the composer surfaced an
        // error the user had no way to clear, blocking every send.
        expect(
          await needsFirstChatAcknowledgment(tenantDb, conversation.id),
        ).toBe(false);
        // Acknowledging is a no-op rather than a throw, and writes nothing.
        await acknowledgeFirstChat(tenantDb, conversation.id, userId);
        expect(
          await tenantDb
            .selectFrom("audit_logs")
            .select("id")
            .where("action", "=", FIRST_CHAT_ACTION)
            .executeTakeFirst(),
        ).toBeUndefined();

        // An id that names nothing at all is still a 404.
        await expect(
          needsFirstChatAcknowledgment(tenantDb, crypto.randomUUID()),
        ).rejects.toBeInstanceOf(NotFoundError);
      }),
  );
});
