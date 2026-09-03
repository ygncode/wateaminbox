import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { getContactDisplayName } from "@wateaminbox/shared";
import type { ContactEvent } from "../lib/nats/index.js";
import {
  getEnrichedGroupParticipants,
  getGroupsList,
} from "./group.service.js";
import { handleContactEvent } from "./handlers/contact-handlers.js";
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

describe("group synchronization", () => {
  integrationTest(
    "keeps title, participants, and unread state coherent across sidebar projections",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const groupJid = "120363000000000000@g.us";

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Primary",
            jid: "999@s.whatsapp.net",
            status: "connected",
          })
          .execute();

        const contactEvent: ContactEvent = {
          contractVersion: 1,
          type: "contact",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            jid: groupJid,
            displayName: "AI Sharing Group",
            isGroup: true,
            unreadCount: 7,
            participants: [
              { jid: "111:2@s.whatsapp.net", isAdmin: true },
              { jid: "222@s.whatsapp.net", isAdmin: false },
            ],
          },
        };
        await handleContactEvent(contactEvent);

        const contact = await tenantDb
          .selectFrom("contacts")
          .select(["id", "phone_number"])
          .where("jid", "=", groupJid)
          .executeTakeFirstOrThrow();
        expect(contact.phone_number).toBeNull();
        await tenantDb
          .insertInto("messages")
          .values([
            {
              whatsapp_connection_id: connectionId,
              contact_id: contact.id,
              message_id: "history-1",
              from_me: false,
              sender_jid: "111@s.whatsapp.net",
              sender_name: "Bob from messages",
              message_type: "text",
              content: "old one",
              timestamp: new Date("2026-01-01T00:00:00Z"),
            },
            {
              whatsapp_connection_id: connectionId,
              contact_id: contact.id,
              message_id: "history-2",
              from_me: false,
              sender_jid: "222@s.whatsapp.net",
              sender_name: "Old Alice name",
              message_type: "text",
              content: "old two",
              timestamp: new Date("2026-01-02T00:00:00Z"),
            },
          ])
          .execute();
        // The group snapshot above already backfilled a bare contact for every
        // phone-addressable member, so this names the member rather than
        // introducing them - the name is what the assertion below is about.
        await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: "222@s.whatsapp.net",
            phone_number: "222",
            push_name: "Alice from contacts",
          })
          .onConflict((oc) =>
            oc
              .columns(["whatsapp_connection_id", "jid"])
              .where("whatsapp_connection_id", "is not", null)
              .where("jid", "is not", null)
              .doUpdateSet({ push_name: "Alice from contacts" }),
          )
          .execute();
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_lid_mappings (
            connection_id,
            lid,
            jid
          ) VALUES (
            ${connectionId},
            '83185010536598@lid',
            '222@s.whatsapp.net'
          )
        `.execute(db);

        const groupRecord = await tenantDb
          .selectFrom("groups")
          .select("id")
          .where("contact_id", "=", contact.id)
          .executeTakeFirstOrThrow();
        const enrichedParticipants = await getEnrichedGroupParticipants(
          tenantDb,
          {
            groupId: groupRecord.id,
            contactId: contact.id,
            connectionId,
            connectionJid: "999@s.whatsapp.net",
          },
        );
        expect(enrichedParticipants).toMatchObject([
          {
            jid: "111@s.whatsapp.net",
            phoneNumber: "111",
            displayName: "Bob from messages",
            isAdmin: true,
          },
          {
            jid: "222@s.whatsapp.net",
            phoneNumber: "222",
            mentionIds: ["83185010536598", "222"],
            displayName: "Alice from contacts",
            isAdmin: false,
          },
        ]);

        let result = await getGroupsList(tenantDb, {
          limit: 100,
          offset: 0,
          userId: crypto.randomUUID(),
          canViewAllChats: true,
        });
        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]).toMatchObject({
          displayName: "AI Sharing Group",
          participantCount: 2,
          unreadCount: 7,
        });

        const matchingConnection = await getGroupsList(tenantDb, {
          connectionId,
          limit: 100,
          offset: 0,
          userId: crypto.randomUUID(),
          canViewAllChats: true,
        });
        expect(matchingConnection.groups).toHaveLength(1);
        const otherConnection = await getGroupsList(tenantDb, {
          connectionId: crypto.randomUUID(),
          limit: 100,
          offset: 0,
          userId: crypto.randomUUID(),
          canViewAllChats: true,
        });
        expect(otherConnection.groups).toHaveLength(0);
        expect(otherConnection.total).toBe(0);

        // A reconnect metadata repair has no unread snapshot and must not
        // claim that every group is read.
        await handleContactEvent({
          ...contactEvent,
          payload: {
            jid: groupJid,
            displayName: "AI Sharing Group",
            isGroup: true,
            participantCount: 2,
            participants: contactEvent.payload.participants,
          },
        });
        result = await getGroupsList(tenantDb, {
          limit: 100,
          offset: 0,
          userId: crypto.randomUUID(),
          canViewAllChats: true,
        });
        expect(result.groups[0]?.unreadCount).toBe(7);

        await handleContactEvent({
          ...contactEvent,
          payload: {
            ...contactEvent.payload,
            unreadCount: 0,
            participants: [{ jid: "222:5@s.whatsapp.net", isAdmin: true }],
          },
        });

        result = await getGroupsList(tenantDb, {
          limit: 100,
          offset: 0,
          userId: crypto.randomUUID(),
          canViewAllChats: true,
        });
        expect(result.groups[0]).toMatchObject({
          participantCount: 1,
          unreadCount: 0,
        });
        const participants = await tenantDb
          .selectFrom("group_participants")
          .select(["participant_jid", "is_admin"])
          .execute();
        expect(participants).toEqual([
          { participant_jid: "222@s.whatsapp.net", is_admin: true },
        ]);
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_lid_mappings
          WHERE connection_id = ${connectionId}
        `.execute(db);
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );

  integrationTest(
    "uses only unambiguous cross-connection aliases for existing group members",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const foreignConnectionA = crypto.randomUUID();
      const foreignConnectionB = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const groupJid = `${randomNumericId()}@g.us`;
      const participantA = randomNumericId();
      const participantB = randomNumericId();
      const outsider = randomNumericId();
      const uniqueAlias = randomNumericId();
      const hostedAlias = randomNumericId();
      const conflictingAlias = randomNumericId();
      const locallyAuthoritativeAlias = randomNumericId();

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Primary",
            jid: `${randomNumericId()}@s.whatsapp.net`,
            status: "connected",
          })
          .execute();

        await handleContactEvent({
          contractVersion: 1,
          type: "contact",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            jid: groupJid,
            displayName: "Historical aliases",
            isGroup: true,
            participants: [
              { jid: `${participantA}@s.whatsapp.net`, isAdmin: false },
              { jid: `${participantB}@s.whatsapp.net`, isAdmin: false },
            ],
          },
        });

        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_lid_mappings (
            connection_id,
            lid,
            jid
          ) VALUES
            (
              ${foreignConnectionA},
              ${`${uniqueAlias}:7@lid`},
              ${`${participantA}:4@s.whatsapp.net`}
            ),
            (
              ${foreignConnectionA},
              ${`${hostedAlias}@hosted.lid`},
              ${`${participantB}@s.whatsapp.net`}
            ),
            (
              ${foreignConnectionA},
              ${`${conflictingAlias}:3@lid`},
              ${`${participantA}@s.whatsapp.net`}
            ),
            (
              ${foreignConnectionB},
              ${`${conflictingAlias}@hosted.lid`},
              ${`${participantB}@s.whatsapp.net`}
            ),
            (
              ${connectionId},
              ${`${locallyAuthoritativeAlias}@lid`},
              ${`${participantA}@s.whatsapp.net`}
            ),
            (
              ${foreignConnectionB},
              ${`${locallyAuthoritativeAlias}@hosted.lid`},
              ${`${participantB}@s.whatsapp.net`}
            ),
            (
              ${foreignConnectionA},
              ${`${randomNumericId()}@lid`},
              ${`${outsider}@s.whatsapp.net`}
            )
        `.execute(db);

        const contact = await tenantDb
          .selectFrom("contacts")
          .select("id")
          .where("jid", "=", groupJid)
          .executeTakeFirstOrThrow();
        const group = await tenantDb
          .selectFrom("groups")
          .select("id")
          .where("contact_id", "=", contact.id)
          .executeTakeFirstOrThrow();
        const participants = await getEnrichedGroupParticipants(tenantDb, {
          groupId: group.id,
          contactId: contact.id,
          connectionId,
          connectionJid: null,
        });
        const enrichedA = participants.find(
          (participant) => participant.jid === `${participantA}@s.whatsapp.net`,
        );
        const enrichedB = participants.find(
          (participant) => participant.jid === `${participantB}@s.whatsapp.net`,
        );

        expect(enrichedA?.mentionIds).toEqual(
          expect.arrayContaining([
            participantA,
            uniqueAlias,
            locallyAuthoritativeAlias,
          ]),
        );
        expect(enrichedA?.mentionIds).not.toContain(conflictingAlias);
        expect(enrichedB?.mentionIds).toEqual(
          expect.arrayContaining([participantB, hostedAlias]),
        );
        expect(enrichedB?.mentionIds).not.toContain(conflictingAlias);
        expect(enrichedB?.mentionIds).not.toContain(locallyAuthoritativeAlias);
        expect(
          participants.some((participant) =>
            participant.jid.includes(outsider),
          ),
        ).toBe(false);

        const targetMappings = await sql<{ lid: string }>`
          SELECT lid
          FROM whatsapp_sessions.whatsmeow_lid_mappings
          WHERE connection_id = ${connectionId}
          ORDER BY lid
        `.execute(db);
        expect(targetMappings.rows).toEqual([
          { lid: `${locallyAuthoritativeAlias}@lid` },
        ]);

        const indexPlan = await db.transaction().execute(async (trx) => {
          await sql`SET LOCAL enable_seqscan = off`.execute(trx);
          const participantPlan = await sql<{ "QUERY PLAN": string }>`
            EXPLAIN (COSTS OFF)
            SELECT lid
            FROM whatsapp_sessions.whatsmeow_lid_mappings
            WHERE (
              split_part(split_part(jid, '@', 1), ':', 1)
              || '@' || split_part(jid, '@', 2)
            ) = ${`${participantA}@s.whatsapp.net`}
          `.execute(trx);
          const tokenPlan = await sql<{ "QUERY PLAN": string }>`
            EXPLAIN (COSTS OFF)
            SELECT jid
            FROM whatsapp_sessions.whatsmeow_lid_mappings
            WHERE split_part(split_part(lid, '@', 1), ':', 1) =
              ${uniqueAlias}
          `.execute(trx);
          return [...participantPlan.rows, ...tokenPlan.rows]
            .map((row) => row["QUERY PLAN"])
            .join("\n");
        });
        expect(indexPlan).toContain(
          "whatsmeow_lid_mappings_normalized_jid_idx",
        );
        expect(indexPlan).toContain("whatsmeow_lid_mappings_mention_token_idx");
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_lid_mappings
          WHERE connection_id IN (
            ${connectionId},
            ${foreignConnectionA},
            ${foreignConnectionB}
          )
        `.execute(db);
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );

  integrationTest(
    "sorts active groups by their latest message and puts empty groups last",
    async () => {
      const companyId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const newestId = crypto.randomUUID();
        const olderId = crypto.randomUUID();
        const emptyId = crypto.randomUUID();
        await tenantDb
          .insertInto("contacts")
          .values([
            {
              id: olderId,
              jid: "older@g.us",
              push_name: "Older group",
              is_group: true,
            },
            {
              id: emptyId,
              jid: "empty@g.us",
              push_name: "Empty group",
              is_group: true,
            },
            {
              id: newestId,
              jid: "newest@g.us",
              push_name: "Newest group",
              is_group: true,
            },
          ])
          .execute();
        await tenantDb
          .insertInto("messages")
          .values([
            {
              contact_id: olderId,
              message_id: "older-message",
              from_me: false,
              message_type: "text",
              content: "older",
              timestamp: new Date("2026-01-01T00:00:00Z"),
            },
            {
              contact_id: newestId,
              message_id: "newest-message",
              from_me: false,
              message_type: "text",
              content: "newest",
              timestamp: new Date("2026-02-01T00:00:00Z"),
            },
          ])
          .execute();

        const result = await getGroupsList(tenantDb, {
          limit: 100,
          offset: 0,
          userId: crypto.randomUUID(),
          canViewAllChats: true,
        });
        expect(result.groups.map((group) => group.displayName)).toEqual([
          "Newest group",
          "Older group",
          "Empty group",
        ]);
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );

  integrationTest(
    "uses legacy contact titles in group results and search",
    async () => {
      const companyId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("contacts")
          .values({
            jid: "120363111111111111@g.us",
            push_name: "Legacy Project Group",
            is_group: true,
          })
          .execute();

        const result = await getGroupsList(tenantDb, {
          search: "Legacy Project",
          limit: 100,
          offset: 0,
          userId: crypto.randomUUID(),
          canViewAllChats: true,
        });
        expect(result.total).toBe(1);
        expect(result.groups[0]?.displayName).toBe("Legacy Project Group");
        expect(result.groups[0]?.participantCount).toBeNull();
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
  integrationTest(
    "gives every phone-addressable member a contact so their identity is openable",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const groupJid = `${randomNumericId()}@g.us`;
      const ownNumber = randomNumericId();
      const speaker = randomNumericId();
      const silentMember = randomNumericId();
      const lidOnlyMember = randomNumericId();

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Primary",
            phone_number: ownNumber,
            // Connected rows from older event flows can temporarily lack jid;
            // self-filtering must fall back to this phone number.
            jid: null,
            status: "connected",
          })
          .execute();

        const contactEvent: ContactEvent = {
          contractVersion: 1,
          type: "contact",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            jid: groupJid,
            displayName: "Backfill Group",
            isGroup: true,
            participants: [
              // Already has a direct conversation - historically the ONLY
              // member with a contact row, and so the only clickable one.
              { jid: `${speaker}@s.whatsapp.net`, isAdmin: false },
              { jid: `${silentMember}@s.whatsapp.net`, isAdmin: true },
              // WhatsApp has not disclosed this member's number.
              { jid: `${lidOnlyMember}@lid`, isAdmin: false },
              // The connected account itself.
              { jid: `${ownNumber}@s.whatsapp.net`, isAdmin: true },
            ],
          },
        };

        await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: `${speaker}@s.whatsapp.net`,
            phone_number: speaker,
            push_name: "Existing Contact",
          })
          .execute();

        await handleContactEvent(contactEvent);

        const groupContact = await tenantDb
          .selectFrom("contacts")
          .select(["id"])
          .where("jid", "=", groupJid)
          .executeTakeFirstOrThrow();
        const groupRecord = await tenantDb
          .selectFrom("groups")
          .select("id")
          .where("contact_id", "=", groupContact.id)
          .executeTakeFirstOrThrow();

        const participants = await getEnrichedGroupParticipants(tenantDb, {
          groupId: groupRecord.id,
          contactId: groupContact.id,
          connectionId,
          connectionJid: `${ownNumber}@s.whatsapp.net`,
        });
        const contactIdByJid = new Map(
          participants.map((participant) => [
            participant.jid,
            participant.contactId,
          ]),
        );

        // The member who was already reachable stays reachable, and keeps the
        // contact that already carried their name rather than gaining a second.
        expect(contactIdByJid.get(`${speaker}@s.whatsapp.net`)).toBeTruthy();
        // The regression this fixes: a member who never messaged is openable.
        expect(
          contactIdByJid.get(`${silentMember}@s.whatsapp.net`),
        ).toBeTruthy();
        // No stable key exists for a LID-only member, so none is invented.
        expect(contactIdByJid.get(`${lidOnlyMember}@lid`)).toBeNull();

        const ownContact = await tenantDb
          .selectFrom("contacts")
          .select(["id"])
          .where("jid", "=", `${ownNumber}@s.whatsapp.net`)
          .executeTakeFirst();
        expect(ownContact).toBeUndefined();

        const backfilled = await tenantDb
          .selectFrom("contacts")
          .select(["id", "is_group", "phone_number"])
          .where("jid", "=", `${silentMember}@s.whatsapp.net`)
          .executeTakeFirstOrThrow();
        expect(backfilled.is_group).toBe(false);
        expect(backfilled.phone_number).toBe(silentMember);

        // A backfilled member carries no conversation state, so the default
        // "open" inbox does not gain an empty conversation for them.
        const conversationState = await tenantDb
          .selectFrom("conversation_states")
          .select(["contact_id"])
          .where("contact_id", "=", backfilled.id)
          .executeTakeFirst();
        expect(conversationState).toBeUndefined();

        // Re-running the same snapshot is a no-op: no duplicate rows, and the
        // member keeps the identity the first pass gave them.
        await handleContactEvent(contactEvent);
        const afterReplay = await tenantDb
          .selectFrom("contacts")
          .select(["id"])
          .where("jid", "=", `${silentMember}@s.whatsapp.net`)
          .execute();
        expect(afterReplay).toHaveLength(1);
        expect(afterReplay[0]?.id).toBe(backfilled.id);
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
  integrationTest(
    "names a backfilled member so their profile matches the identity that was clicked",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const otherConnectionId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const groupJid = `${randomNumericId()}@g.us`;
      const ownNumber = randomNumericId();
      const storedNamed = randomNumericId();
      const messageNamed = randomNumericId();
      const anonymous = randomNumericId();
      const customNamed = randomNumericId();

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values([
            {
              id: connectionId,
              name: "Primary",
              jid: `${ownNumber}@s.whatsapp.net`,
              status: "connected",
            },
            {
              id: otherConnectionId,
              name: "Secondary",
              jid: `${randomNumericId()}@s.whatsapp.net`,
              status: "connected",
            },
          ])
          .execute();

        // WhatsApp's own address book, owned by the OTHER connection. Its name
        // must never reach a member on this connection.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts (
            connection_id, our_jid, their_jid, full_name
          ) VALUES (
            ${otherConnectionId},
            ${`${ownNumber}@s.whatsapp.net`},
            ${`${storedNamed}@s.whatsapp.net`},
            'Leaked From Other Connection'
          )
        `.execute(db);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts (
            connection_id, our_jid, their_jid, full_name
          ) VALUES (
            ${connectionId},
            ${`${ownNumber}@s.whatsapp.net`},
            ${`${storedNamed}@s.whatsapp.net`},
            'Stored Address Book Name'
          )
        `.execute(db);

        const contactEvent: ContactEvent = {
          contractVersion: 1,
          type: "contact",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            jid: groupJid,
            displayName: "Naming Group",
            isGroup: true,
            participants: [
              { jid: `${storedNamed}@s.whatsapp.net`, isAdmin: false },
              { jid: `${messageNamed}@s.whatsapp.net`, isAdmin: false },
              { jid: `${anonymous}@s.whatsapp.net`, isAdmin: false },
              { jid: `${customNamed}@s.whatsapp.net`, isAdmin: false },
            ],
          },
        };
        await handleContactEvent(contactEvent);

        const groupContact = await tenantDb
          .selectFrom("contacts")
          .select(["id"])
          .where("jid", "=", groupJid)
          .executeTakeFirstOrThrow();

        // A member whose only name is the one WhatsApp put on their messages.
        await tenantDb
          .insertInto("messages")
          .values({
            whatsapp_connection_id: connectionId,
            contact_id: groupContact.id,
            message_id: `msg-${messageNamed}`,
            from_me: false,
            sender_jid: `${messageNamed}@s.whatsapp.net`,
            sender_name: "Name From Messages",
            message_type: "text",
            content: "hi",
            timestamp: new Date("2026-02-01T00:00:00Z"),
          })
          .execute();

        // A historical blank is still unnamed and should be repaired.
        await tenantDb
          .updateTable("contacts")
          .set({ push_name: "   " })
          .where("jid", "=", `${storedNamed}@s.whatsapp.net`)
          .where("whatsapp_connection_id", "=", connectionId)
          .execute();

        // A member an agent already renamed by hand.
        await tenantDb
          .updateTable("contacts")
          .set({ custom_name: "Agent Chosen Name" })
          .where("jid", "=", `${customNamed}@s.whatsapp.net`)
          .where("whatsapp_connection_id", "=", connectionId)
          .execute();

        // Re-running the sync is what names the members already created.
        await handleContactEvent(contactEvent);

        const nameOf = async (number: string) =>
          tenantDb
            .selectFrom("contacts")
            .select(["push_name", "custom_name"])
            .where("jid", "=", `${number}@s.whatsapp.net`)
            .where("whatsapp_connection_id", "=", connectionId)
            .executeTakeFirstOrThrow();

        // The profile reads push_name, so this is what the opened panel shows.
        expect((await nameOf(storedNamed)).push_name).toBe(
          "Stored Address Book Name",
        );
        expect((await nameOf(messageNamed)).push_name).toBe(
          "Name From Messages",
        );
        // No WhatsApp name anywhere: left null rather than stamped with digits.
        expect((await nameOf(anonymous)).push_name).toBeNull();

        // A hand-chosen name is never overwritten, and never demoted.
        const renamed = await nameOf(customNamed);
        expect(renamed.custom_name).toBe("Agent Chosen Name");

        // Connection isolation: the other connection's address book entry did
        // not name this member, and no contact was created over there.
        expect((await nameOf(storedNamed)).push_name).not.toBe(
          "Leaked From Other Connection",
        );
        const foreign = await tenantDb
          .selectFrom("contacts")
          .select(["id"])
          .where("whatsapp_connection_id", "=", otherConnectionId)
          .execute();
        expect(foreign).toEqual([]);
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id IN (${connectionId}, ${otherConnectionId})
        `.execute(db);
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
  integrationTest(
    "the clicked row and the opened profile cannot disagree, LID-filed names included",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const groupJid = `${randomNumericId()}@g.us`;
      const ownNumber = randomNumericId();
      const lidNamed = randomNumericId();
      const lidToken = randomNumericId();
      const bookNamed = randomNumericId();
      const messageNamed = randomNumericId();

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Primary",
            jid: `${ownNumber}@s.whatsapp.net`,
            status: "connected",
          })
          .execute();

        // An unnamed direct cache row must not hide the useful name WhatsApp
        // filed under this member's LID.
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionId}, ${`${ownNumber}@s.whatsapp.net`},
                  ${`${lidNamed}@s.whatsapp.net`}, '   ')
        `.execute(db);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionId}, ${`${ownNumber}@s.whatsapp.net`},
                  ${`${lidToken}@lid`}, 'Alice Behind A LID')
        `.execute(db);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_lid_mappings
            (connection_id, lid, jid)
          VALUES (${connectionId}, ${`${lidToken}@lid`},
                  ${`${lidNamed}@s.whatsapp.net`})
        `.execute(db);
        await sql`
          INSERT INTO whatsapp_sessions.whatsmeow_contacts
            (connection_id, our_jid, their_jid, full_name)
          VALUES (${connectionId}, ${`${ownNumber}@s.whatsapp.net`},
                  ${`${bookNamed}@s.whatsapp.net`}, 'Bob From The Book')
        `.execute(db);

        const contactEvent: ContactEvent = {
          contractVersion: 1,
          type: "contact",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            jid: groupJid,
            displayName: "Agreement Group",
            isGroup: true,
            participants: [
              { jid: `${lidNamed}@s.whatsapp.net`, isAdmin: false },
              { jid: `${bookNamed}@s.whatsapp.net`, isAdmin: false },
              { jid: `${messageNamed}@s.whatsapp.net`, isAdmin: false },
            ],
          },
        };
        await handleContactEvent(contactEvent);

        const groupContact = await tenantDb
          .selectFrom("contacts")
          .select(["id"])
          .where("jid", "=", groupJid)
          .executeTakeFirstOrThrow();
        await tenantDb
          .insertInto("messages")
          .values({
            whatsapp_connection_id: connectionId,
            contact_id: groupContact.id,
            message_id: `msg-${messageNamed}`,
            from_me: false,
            sender_jid: `${messageNamed}@s.whatsapp.net`,
            sender_name: "Carol From Messages",
            message_type: "text",
            content: "hi",
            timestamp: new Date("2026-03-01T00:00:00Z"),
          })
          .execute();
        await handleContactEvent(contactEvent);

        const groupRecord = await tenantDb
          .selectFrom("groups")
          .select("id")
          .where("contact_id", "=", groupContact.id)
          .executeTakeFirstOrThrow();

        // What the participant row renders.
        const participants = await getEnrichedGroupParticipants(tenantDb, {
          groupId: groupRecord.id,
          contactId: groupContact.id,
          connectionId,
          connectionJid: `${ownNumber}@s.whatsapp.net`,
        });

        // What the profile the row opens renders, from the contact row alone.
        for (const participant of participants) {
          expect(participant.contactId).toBeTruthy();
          const contact = await tenantDb
            .selectFrom("contacts")
            .select([
              "jid",
              "custom_name",
              "push_name",
              "username",
              "phone_number",
            ])
            .where("id", "=", participant.contactId as string)
            .executeTakeFirstOrThrow();
          expect([participant.jid, getContactDisplayName(contact)]).toEqual([
            participant.jid,
            participant.displayName,
          ]);
        }

        // And the names really are the WhatsApp ones, not phone-number
        // fallbacks that would agree only by both being empty.
        const nameByJid = new Map(
          participants.map((participant) => [
            participant.jid,
            participant.displayName,
          ]),
        );
        expect(nameByJid.get(`${lidNamed}@s.whatsapp.net`)).toBe(
          "Alice Behind A LID",
        );
        expect(nameByJid.get(`${bookNamed}@s.whatsapp.net`)).toBe(
          "Bob From The Book",
        );
        expect(nameByJid.get(`${messageNamed}@s.whatsapp.net`)).toBe(
          "Carol From Messages",
        );
      } finally {
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_lid_mappings
          WHERE connection_id = ${connectionId}
        `.execute(db);
        await sql`
          DELETE FROM whatsapp_sessions.whatsmeow_contacts
          WHERE connection_id = ${connectionId}
        `.execute(db);
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
});
