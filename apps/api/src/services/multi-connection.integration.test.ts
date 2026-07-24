import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("PostgreSQL tenant and connection isolation", () => {
  integrationTest(
    "keeps two company schemas physically isolated",
    async () => {
      const companyA = crypto.randomUUID();
      const companyB = crypto.randomUUID();
      try {
        await Promise.all([
          createTenantSchema(companyA),
          createTenantSchema(companyB),
        ]);
        const tenantA = getTenantConnection(companyA);
        const tenantB = getTenantConnection(companyB);
        const sharedConnectionId = crypto.randomUUID();
        await tenantA
          .insertInto("whatsapp_connections")
          .values({
            id: sharedConnectionId,
            name: "company-a-only",
            status: "connected",
          })
          .execute();
        expect(
          await tenantB
            .selectFrom("whatsapp_connections")
            .select("id")
            .where("id", "=", sharedConnectionId)
            .executeTakeFirst(),
        ).toBeUndefined();
      } finally {
        await Promise.all([
          clearTenantConnection(companyA),
          clearTenantConnection(companyB),
        ]);
        await Promise.all(
          [companyA, companyB].map((companyId) =>
            sql
              .raw(
                `DROP SCHEMA IF EXISTS "${getSchemaName(companyId)}" CASCADE`,
              )
              .execute(db),
          ),
        );
      }
    },
    30_000,
  );

  integrationTest(
    "stores and updates a colliding WhatsApp message ID independently",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionA = crypto.randomUUID();
      const connectionB = crypto.randomUUID();
      const contactA = crypto.randomUUID();
      const contactB = crypto.randomUUID();
      const remoteMessageId = "same-remote-message-id";
      const schema = getSchemaName(companyId);

      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values([
            { id: connectionA, name: "A", status: "connected" },
            { id: connectionB, name: "B", status: "connected" },
          ])
          .execute();
        await tenantDb
          .insertInto("contacts")
          .values([
            {
              id: contactA,
              whatsapp_connection_id: connectionA,
              jid: "1@s.whatsapp.net",
              phone_number: "1",
            },
            {
              id: contactB,
              whatsapp_connection_id: connectionB,
              jid: "1@s.whatsapp.net",
              phone_number: "1",
            },
          ])
          .execute();
        await tenantDb
          .insertInto("messages")
          .values([
            {
              id: crypto.randomUUID(),
              whatsapp_connection_id: connectionA,
              contact_id: contactA,
              message_id: remoteMessageId,
              from_me: true,
              message_type: "text",
              content: "A",
              status: "sent",
              timestamp: new Date(),
            },
            {
              id: crypto.randomUUID(),
              whatsapp_connection_id: connectionB,
              contact_id: contactB,
              message_id: remoteMessageId,
              from_me: true,
              message_type: "text",
              content: "B",
              status: "sent",
              timestamp: new Date(),
            },
          ])
          .execute();

        await tenantDb
          .updateTable("messages")
          .set({ status: "read" })
          .where("message_id", "=", remoteMessageId)
          .where("whatsapp_connection_id", "=", connectionA)
          .execute();
        const rows = await tenantDb
          .selectFrom("messages")
          .select(["whatsapp_connection_id", "status"])
          .where("message_id", "=", remoteMessageId)
          .orderBy("whatsapp_connection_id")
          .execute();

        expect(rows).toHaveLength(2);
        expect(
          rows.find((row) => row.whatsapp_connection_id === connectionA)
            ?.status,
        ).toBe("read");
        expect(
          rows.find((row) => row.whatsapp_connection_id === connectionB)
            ?.status,
        ).toBe("sent");
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
});
