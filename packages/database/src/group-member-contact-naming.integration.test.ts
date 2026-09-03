import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { backfillGroupMemberContacts } from "./migrations/079_backfill_group_member_contacts.js";
import { nameGroupMemberContacts } from "./migrations/080_name_group_member_contacts.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * Migration 079 creates member contacts bare. These cases prove 080 gives them
 * the name WhatsApp already knows - including rows 077 created in an earlier
 * deployment - so the profile the member's row opens shows the same identity
 * that was clicked, without renaming anything an agent chose by hand.
 */

type Database = ReturnType<typeof createDatabase>;
const untyped = (database: Database) => database as unknown as Kysely<unknown>;

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
      custom_name TEXT,
      is_group BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    .execute(database);
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
      participant_jid TEXT NOT NULL
    )`)
    .execute(database);
  await sql
    .raw(`CREATE TABLE "${schema}".messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      whatsapp_connection_id UUID,
      contact_id UUID,
      sender_jid TEXT,
      sender_name TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    .execute(database);
  return schema;
}

async function nameOf(
  database: Database,
  schema: string,
  jid: string,
): Promise<{ push_name: string | null; custom_name: string | null }> {
  const result = await sql<{
    push_name: string | null;
    custom_name: string | null;
  }>`
    SELECT push_name, custom_name
    FROM ${sql.raw(`"${schema}".contacts`)}
    WHERE jid = ${jid} AND is_group = false
  `.execute(database);
  return result.rows[0] ?? { push_name: null, custom_name: null };
}

