import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { up } from "./migrations/057_link_orphan_contacts_to_sole_connection.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

/**
 * Minimal tenant fixtures for the backfill: only the tables/columns the
 * migration touches. Schemas are named tenant_* so executeOnAllTenants
 * discovers them like real tenants.
 */
async function createFixtureSchema(
  database: ReturnType<typeof createDatabase>,
): Promise<string> {
  const schema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;
  await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
  await sql
    .raw(`CREATE TABLE "${schema}".whatsapp_connections (
      id UUID PRIMARY KEY,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    .execute(database);
  await sql
    .raw(`CREATE TABLE "${schema}".contacts (
      id UUID PRIMARY KEY,
      whatsapp_connection_id UUID,
      jid TEXT,
      phone_number TEXT,
      is_group BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
    .execute(database);
  return schema;
}

async function connectionRows(
  database: ReturnType<typeof createDatabase>,
  schema: string,
): Promise<Map<string, string | null>> {
  const result = await sql<{
    id: string;
    whatsapp_connection_id: string | null;
  }>`
    SELECT id, whatsapp_connection_id
    FROM ${sql.raw(`"${schema}".contacts`)}
  `.execute(database);
  return new Map(
    result.rows.map((row) => [row.id, row.whatsapp_connection_id]),
  );
}

describe("migration 057 orphan contact backfill", () => {
  integrationTest(
    "links orphans only in sole-connection tenants, skipping groups, JID collisions, and multi-connection tenants",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      let soleSchema: string | null = null;
      let multiSchema: string | null = null;
      try {
        // Tenant A: one unarchived connection (plus an archived one that must
        // not make the tenant ambiguous).
        soleSchema = await createFixtureSchema(database);
        const soleConnection = crypto.randomUUID();
        const archivedConnection = crypto.randomUUID();
        await sql
          .raw(`INSERT INTO "${soleSchema}".whatsapp_connections (id, archived_at) VALUES
            ('${soleConnection}', NULL),
            ('${archivedConnection}', now())`)
          .execute(database);

        const orphan = crypto.randomUUID();
        const groupOrphan = crypto.randomUUID();
        const collisionOrphan = crypto.randomUUID();
        const alreadyLinked = crypto.randomUUID();
        await sql
          .raw(`INSERT INTO "${soleSchema}".contacts
            (id, whatsapp_connection_id, jid, is_group) VALUES
            ('${orphan}', NULL, '1000@s.whatsapp.net', false),
            ('${groupOrphan}', NULL, '2000@g.us', true),
            ('${collisionOrphan}', NULL, '3000@s.whatsapp.net', false),
            ('${alreadyLinked}', '${soleConnection}', '3000@s.whatsapp.net', false)`)
          .execute(database);

        // Tenant B: two unarchived connections — never guess.
        multiSchema = await createFixtureSchema(database);
        const multiOrphan = crypto.randomUUID();
        await sql
          .raw(`INSERT INTO "${multiSchema}".whatsapp_connections (id, archived_at) VALUES
            ('${crypto.randomUUID()}', NULL),
            ('${crypto.randomUUID()}', NULL)`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${multiSchema}".contacts
            (id, whatsapp_connection_id, jid, is_group) VALUES
            ('${multiOrphan}', NULL, '4000@s.whatsapp.net', false)`)
          .execute(database);

        await up(database as unknown as Kysely<unknown>);

        const soleRows = await connectionRows(database, soleSchema);
        expect(soleRows.get(orphan)).toBe(soleConnection);
        // Groups and JID collisions stay unlinked.
        expect(soleRows.get(groupOrphan)).toBeNull();
        expect(soleRows.get(collisionOrphan)).toBeNull();
        expect(soleRows.get(alreadyLinked)).toBe(soleConnection);

        const multiRows = await connectionRows(database, multiSchema);
        expect(multiRows.get(multiOrphan)).toBeNull();
      } finally {
        for (const schema of [soleSchema, multiSchema]) {
          if (schema) {
            await sql
              .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
              .execute(database);
          }
        }
        await database.destroy();
      }
    },
    30_000,
  );
});
