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

/**
 * Each test builds and drops a tenant schema, which costs seconds. Bun's 5s
 * default is close enough to that to fail whichever test happens to land
 * slowest, so give every case explicit headroom.
 */
const TEST_TIMEOUT_MS = 30_000;

const updateContact = writeTools.find((tool) => tool.name === "update_contact");
if (!updateContact) throw new Error("update_contact tool not found");

function fakeContext(values: Record<string, unknown>): Context {
  return {
    get: (key: string) => values[key],
    req: { header: () => undefined },
  } as unknown as Context;
}

async function withContact(
  run: (ctx: {
    contactId: string;
    tenantDb: ReturnType<typeof getTenantConnection>;
    c: Context;
  }) => Promise<void>,
  contactOverrides: Record<string, unknown> = {},
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
        email: `update-contact-${userId}@example.com`,
        password_hash: "x",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "update_contact test",
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
        jid: "15550001111@s.whatsapp.net",
        status: "connected",
      })
      .execute();
    const contact = await tenantDb
      .insertInto("contacts")
      .values({
        whatsapp_connection_id: connectionId,
        jid: "6582858917@s.whatsapp.net",
        phone_number: "6582858917",
        push_name: "WhatsApp Supplied Name",
        custom_name: "Easy Travel &amp; Tours",
        is_group: false,
        ...contactOverrides,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    const c = fakeContext({
      tenantDb,
      companyId,
      user: { id: userId, email: `update-contact-${userId}@example.com` },
      companyPermissions: { can_view_all_chats: true },
      companyRole: "owner",
      apiToken: { id: crypto.randomUUID() },
    });

    await run({ contactId: contact.id, tenantDb, c });
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

describe("update_contact", () => {
  integrationTest(
    "renames a contact",
    () =>
      withContact(async ({ contactId, tenantDb, c }) => {
        const result = (await updateContact.handler(
          { contactId, customName: "Easy Travel & Tours" },
          c,
        )) as { customName: string | null; displayName: string };

        expect(result.customName).toBe("Easy Travel & Tours");
        expect(result.displayName).toBe("Easy Travel & Tours");

        const row = await tenantDb
          .selectFrom("contacts")
          .select(["custom_name", "push_name"])
          .where("id", "=", contactId)
          .executeTakeFirstOrThrow();
        expect(row.custom_name).toBe("Easy Travel & Tours");
        // The WhatsApp-supplied name is left alone; custom_name only overrides it.
        expect(row.push_name).toBe("WhatsApp Supplied Name");
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "clears the custom name with null and falls back",
    () =>
      withContact(async ({ contactId, tenantDb, c }) => {
        const result = (await updateContact.handler(
          { contactId, customName: null },
          c,
        )) as { customName: string | null; displayName: string };

        expect(result.customName).toBeNull();
        // With no custom name the display falls back to what WhatsApp supplied.
        expect(result.displayName).toBe("WhatsApp Supplied Name");

        const row = await tenantDb
          .selectFrom("contacts")
          .select(["custom_name"])
          .where("id", "=", contactId)
          .executeTakeFirstOrThrow();
        expect(row.custom_name).toBeNull();
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "leaves omitted fields untouched",
    () =>
      withContact(async ({ contactId, tenantDb, c }) => {
        await updateContact.handler(
          { contactId, notesShared: "Two WhatsApp numbers published" },
          c,
        );

        const row = await tenantDb
          .selectFrom("contacts")
          .select(["custom_name", "notes_shared"])
          .where("id", "=", contactId)
          .executeTakeFirstOrThrow();
        expect(row.notes_shared).toBe("Two WhatsApp numbers published");
        // customName was not passed, so it must survive unchanged.
        expect(row.custom_name).toBe("Easy Travel &amp; Tours");
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "falls back to the username when there is no push_name",
    () =>
      withContact(
        async ({ contactId, c }) => {
          const result = (await updateContact.handler(
            { contactId, customName: null },
            c,
          )) as { customName: string | null; displayName: string };

          expect(result.customName).toBeNull();
          // custom_name -> push_name -> @username -> phone. With the first two
          // gone the handle is what the app shows, so the tool must report it
          // rather than the raw LID label.
          expect(result.displayName).toBe("@easytravelsg");
        },
        {
          jid: "199999999999999@lid",
          phone_number: null,
          push_name: null,
          username: "easytravelsg",
        },
      ),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "rejects a call that changes nothing",
    () =>
      withContact(async ({ contactId, c }) => {
        const attempt = updateContact.handler({ contactId }, c);
        await expect(attempt).rejects.toThrow(/nothing to update/);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "rejects an unknown contact",
    () =>
      withContact(async ({ c }) => {
        const attempt = updateContact.handler(
          { contactId: crypto.randomUUID(), customName: "Nobody" },
          c,
        );
        await expect(attempt).rejects.toThrow();
      }),
    TEST_TIMEOUT_MS,
  );
});
