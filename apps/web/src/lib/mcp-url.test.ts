import { describe, expect, test } from "bun:test";
import { resolveMcpEndpointUrl } from "./mcp-url";

describe("resolveMcpEndpointUrl", () => {
  test("resolves the production-relative API base against the app origin", () => {
    expect(resolveMcpEndpointUrl("/api", "https://app.wateaminbox.com")).toBe(
      "https://app.wateaminbox.com/api/mcp",
    );
  });

  test("preserves an absolute API origin and removes a trailing slash", () => {
    expect(
      resolveMcpEndpointUrl(
        "https://api.example.com/api/",
        "https://app.example.com",
      ),
    ).toBe("https://api.example.com/api/mcp");
  });
});
