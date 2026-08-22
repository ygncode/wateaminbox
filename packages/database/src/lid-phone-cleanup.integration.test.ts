import { describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDatabase } from "./client.js";
import { clearOpaqueJidPhoneNumbers } from "./migrations/073_clear_opaque_jid_phone_numbers.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

type ContactRow = {
  jid: string;
  phone_number: string | null;
};

describe("migration 073 opaque JID phone cleanup", () => {
  integrationTest(
    "clears exact LID and group-ID derivations without changing real or manually entered numbers",
    async () => {
      const database = createDatabase(process.env.DATABASE_URL || "");
      const schema = `tenant_${crypto.randomUUID().replaceAll("-", "_")}`;

      try {
        await sql.raw(`CREATE SCHEMA "${schema}"`).execute(database);
        await sql
          .raw(`CREATE TABLE "${schema}".contacts (
            id UUID PRIMARY KEY,
            jid TEXT,
            phone_number TEXT,
            is_group BOOLEAN NOT NULL DEFAULT false,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`)
          .execute(database);
        await sql
          .raw(`INSERT INTO "${schema}".contacts
            (id, jid, phone_number, is_group) VALUES
            ('${crypto.randomUUID()}', '123456789012345@lid', '123456789012345', false),
            ('${crypto.randomUUID()}', '99112233@hosted.lid', '+99112233', false),
            ('${crypto.randomUUID()}', '120363000000000000@g.us', '120363000000000000', true),
            ('${crypto.randomUUID()}', '15551234567@s.whatsapp.net', '15551234567', false),
            ('${crypto.randomUUID()}', '88776655@lid', '60123456789', false),
            ('${crypto.randomUUID()}', '120363999999999999@g.us', NULL, true)`)
          .execute(database);

        await clearOpaqueJidPhoneNumbers(
          database as unknown as Kysely<unknown>,
          schema,
        );

        const result = await sql<ContactRow>`
          SELECT jid, phone_number
          FROM ${sql.table(`${schema}.contacts`)}
          ORDER BY jid
        `.execute(database);
        const phones = new Map(
          result.rows.map((row) => [row.jid, row.phone_number]),
        );

        expect(phones.get("123456789012345@lid")).toBeNull();
        expect(phones.get("99112233@hosted.lid")).toBeNull();
        expect(phones.get("120363000000000000@g.us")).toBeNull();
        expect(phones.get("15551234567@s.whatsapp.net")).toBe("15551234567");
        expect(phones.get("88776655@lid")).toBe("60123456789");
        expect(phones.get("120363999999999999@g.us")).toBeNull();
      } finally {
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
          .execute(database);
        await database.destroy();
      }
    },
    30_000,
  );
});
