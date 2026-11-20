import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

/**
 * PATCH /contacts/:id { isBlocked } dual-writes the channel-neutral customer
 * suppression alongside the legacy WhatsApp flag (phase 1 of the
 * contact-blocking plan). Enforcement does not read it yet; this pins that the
 * two never disagree.
 */
describe("PATCH /contacts/:id block dual-write", () => {
  integrationTest(
    "blocking writes one active block suppression and unblocking revokes it",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const ownerId = crypto.randomUUID();
      const ownerEmail = `block-owner-${ownerId}@example.com`;
      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: ownerEmail,
            password_hash: await hashPassword(PASSWORD),
            email_verified_at: new Date(),
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Block dual-write test",
            schema_name: schemaName,
            status: "active",
          })
          .execute();
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: ownerId, role: "owner" })
          .execute();
        await createTenantSchema(companyId);

        const login = await app.request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: ownerEmail, password: PASSWORD }),
        });
        expect(login.status).toBe(200);
        const { tokens } = (await login.json()) as {
          tokens: { accessToken: string };
        };
        const headers = {
          authorization: `Bearer ${tokens.accessToken}`,
          "x-company-id": companyId,
          "content-type": "application/json",
        };

        const tenantDb = getTenantConnection(companyId);
        const connectionId = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: connectionId,
            name: "Primary",
            jid: "15550001111@s.whatsapp.net",
            status: "connected",
          })
          .execute();
        // The command outbox addresses the connection's current session.
        await tenantDb
          .insertInto("whatsapp_connection_sessions")
          .values({
            whatsapp_connection_id: connectionId,
            status: "connected",
            started_at: new Date(),
            connected_at: new Date(),
          })
          .execute();
        const contact = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: "15550002222@s.whatsapp.net",
            phone_number: "15550002222",
            push_name: "Abuser",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        const patch = (isBlocked: boolean) =>
          app.request(`/api/contacts/${contact.id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ isBlocked }),
          });
        const active = () =>
          tenantDb
            .selectFrom("contact_suppressions")
            .select(["contact_id", "scope", "reason", "created_by"])
            .where("revoked_at", "is", null)
            .execute();

        expect((await patch(true)).status).toBe(200);
        expect(await active()).toEqual([
          {
            contact_id: contact.id,
            scope: "block",
            reason: "manual",
            created_by: ownerId,
          },
        ]);

        expect((await patch(false)).status).toBe(200);
        expect(await active()).toEqual([]);
        const revoked = await tenantDb
          .selectFrom("contact_suppressions")
          .select(["revoked_by"])
          .executeTakeFirstOrThrow();
        expect(revoked.revoked_by).toBe(ownerId);

        // Re-blocking takes a fresh slot rather than reviving the old row.
        expect((await patch(true)).status).toBe(200);
        expect(await active()).toHaveLength(1);
        expect(
          (
            await tenantDb
              .selectFrom("contacts")
              .select("is_blocked")
              .where("id", "=", contact.id)
              .executeTakeFirstOrThrow()
          ).is_blocked,
        ).toBe(true);
      } finally {
        await clearTenantConnection(companyId);
        await sql
          .raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
          .execute(db);
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .execute();
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
  );
});
