import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";
import { sql } from "kysely";
import {
  exportContacts,
  exportConversation,
  exportFullBackup,
  exportMessages,
  type FullBackupExport,
} from "./export.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("tenant exports", () => {
  integrationTest(
    "exports contacts from the tenant schema and binds tag and assignment filters",
    async () => {
      const companyA = crypto.randomUUID();
      const companyB = crypto.randomUUID();
      const assignedUserId = crypto.randomUUID();
      const otherUserId = crypto.randomUUID();

      try {
        await Promise.all([
          createTenantSchema(companyA),
          createTenantSchema(companyB),
        ]);
        const tenantA = getTenantConnection(companyA);
        const tenantB = getTenantConnection(companyB);

        const [contactA, otherContactA] = await tenantA
          .insertInto("contacts")
          .values([
            {
              jid: "tenant-a@s.whatsapp.net",
              phone_number: "111",
              push_name: "Tenant A",
              custom_name: "Alpha",
              notes_shared: "private tenant A note",
            },
            {
              jid: "other-a@s.whatsapp.net",
              phone_number: "112",
              push_name: "Other A",
            },
          ])
          .returning("id")
          .execute();
        await tenantB
          .insertInto("contacts")
          .values({
            jid: "tenant-b@s.whatsapp.net",
            phone_number: "222",
            push_name: "Tenant B",
            custom_name: "Beta",
          })
          .execute();

        const [priorityTag, vipTag] = await tenantA
          .insertInto("tags")
          .values([{ name: "Priority" }, { name: "VIP" }])
          .returning("id")
          .execute();
        await tenantA
          .insertInto("contact_tags")
          .values([
            { contact_id: contactA.id, tag_id: priorityTag.id },
            { contact_id: contactA.id, tag_id: vipTag.id },
          ])
          .execute();
        await tenantA
          .insertInto("contact_assignments")
          .values([
            {
              contact_id: contactA.id,
              assigned_to: assignedUserId,
              assigned_by: assignedUserId,
            },
            {
              contact_id: otherContactA.id,
              assigned_to: otherUserId,
              assigned_by: otherUserId,
            },
          ])
          .execute();
        await tenantA
          .insertInto("messages")
          .values({
            contact_id: contactA.id,
            message_id: "latest-contact-message",
            from_me: false,
            message_type: "text",
            content: "hello",
            timestamp: new Date("2026-02-01T10:00:00.000Z"),
          })
          .execute();

        // This call previously failed with `relation "contacts" does not exist`
        // because raw SQL ignored the tenant connection's withSchema() plugin.
        const allContacts = await exportContacts(companyA);
        expect(
          allContacts.map((contact) => contact.whatsapp_id).sort(),
        ).toEqual(["other-a@s.whatsapp.net", "tenant-a@s.whatsapp.net"]);
        expect(
          allContacts.find(
            (contact) => contact.whatsapp_id === "tenant-a@s.whatsapp.net",
          ),
        ).toMatchObject({
          shared_notes: "private tenant A note",
          tags: "Priority,VIP",
          assigned_to: assignedUserId,
          last_message_at: "2026-02-01T10:00:00.000Z",
        });

        const byTag = await exportContacts(companyA, {
          tagIds: [priorityTag.id],
        });
        expect(byTag).toHaveLength(1);
        expect(byTag[0]).toMatchObject({
          whatsapp_id: "tenant-a@s.whatsapp.net",
          tags: "Priority,VIP",
        });

        const byAssignment = await exportContacts(companyA, {
          assignedTo: assignedUserId,
          assignedUserId,
          hasCustomName: true,
        });
        expect(byAssignment.map((contact) => contact.whatsapp_id)).toEqual([
          "tenant-a@s.whatsapp.net",
        ]);
        expect(
          await exportContacts(companyA, { assignedTo: crypto.randomUUID() }),
        ).toEqual([]);
      } finally {
        await Promise.all([
          dropTenantSchema(companyA),
          dropTenantSchema(companyB),
        ]);
      }
    },
    30_000,
  );

  integrationTest(
    "applies tenant, assignment, and date filters to messages, conversations, and backups",
    async () => {
      const companyA = crypto.randomUUID();
      const companyB = crypto.randomUUID();
      const assignedUserId = crypto.randomUUID();
      const otherUserId = crypto.randomUUID();

      try {
        await Promise.all([
          createTenantSchema(companyA),
          createTenantSchema(companyB),
        ]);
        const tenantA = getTenantConnection(companyA);
        const tenantB = getTenantConnection(companyB);

        const [contactA, otherContactA] = await tenantA
          .insertInto("contacts")
          .values([
            {
              jid: "conversation-a@s.whatsapp.net",
              push_name: "Conversation A",
              custom_name: "Customer A",
            },
            {
              jid: "other-conversation-a@s.whatsapp.net",
              push_name: "Other Conversation A",
            },
          ])
          .returning("id")
          .execute();
        const contactB = await tenantB
          .insertInto("contacts")
          .values({
            jid: "conversation-b@s.whatsapp.net",
            push_name: "Conversation B",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        await tenantA
          .insertInto("contact_assignments")
          .values([
            {
              contact_id: contactA.id,
              assigned_to: assignedUserId,
              assigned_by: assignedUserId,
            },
            {
              contact_id: otherContactA.id,
              assigned_to: otherUserId,
              assigned_by: otherUserId,
            },
          ])
          .execute();
        await tenantA
          .insertInto("messages")
          .values([
            {
              contact_id: contactA.id,
              message_id: "before-range",
              from_me: false,
              message_type: "text",
              content: "before",
              timestamp: new Date("2026-01-01T00:00:00.000Z"),
            },
            {
              contact_id: contactA.id,
              message_id: "in-range-text",
              from_me: false,
              message_type: "text",
              content: "included text",
              timestamp: new Date("2026-02-01T00:00:00.000Z"),
            },
            {
              contact_id: contactA.id,
              message_id: "after-range-image",
              from_me: true,
              message_type: "image",
              content: "after",
              media_url: "https://media.test/image",
              timestamp: new Date("2026-03-01T00:00:00.000Z"),
            },
            {
              contact_id: otherContactA.id,
              message_id: "other-assignment",
              from_me: false,
              message_type: "text",
              content: "other",
              timestamp: new Date("2026-02-10T00:00:00.000Z"),
            },
          ])
          .execute();
        await tenantB
          .insertInto("messages")
          .values({
            contact_id: contactB.id,
            message_id: "tenant-b-private",
            from_me: false,
            message_type: "text",
            content: "must not leak",
            timestamp: new Date("2026-02-05T00:00:00.000Z"),
          })
          .execute();

        const filteredMessages = await exportMessages(companyA, {
          startDate: new Date("2026-01-15T00:00:00.000Z"),
          endDate: new Date("2026-02-28T23:59:59.999Z"),
          messageTypes: ["text"],
          assignedUserId,
        });
        expect(filteredMessages).toEqual([
          expect.objectContaining({
            message_id: "in-range-text",
            contact_whatsapp_id: "conversation-a@s.whatsapp.net",
            contact_name: "Customer A",
            text_content: "included text",
          }),
        ]);
        expect(
          await exportMessages(companyA, { messageTypes: ["not-a-type"] }),
        ).toEqual([]);

        const conversation = await exportConversation(companyA, contactA.id, {
          startDate: new Date("2026-01-15T00:00:00.000Z"),
          endDate: new Date("2026-03-01T00:00:00.000Z"),
          assignedUserId,
        });
        expect(conversation.contact.whatsapp_id).toBe(
          "conversation-a@s.whatsapp.net",
        );
        expect(
          conversation.messages.map((message) => message.message_id),
        ).toEqual(["in-range-text", "after-range-image"]);
        await expect(
          exportConversation(companyA, contactA.id, {
            assignedUserId: otherUserId,
          }),
        ).rejects.toMatchObject({ statusCode: 404 });

        const groupContact = await tenantA
          .insertInto("contacts")
          .values({
            jid: "group-a@g.us",
            push_name: "Tenant A Group",
            is_group: true,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await tenantA
          .insertInto("messages")
          .values({
            contact_id: groupContact.id,
            message_id: "group-backup-message",
            from_me: false,
            message_type: "text",
            content: "group message",
            timestamp: new Date("2026-02-15T00:00:00.000Z"),
          })
          .execute();

        // Cross the backup's 5,000-row batch boundary with identical timestamps.
        // Offset pagination could omit or duplicate rows when PostgreSQL changed
        // the tie order between batches; keyset pagination must return each once.
        const messagesTable = sql.table(`${getSchemaName(companyA)}.messages`);
        await sql`
          INSERT INTO ${messagesTable}
            (contact_id, message_id, from_me, message_type, content, timestamp)
          SELECT
            ${contactA.id},
            'backup-tie-' || n,
            false,
            'text'::message_type,
            'batch boundary',
            ${new Date("2026-02-20T00:00:00.000Z")}
          FROM generate_series(1, 5001) AS n
        `.execute(tenantA);

        const zipData = await exportFullBackup(companyA, {
          startDate: new Date("2026-01-15T00:00:00.000Z"),
          endDate: new Date("2026-02-28T23:59:59.999Z"),
        });
        const files = unzipSync(zipData);
        const contacts = JSON.parse(
          strFromU8(files["contacts.json"]),
        ) as FullBackupExport["contacts"];
        const messages = JSON.parse(
          strFromU8(files["messages.json"]),
        ) as FullBackupExport["messages"];
        const summary = JSON.parse(
          strFromU8(files["backup-summary.json"]),
        ) as FullBackupExport;

        expect(contacts.map((contact) => contact.whatsapp_id).sort()).toEqual([
          "conversation-a@s.whatsapp.net",
          "group-a@g.us",
          "other-conversation-a@s.whatsapp.net",
        ]);
        const messageIds = messages.map((message) => message.message_id);
        expect(messages).toHaveLength(5004);
        expect(new Set(messageIds)).toHaveLength(5004);
        expect(messageIds).toContain("in-range-text");
        expect(messageIds).toContain("other-assignment");
        expect(messageIds).toContain("group-backup-message");
        expect(messageIds).toContain("backup-tie-1");
        expect(messageIds).toContain("backup-tie-5001");
        expect(messageIds).not.toContain("tenant-b-private");
        expect(summary.stats).toMatchObject({
          totalContacts: 3,
          totalMessages: 5004,
          dateRange: {
            start: "2026-02-01T00:00:00.000Z",
            end: "2026-02-20T00:00:00.000Z",
          },
        });
        expect(strFromU8(files["contacts.csv"])).toStartWith("whatsapp_id,");
        expect(strFromU8(files["messages.csv"])).toContain("in-range-text");
      } finally {
        await Promise.all([
          dropTenantSchema(companyA),
          dropTenantSchema(companyB),
        ]);
      }
    },
    30_000,
  );

  integrationTest(
    "exports conversations larger than the single-query limit without truncation",
    async () => {
      const companyId = crypto.randomUUID();

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const contact = await tenantDb
          .insertInto("contacts")
          .values({
            jid: "large-conversation@s.whatsapp.net",
            push_name: "Large Conversation",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const messagesTable = sql.table(`${getSchemaName(companyId)}.messages`);

        await sql`
          INSERT INTO ${messagesTable}
            (contact_id, message_id, from_me, message_type, content, timestamp)
          SELECT
            ${contact.id},
            'large-conversation-' || n,
            false,
            'text'::message_type,
            'large export',
            ${new Date("2026-04-01T00:00:00.000Z")}
          FROM generate_series(1, 50001) AS n
        `.execute(tenantDb);

        const conversation = await exportConversation(companyId, contact.id);
        const messageIds = conversation.messages.map(
          (message) => message.message_id,
        );
        expect(conversation.messages).toHaveLength(50001);
        expect(new Set(messageIds)).toHaveLength(50001);
        expect(messageIds).toContain("large-conversation-1");
        expect(messageIds).toContain("large-conversation-50001");
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    120_000,
  );
});
