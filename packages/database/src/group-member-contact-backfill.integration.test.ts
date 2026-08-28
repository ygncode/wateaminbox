import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { backfillGroupMemberContacts } from "./migrations/079_backfill_group_member_contacts.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * The point of this migration is that membership ALREADY stored is repaired.
 * Every fixture below writes `group_participants` directly and never runs a
 * WhatsApp snapshot, so a pass proves an existing workspace is fixed by the
 * upgrade alone - no reconnect, no per-group "Refresh from WhatsApp".
 */

type Database = ReturnType<typeof createDatabase>;

async function createFixtureSchema(database: Database): Promise<string> {
  const schema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;
  await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
  await sql
    .raw(`CREATE TABLE "${schema}".whatsapp_connections (
      id UUID PRIMARY KEY,
      jid TEXT,
      phone_number TEXT
    )`)
    .execute(database);
  await sql
    .raw(`CREATE TABLE "${schema}".contacts (
      id UUID PRIMARY KEY,
      whatsapp_connection_id UUID,
      jid TEXT,
      phone_number TEXT,
      push_name TEXT,
      is_group BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    .execute(database);
  // The same partial unique index production carries, so the migration's
  // ON CONFLICT has something real to conflict against.
  await sql
    .raw(`CREATE UNIQUE INDEX "${schema}_ct_conn_jid_uidx"
      ON "${schema}".contacts (whatsapp_connection_id, jid)
      WHERE whatsapp_connection_id IS NOT NULL AND jid IS NOT NULL`)
    .execute(database);
  await sql
    .raw(`CREATE TABLE "${schema}".groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contact_id UUID NOT NULL,
      jid TEXT NOT NULL
    )`)
    .execute(database);
  await sql
    .raw(`CREATE TABLE "${schema}".group_participants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL,
      participant_jid TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false
    )`)
    .execute(database);
  await sql
    .raw(`CREATE TABLE "${schema}".conversation_states (
      contact_id UUID PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'open'
    )`)
    .execute(database);
  return schema;
}

async function memberContacts(
  database: Database,
  schema: string,
): Promise<Array<{ jid: string; connection: string; phone: string | null }>> {
  const result = await sql<{
    jid: string;
    whatsapp_connection_id: string;
    phone_number: string | null;
  }>`
    SELECT jid, whatsapp_connection_id, phone_number
    FROM ${sql.raw(`"${schema}".contacts`)}
    WHERE is_group = false
    ORDER BY jid
  `.execute(database);
  return result.rows.map((row) => ({
    jid: row.jid,
    connection: row.whatsapp_connection_id,
    phone: row.phone_number,
  }));
}

/** Seed one connection owning one group with the given stored members. */
async function seedGroup(
  database: Database,
  schema: string,
  options: {
    connectionId: string;
    connectionJid: string | null;
    connectionPhone?: string | null;
    groupJid: string;
    participantJids: string[];
  },
): Promise<void> {
  const groupContactId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  await sql
    .raw(`INSERT INTO "${schema}".whatsapp_connections
      (id, jid, phone_number) VALUES
      ('${options.connectionId}', ${
        options.connectionJid ? `'${options.connectionJid}'` : "NULL"
      }, ${options.connectionPhone ? `'${options.connectionPhone}'` : "NULL"})`)
    .execute(database);
  await sql
    .raw(`INSERT INTO "${schema}".contacts (id, whatsapp_connection_id, jid, is_group) VALUES
      ('${groupContactId}', '${options.connectionId}', '${options.groupJid}', true)`)
    .execute(database);
  await sql
    .raw(`INSERT INTO "${schema}".groups (id, contact_id, jid) VALUES
      ('${groupId}', '${groupContactId}', '${options.groupJid}')`)
    .execute(database);
  for (const participantJid of options.participantJids) {
    await sql
      .raw(`INSERT INTO "${schema}".group_participants (group_id, participant_jid)
        VALUES ('${groupId}', '${participantJid}')`)
      .execute(database);
  }
}

describe("migration 079 group member contact backfill", () => {
  integrationTest(
    "repairs membership already stored, without a fresh WhatsApp snapshot",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      try {
        schema = await createFixtureSchema(database);
        const connectionId = crypto.randomUUID();
        const existingContactId = crypto.randomUUID();

        await seedGroup(database, schema, {
          connectionId,
          connectionJid: "6580000000@s.whatsapp.net",
          groupJid: "120363000000000001@g.us",
          participantJids: [
            // Already reachable: the one member who also DMs this account.
            "6593333333@s.whatsapp.net",
            // Stored members who had no contact at all - the bug.
            "6591111111@s.whatsapp.net",
            "6592222222:12@s.whatsapp.net",
            // Opaque identity: no stable key, must not be invented.
            "182736450912345@lid",
            // The connected account itself.
            "6580000000@s.whatsapp.net",
          ],
        });
        await sql
          .raw(`INSERT INTO "${schema}".contacts
            (id, whatsapp_connection_id, jid, phone_number, push_name)
            VALUES ('${existingContactId}', '${connectionId}',
                    '6593333333@s.whatsapp.net', '6593333333', 'Existing Name')`)
          .execute(database);

        const inserted = await backfillGroupMemberContacts(
          database as unknown as Kysely<unknown>,
          schema,
        );
        expect(inserted).toBe(2n);

        expect(await memberContacts(database, schema)).toEqual([
          {
            jid: "6591111111@s.whatsapp.net",
            connection: connectionId,
            phone: "6591111111",
          },
          {
            // The device suffix is stripped, matching how every other writer
            // stores the same person.
            jid: "6592222222@s.whatsapp.net",
            connection: connectionId,
            phone: "6592222222",
          },
          {
            jid: "6593333333@s.whatsapp.net",
            connection: connectionId,
            phone: "6593333333",
          },
        ]);

        // The member who already had a contact keeps it, name intact.
        const preserved = await sql<{ id: string; push_name: string | null }>`
          SELECT id, push_name
          FROM ${sql.raw(`"${schema}".contacts`)}
          WHERE jid = '6593333333@s.whatsapp.net'
        `.execute(database);
        expect(preserved.rows).toHaveLength(1);
        expect(preserved.rows[0]?.id).toBe(existingContactId);
        expect(preserved.rows[0]?.push_name).toBe("Existing Name");

        // Backfilled members must not appear in the default "open" inbox.
        const states = await sql<{ count: string }>`
          SELECT count(*)::text AS count
          FROM ${sql.raw(`"${schema}".conversation_states`)}
        `.execute(database);
        expect(states.rows[0]?.count).toBe("0");

        // Idempotent: a re-run inserts nothing and duplicates nothing.
        expect(
          await backfillGroupMemberContacts(
            database as unknown as Kysely<unknown>,
            schema,
          ),
        ).toBe(0n);
        expect(await memberContacts(database, schema)).toHaveLength(3);
      } finally {
        if (schema) {
          await sql
            .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
            .execute(database);
        }
        await database.destroy();
      }
    },
    60_000,
  );

  integrationTest(
    "uses the connection phone number to avoid a self-contact when jid is missing",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      try {
        schema = await createFixtureSchema(database);
        const connectionId = crypto.randomUUID();
        await seedGroup(database, schema, {
          connectionId,
          connectionJid: null,
          connectionPhone: "+65 8000 0000",
          groupJid: "120363000000000099@g.us",
          participantJids: [
            "6580000000@s.whatsapp.net",
            "6591111111@s.whatsapp.net",
          ],
        });

        expect(
          await backfillGroupMemberContacts(
            database as unknown as Kysely<unknown>,
            schema,
          ),
        ).toBe(1n);
        expect(await memberContacts(database, schema)).toEqual([
          {
            jid: "6591111111@s.whatsapp.net",
            connection: connectionId,
            phone: "6591111111",
          },
        ]);
      } finally {
        if (schema) {
          await sql
            .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
            .execute(database);
        }
        await database.destroy();
      }
    },
    60_000,
  );

  integrationTest(
    "creates each member only against the connection that shares the group",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      try {
        schema = await createFixtureSchema(database);
        const connectionA = crypto.randomUUID();
        const connectionB = crypto.randomUUID();
        const sharedMember = "6594444444@s.whatsapp.net";

        await seedGroup(database, schema, {
          connectionId: connectionA,
          connectionJid: "6580000001@s.whatsapp.net",
          groupJid: "120363000000000002@g.us",
          participantJids: [sharedMember],
        });
        await seedGroup(database, schema, {
          connectionId: connectionB,
          connectionJid: "6580000002@s.whatsapp.net",
          groupJid: "120363000000000003@g.us",
          participantJids: [sharedMember, "6595555555@s.whatsapp.net"],
        });

        await backfillGroupMemberContacts(
          database as unknown as Kysely<unknown>,
          schema,
        );

        const rows = await memberContacts(database, schema);
        // The shared member exists once per connection - two different
        // conversations - and never leaks across the boundary.
        expect(
          rows
            .filter((row) => row.jid === sharedMember)
            .map((r) => r.connection)
            .sort(),
        ).toEqual([connectionA, connectionB].sort());
        expect(
          rows.filter((row) => row.jid === "6595555555@s.whatsapp.net"),
        ).toEqual([
          {
            jid: "6595555555@s.whatsapp.net",
            connection: connectionB,
            phone: "6595555555",
          },
        ]);
      } finally {
        if (schema) {
          await sql
            .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
            .execute(database);
        }
        await database.destroy();
      }
    },
    60_000,
  );

  integrationTest(
    "skips a group whose contact has no owning connection, and a schema without group tables",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      let bareSchema: string | null = null;
      try {
        schema = await createFixtureSchema(database);
        const orphanGroupContact = crypto.randomUUID();
        const orphanGroup = crypto.randomUUID();
        await sql
          .raw(`INSERT INTO "${schema}".contacts (id, whatsapp_connection_id, jid, is_group)
            VALUES ('${orphanGroupContact}', NULL, '120363000000000004@g.us', true)`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".groups (id, contact_id, jid)
            VALUES ('${orphanGroup}', '${orphanGroupContact}', '120363000000000004@g.us')`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".group_participants (group_id, participant_jid)
            VALUES ('${orphanGroup}', '6596666666@s.whatsapp.net')`)
          .execute(database);

        // A contact with no connection could not be scoped, and the partial
        // unique index would not even protect it from duplicating.
        expect(
          await backfillGroupMemberContacts(
            database as unknown as Kysely<unknown>,
            schema,
          ),
        ).toBe(0n);
        expect(await memberContacts(database, schema)).toEqual([]);

        // A schema provisioned before group administration shipped is skipped
        // rather than failing the migration for every other tenant.
        bareSchema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;
        await sql.raw(`CREATE SCHEMA "${bareSchema}"`).execute(database);
        expect(
          await backfillGroupMemberContacts(
            database as unknown as Kysely<unknown>,
            bareSchema,
          ),
        ).toBe(0n);
      } finally {
        for (const target of [schema, bareSchema]) {
          if (target) {
            await sql
              .raw(`DROP SCHEMA IF EXISTS "${target}" CASCADE`)
              .execute(database);
          }
        }
        await database.destroy();
      }
    },
    60_000,
  );

  integrationTest(
    "converges past its batch size on a group larger than one batch",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      try {
        schema = await createFixtureSchema(database);
        const connectionId = crypto.randomUUID();
        // One more than BACKFILL_BATCH_SIZE, so the loop must run twice and
        // still terminate.
        const memberCount = 501;
        await seedGroup(database, schema, {
          connectionId,
          connectionJid: "6580000003@s.whatsapp.net",
          groupJid: "120363000000000005@g.us",
          participantJids: Array.from(
            { length: memberCount },
            (_, index) => `65${String(index).padStart(8, "0")}@s.whatsapp.net`,
          ),
        });

        expect(
          await backfillGroupMemberContacts(
            database as unknown as Kysely<unknown>,
            schema,
          ),
        ).toBe(BigInt(memberCount));
        expect(await memberContacts(database, schema)).toHaveLength(
          memberCount,
        );
        expect(
          await backfillGroupMemberContacts(
            database as unknown as Kysely<unknown>,
            schema,
          ),
        ).toBe(0n);
      } finally {
        if (schema) {
          await sql
            .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
            .execute(database);
        }
        await database.destroy();
      }
    },
    60_000,
  );
});
