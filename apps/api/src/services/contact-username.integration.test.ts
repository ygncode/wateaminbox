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
    "identical name-only replay does not rewrite the row, but a changed name still applies",
    async () => {
      const companyId = crypto.randomUUID();
      const connectionId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const jid = "100@s.whatsapp.net";
      const originalTimestamp = "2020-01-01T00:00:00.000Z";
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Test",
            jid: "999@s.whatsapp.net",
            status: "connected",
          })
          .execute();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: crypto.randomUUID(),
            whatsapp_connection_id: connectionId,
            jid,
            phone_number: "100",
            push_name: "Saved name",
            updated_at: new Date(originalTimestamp),
          })
          .execute();
        const event: ContactEvent = {
          contractVersion: 1,
          type: "contact",
          companyId,
          connectionId,
          timestamp: new Date().toISOString(),
          payload: { jid, nameOnly: true, fullName: "  Saved name  " },
        };
        await handleContactEvent(event);
        const unchanged = await tenantDb
          .selectFrom("contacts")
          .select(["push_name", "updated_at"])
          .where("jid", "=", jid)
          .executeTakeFirstOrThrow();
        expect(unchanged.push_name).toBe("Saved name");
        expect(new Date(String(unchanged.updated_at)).toISOString()).toBe(
          originalTimestamp,
        );
        await handleContactEvent({
          ...event,
          payload: { ...event.payload, fullName: "Changed name" },
        });
        const changed = await tenantDb
          .selectFrom("contacts")
          .select(["push_name", "updated_at"])
          .where("jid", "=", jid)
          .executeTakeFirstOrThrow();
        expect(changed.push_name).toBe("Changed name");
        expect(new Date(String(changed.updated_at)).toISOString()).not.toBe(
          originalTimestamp,
        );
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
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
