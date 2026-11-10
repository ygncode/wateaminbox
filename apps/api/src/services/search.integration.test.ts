import { describe, expect, test } from "bun:test";
import {
  searchContacts,
  searchMessages,
  updateMessageSearchVector,
} from "./search.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("PostgreSQL tenant message search", () => {
  integrationTest(
    "qualifies tenant tables, updates vectors, and enforces assignments",
    async () => {
      const companyA = crypto.randomUUID();
      const companyB = crypto.randomUUID();
      const assignedUserId = crypto.randomUUID();

      try {
        await Promise.all([
          createTenantSchema(companyA),
          createTenantSchema(companyB),
        ]);
        const tenantA = getTenantConnection(companyA);
        const tenantB = getTenantConnection(companyB);

        const [contactA] = await tenantA
          .insertInto("contacts")
          .values({
            jid: "111@s.whatsapp.net",
            phone_number: "111",
            push_name: "Tenant A",
          })
          .returning("id")
          .execute();
        const [contactB] = await tenantB
          .insertInto("contacts")
          .values({
            jid: "222@s.whatsapp.net",
            phone_number: "222",
            push_name: "Tenant B",
          })
          .returning("id")
          .execute();

        const [messageA] = await tenantA
          .insertInto("messages")
          .values({
            contact_id: contactA.id,
            message_id: "tenant-a-message",
            from_me: false,
            message_type: "text",
            content: "private apricot conversation",
            timestamp: new Date("2026-01-01T00:00:00Z"),
          })
          .returning("id")
          .execute();
        await tenantB
          .insertInto("messages")
          .values({
            contact_id: contactB.id,
            message_id: "tenant-b-message",
            from_me: false,
            message_type: "text",
            content: "private blueberry conversation",
            timestamp: new Date("2026-01-02T00:00:00Z"),
          })
          .execute();
        const [lidContact] = await tenantA
          .insertInto("contacts")
          .values({
            jid: "123456789012345@lid",
            phone_number: "123456789012345",
          })
          .returning("id")
          .execute();
        const [lidMessage] = await tenantA
          .insertInto("messages")
          .values({
            contact_id: lidContact.id,
            message_id: "tenant-a-lid-message",
            from_me: false,
            message_type: "text",
            content: "private mango conversation",
            timestamp: new Date("2026-01-03T00:00:00Z"),
          })
          .returning("id")
          .execute();
        await tenantA
          .insertInto("contact_assignments")
          .values({
            contact_id: contactA.id,
            assigned_to: assignedUserId,
            assigned_by: assignedUserId,
          })
          .execute();

        await updateMessageSearchVector(companyA, messageA.id);
        const stored = await tenantA
          .selectFrom("messages")
          .select("search_vector")
          .where("id", "=", messageA.id)
          .executeTakeFirstOrThrow();
        expect(stored.search_vector).not.toBeNull();

        const tenantAResults = await searchMessages(companyA, {
          query: "apricot",
          useMeilisearch: false,
          assignedUserId,
        });
        expect(tenantAResults.total).toBe(1);
        expect(
          tenantAResults.results.map((result) => result.messageId),
        ).toEqual(["tenant-a-message"]);
        // ts_headline now runs after LIMIT/OFFSET; the page row must still
        // carry the <mark> highlight markup.
        expect(tenantAResults.results[0]?.highlights).toContain("<mark>");

        const crossTenantResults = await searchMessages(companyA, {
          query: "blueberry",
          useMeilisearch: false,
        });
        expect(crossTenantResults).toEqual({ results: [], total: 0 });

        await updateMessageSearchVector(companyA, lidMessage.id);
        const lidResults = await searchMessages(companyA, {
          query: "mango",
          useMeilisearch: false,
        });
        expect(lidResults.total).toBe(1);
        expect(lidResults.results[0]?.contactName).toBe(
          "WhatsApp user (ID …2345)",
        );

        await tenantA
          .updateTable("contacts")
          .set({ username: "private_user" })
          .where("id", "=", lidContact.id)
          .execute();
        const usernameMessageResults = await searchMessages(companyA, {
          query: "mango",
          useMeilisearch: false,
        });
        expect(usernameMessageResults.results[0]?.contactName).toBe(
          "@private_user",
        );
        const usernameContactResults = await searchContacts(
          companyA,
          "@private_user",
          { useMeilisearch: false },
        );
        expect(usernameContactResults.results).toMatchObject([
          { id: lidContact.id, displayName: "@private_user" },
        ]);
      } finally {
        await Promise.all([
          dropTenantSchema(companyA),
          dropTenantSchema(companyB),
        ]);
      }
    },
  );

  integrationTest(
    "matches non-Latin text, treats LIKE metacharacters literally, hides merged contacts",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: "333@s.whatsapp.net",
            phone_number: "333",
            push_name: "မောင်မောင်",
          })
          .returning("id")
          .execute();
        await tenantDb
          .insertInto("messages")
          .values([
            {
              contact_id: contact.id,
              message_id: "burmese",
              from_me: false,
              message_type: "text",
              content: "နေကောင်းလား ဆရာ",
              timestamp: new Date("2026-02-01T00:00:00Z"),
            },
            {
              contact_id: contact.id,
              message_id: "percent",
              from_me: false,
              message_type: "text",
              content: "discount 100% today",
              timestamp: new Date("2026-02-01T00:01:00Z"),
            },
            {
              contact_id: contact.id,
              message_id: "plain",
              from_me: false,
              message_type: "text",
              content: "no symbols here",
              timestamp: new Date("2026-02-01T00:02:00Z"),
            },
          ])
          .execute();

        // The old implementation stripped every non-[a-zA-Z0-9] character and
        // returned nothing for Burmese/Thai/CJK queries.
        const burmese = await searchMessages(companyId, { query: "ကောင်း" });
        expect(burmese.results.map((r) => r.messageId)).toEqual(["burmese"]);

        // "%" must be a literal percent sign, not a LIKE wildcard.
        const percent = await searchMessages(companyId, { query: "100%" });
        expect(percent.results.map((r) => r.messageId)).toEqual(["percent"]);
        // A bare "%" is a literal percent sign: it matches only the one message
        // that contains one, not every row.
        const wildcard = await searchMessages(companyId, { query: "%" });
        expect(wildcard.results.map((r) => r.messageId)).toEqual(["percent"]);
        const underscore = await searchMessages(companyId, { query: "n_" });
        expect(underscore.total).toBe(0);

        // Contacts: non-Latin names match, merged-away contacts are hidden.
        const named = await searchContacts(companyId, "မောင်");
        expect(named.results.map((c) => c.id)).toEqual([contact.id]);
        const [survivor] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: "444@s.whatsapp.net",
            phone_number: "444",
            push_name: "Survivor Maung",
          })
          .returning("id")
          .execute();
        await tenantDb
          .updateTable("contacts")
          .set({ merged_into_contact_id: survivor.id })
          .where("id", "=", contact.id)
          .execute();
        const afterMerge = await searchContacts(companyId, "Maung");
        expect(afterMerge.results.map((c) => c.id)).toEqual([survivor.id]);
        const mergedAway = await searchContacts(companyId, "မောင်");
        expect(mergedAway.total).toBe(0);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
    60_000,
  );
});
