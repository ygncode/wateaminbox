import { afterEach, describe, expect, test } from "bun:test";
import {
  attemptTokenRefresh,
  clearAuthTokens,
  fetchWithAuth,
  getAccessToken,
  setAuthToken,
  setCompanyId,
} from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearAuthTokens();
});

function refreshSucceeds(accessToken = "access-1"): void {
  globalThis.fetch = (async () =>
    Response.json({ tokens: { accessToken } })) as unknown as typeof fetch;
}

function refreshFailsWith(status: number): void {
  globalThis.fetch = (async () =>
    Response.json(
      { code: "SESSION_EXPIRED" },
      { status },
    )) as unknown as typeof fetch;
}

function refreshThrows(): void {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
}

describe("attemptTokenRefresh outcomes", () => {
  test("reports a refreshed session", async () => {
    refreshSucceeds("access-2");
    setAuthToken("expired");

    expect(await attemptTokenRefresh()).toBe("refreshed");
    expect(getAccessToken()).toBe("access-2");
  });

  test("reports rejection and clears local state when the API refuses", async () => {
    refreshFailsWith(401);
    setAuthToken("expired");
    setCompanyId("company-1");

    expect(await attemptTokenRefresh()).toBe("rejected");
    expect(getAccessToken()).toBeNull();
  });

  test("keeps the session when the request never reaches the API", async () => {
    // The deployment case: the container holding the session is being replaced
    // and the connection is refused outright. Nothing about the refresh cookie
    // has changed, so discarding local auth state here is what used to sign
    // every user out mid-deploy.
    refreshThrows();
    setAuthToken("expired");

    expect(await attemptTokenRefresh()).toBe("unavailable");
    expect(getAccessToken()).toBe("expired");
  });

  test("keeps the session when the API answers with a server error", async () => {
    refreshFailsWith(502);
    setAuthToken("expired");

    expect(await attemptTokenRefresh()).toBe("unavailable");
    expect(getAccessToken()).toBe("expired");
  });

  test("retries a transient failure before giving up", async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("Failed to fetch");
      return Response.json({ tokens: { accessToken: "access-3" } });
    }) as unknown as typeof fetch;

    setAuthToken("expired");

    expect(await attemptTokenRefresh()).toBe("refreshed");
    expect(attempts).toBe(3);
    expect(getAccessToken()).toBe("access-3");
  });

  test("coalesces concurrent attempts so the cookie is rotated once", async () => {
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ tokens: { accessToken: "access-4" } });
    }) as unknown as typeof fetch;

    const [first, second] = await Promise.all([
      attemptTokenRefresh(),
      attemptTokenRefresh(),
    ]);

    expect([first, second]).toEqual(["refreshed", "refreshed"]);
    expect(attempts).toBe(1);
  });
});

describe("fetchWithAuth refresh handling", () => {
  test("retries the request once the session is refreshed", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/auth/refresh")) {
        return Response.json({ tokens: { accessToken: "access-5" } });
      }
      if (calls.filter((c) => c.endsWith("/threads")).length === 1) {
        return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
      }
      return Response.json({ data: { id: "thread-1" } });
    }) as unknown as typeof fetch;

    expect(await fetchWithAuth<{ id: string }>("/threads")).toEqual({
      id: "thread-1",
    });
    expect(calls.filter((c) => c.endsWith("/threads"))).toHaveLength(2);
  });

  test("reports an outage instead of a failed sign-in", async () => {
    // Callers distinguish 401 from a transient failure. Surfacing the original
    // 401 here would tell them the session is gone when it is not.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/refresh")) {
        throw new TypeError("Failed to fetch");
      }
      return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
    }) as unknown as typeof fetch;

    setAuthToken("expired");

    const error = await fetchWithAuth("/threads").catch((e: unknown) => e);

    expect(error).toMatchObject({
      statusCode: 503,
      code: "SESSION_REFRESH_UNAVAILABLE",
    });
    expect(getAccessToken()).toBe("expired");
  });
});

describe("payment-required redirect", () => {
  test("bills the workspace the request was sent for", async () => {
    // Switching workspaces can change the active workspace while a request is
    // in flight. Its 402 belongs to the workspace in its X-Company-ID header.
    const replaced: string[] = [];
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalBillingUrl = process.env.VITE_BILLING_URL;
    (globalThis as { window?: unknown }).window = {
      location: {
        origin: "https://app.example.com",
        replace: (url: string) => replaced.push(url),
      },
    };
    process.env.VITE_BILLING_URL = "/billing";

    let respond: (response: Response) => void = () => undefined;
    let sentCompanyId = null as string | null;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      sentCompanyId = (init?.headers as Record<string, string>)["X-Company-ID"];
      return new Promise<Response>((resolve) => {
        respond = resolve;
      });
    }) as unknown as typeof fetch;

    try {
      setCompanyId("new-workspace");
      const request = fetchWithAuth("/companies");
      setCompanyId("previous-workspace");
      respond(
        Response.json({ error: "SUBSCRIPTION_RESTRICTED" }, { status: 402 }),
      );

      await expect(request).rejects.toThrow();
      expect(sentCompanyId).toBe("new-workspace");
      expect(replaced).toEqual([
        "/billing?companyId=new-workspace&mode=onboarding",
      ]);
    } finally {
      (globalThis as { window?: unknown }).window = originalWindow;
      if (originalBillingUrl === undefined) delete process.env.VITE_BILLING_URL;
      else process.env.VITE_BILLING_URL = originalBillingUrl;
    }
  });
});
