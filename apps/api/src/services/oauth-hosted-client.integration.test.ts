import { createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { canonicalResource, issuer } from "../routes/oauth.js";
import { hostedClientId } from "./oauth-hosted-clients.js";
import { resolveOAuthClient } from "./oauth-client.service.js";
import { createAuthorizationCode } from "./oauth.service.js";
import { getSchemaName } from "./tenant.service.js";

/**
 * Authorization for a client whose document this server hosts.
 *
 * oauth_grants.client_id and oauth_authorization_codes.client_id are foreign
 * keys into oauth_clients, and only the fetch path was writing that row. A
 * hosted client resolved straight from the registry, so every Grok
 * authorization failed at code insertion with a 23503 - after the user had
 * signed in, picked a workspace and pressed Connect.
 *
 * The existing OAuth integration tests all pre-insert their oauth_clients row
 * in the fixture, which is why none of them saw this. This one deliberately
 * does not: it exercises resolve-then-issue exactly as the authorize route
 * does, so the row has to come from resolution itself.
 */
const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const TEST_TIMEOUT_MS = 30_000;

const GROK_CLIENT_ID = hostedClientId(issuer(), "grok");
const GROK_REDIRECT_URI = "https://grok.com/connectors-oauth-exchange-code/";

async function withFixture(
  run: (ctx: { userId: string; companyId: string }) => Promise<void>,
): Promise<void> {
  const userId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email: `hosted-${userId}@example.com`,
        password_hash: "x",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Hosted client test",
        schema_name: getSchemaName(companyId),
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: userId, role: "owner" })
      .execute();

    await run({ userId, companyId });
  } finally {
    await db.deleteFrom("oauth_grants").where("user_id", "=", userId).execute();
    await db
      .deleteFrom("oauth_authorization_codes")
      .where("user_id", "=", userId)
      .execute();
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", userId).execute();
  }
}

describe("authorizing a hosted client", () => {
  integrationTest(
    "issues a code without the client row being created by hand",
    async () => {
      await withFixture(async ({ userId, companyId }) => {
        // Nothing seeded the row; resolution is the only thing that can.
        await db
          .deleteFrom("oauth_clients")
          .where("client_id", "=", GROK_CLIENT_ID)
          .execute();

        const client = await resolveOAuthClient(GROK_CLIENT_ID);
        expect(client.clientName).toBe("Grok");

        const verifier = randomBytes(32).toString("base64url");
        const code = await createAuthorizationCode({
          clientId: GROK_CLIENT_ID,
          userId,
          companyId,
          scopes: ["read", "write"],
          redirectUri: GROK_REDIRECT_URI,
          codeChallenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          resource: canonicalResource(),
        });

        expect(code).toBeTruthy();
      });
    },
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "records the registry's metadata, not a placeholder",
    async () => {
      await resolveOAuthClient(GROK_CLIENT_ID);

      const row = await db
        .selectFrom("oauth_clients")
        .select(["client_name", "redirect_uris", "token_endpoint_auth_method"])
        .where("client_id", "=", GROK_CLIENT_ID)
        .executeTakeFirst();

      // The connected-apps list reads this row, so a bare row satisfying the
      // constraint is not enough - it has to carry the real name.
      expect(row?.client_name).toBe("Grok");
      expect(row?.token_endpoint_auth_method).toBe("none");
      expect(row?.redirect_uris).toContain(GROK_REDIRECT_URI);
    },
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "resolving twice does not conflict",
    async () => {
      // Every authorization resolves again; the upsert must be idempotent.
      await resolveOAuthClient(GROK_CLIENT_ID);
      await resolveOAuthClient(GROK_CLIENT_ID);

      const rows = await db
        .selectFrom("oauth_clients")
        .select("client_id")
        .where("client_id", "=", GROK_CLIENT_ID)
        .execute();

      expect(rows).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
