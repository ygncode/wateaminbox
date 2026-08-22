import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
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
        await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: "222@s.whatsapp.net",
            phone_number: "222",
            push_name: "Alice from contacts",
          })
          .execute();

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
});
