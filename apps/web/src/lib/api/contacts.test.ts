import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearAuthTokens, setAuthToken, setCompanyId } from "./client";
import { downloadImportTemplate } from "./contacts";

const originalFetch = globalThis.fetch;
const originalDocument = (globalThis as { document?: unknown }).document;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

interface StubAnchor {
  href: string;
  download: string;
  clicked: number;
  removed: number;
  click: () => void;
  remove: () => void;
}

let anchors: StubAnchor[] = [];
let revokedUrls: string[] = [];

/** Minimal DOM stand-in: web unit tests run in Bun without a DOM. */
function installDomStub() {
  anchors = [];
  revokedUrls = [];

  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const anchor: StubAnchor = {
        href: "",
        download: "",
        clicked: 0,
        removed: 0,
        click() {
          anchor.clicked += 1;
        },
        remove() {
          anchor.removed += 1;
        },
      };
      anchors.push(anchor);
      return anchor;
    },
    body: {
      appendChild: () => undefined,
      removeChild: () => undefined,
    },
  };

  URL.createObjectURL = (() =>
    "blob:contact-template") as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revokedUrls.push(url);
  }) as typeof URL.revokeObjectURL;
}

beforeEach(() => {
  installDomStub();
  setAuthToken("access-token-1");
  setCompanyId("company-1");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { document?: unknown }).document = originalDocument;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  clearAuthTokens();
});

describe("CSV import template download", () => {
  test("sends the authenticated request the template endpoint requires", async () => {
    let requestedUrl = "";
    let requestHeaders: Record<string, string> = {};

    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      requestHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response("phone_number,name,notes,tags\n", {
        headers: { "Content-Type": "text/csv" },
      });
    }) as typeof fetch;

    await downloadImportTemplate();

    expect(requestedUrl).toContain("/contacts/import/template");
    // The regression: a bare navigation carried no credentials and the auth
    // middleware answered with Unauthorized JSON instead of the CSV.
    expect(requestHeaders.Authorization).toBe("Bearer access-token-1");
    expect(requestHeaders["X-Company-ID"]).toBe("company-1");
  });

  test("hands the CSV to the browser as a named download", async () => {
    globalThis.fetch = (async (_input, _init) =>
      new Response("phone_number,name,notes,tags\n", {
        headers: { "Content-Type": "text/csv" },
      })) as typeof fetch;

    await downloadImportTemplate();

    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("contact-import-template.csv");
    expect(anchors[0].href).toBe("blob:contact-template");
    expect(anchors[0].clicked).toBe(1);
    expect(revokedUrls).toEqual(["blob:contact-template"]);
  });

  test("retries once with a refreshed token when the access token expired", async () => {
    const sentTokens: (string | undefined)[] = [];

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        return Response.json({ tokens: { accessToken: "access-token-2" } });
      }
      sentTokens.push((init?.headers as Record<string, string>)?.Authorization);
      if (sentTokens.length === 1) {
        return Response.json(
          { error: "Unauthorized", message: "Token expired" },
          { status: 401 },
        );
      }
      return new Response("phone_number,name,notes,tags\n", {
        headers: { "Content-Type": "text/csv" },
      });
    }) as typeof fetch;

    await downloadImportTemplate();

    expect(sentTokens).toEqual([
      "Bearer access-token-1",
      "Bearer access-token-2",
    ]);
    expect(anchors).toHaveLength(1);
  });

  test("surfaces the error instead of downloading an error page", async () => {
    globalThis.fetch = (async (input) => {
      if (String(input).endsWith("/auth/refresh")) {
        return new Response(null, { status: 401 });
      }
      return Response.json(
        {
          error: "Unauthorized",
          message: "Missing or invalid Authorization header",
        },
        { status: 401 },
      );
    }) as typeof fetch;

    await expect(downloadImportTemplate()).rejects.toThrow(
      "Missing or invalid Authorization header",
    );
    expect(anchors).toHaveLength(0);
  });
});
