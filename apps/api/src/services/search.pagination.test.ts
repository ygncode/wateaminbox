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

describe("searchMessages pagination total", () => {
  integrationTest(
    "reports the true total when the requested page is beyond the last row",
    async () => {
      const companyId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        const [contact] = await tenantDb
          .insertInto("contacts")
          .values({
            jid: "99999@s.whatsapp.net",
            phone_number: "99999",
            push_name: "Pagination Probe",
          })
          .returning("id")
          .execute();

        const [message] = await tenantDb
          .insertInto("messages")
          .values({
            contact_id: contact.id,
            message_id: "msg-pagination",
            from_me: false,
            message_type: "text",
            content: "pagination zucchini probe",
            timestamp: new Date("2026-01-01T00:00:00Z"),
          })
          .returning("id")
          .execute();
        await updateMessageSearchVector(companyId, message.id);

        const firstPage = await searchMessages(companyId, {
          query: "zucchini",
          useMeilisearch: false,
          limit: 10,
          offset: 0,
        });
        expect(firstPage.total).toBe(1);

        const pastEnd = await searchMessages(companyId, {
          query: "zucchini",
          useMeilisearch: false,
          limit: 10,
          offset: 10,
        });

        const contactsPastEnd = await searchContacts(companyId, "Pagination", {
          useMeilisearch: false,
          limit: 10,
          offset: 10,
        });
        expect(contactsPastEnd.results).toEqual([]);
        expect(contactsPastEnd.total).toBe(1);

        expect(pastEnd.results).toEqual([]);
        expect(pastEnd.total).toBe(1);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});
