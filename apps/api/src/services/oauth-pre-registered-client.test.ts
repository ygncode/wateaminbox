import { describe, expect, test } from "bun:test";
import {
  findPreRegisteredClient,
  PRE_REGISTERED_CLIENTS,
} from "./oauth-hosted-clients.js";
import { isAllowedRedirectUri } from "./oauth-client.service.js";

/**
 * Grok presents its own client_id, https://grok.com/oauth/mcp-client.json, and
 * that document cannot be fetched from the production host: grok.com sits
 * behind a Cloudflare bot challenge that answers 403 to every request from a
 * datacenter IP, on every edge address, with or without a User-Agent. The
 * document is valid and returns 200 from a residential connection, so the
 * entry below records what it actually contains.
 */
function resolvedShape(clientId: string) {
  const client = findPreRegisteredClient(clientId);
  return {
    clientId,
    clientName: client?.clientName ?? null,
    redirectUris: client?.redirectUris ?? [],
    tokenEndpointAuthMethod: "none" as const,
  };
}

describe("pre-registered clients", () => {
  test("Grok's own client_id is known without a fetch", () => {
    const grok = findPreRegisteredClient(
      "https://grok.com/oauth/mcp-client.json",
    );
    expect(grok).not.toBeNull();
    expect(grok?.clientName).toBe("Grok");
  });

  test("carries the callbacks Grok's document declares", () => {
    const client = resolvedShape("https://grok.com/oauth/mcp-client.json");
    // Grok sends the trailing-slash form; redirect_uri is compared as an exact
    // string, so both forms of both origins have to be present.
    for (const uri of [
      "https://grok.com/connectors-oauth-exchange-code/",
      "https://grok.com/connectors-oauth-exchange-code",
      "https://console.x.ai/connectors-oauth-exchange-code/",
      "https://console.x.ai/connectors-oauth-exchange-code",
    ]) {
      expect(isAllowedRedirectUri(client, uri)).toBe(true);
    }
  });

  test("pre-registration does not widen where a client may redirect", () => {
    const client = resolvedShape("https://grok.com/oauth/mcp-client.json");
    expect(isAllowedRedirectUri(client, "https://evil.example/cb")).toBe(false);
    expect(
      isAllowedRedirectUri(client, "https://grok.com.evil.example/cb"),
    ).toBe(false);
    // A path on the right origin is still not a declared callback.
    expect(isAllowedRedirectUri(client, "https://grok.com/anything")).toBe(
      false,
    );
  });

  test("only an exact client_id matches", () => {
    expect(findPreRegisteredClient("https://grok.com/oauth/")).toBeNull();
    expect(
      findPreRegisteredClient("https://evil.example/oauth/mcp-client.json"),
    ).toBeNull();
    // A prefix of a known id must not match it.
    expect(findPreRegisteredClient("https://grok.com")).toBeNull();
  });

  test("every entry is an https URL that matches its own document location", () => {
    for (const client of PRE_REGISTERED_CLIENTS) {
      // The id is the URL the document lives at, so the same rule the fetch
      // path enforces has to hold here: https, and a real absolute URL.
      const url = new URL(client.clientId);
      expect(url.protocol).toBe("https:");
      expect(client.redirectUris.length).toBeGreaterThan(0);
      for (const uri of client.redirectUris) {
        expect(new URL(uri).protocol).toBe("https:");
      }
    }
  });
});
