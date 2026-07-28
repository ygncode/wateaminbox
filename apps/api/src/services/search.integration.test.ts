import { describe, expect, test } from "bun:test";
import { searchMessages, updateMessageSearchVector } from "./search.service.js";
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

        const crossTenantResults = await searchMessages(companyA, {
          query: "blueberry",
          useMeilisearch: false,
        });
        expect(crossTenantResults).toEqual({ results: [], total: 0 });
      } finally {
        await Promise.all([
          dropTenantSchema(companyA),
          dropTenantSchema(companyB),
        ]);
      }
    },
  );
});
