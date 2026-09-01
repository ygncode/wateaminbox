import { describe, expect, test } from "bun:test";
import { resolveOAuthClient } from "./oauth-client.service.js";

/**
 * A real network fetch of a client metadata document.
 *
 * Every other test in this area exercises the rejection paths - private
 * addresses, bad documents, mismatched identity - so nothing ever performed a
 * successful fetch. That gap shipped a change that made client resolution fail
 * for every client: pinning the address through the request's `lookup` option
 * is correct on Node and unusable on Bun, where the documented array form does
 * not connect and the single-address form crashes inside Bun itself. The unit
 * tests all still passed, because refusing to fetch looks the same as refusing
 * a private address.
 *
 * This talks to chatgpt.com, which is the client the feature exists to serve,
 * so it is gated rather than run by default: a test that fails when the network
 * is unavailable is worse than no test in a normal suite. Enable it with
 * RUN_NETWORK_TESTS=1 - and it is worth running before releasing a change to
 * this file.
 */
const networkTest = process.env.RUN_NETWORK_TESTS === "1" ? test : test.skip;

const TIMEOUT_MS = 30_000;

describe("client metadata fetch over the network", () => {
  networkTest(
    "resolves ChatGPT's client metadata document",
    async () => {
      const client = await resolveOAuthClient(
        "https://chatgpt.com/oauth/client.json",
      );

      expect(client.clientId).toBe("https://chatgpt.com/oauth/client.json");
      expect(client.clientName).toBe("ChatGPT");
      // The redirect URI ChatGPT actually sends users back to. If this stops
      // matching, authorization requests from ChatGPT get rejected.
      expect(client.redirectUris).toContain(
        "https://chatgpt.com/connector_platform_oauth_redirect",
      );
    },
    TIMEOUT_MS,
  );

  networkTest(
    "still refuses a host that resolves privately",
    async () => {
      // localhost resolves to loopback, so the address check has to reject it
      // even though the fetch itself would succeed. Proves pinning did not get
      // loosened while making it work.
      await expect(
        resolveOAuthClient("https://localhost/client.json"),
      ).rejects.toThrow(/private address/);
    },
    TIMEOUT_MS,
  );
});
