import { createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  listConnectedApps,
  OAuthError,
  refreshTokens,
  revokeConnectedApp,
  revokeGrant,
} from "./oauth.service.js";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
  verifyApiToken,
} from "./api-token.service.js";
import { getSchemaName } from "./tenant.service.js";
import { removeMember } from "./company/members.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const TEST_TIMEOUT_MS = 30_000;

const CLIENT_ID = "https://chatgpt.com/oauth/client.json";
const REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
const RESOURCE = "https://app.example.com/api/mcp";

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

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
        email: `oauth-${userId}@example.com`,
        password_hash: "x",
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "OAuth test",
        schema_name: getSchemaName(companyId),
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: userId, role: "owner" })
      .execute();
    await db
      .insertInto("oauth_clients")
      .values({
        client_id: CLIENT_ID,
        client_name: "ChatGPT",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        metadata: JSON.stringify({ client_id: CLIENT_ID }),
        cache_expires_at: new Date(Date.now() + 3_600_000),
      })
      .onConflict((oc) => oc.column("client_id").doNothing())
      .execute();

    await run({ userId, companyId });
  } finally {
    await db.deleteFrom("api_tokens").where("user_id", "=", userId).execute();
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

async function issueCode(
  userId: string,
  companyId: string,
  challenge: string,
): Promise<string> {
  return createAuthorizationCode({
    clientId: CLIENT_ID,
    userId,
    companyId,
    scopes: ["read", "write"],
    redirectUri: REDIRECT_URI,
    codeChallenge: challenge,
    resource: RESOURCE,
  });
}

function exchange(code: string, verifier: string, overrides = {}) {
  return exchangeAuthorizationCode({
    code,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    codeVerifier: verifier,
    resource: RESOURCE,
    clientName: "ChatGPT",
    ...overrides,
  });
}

describe("authorization code exchange", () => {
  integrationTest(
    "issues a usable access token that the MCP auth path accepts",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const code = await issueCode(userId, companyId, challenge);
        const tokens = await exchange(code, verifier);

        expect(tokens.scopes).toEqual(["read", "write"]);
        expect(tokens.expiresInSeconds).toBe(3600);

        // The whole point of reusing api_tokens: the existing verification path
        // accepts an OAuth-issued token with no changes.
        const verified = await verifyApiToken(tokens.accessToken);
        expect(verified).not.toBeNull();
        expect(verified?.userId).toBe(userId);
        expect(verified?.companyId).toBe(companyId);
        expect(verified?.scopes).toEqual(["read", "write"]);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "refuses a code presented twice",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const code = await issueCode(userId, companyId, challenge);
        await exchange(code, verifier);

        await expect(exchange(code, verifier)).rejects.toThrow(/already used/);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "refuses a wrong PKCE verifier",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { challenge } = pkcePair();
        const other = pkcePair();
        const code = await issueCode(userId, companyId, challenge);

        await expect(exchange(code, other.verifier)).rejects.toThrow(
          /PKCE verification failed/,
        );
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "refuses a mismatched redirect_uri or resource",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const a = pkcePair();
        const codeA = await issueCode(userId, companyId, a.challenge);
        await expect(
          exchange(codeA, a.verifier, {
            redirectUri: "https://evil.example/cb",
          }),
        ).rejects.toThrow(/redirect_uri does not match/);

        const b = pkcePair();
        const codeB = await issueCode(userId, companyId, b.challenge);
        // RFC 8707: a token must not be obtainable for a different audience
        // than the one the user authorized.
        await expect(
          exchange(codeB, b.verifier, {
            resource: "https://other.example/api/mcp",
          }),
        ).rejects.toThrow(/resource does not match/);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "refuses a code belonging to another client",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const code = await issueCode(userId, companyId, challenge);
        await expect(
          exchange(code, verifier, {
            clientId: CLIENT_ID.replace("chatgpt", "claude"),
          }),
        ).rejects.toThrow(OAuthError);
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("refresh token rotation", () => {
  integrationTest(
    "rotates and invalidates the previous access token",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const first = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );

        const second = await refreshTokens({
          refreshToken: first.refreshToken,
          clientId: CLIENT_ID,
          resource: RESOURCE,
          clientName: "ChatGPT",
        });

        expect(second.accessToken).not.toBe(first.accessToken);
        expect(second.refreshToken).not.toBe(first.refreshToken);
        expect(await verifyApiToken(second.accessToken)).not.toBeNull();
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "reusing a spent refresh token burns the whole grant",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const first = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );
        const second = await refreshTokens({
          refreshToken: first.refreshToken,
          clientId: CLIENT_ID,
          resource: RESOURCE,
          clientName: "ChatGPT",
        });

        // Presenting the already-exchanged refresh token means it leaked: both
        // an attacker and the honest client hold one. Revoking only that token
        // would leave whichever party rotated last in possession of a live
        // chain, so the entire grant dies.
        await expect(
          refreshTokens({
            refreshToken: first.refreshToken,
            clientId: CLIENT_ID,
            resource: RESOURCE,
            clientName: "ChatGPT",
          }),
        ).rejects.toThrow(/already been used/);

        // The token minted by the honest rotation is dead too.
        expect(await verifyApiToken(second.accessToken)).toBeNull();

        const grant = await db
          .selectFrom("oauth_grants")
          .select(["revoked_at", "revoked_reason"])
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow();
        expect(grant.revoked_at).not.toBeNull();
        expect(grant.revoked_reason).toBe("refresh_token_reuse");
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "refuses to refresh against a revoked grant",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const tokens = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );
        const grant = await db
          .selectFrom("oauth_grants")
          .select("id")
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow();

        await revokeGrant(grant.id, "user_revoked");

        expect(await verifyApiToken(tokens.accessToken)).toBeNull();
        await expect(
          refreshTokens({
            refreshToken: tokens.refreshToken,
            clientId: CLIENT_ID,
            resource: RESOURCE,
            clientName: "ChatGPT",
          }),
        ).rejects.toThrow(/revoked/);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "refuses a refresh token presented by another client",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const tokens = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );
        await expect(
          refreshTokens({
            refreshToken: tokens.refreshToken,
            clientId: "https://claude.ai/oauth/claude-code-client-metadata",
            resource: RESOURCE,
            clientName: "Claude",
          }),
        ).rejects.toThrow(/another client/);
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("the MCP 401 challenge covers rejected tokens", () => {
  integrationTest(
    "an invalid token is challenged, not just a missing one",
    () =>
      withFixture(async () => {
        // Needs a database because the token is looked up before it is refused,
        // which is why this cannot live in the well-known unit test.
        const response = await app.request("/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer wti_definitely-not-valid",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toContain(
          "resource_metadata=",
        );
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("audience binding", () => {
  integrationTest(
    "a token records the resource its grant was authorized for",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const tokens = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );

        // The MCP endpoint compares this against its own canonical resource and
        // refuses a mismatch. Without the resource surfacing here there is
        // nothing to compare, so a token minted for another resource would be
        // accepted - the confused-deputy case RFC 8707 exists to prevent.
        const verified = await verifyApiToken(tokens.accessToken);
        expect(verified?.resource).toBe(RESOURCE);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "a personal token has no resource and stays unrestricted",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { token } = await createApiToken({
          userId,
          companyId,
          name: "personal",
          scopes: ["read"],
        });
        // Hand-made tokens are not audience-scoped: a person created this for
        // this server directly, so there is nothing to bind.
        const verified = await verifyApiToken(token);
        expect(verified?.resource).toBeNull();
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("connected apps", () => {
  integrationTest(
    "lists a grant and disconnects it",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const tokens = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );

        const listed = await listConnectedApps(companyId, { userId });
        expect(listed).toHaveLength(1);
        expect(listed[0].clientName).toBe("ChatGPT");
        expect(listed[0].scopes).toEqual(["read", "write"]);

        const revoked = await revokeConnectedApp({
          grantId: listed[0].grantId,
          companyId,
          requesterId: userId,
          isAdmin: false,
        });
        expect(revoked).toBe(true);

        // Disconnecting must kill the live token, not merely hide the entry.
        expect(await verifyApiToken(tokens.accessToken)).toBeNull();
        expect(await listConnectedApps(companyId, { userId })).toHaveLength(0);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "will not disconnect another member's grant",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        await exchange(await issueCode(userId, companyId, challenge), verifier);
        const listed = await listConnectedApps(companyId, { userId });

        const revoked = await revokeConnectedApp({
          grantId: listed[0].grantId,
          companyId,
          requesterId: crypto.randomUUID(),
          isAdmin: false,
        });
        expect(revoked).toBe(false);
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("the MCP endpoint enforces the audience", () => {
  async function callMcp(token: string) {
    return app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  }

  integrationTest(
    "refuses a token issued for a different resource",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        // RESOURCE here is https://app.example.com/api/mcp, which is not this
        // server's canonical resource under the test APP_URL.
        const tokens = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );

        const response = await callMcp(tokens.accessToken);
        expect(response.status).toBe(401);
        const body = (await response.json()) as { message: string };
        expect(body.message).toMatch(/not issued for this MCP server/);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "accepts a personal token, which carries no audience",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { token } = await createApiToken({
          userId,
          companyId,
          name: "personal",
          scopes: ["read"],
        });
        const response = await callMcp(token);
        // Anything but 401 means authentication passed; the request may still
        // fail further in for unrelated reasons, which is not what is asserted.
        expect(response.status).not.toBe(401);
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("revocation cannot be undone by a refresh", () => {
  integrationTest(
    "revoking the access-token row also stops its refresh token",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const tokens = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );

        // Anything that revokes token rows without knowing about grants -
        // membership removal, an admin sweep - must not be undone by the
        // connector simply refreshing.
        await db
          .updateTable("api_tokens")
          .set({ revoked_at: new Date() })
          .where("user_id", "=", userId)
          .execute();

        await expect(
          refreshTokens({
            refreshToken: tokens.refreshToken,
            clientId: CLIENT_ID,
            resource: RESOURCE,
            clientName: "ChatGPT",
          }),
        ).rejects.toThrow(/revoked/);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "OAuth tokens are not listed or deletable as personal tokens",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        await exchange(await issueCode(userId, companyId, challenge), verifier);

        // Showing them in the personal token list invites a user to "delete the
        // token" and be told it worked, while the connector mints a replacement
        // on its next refresh.
        const listed = await listApiTokens(companyId, { userId });
        expect(listed).toHaveLength(0);

        const row = await db
          .selectFrom("api_tokens")
          .select("id")
          .where("user_id", "=", userId)
          .executeTakeFirstOrThrow();
        const revoked = await revokeApiToken({
          tokenId: row.id,
          companyId,
          requesterId: userId,
          isAdmin: true,
        });
        expect(revoked).toBeNull();
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("the MCP 401 challenge covers rejected tokens", () => {
  integrationTest(
    "an invalid token is challenged, not just a missing one",
    () =>
      withFixture(async () => {
        // Needs a database because the token is looked up before it is refused,
        // which is why this cannot live in the well-known unit test.
        const response = await app.request("/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer wti_definitely-not-valid",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toContain(
          "resource_metadata=",
        );
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("membership removal is a hard boundary", () => {
  integrationTest(
    "a code approved before removal cannot be exchanged after it",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const code = await issueCode(userId, companyId, challenge);

        // The user is removed after approving but before the client redeems
        // the code. Without the membership check inside the exchange this mints
        // a fresh grant and a refresh chain that outlives the removal.
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .where("user_id", "=", userId)
          .execute();

        await expect(exchange(code, verifier)).rejects.toThrow(
          /membership is no longer active/,
        );

        // Nothing was created on the way to failing.
        const grants = await db
          .selectFrom("oauth_grants")
          .select("id")
          .where("user_id", "=", userId)
          .execute();
        expect(grants).toHaveLength(0);
        const tokens = await db
          .selectFrom("api_tokens")
          .select("id")
          .where("user_id", "=", userId)
          .execute();
        expect(tokens).toHaveLength(0);
      }),
    TEST_TIMEOUT_MS,
  );

  integrationTest(
    "a refresh cannot outlive the membership either",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const tokens = await exchange(
          await issueCode(userId, companyId, challenge),
          verifier,
        );

        // Delete the membership directly, bypassing removeMember's own grant
        // revocation, so this asserts the refresh path's own guard rather than
        // the caller's cleanup.
        await db
          .deleteFrom("company_members")
          .where("company_id", "=", companyId)
          .where("user_id", "=", userId)
          .execute();

        await expect(
          refreshTokens({
            refreshToken: tokens.refreshToken,
            clientId: CLIENT_ID,
            resource: RESOURCE,
            clientName: "ChatGPT",
          }),
        ).rejects.toThrow(/membership is no longer active/);
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("reinvitation does not revive a pre-removal code", () => {
  integrationTest(
    "an authorization code does not survive removal and reinvitation",
    () =>
      withFixture(async ({ userId, companyId }) => {
        const { verifier, challenge } = pkcePair();
        const code = await issueCode(userId, companyId, challenge);

        // The fixture creates an owner, and an owner cannot be removed.
        await db
          .updateTable("company_members")
          .set({ role: "member" })
          .where("company_id", "=", companyId)
          .where("user_id", "=", userId)
          .execute();

        // removeMember's own cleanup, not a direct delete: the point is that
        // the documented credential boundary covers codes as well as tokens.
        await removeMember(companyId, userId);

        // Reinvitation inside the code's five-minute TTL. Without invalidating
        // codes at removal the old one would now be redeemable, granting access
        // the user never re-consented to.
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: userId, role: "member" })
          .execute();

        await expect(exchange(code, verifier)).rejects.toThrow(
          /Unknown authorization code/,
        );
      }),
    TEST_TIMEOUT_MS,
  );
});

describe("a removal racing an exchange does not deadlock", () => {
  integrationTest(
    "concurrent removal and code exchange always settle",
    () =>
      withFixture(async ({ userId, companyId }) => {
        await db
          .updateTable("company_members")
          .set({ role: "member" })
          .where("company_id", "=", companyId)
          .where("user_id", "=", userId)
          .execute();

        // The two transactions touch the same rows: the exchange takes the
        // authorization code and then the membership, and removal has to take
        // them in that same order. Acquiring them in opposite orders is a
        // textbook deadlock, which Postgres resolves by killing one side with
        // 40P01 - a 500 to whichever caller lost. No single-threaded test
        // reaches this, which is why it survived the earlier reviews.
        const ROUNDS = 12;
        const deadlocks: string[] = [];

        for (let round = 0; round < ROUNDS; round++) {
          const { verifier, challenge } = pkcePair();
          const code = await issueCode(userId, companyId, challenge);

          const [exchanged, removed] = await Promise.allSettled([
            exchange(code, verifier),
            removeMember(companyId, userId),
          ]);

          for (const outcome of [exchanged, removed]) {
            if (outcome.status === "rejected") {
              const message = String(outcome.reason);
              // 40P01 is Postgres' deadlock_detected.
              if (/40P01|deadlock/i.test(message)) deadlocks.push(message);
            }
          }

          // Whichever side won, the outcome has to be coherent: an exchange
          // that succeeded must not leave a usable token behind a completed
          // removal.
          if (
            exchanged.status === "fulfilled" &&
            removed.status === "fulfilled"
          ) {
            expect(
              await verifyApiToken(exchanged.value.accessToken),
            ).toBeNull();
          }

          // Put the membership back for the next round.
          await db
            .insertInto("company_members")
            .values({ company_id: companyId, user_id: userId, role: "member" })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }

        expect(deadlocks).toEqual([]);
      }),
    TEST_TIMEOUT_MS,
  );
});
