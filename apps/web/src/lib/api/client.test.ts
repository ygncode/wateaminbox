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
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalBillingUrl = process.env.VITE_BILLING_URL;
  let replaced: string[] = [];
  let respond: (response: Response) => void = () => undefined;
  let sentCompanyId = null as string | null;

  function stubBrowser(pathname: string): void {
    replaced = [];
    (globalThis as { window?: unknown }).window = {
      location: {
        origin: "https://app.example.com",
        pathname,
        replace: (url: string) => replaced.push(url),
      },
    };
    process.env.VITE_BILLING_URL = "/billing";
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      sentCompanyId = (init?.headers as Record<string, string>)["X-Company-ID"];
      return new Promise<Response>((resolve) => {
        respond = resolve;
      });
    }) as unknown as typeof fetch;
  }

  async function answerWith402(request: Promise<unknown>): Promise<void> {
    respond(
      Response.json({ error: "SUBSCRIPTION_RESTRICTED" }, { status: 402 }),
    );
    await expect(request).rejects.toThrow();
  }

  afterEach(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    if (originalBillingUrl === undefined) delete process.env.VITE_BILLING_URL;
    else process.env.VITE_BILLING_URL = originalBillingUrl;
  });

  test("bills the workspace the request was sent for", async () => {
    stubBrowser("/w/new-workspace/chat");
    setCompanyId("new-workspace");
    await answerWith402(fetchWithAuth("/companies"));

    expect(sentCompanyId).toBe("new-workspace");
    expect(replaced).toEqual([
      "/billing?companyId=new-workspace&mode=onboarding",
    ]);
  });

  test("ignores a 402 for a workspace the user has left", async () => {
    // Switching away from a workspace that needs payment must not be undone by
    // a request that was still in flight for it.
    stubBrowser("/w/paid-workspace/chat");
    setCompanyId("unpaid-workspace");
    const request = fetchWithAuth("/notifications/count");
    setCompanyId("paid-workspace");
    await answerWith402(request);

    expect(sentCompanyId).toBe("unpaid-workspace");
    expect(replaced).toEqual([]);
  });

  test("never redirects away from the workspace chooser", async () => {
    // The chooser is how a user leaves a workspace that needs payment.
    stubBrowser("/workspaces");
    setCompanyId("unpaid-workspace");
    await answerWith402(fetchWithAuth("/notifications/count"));

    expect(replaced).toEqual([]);
  });
});
