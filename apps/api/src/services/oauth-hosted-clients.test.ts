import { describe, expect, test } from "bun:test";
import { app } from "../app.js";
import {
  findHostedClient,
  HOSTED_CLIENTS,
  hostedClientId,
} from "./oauth-hosted-clients.js";
import { isAllowedRedirectUri } from "./oauth-client.service.js";

const ISSUER = "https://app.example.com";

describe("hosted client registry", () => {
  test("Grok's exact callback is declared, trailing slash included", () => {
    const grok = HOSTED_CLIENTS.find((client) => client.slug === "grok");
    expect(grok).toBeDefined();
    // Observed in production logs. OAuth compares redirect_uri as an exact
    // string, and Grok sends the trailing-slash form, so that one must be
    // present or every authorization is rejected.
    expect(grok?.redirectUris).toContain(
      "https://grok.com/connectors-oauth-exchange-code/",
    );
  });

  test("both slash forms match, since only one of them arrives", () => {
    const grok = HOSTED_CLIENTS.find((client) => client.slug === "grok");
    const client = {
      clientId: hostedClientId(ISSUER, "grok"),
      clientName: grok?.clientName ?? null,
      redirectUris: grok?.redirectUris ?? [],
      tokenEndpointAuthMethod: "none",
    };
    expect(
      isAllowedRedirectUri(
        client,
        "https://grok.com/connectors-oauth-exchange-code/",
      ),
    ).toBe(true);
    expect(
      isAllowedRedirectUri(
        client,
        "https://grok.com/connectors-oauth-exchange-code",
      ),
    ).toBe(true);
  });

  test("hosting a client does not widen where it may redirect", () => {
    const grok = HOSTED_CLIENTS.find((client) => client.slug === "grok");
    const client = {
      clientId: hostedClientId(ISSUER, "grok"),
      clientName: grok?.clientName ?? null,
      redirectUris: grok?.redirectUris ?? [],
      tokenEndpointAuthMethod: "none",
    };
    // The id is public and pasteable, so it is worth stating that possessing it
    // buys nothing beyond redirecting to the vendor it names.
    expect(isAllowedRedirectUri(client, "https://evil.example/cb")).toBe(false);
    expect(
      isAllowedRedirectUri(client, "https://grok.com.evil.example/cb"),
    ).toBe(false);
  });

  test("only an exact id matches, not a lookalike", () => {
    expect(
      findHostedClient(ISSUER, hostedClientId(ISSUER, "grok")),
    ).not.toBeNull();
    expect(findHostedClient(ISSUER, "grok")).toBeNull();
    expect(
      findHostedClient(
        ISSUER,
        "https://evil.example/api/oauth/clients/grok.json",
      ),
    ).toBeNull();
  });
});

describe("hosted client document", () => {
  test("is served as JSON and declares its own id", async () => {
    const response = await app.request("/api/oauth/clients/grok.json");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    // A CIMD document must claim the URL it was fetched from, which is the
    // rule resolveOAuthClient enforces on documents from anyone else.
    expect(String(body.client_id)).toMatch(
      /\/api\/oauth\/clients\/grok\.json$/,
    );
    expect(body.client_name).toBe("Grok");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.redirect_uris).toContain(
      "https://grok.com/connectors-oauth-exchange-code/",
    );
  });

  test("an unknown slug is a 404, not an invented client", async () => {
    const response = await app.request("/api/oauth/clients/anything.json");
    expect(response.status).toBe(404);
  });
});
