import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import type { ContactEvent } from "../lib/nats/index.js";
import { handleContactEvent } from "./handlers/contact-handlers.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("WhatsApp username synchronization", () => {
  integrationTest(
    "stores, updates, and explicitly clears a private-number username",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const jid = "123456789012345@lid";

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

        const event: ContactEvent = {
          contractVersion: 1,
          type: "contact",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: {
            jid,
            username: " @private_user ",
            isGroup: false,
          },
        };
        await handleContactEvent(event);

        const stored = await tenantDb
          .selectFrom("contacts")
          .select(["phone_number", "username"])
          .where("jid", "=", jid)
          .executeTakeFirstOrThrow();
        expect(stored).toEqual({
          phone_number: null,
          username: "private_user",
        });

        await handleContactEvent({
          ...event,
          payload: { jid, username: "renamed_user", nameOnly: true },
        });
        expect(
          await tenantDb
            .selectFrom("contacts")
            .select("username")
            .where("jid", "=", jid)
            .executeTakeFirstOrThrow(),
        ).toEqual({ username: "renamed_user" });

        await handleContactEvent({
          ...event,
          payload: { jid, username: "", nameOnly: true },
        });
        expect(
          await tenantDb
            .selectFrom("contacts")
            .select("username")
            .where("jid", "=", jid)
            .executeTakeFirstOrThrow(),
        ).toEqual({ username: null });
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
});
