import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import {
  findOrCreateContactByPhone,
  OutboundContactError,
} from "./contact.service.js";
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

    await run({ companyId, tenantDb: getTenantConnection(companyId) });
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

describe("findOrCreateContactByPhone", () => {
  integrationTest("creates a contact on the only connected account", () =>
    withTenantFixture(async ({ tenantDb }) => {
      const connectionId = await addConnection(
        tenantDb,
        "15550000001@s.whatsapp.net",
      );

      const result = await findOrCreateContactByPhone(tenantDb, {
        phoneNumber: "+65 8900 1305",
        customName: "Senyum Travel",
      });

      expect(result.created).toBe(true);
      expect(result.connectionId).toBe(connectionId);
      // The + and the spaces are stripped, and the jid is derived from the
      // cleaned digits.
      expect(result.contact.phone_number).toBe("6589001305");
      expect(result.contact.jid).toBe("6589001305@s.whatsapp.net");
      expect(result.contact.custom_name).toBe("Senyum Travel");
      expect(result.contact.is_group).toBe(false);
    }),
  );

  integrationTest("reuses an existing contact instead of duplicating", () =>
    withTenantFixture(async ({ tenantDb }) => {
      await addConnection(tenantDb, "15550000002@s.whatsapp.net");

      const first = await findOrCreateContactByPhone(tenantDb, {
        phoneNumber: "6589001305",
      });
      // A differently formatted spelling of the same number must land on the
      // same contact rather than creating a second one.
      const second = await findOrCreateContactByPhone(tenantDb, {
        phoneNumber: "006589001305",
        customName: "ignored on reuse",
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.contact.id).toBe(first.contact.id);

      const rows = await tenantDb
        .selectFrom("contacts")
        .select("id")
        .where("phone_number", "=", "6589001305")
        .execute();
      expect(rows).toHaveLength(1);
    }),
  );

  integrationTest("rejects a phone number that cannot be normalised", () =>
    withTenantFixture(async ({ tenantDb }) => {
      await addConnection(tenantDb, "15550000003@s.whatsapp.net");

      const attempt = findOrCreateContactByPhone(tenantDb, {
        phoneNumber: "not-a-number",
      });

      await expect(attempt).rejects.toThrow(OutboundContactError);
      // No junk contact is left behind by a rejected number.
      const rows = await tenantDb.selectFrom("contacts").select("id").execute();
      expect(rows).toHaveLength(0);
    }),
  );

  integrationTest("refuses when no account is connected", () =>
    withTenantFixture(async ({ tenantDb }) => {
      await addConnection(
        tenantDb,
        "15550000004@s.whatsapp.net",
        "disconnected",
      );

      const attempt = findOrCreateContactByPhone(tenantDb, {
        phoneNumber: "6589001305",
      });

      await expect(attempt).rejects.toThrow(/No matching active/);
    }),
  );

  integrationTest(
    "requires connectionId when several accounts are connected",
    () =>
      withTenantFixture(async ({ tenantDb }) => {
        const first = await addConnection(
          tenantDb,
          "15550000005@s.whatsapp.net",
        );
        await addConnection(tenantDb, "15550000006@s.whatsapp.net");

        const ambiguous = findOrCreateContactByPhone(tenantDb, {
          phoneNumber: "6589001305",
        });
        await expect(ambiguous).rejects.toThrow(/connectionId is required/);

        // Naming the account resolves the ambiguity.
        const resolved = await findOrCreateContactByPhone(tenantDb, {
          phoneNumber: "6589001305",
          connectionId: first,
        });
        expect(resolved.created).toBe(true);
        expect(resolved.connectionId).toBe(first);
      }),
  );

  integrationTest("scopes contacts per connection", () =>
    withTenantFixture(async ({ tenantDb }) => {
      const first = await addConnection(tenantDb, "15550000007@s.whatsapp.net");
      const second = await addConnection(
        tenantDb,
        "15550000008@s.whatsapp.net",
      );

      const a = await findOrCreateContactByPhone(tenantDb, {
        phoneNumber: "6589001305",
        connectionId: first,
      });
      // The same number reached through a different account is a separate
      // conversation, so it gets its own contact row.
      const b = await findOrCreateContactByPhone(tenantDb, {
        phoneNumber: "6589001305",
        connectionId: second,
      });

      expect(a.created).toBe(true);
      expect(b.created).toBe(true);
      expect(a.contact.id).not.toBe(b.contact.id);
    }),
  );
});
