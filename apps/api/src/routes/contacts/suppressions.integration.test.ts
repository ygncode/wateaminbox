import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../../app.js";
import { createSpineTestTenant } from "../../channel-spine/application/spine-test-tenant.js";
import { hashPassword } from "../../lib/password.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

/**
 * /contacts/:id/suppressions: block and mute for any channel, including a
 * Telegram-only customer that the WhatsApp PATCH toggle cannot block.
 */
describe("contact suppression routes", () => {
  integrationTest(
    "blocks, reports and unblocks a Telegram-only customer; mutes with an expiry",
    async () => {
      const tenant = await createSpineTestTenant("suppression-routes");
      try {
        const { tenantDb, companyId, accountId, ownerId } = tenant;
        const email = `suppression-routes-${ownerId}@example.com`;
        await db
          .updateTable("users")
          .set({
            email,
            password_hash: await hashPassword(PASSWORD),
            email_verified_at: new Date(),
          })
          .where("id", "=", ownerId)
          .execute();
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: ownerId, role: "owner" })
          .execute();
        const login = await app.request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: PASSWORD }),
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

        const customer = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: null,
            jid: null,
            phone_number: null,
            push_name: "Telegram spammer",
            record_kind: "customer",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await tenantDb
          .insertInto("contact_endpoints")
          .values({
            contact_id: customer.id,
            channel: "telegram",
            provider: "telegram_bot",
            channel_account_id: accountId,
            endpoint_kind: "person",
            external_id: "tg-1",
            identity_scope: "telegram:user",
            verification_state: "provider_verified",
          })
          .execute();

        const base = `/api/contacts/${customer.id}/suppressions`;
        const status = async () => {
          const response = await app.request(base, { headers });
          expect(response.status).toBe(200);
          return ((await response.json()) as { data: Record<string, unknown> })
            .data;
        };

        // The WhatsApp toggle refuses this customer; the neutral route does not.
        const legacy = await app.request(`/api/contacts/${customer.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ isBlocked: true }),
        });
        expect(legacy.status).toBe(400);

        const blocked = await app.request(base, {
          method: "POST",
          headers,
          body: JSON.stringify({ scope: "block" }),
        });
        expect(blocked.status).toBe(200);
        const afterBlock = await status();
        expect(afterBlock.blocked).toBe(true);
        // On by default: no settings row means the workspace enforces.
        expect(afterBlock.enforced).toBe(true);
        expect(afterBlock.channels).toEqual([
          {
            channel: "telegram",
            providerBlocked: false,
            unreachable: false,
            dropped: 0,
            lastDroppedAt: null,
          },
        ]);
        // The contact detail reports the workspace block, so the composer
        // shows the unblock bar for a Telegram customer too.
        const detail = await app.request(`/api/contacts/${customer.id}`, {
          headers,
        });
        expect(
          ((await detail.json()) as { data: { isBlocked: boolean } }).data
            .isBlocked,
        ).toBe(true);

        const unblocked = await app.request(`${base}/block`, {
          method: "DELETE",
          headers,
        });
        expect(unblocked.status).toBe(200);
        expect((await status()).blocked).toBe(false);

        const muted = await app.request(base, {
          method: "POST",
          headers,
          body: JSON.stringify({ scope: "mute_inbound", durationMinutes: 60 }),
        });
        expect(muted.status).toBe(200);
        const mute = (await status()).muted as { expiresAt: string } | null;
        expect(mute?.expiresAt).toBeTruthy();
        expect(new Date(mute!.expiresAt).getTime()).toBeGreaterThan(Date.now());

        const bad = await app.request(`${base}/do_not_contact`, {
          method: "DELETE",
          headers,
        });
        expect(bad.status).toBe(400);

        const audit = await tenantDb
          .selectFrom("audit_logs")
          .select("action")
          .where("entity_id", "=", customer.id)
          .orderBy("created_at")
          .execute();
        expect(audit.map((row) => row.action)).toEqual([
          "contact.blocked",
          "contact.unblocked",
          "contact.muted",
        ]);
      } finally {
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", tenant.companyId)
          .execute();
        await tenant.drop();
      }
    },
  );
});
