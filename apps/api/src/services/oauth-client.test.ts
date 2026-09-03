import { describe, expect, test } from "bun:test";
import {
  isAllowedRedirectUri,
  OAuthClientError,
  resolveOAuthClient,
  type ResolvedOAuthClient,
} from "./oauth-client.service.js";
import { parseScopes, OAuthError } from "./oauth.service.js";

function client(redirectUris: string[]): ResolvedOAuthClient {
  return {
    clientId: "https://chatgpt.com/oauth/client.json",
    clientName: "Test",
    redirectUris,
    tokenEndpointAuthMethod: "none",
  };
}

describe("client_id fetch guard", () => {
  // resolveOAuthClient fetches a URL the caller chose, so the address checks
  // are the difference between a metadata fetch and an SSRF primitive. IP
  // literals are used so these assertions never depend on DNS.
  const blocked = [
    "https://127.0.0.1/client.json",
    "https://10.0.0.5/client.json",
    "https://192.168.1.1/client.json",
    "https://172.16.0.1/client.json",
    // The cloud metadata endpoint, the classic SSRF target.
    "https://169.254.169.254/client.json",
    "https://[::1]/client.json",
    "https://[fd00::1]/client.json",
    // IPv4-mapped IPv6 must not smuggle loopback past the check.
    "https://[::ffff:127.0.0.1]/client.json",
  ];

  for (const url of blocked) {
    test(`refuses ${url}`, async () => {
      await expect(resolveOAuthClient(url)).rejects.toThrow(/private address/);
    });
  }

  test("refuses a non-https client_id", async () => {
    await expect(
      resolveOAuthClient("http://example.com/client.json"),
    ).rejects.toThrow(/https/);
  });

  test("refuses a client_id carrying a fragment", async () => {
    await expect(
      resolveOAuthClient("https://example.com/client.json#x"),
    ).rejects.toThrow(/fragment/);
  });

  test("refuses something that is not a URL", async () => {
    await expect(resolveOAuthClient("not-a-url")).rejects.toBeInstanceOf(
      OAuthClientError,
    );
  });
});

describe("redirect URI matching", () => {
  test("accepts an exact match", () => {
    const c = client(["https://claude.ai/api/mcp/auth_callback"]);
    expect(
      isAllowedRedirectUri(c, "https://claude.ai/api/mcp/auth_callback"),
    ).toBe(true);
  });

  test("rejects a different host", () => {
    const c = client(["https://claude.ai/api/mcp/auth_callback"]);
    expect(
      isAllowedRedirectUri(c, "https://evil.example/api/mcp/auth_callback"),
    ).toBe(false);
  });

  test("rejects a different path", () => {
    const c = client(["https://claude.ai/api/mcp/auth_callback"]);
    expect(isAllowedRedirectUri(c, "https://claude.ai/steal")).toBe(false);
  });

  test("ignores the port on loopback, which native clients require", () => {
    // RFC 8252: Claude Code declares localhost and 127.0.0.1 without a port and
    // then listens on an ephemeral one, so the port cannot be compared.
    const c = client([
      "http://localhost/callback",
      "http://127.0.0.1/callback",
    ]);
    expect(isAllowedRedirectUri(c, "http://localhost:53682/callback")).toBe(
      true,
    );
    expect(isAllowedRedirectUri(c, "http://127.0.0.1:49111/callback")).toBe(
      true,
    );
  });

  test("does not relax anything else for loopback", () => {
    const c = client(["http://localhost/callback"]);
    // Path still has to match.
    expect(isAllowedRedirectUri(c, "http://localhost:53682/other")).toBe(false);
    // Scheme still has to match.
    expect(isAllowedRedirectUri(c, "https://localhost:53682/callback")).toBe(
      false,
    );
    // A non-loopback host must never inherit the port exemption.
    expect(isAllowedRedirectUri(c, "http://evil.example:53682/callback")).toBe(
      false,
    );
  });

  test("rejects a redirect URI with a fragment", () => {
    const c = client(["https://claude.ai/cb"]);
    expect(isAllowedRedirectUri(c, "https://claude.ai/cb#x")).toBe(false);
  });
});

describe("scope parsing", () => {
  test("read is always granted", () => {
    expect(parseScopes(undefined)).toEqual(["read"]);
    expect(parseScopes("")).toEqual(["read"]);
  });

  test("write implies read", () => {
    expect(parseScopes("write")).toEqual(["read", "write"]);
    expect(parseScopes("read write")).toEqual(["read", "write"]);
  });

  test("offline_access is accepted and dropped", () => {
    // Claude appends offline_access whenever the AS advertises it. It asks for
    // a refresh token rather than an access right, and api_tokens.scopes only
    // accepts read/write.
    expect(parseScopes("read offline_access")).toEqual(["read"]);
    expect(parseScopes("read write offline_access")).toEqual(["read", "write"]);
  });

  test("an unknown scope is rejected rather than silently ignored", () => {
    expect(() => parseScopes("read admin")).toThrow(OAuthError);
    expect(() => parseScopes("read admin")).toThrow(/Unknown scope: admin/);
  });
});

describe("loopback matching does not relax the hostname", () => {
  test("localhost and 127.0.0.1 are not interchangeable", () => {
    // A client that declared only localhost must not have a 127.0.0.1 callback
    // honoured, and vice versa: that is a redirect it never registered.
    const localhostOnly = client(["http://localhost/callback"]);
    expect(
      isAllowedRedirectUri(localhostOnly, "http://127.0.0.1:53682/callback"),
    ).toBe(false);

    const literalOnly = client(["http://127.0.0.1/callback"]);
    expect(
      isAllowedRedirectUri(literalOnly, "http://localhost:53682/callback"),
    ).toBe(false);
  });

  test("each declared loopback host still accepts any port", () => {
    // Claude Code declares both, which is why the real client keeps working.
    const both = client([
      "http://localhost/callback",
      "http://127.0.0.1/callback",
    ]);
    expect(isAllowedRedirectUri(both, "http://localhost:53682/callback")).toBe(
      true,
    );
    expect(isAllowedRedirectUri(both, "http://127.0.0.1:49111/callback")).toBe(
      true,
    );
  });

  test("a non-loopback host never gets the port exemption", () => {
    const c = client(["https://claude.ai/cb"]);
    expect(isAllowedRedirectUri(c, "https://claude.ai:8443/cb")).toBe(false);
  });
});
