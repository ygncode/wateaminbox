import { createHash, randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  OAuthError,
  refreshTokens,
  revokeGrant,
} from "./oauth.service.js";
import { verifyApiToken } from "./api-token.service.js";
import { getSchemaName } from "./tenant.service.js";

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
