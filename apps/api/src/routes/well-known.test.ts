import { describe, expect, test } from "bun:test";
import { app } from "../app.js";

async function json(path: string) {
  const response = await app.request(path);
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe("authorization server metadata", () => {
  test("is served as JSON, not the SPA shell", async () => {
    const { response, body } = await json(
      "/.well-known/oauth-authorization-server",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(typeof body.issuer).toBe("string");
  });

  test("advertises both fields CIMD selection depends on", async () => {
    const { body } = await json("/.well-known/oauth-authorization-server");
    // Claude checks for both and silently falls back to Dynamic Client
    // Registration if either is missing. This server does not implement DCR, so
    // a missing field is a failed connection rather than a slower one.
    expect(body.client_id_metadata_document_supported).toBe(true);
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  test("advertises S256, which clients treat as mandatory", async () => {
    const { body } = await json("/.well-known/oauth-authorization-server");
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
  });

  test("advertises offline_access so a refresh token is requested", async () => {
    const { body } = await json("/.well-known/oauth-authorization-server");
    expect(body.scopes_supported).toContain("offline_access");
  });

  test("declares the iss authorization response parameter", async () => {
    const { body } = await json("/.well-known/oauth-authorization-server");
    expect(body.authorization_response_iss_parameter_supported).toBe(true);
  });

  test("endpoints sit under the issuer", async () => {
    const { body } = await json("/.well-known/oauth-authorization-server");
    const issuer = body.issuer as string;
    expect(body.authorization_endpoint).toBe(`${issuer}/api/oauth/authorize`);
    expect(body.token_endpoint).toBe(`${issuer}/api/oauth/token`);
  });
});

describe("protected resource metadata", () => {
  test("is served at the root location", async () => {
    const { response, body } = await json(
      "/.well-known/oauth-protected-resource",
    );
    expect(response.status).toBe(200);
    expect(typeof body.resource).toBe("string");
    expect(Array.isArray(body.authorization_servers)).toBe(true);
  });

  test("is served at the path-inserted location too", async () => {
    // RFC 9728 defines both and clients probe the path-inserted form first,
    // built from the resource's path - /api/mcp here.
    const { response, body } = await json(
      "/.well-known/oauth-protected-resource/api/mcp",
    );
    expect(response.status).toBe(200);
    expect(body.resource).toBe(
      (await json("/.well-known/oauth-protected-resource")).body
        .resource as string,
    );
  });

  test("names the MCP endpoint as the resource", async () => {
    const { body } = await json("/.well-known/oauth-protected-resource");
    expect(body.resource as string).toMatch(/\/api\/mcp$/);
  });

  test("lists exactly one authorization server", async () => {
    const { body } = await json("/.well-known/oauth-protected-resource");
    // Claude uses only the first entry with no fallback, so more than one would
    // be a silent trap rather than redundancy.
    expect((body.authorization_servers as string[]).length).toBe(1);
  });
});

describe("MCP 401 challenge", () => {
  // Only the no-token case belongs here: it is answered before any database
  // lookup. Verifying a malformed token needs Postgres, so that assertion
  // lives with the integration tests - as a unit test it returns 500 wherever
  // the database is absent, which is every CI unit job.
  test("points an unauthenticated caller at the resource metadata", async () => {
    const response = await app.request("/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);

    // Without this header a client cannot discover the authorization server and
    // just reports a failed connection.
    const challenge = response.headers.get("WWW-Authenticate");
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain('resource_metadata="');
    expect(challenge).toContain("/.well-known/oauth-protected-resource");
  });
});
