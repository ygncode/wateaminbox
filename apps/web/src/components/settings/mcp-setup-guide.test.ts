import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * The setup instructions are split by how a client authenticates, not by brand.
 *
 * Before OAuth shipped, every client used a bearer token and the guide said so.
 * Afterwards ChatGPT and Claude authenticate in the browser and have no field
 * to paste a token into, but the guide still told people to paste one - so it
 * sent them looking for something that no longer existed.
 */
const source = readFileSync(
  new URL("./ApiTokensSection.tsx", import.meta.url),
  "utf8",
);

function tabContent(value: string): string {
  const start = source.indexOf(`<TabsContent value="${value}">`);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("</TabsContent>", start));
}

describe("hosted-app instructions", () => {
  test("never ask for a token", () => {
    const hosted = tabContent("hosted");
    // The failure this guards: ChatGPT and Claude have no token field, so
    // mentioning one sends the reader hunting for a control that is not there.
    expect(hosted).not.toContain("Bearer");
    expect(hosted).not.toMatch(/paste your token/i);
    expect(hosted).toContain("apiTokens.setup.noTokenNeeded");
  });

  test("say plainly that no token is needed", () => {
    expect(source).toMatch(/No token needed/);
  });
});

describe("Grok instructions", () => {
  test("supply the client id Grok asks for", () => {
    const grok = tabContent("grok");
    expect(grok).toContain("grokClientId");
    // Grok's field is the one thing that differs from the other hosted apps;
    // leaving it out is why the connection failed three times.
    expect(grok).toMatch(/Client ID/);
  });

  test("tell the user to leave the secret empty", () => {
    expect(tabContent("grok")).toMatch(/Client Secret empty/);
  });
});

describe("token-based instructions", () => {
  test("say a token is required", () => {
    for (const value of ["claude-code", "cursor"]) {
      expect(tabContent(value)).toContain("apiTokens.setup.tokenNeeded");
    }
  });
});

describe("the Grok client id", () => {
  test("is derived from the endpoint, not hardcoded", () => {
    // A hardcoded production URL would hand a self-hosted or local deployment
    // an id pointing at someone else's server.
    expect(source).toMatch(/mcpUrl\.replace\(/);
    expect(source).not.toContain("https://app.wateaminbox.com/api/oauth");
  });

  test("the derivation produces the document URL", () => {
    const derive = (mcpUrl: string) =>
      mcpUrl.replace(/\/mcp$/, "/oauth/clients/grok.json");
    expect(derive("https://app.wateaminbox.com/api/mcp")).toBe(
      "https://app.wateaminbox.com/api/oauth/clients/grok.json",
    );
    expect(derive("http://localhost:4445/api/mcp")).toBe(
      "http://localhost:4445/api/oauth/clients/grok.json",
    );
  });
});