describe("migration 080 group member contact naming", () => {
  integrationTest(
    "names the bare contacts migration 079 created, from WhatsApp's own data",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      const connectionId = crypto.randomUUID();
      try {
        schema = await createFixtureSchema(database);
        const groupContactId = crypto.randomUUID();
        const groupId = crypto.randomUUID();
        const addressBookMember = "6591111111@s.whatsapp.net";
        const messageMember = "6592222222@s.whatsapp.net";
        const anonymousMember = "6593333333@s.whatsapp.net";
        const digitsOnlyMember = "6594444444@s.whatsapp.net";

        await sql
          .raw(`INSERT INTO "${schema}".whatsapp_connections (id, jid)
            VALUES ('${connectionId}', '6580000000@s.whatsapp.net')`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".contacts
            (id, whatsapp_connection_id, jid, is_group)
            VALUES ('${groupContactId}', '${connectionId}',
                    '120363000000000010@g.us', true)`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".groups (id, contact_id, jid)
            VALUES ('${groupId}', '${groupContactId}',
                    '120363000000000010@g.us')`)
          .execute(database);
        for (const jid of [
          addressBookMember,
          messageMember,
          anonymousMember,
          digitsOnlyMember,
        ]) {
          await sql
            .raw(`INSERT INTO "${schema}".group_participants
              (group_id, participant_jid) VALUES ('${groupId}', '${jid}')`)
            .execute(database);
        }

        // WhatsApp's address book for this connection.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionId}, '6580000000@s.whatsapp.net',
                  ${addressBookMember}, 'Address Book Alice')
        `.execute(database);
        // A "name" that is only the member's own number in prettified form.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, push_name)
          VALUES (${connectionId}, '6580000000@s.whatsapp.net',
                  ${digitsOnlyMember}, '+65 9444 4444')
        `.execute(database);

        // Migration 079 creates every member bare - the state 080 repairs.
        expect(
          await backfillGroupMemberContacts(untyped(database), schema),
        ).toBe(4n);
        expect(
          (await nameOf(database, schema, addressBookMember)).push_name,
        ).toBeNull();
        // Historical writers could persist whitespace instead of NULL. It is
        // still unnamed and must be repaired by the same migration.
        await sql
          .raw(`UPDATE "${schema}".contacts SET push_name = '   '
            WHERE jid = '${addressBookMember}'`)
          .execute(database);

        // A member whose only name is on their messages.
        await sql
          .raw(`INSERT INTO "${schema}".messages
            (whatsapp_connection_id, contact_id, sender_jid, sender_name, timestamp)
            VALUES
            ('${connectionId}', '${groupContactId}', '${messageMember}',
             'Older Name', now() - interval '2 days'),
            ('${connectionId}', '${groupContactId}', '${messageMember}',
             'Newest Message Name', now())`)
          .execute(database);

        expect(await nameGroupMemberContacts(untyped(database), schema)).toBe(
          2n,
        );

        // The address book wins, and the newest message name is used otherwise.
        expect(
          (await nameOf(database, schema, addressBookMember)).push_name,
        ).toBe("Address Book Alice");
        expect((await nameOf(database, schema, messageMember)).push_name).toBe(
          "Newest Message Name",
        );
        // No name anywhere, and a "name" that only repeats the number: both
        // left null so the display chain falls through to the phone column.
        expect(
          (await nameOf(database, schema, anonymousMember)).push_name,
        ).toBeNull();
        expect(
          (await nameOf(database, schema, digitsOnlyMember)).push_name,
        ).toBeNull();

        // Idempotent.
        expect(await nameGroupMemberContacts(untyped(database), schema)).toBe(
          0n,
        );
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id = ${connectionId}
        `.execute(database);
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
    "repairs legacy message tables missing sender identity columns before naming",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      const connectionId = crypto.randomUUID();
      try {
        schema = await createFixtureSchema(database);
        const groupContactId = crypto.randomUUID();
        const memberContactId = crypto.randomUUID();
        const groupId = crypto.randomUUID();
        const member = "6591010101@s.whatsapp.net";

        // Reproduce tenants created after migration 034 was globally recorded
        // but before the tenant template included these columns.
        await sql
          .raw(`ALTER TABLE "${schema}".messages
            DROP COLUMN sender_jid, DROP COLUMN sender_name`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".whatsapp_connections (id, jid)
            VALUES ('${connectionId}', '6580000000@s.whatsapp.net')`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".contacts
            (id, whatsapp_connection_id, jid, is_group)
            VALUES
              ('${groupContactId}', '${connectionId}',
               '120363000000000099@g.us', true),
              ('${memberContactId}', '${connectionId}', '${member}', false)`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".groups (id, contact_id, jid)
            VALUES ('${groupId}', '${groupContactId}',
                    '120363000000000099@g.us')`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".group_participants
            (group_id, participant_jid) VALUES ('${groupId}', '${member}')`)
          .execute(database);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionId}, '6580000000@s.whatsapp.net',
                  ${member}, 'Legacy Tenant Alice')
        `.execute(database);

        expect(await nameGroupMemberContacts(untyped(database), schema)).toBe(
          1n,
        );
        expect((await nameOf(database, schema, member)).push_name).toBe(
          "Legacy Tenant Alice",
        );
        const columns = await sql<{ column_name: string }>`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = ${schema}
            AND table_name = 'messages'
            AND column_name IN ('sender_jid', 'sender_name')
          ORDER BY column_name
        `.execute(database);
        expect(columns.rows.map((row) => row.column_name)).toEqual([
          "sender_jid",
          "sender_name",
        ]);
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id = ${connectionId}
        `.execute(database);
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
    "never touches a hand-chosen name, an already-named member, or another connection's member",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      const connectionA = crypto.randomUUID();
      const connectionB = crypto.randomUUID();
      try {
        schema = await createFixtureSchema(database);
        const sharedMember = "6595555555@s.whatsapp.net";
        const renamedMember = "6596666666@s.whatsapp.net";
        const alreadyNamed = "6597777777@s.whatsapp.net";

        for (const [connectionId, groupJid] of [
          [connectionA, "120363000000000011@g.us"],
          [connectionB, "120363000000000012@g.us"],
        ] as const) {
          const groupContactId = crypto.randomUUID();
          const groupId = crypto.randomUUID();
          await sql
            .raw(`INSERT INTO "${schema}".whatsapp_connections (id, jid)
              VALUES ('${connectionId}', '658000000${
                connectionId === connectionA ? 1 : 2
              }@s.whatsapp.net')`)
            .execute(database);
          await sql
            .raw(`INSERT INTO "${schema}".contacts
              (id, whatsapp_connection_id, jid, is_group)
              VALUES ('${groupContactId}', '${connectionId}', '${groupJid}', true)`)
            .execute(database);
          await sql
            .raw(`INSERT INTO "${schema}".groups (id, contact_id, jid)
              VALUES ('${groupId}', '${groupContactId}', '${groupJid}')`)
            .execute(database);
          for (const jid of [sharedMember, renamedMember, alreadyNamed]) {
            await sql
              .raw(`INSERT INTO "${schema}".group_participants
                (group_id, participant_jid) VALUES ('${groupId}', '${jid}')`)
              .execute(database);
          }
        }

        // Only connection B's address book knows this member.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionB}, '6580000002@s.whatsapp.net',
                  ${sharedMember}, 'Known Only To B')
        `.execute(database);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionA}, '6580000001@s.whatsapp.net',
                  ${renamedMember}, 'WhatsApp Supplied Name')
        `.execute(database);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionA}, '6580000001@s.whatsapp.net',
                  ${alreadyNamed}, 'Stale Address Book Name')
        `.execute(database);

        await backfillGroupMemberContacts(untyped(database), schema);

        // An agent renamed one member by hand; another already carries a name.
        await sql
          .raw(`UPDATE "${schema}".contacts SET custom_name = 'Agent Chosen'
            WHERE jid = '${renamedMember}'
              AND whatsapp_connection_id = '${connectionA}'`)
          .execute(database);
        await sql
          .raw(`UPDATE "${schema}".contacts SET push_name = 'Fresher Name'
            WHERE jid = '${alreadyNamed}'
              AND whatsapp_connection_id = '${connectionA}'`)
          .execute(database);

        await nameGroupMemberContacts(untyped(database), schema);

        const rows = await sql<{
          jid: string;
          whatsapp_connection_id: string;
          push_name: string | null;
          custom_name: string | null;
        }>`
          SELECT jid, whatsapp_connection_id, push_name, custom_name
          FROM ${sql.raw(`"${schema}".contacts`)}
          WHERE is_group = false
        `.execute(database);
        const row = (jid: string, connection: string) =>
          rows.rows.find(
            (candidate) =>
              candidate.jid === jid &&
              candidate.whatsapp_connection_id === connection,
          );

        // Connection isolation: B's address book named B's copy only.
        expect(row(sharedMember, connectionB)?.push_name).toBe(
          "Known Only To B",
        );
        expect(row(sharedMember, connectionA)?.push_name).toBeNull();

        // The hand-chosen name survives, and push_name is still filled beneath
        // it - custom_name outranks it, so nothing an agent sees changes.
        expect(row(renamedMember, connectionA)?.custom_name).toBe(
          "Agent Chosen",
        );
        expect(row(renamedMember, connectionA)?.push_name).toBe(
          "WhatsApp Supplied Name",
        );

        // An existing WhatsApp name is not walked back by a staler one.
        expect(row(alreadyNamed, connectionA)?.push_name).toBe("Fresher Name");
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id IN (${connectionA}, ${connectionB})
        `.execute(database);
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
    "converges past its batch size and skips a schema without the tables",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      let bareSchema: string | null = null;
      const connectionId = crypto.randomUUID();
      try {
        schema = await createFixtureSchema(database);
        const groupContactId = crypto.randomUUID();
        const groupId = crypto.randomUUID();
        await sql
          .raw(`INSERT INTO "${schema}".whatsapp_connections (id, jid)
            VALUES ('${connectionId}', '6580000009@s.whatsapp.net')`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".contacts
            (id, whatsapp_connection_id, jid, is_group)
            VALUES ('${groupContactId}', '${connectionId}',
                    '120363000000000013@g.us', true)`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".groups (id, contact_id, jid)
            VALUES ('${groupId}', '${groupContactId}',
                    '120363000000000013@g.us')`)
          .execute(database);

        // 501 nameable members plus 30 that can never be named, so a batch
        // boundary lands among unnameable rows.
        const nameable = 501;
        const unnameable = 30;
        for (let index = 0; index < nameable + unnameable; index += 1) {
          const jid = `65${String(index).padStart(8, "0")}@s.whatsapp.net`;
          await sql
            .raw(`INSERT INTO "${schema}".group_participants
              (group_id, participant_jid) VALUES ('${groupId}', '${jid}')`)
            .execute(database);
          if (index < nameable) {
            await sql`
              INSERT INTO whatsapp_sessions.whatsmeow_contacts
                (connection_id, our_jid, their_jid, full_name)
              VALUES (${connectionId}, '6580000009@s.whatsapp.net',
                      ${jid}, ${`Member ${index}`})
            `.execute(database);
          }
        }

        await backfillGroupMemberContacts(untyped(database), schema);
        // Every nameable member is named even though unnameable ones are mixed
        // in and the total crosses the batch boundary.
        expect(await nameGroupMemberContacts(untyped(database), schema)).toBe(
          BigInt(nameable),
        );
        expect(await nameGroupMemberContacts(untyped(database), schema)).toBe(
          0n,
        );

        bareSchema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;
        await sql.raw(`CREATE SCHEMA "${bareSchema}"`).execute(database);
        expect(
          await nameGroupMemberContacts(untyped(database), bareSchema),
        ).toBe(0n);
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id = ${connectionId}
        `.execute(database);
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
    120_000,
  );
  integrationTest(
    "applies the same name-rejection rule the API's sync backfill applies",
    async () => {
      // resolveMemberPushName and this migration must agree, or a member named
      // by one path would be rejected by the other and flip on next sync.
      const database = createDatabase(process.env.DATABASE_URL || "");
      const member = "6591234567@s.whatsapp.net";
      const cases: Array<[string, boolean]> = [
        ["Alice Tan", true],
        ["Alice 6591234567", true],
        ["8888", true],
        ["6591234567", false],
        ["+65 9123 4567", false],
        ["(65) 9123-4567", false],
      ];
      try {
        for (const [candidate, kept] of cases) {
          const result = await sql<{ accepted: boolean }>`
            SELECT NOT (
              regexp_replace(${candidate}, '[0-9[:space:]+().-]', '', 'g') = ''
              AND regexp_replace(${candidate}, '\\D', '', 'g')
                  = regexp_replace(
                      split_part(split_part(${member}, '@', 1), ':', 1),
                      '\\D', '', 'g'
                    )
              AND regexp_replace(
                    split_part(split_part(${member}, '@', 1), ':', 1),
                    '\\D', '', 'g'
                  ) <> ''
            ) AS accepted
          `.execute(database);
          expect([candidate, result.rows[0]?.accepted]).toEqual([
            candidate,
            kept,
          ]);
        }
      } finally {
        await database.destroy();
      }
    },
    60_000,
  );
  integrationTest(
    "finds a name WhatsApp filed under the member's LID, not their phone JID",
    async () => {
      // The panel resolves this through whatsmeow_lid_mappings. A naming path
      // without that join leaves the member unnamed while their row shows a
      // name - the exact disagreement this whole change exists to prevent.
      const database = createDatabase(process.env.DATABASE_URL || "");
      let schema: string | null = null;
      const connectionId = crypto.randomUUID();
      const otherConnectionId = crypto.randomUUID();
      try {
        schema = await createFixtureSchema(database);
        const groupContactId = crypto.randomUUID();
        const groupId = crypto.randomUUID();
        const member = "6598888888@s.whatsapp.net";
        const memberLid = "182736450912345@lid";
        const foreignMember = "6599999999@s.whatsapp.net";
        const foreignLid = "182736450999999@lid";

        await sql
          .raw(`INSERT INTO "${schema}".whatsapp_connections (id, jid)
            VALUES ('${connectionId}', '6580000000@s.whatsapp.net')`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".contacts
            (id, whatsapp_connection_id, jid, is_group)
            VALUES ('${groupContactId}', '${connectionId}',
                    '120363000000000014@g.us', true)`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".groups (id, contact_id, jid)
            VALUES ('${groupId}', '${groupContactId}',
                    '120363000000000014@g.us')`)
          .execute(database);
        for (const jid of [member, foreignMember]) {
          await sql
            .raw(`INSERT INTO "${schema}".group_participants
              (group_id, participant_jid) VALUES ('${groupId}', '${jid}')`)
            .execute(database);
        }

        // A direct cache row exists but carries no name. It must not
        // nondeterministically hide the named LID row that normalizes to the
        // same member.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionId}, '6580000000@s.whatsapp.net', ${member}, '   ')
        `.execute(database);
        // The useful address-book entry is filed under the LID, and the mapping
        // is what ties it back to the phone JID the member is stored under.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionId}, '6580000000@s.whatsapp.net',
                  ${memberLid}, 'Alice Behind A LID')
        `.execute(database);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_lid_mappings
            (connection_id, lid, jid)
          VALUES (${connectionId}, ${memberLid}, ${member})
        `.execute(database);

        // A LID entry and mapping owned by a DIFFERENT connection must not
        // name this connection's member.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${otherConnectionId}, '6580000009@s.whatsapp.net',
                  ${foreignLid}, 'Leaked Across Connections')
        `.execute(database);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_lid_mappings
            (connection_id, lid, jid)
          VALUES (${otherConnectionId}, ${foreignLid}, ${foreignMember})
        `.execute(database);

        await backfillGroupMemberContacts(untyped(database), schema);
        await nameGroupMemberContacts(untyped(database), schema);

        expect((await nameOf(database, schema, member)).push_name).toBe(
          "Alice Behind A LID",
        );
        expect(
          (await nameOf(database, schema, foreignMember)).push_name,
        ).toBeNull();
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_lid_mappings
          WHERE connection_id IN (${connectionId}, ${otherConnectionId})
        `.execute(database);
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id IN (${connectionId}, ${otherConnectionId})
        `.execute(database);
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
