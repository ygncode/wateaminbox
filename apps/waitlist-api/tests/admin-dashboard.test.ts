import { describe, expect, test } from "bun:test";
import { app } from "../src/app";
import { hmacSha256 } from "../src/lib/crypto";
import {
  getAdminSubscriberPage,
  parseAdminSubscriberQuery,
} from "../src/services/admin";
import type { Env } from "../src/types";

interface CapturedQuery {
  sql: string;
  values: unknown[];
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ADMIN_PASSWORD_HASH: "test-password-hash",
    ADMIN_SESSION_SECRET:
      "test-admin-secret-that-is-longer-than-thirty-two-characters",
    ALLOWED_ORIGINS: "http://localhost:4446",
    DB: {} as Env["DB"],
    EMAIL: {} as Env["EMAIL"],
    ENVIRONMENT: "development",
    MARKETING_ORIGIN: "http://localhost:4446",
    PUBLIC_API_ORIGIN: "http://localhost:8787",
    TURNSTILE_SECRET_KEY: "",
    WAITLIST_FROM_EMAIL: "WATeamInbox <waitlist@example.test>",
    WAITLIST_TOKEN_SECRET:
      "test-waitlist-secret-that-is-longer-than-thirty-two-characters",
    ...overrides,
  };
}

function subscriberDatabase(
  rows: unknown[],
  total: number,
): { db: Env["DB"]; statements: CapturedQuery[] } {
  const statements: CapturedQuery[] = [];
  const db = {
    prepare(sql: string) {
      const captured: CapturedQuery = { sql, values: [] };
      statements.push(captured);
      return {
        bind(...values: unknown[]) {
          captured.values = values;
          return this;
        },
        first: async () => ({ count: total }),
        all: async () => ({ results: rows }),
      };
    },
  } as unknown as Env["DB"];

  return { db, statements };
}

function dashboardDatabase(expectedTokenHash: string): Env["DB"] {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...bound: unknown[]) {
          values = bound;
          return this;
        },
        first: async () => {
          if (sql.includes("waitlist_admin_sessions")) {
            return values[0] === expectedTokenHash
              ? {
                  expires_at: Date.now() + 1000 * 60 * 60,
                  id: "session-1",
                  ip_hash: "203.0.113.7",
                  last_seen_at: Date.now(),
                  token_hash: "session-token-should-not-render",
                }
              : null;
          }
          return { count: 1 };
        },
        all: async () => ({
          results: [
            {
              confirmed_at: 1_704_153_600_000,
              created_at: 1_704_067_200_000,
              email: '"><img src=x onerror=alert(1)>',
              ip: "203.0.113.7",
              status: "confirmed",
              token_hash: "confirmation-token-should-not-render",
            },
          ],
        }),
      };
    },
    batch: async () =>
      [4, 3, 1, 1, 2, 0].map((count) => ({ results: [{ count }] })),
  } as unknown as Env["DB"];
}

describe("waitlist admin subscriber registry", () => {
  test("uses bounded, parameterized filters and server-side pagination", async () => {
    const query = parseAdminSubscriberQuery({
      page: "2",
      search: "Alice_%\\test",
      status: "confirmed",
    });
    const { db, statements } = subscriberDatabase(
      [
        {
          confirmed_at: 1_704_153_600_000,
          created_at: 1_704_067_200_000,
          email: "alice@example.test",
          status: "confirmed",
        },
      ],
      74,
    );

    const page = await getAdminSubscriberPage(db, query);

    expect(page).toEqual({
      page: 2,
      pageSize: 50,
      query,
      records: [
        {
          confirmedAt: 1_704_153_600_000,
          createdAt: 1_704_067_200_000,
          email: "alice@example.test",
          status: "confirmed",
        },
      ],
      total: 74,
      totalPages: 2,
    });
    expect(parseAdminSubscriberQuery({ page: "99999" }).page).toBe(10_000);

    const [countQuery, pageQuery] = statements;
    expect(countQuery.sql).toContain("status = ?");
    expect(countQuery.sql).toContain("email COLLATE NOCASE LIKE ? ESCAPE '\\'");
    expect(countQuery.sql).not.toContain("Alice");
    expect(countQuery.values).toEqual(["confirmed", "%Alice\\_\\%\\\\test%"]);
    expect(pageQuery.values).toEqual([
      "confirmed",
      "%Alice\\_\\%\\\\test%",
      50,
      50,
    ]);
    expect(pageQuery.sql).toContain("LIMIT ? OFFSET ?");
    expect(pageQuery.sql).not.toContain("token_hash");
    expect(pageQuery.sql).not.toContain("ip_hash");
  });

  test("redirects unauthenticated requests before subscriber data is loaded", async () => {
    const response = await app.request(
      "http://localhost:8787/admin?q=private%40example.test",
      {},
      testEnv(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/login");
    expect(await response.text()).not.toContain("private@example.test");
  });

  test("renders authenticated records with no-store protections and escaped data", async () => {
    const secret =
      "test-admin-secret-that-is-longer-than-thirty-two-characters";
    const token = "a".repeat(32);
    const tokenHash = await hmacSha256(
      secret,
      `waitlist-admin-session:v1:${token}`,
    );
    const dangerousSearch = '"><img src=x onerror=alert(1)>';
    const response = await app.request(
      `http://localhost:8787/admin?q=${encodeURIComponent(dangerousSearch)}`,
      { headers: { Cookie: `wateaminbox_admin=${token}` } },
      testEnv({ DB: dashboardDatabase(tokenHash) }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(html).toContain("Waitlist records");
    expect(html).toContain("2024-01-01 00:00:00 UTC");
    expect(html).toContain("2024-01-02 00:00:00 UTC");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("confirmation-token-should-not-render");
    expect(html).not.toContain("session-token-should-not-render");
    expect(html).not.toContain("203.0.113.7");
    expect(html).not.toContain(token);
  });
});
