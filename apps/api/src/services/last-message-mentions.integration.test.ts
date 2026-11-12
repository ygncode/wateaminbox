import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { getContactsWithLastMessage } from "./contact.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

function randomNumericId(): string {
  const hex = crypto.randomUUID().replaceAll("-", "").slice(0, 15);
  return (BigInt(`0x${hex}`) + 100_000_000_000_000n).toString();
}

describe("inbox last-message mentions", () => {
  integrationTest(
    "names LID and phone mentions in a group's preview, and leaves unknown tokens",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const otherConnectionId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const aliceLid = randomNumericId();
      const bobLid = randomNumericId();
      const strangerLid = randomNumericId();
      const outsiderLid = randomNumericId();
      const alicePhone = "6580000001";
      const bobPhone = "6580000002";

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Primary",
            jid: "6599999999@s.whatsapp.net",
            status: "connected",
          })
          .execute();

        const group = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: "120363000000000001@g.us",
            push_name: "Events & Offers",
            is_group: true,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const groupRow = await tenantDb
          .insertInto("groups")
          .values({ contact_id: group.id, name: "Events & Offers" })
          .returning("id")
          .executeTakeFirstOrThrow();
        await tenantDb
          .insertInto("group_participants")
          .values([
            {
              group_id: groupRow.id,
              participant_jid: `${alicePhone}@s.whatsapp.net`,
            },
            {
              group_id: groupRow.id,
              participant_jid: `${bobPhone}@s.whatsapp.net`,
            },
          ])
          .execute();
        await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: `${alicePhone}@s.whatsapp.net`,
            phone_number: alicePhone,
            push_name: "Alice",
          })
          .execute();

        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_lid_mappings (connection_id, lid, jid)
          VALUES
            (${connectionId}, ${`${aliceLid}@lid`}, ${`${alicePhone}@s.whatsapp.net`}),
            -- Bob is known only through another connection, and is a member.
            (${otherConnectionId}, ${`${bobLid}@lid`}, ${`${bobPhone}@s.whatsapp.net`}),
            -- Known elsewhere, but not a member of this group: never named.
            (${otherConnectionId}, ${`${outsiderLid}@lid`}, '6580000009@s.whatsapp.net')
        `.execute(db);

        // Bob has no contact name; his last group message carries his name.
        await tenantDb
          .insertInto("messages")
          .values([
            {
              whatsapp_connection_id: connectionId,
              contact_id: group.id,
              message_id: "m-1",
              from_me: false,
              sender_jid: `${bobPhone}@s.whatsapp.net`,
              sender_name: "Bob",
              message_type: "text",
              content: "hi",
              timestamp: new Date("2026-01-01T00:00:00Z"),
            },
            {
              whatsapp_connection_id: connectionId,
              contact_id: group.id,
              message_id: "m-2",
              from_me: false,
              sender_jid: `${alicePhone}@s.whatsapp.net`,
              message_type: "text",
              content: `@${aliceLid} @${bobLid} @${strangerLid} @${outsiderLid} see you`,
              timestamp: new Date("2026-01-02T00:00:00Z"),
            },
          ])
          .execute();

        const { contacts } = await getContactsWithLastMessage(
          tenantDb,
          companyId,
          { includeGroups: true },
        );
        const row = contacts.find((contact) => contact.id === group.id);
        const mentions = row?.last_message?.mentionParticipants ?? [];
        expect(
          mentions.sort((a, b) => a.displayName.localeCompare(b.displayName)),
        ).toEqual([
          { displayName: "Alice", mentionIds: [aliceLid] },
          { displayName: "Bob", mentionIds: [bobLid] },
        ]);
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_lid_mappings
          WHERE connection_id IN (${connectionId}, ${otherConnectionId})
        `.execute(db);
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
});
