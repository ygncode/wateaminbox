import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import { generateRefreshToken } from "../lib/jwt.js";
import { hashPassword } from "../lib/password.js";
import { hashToken } from "../lib/security.js";
import { readRetiredRefreshTokens } from "../lib/refresh-token-retention.js";

/**
 * Rotation stays single-use, but a hash retired inside
 * `JWT_REFRESH_REUSE_GRACE_SECONDS` is accepted as a retry. These cases pin the
 * behaviour that keeps a deployment from signing everyone out, and the bounds
 * that keep the exception from becoming a general replay window.
 *
 * Run with `RUN_DB_INTEGRATION=1` and a migrated database. The rate limiter is
 * per-IP and this file issues more than its budget of refreshes, so run it with
 * `RATE_LIMIT_ENABLED=false` as `scripts/run-integration-tests-ts.sh` does.
 */

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const PASSWORD = "Refresh-rotation-test-password-123!";
const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  // user_sessions.user_id ON DELETE CASCADE removes sessions automatically.
  await db.deleteFrom("users").where("id", "in", createdUserIds).execute();
});

function refreshCookieValue(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = header.match(/wateaminbox_refresh=([^;]+)/);
  if (!match?.[1]) throw new Error(`no refresh cookie in: ${header}`);
  return match[1];
}

/** Create a verified user and return the refresh token from a fresh login. */
async function loginFreshSession(): Promise<{
  userId: string;
  sessionId: string;
  token: string;
}> {
  const userId = crypto.randomUUID();
  const email = `refresh-${userId}@example.com`;
  createdUserIds.push(userId);

  await db
    .insertInto("users")
    .values({
      id: userId,
      email,
      password_hash: await hashPassword(PASSWORD),
      email_verified_at: new Date(),
    })
    .execute();

  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);

  const token = refreshCookieValue(response);
  const session = await db
    .selectFrom("user_sessions")
    .where("user_id", "=", userId)
    .select("id")
    .executeTakeFirstOrThrow();

  return { userId, sessionId: session.id, token };
}

async function refresh(token: string): Promise<Response> {
  return app.request("/api/auth/refresh", {
    method: "POST",
    headers: { cookie: `wateaminbox_refresh=${token}` },
  });
}

async function retiredEntries(sessionId: string) {
  const row = await db
    .selectFrom("user_sessions")
    .where("id", "=", sessionId)
    .select("previous_refresh_tokens")
    .executeTakeFirstOrThrow();
  return readRetiredRefreshTokens(row.previous_refresh_tokens);
}

describe("refresh token rotation grace window", () => {
  integrationTest("retires the superseded hash on rotation", async () => {
    const { sessionId, token } = await loginFreshSession();

    const response = await refresh(token);
    expect(response.status).toBe(200);
    const rotated = refreshCookieValue(response);
    expect(rotated).not.toBe(token);

    const retired = await retiredEntries(sessionId);
    expect(retired.map((entry) => entry.hash)).toContain(hashToken(token));
    // The retired hash must not be the token still in force.
    expect(retired.map((entry) => entry.hash)).not.toContain(
      hashToken(rotated),
    );
  });

  integrationTest(
    "accepts a retired hash, so a refresh whose response was lost can converge",
    async () => {
      const { token } = await loginFreshSession();

      const first = await refresh(token);
      expect(first.status).toBe(200);
      const replacement = refreshCookieValue(first);

      // The deployment case: the rotation committed and the reply never
      // arrived, so the browser presents the retired hash again.
      const retry = await refresh(token);
      expect(retry.status).toBe(200);
      expect(refreshCookieValue(retry)).not.toBe(replacement);

      // Both tokens now work, which is what lets the caller recover whichever
      // one it happens to hold.
      expect((await refresh(replacement)).status).toBe(200);
    },
  );

  integrationTest(
    "keeps every racing tab working, not just the one that refreshed first",
    async () => {
      const { token } = await loginFreshSession();

      // Two tabs coalesce within a document but not across documents, so both
      // present the same starting hash.
      const tabA = refreshCookieValue(await refresh(token));
      const tabB = refreshCookieValue(await refresh(token));

      // The tab that rotated first holds a hash the second rotation replaced.
      // It has to stay usable, or fixing one tab only strands the other.
      expect((await refresh(tabA)).status).toBe(200);
      expect((await refresh(tabB)).status).toBe(200);
    },
  );

  integrationTest(
    "rejects a retired hash once its window has closed",
    async () => {
      const { sessionId, token } = await loginFreshSession();
      const current = refreshCookieValue(await refresh(token));

      // Move the recorded deadline into the past rather than waiting out the
      // real window: an entry past its deadline is a settled fact.
      await db
        .updateTable("user_sessions")
        .set({
          previous_refresh_tokens: JSON.stringify([
            {
              hash: hashToken(token),
              expiresAt: new Date(Date.now() - 1).toISOString(),
            },
          ]),
        })
        .where("id", "=", sessionId)
        .execute();

      expect((await refresh(token)).status).toBe(401);

      // A rejected request never reaches the rotation, so the dead entry stays
      // until the next real rotation prunes it.
      expect((await refresh(current)).status).toBe(200);
      expect(
        (await retiredEntries(sessionId)).some(
          (entry) => entry.hash === hashToken(token),
        ),
      ).toBe(false);
    },
  );

  integrationTest(
    "does not extend a retired hash's window when it is retried",
    async () => {
      const { sessionId, token } = await loginFreshSession();
      expect((await refresh(token)).status).toBe(200);

      const [before] = (await retiredEntries(sessionId)).filter(
        (entry) => entry.hash === hashToken(token),
      );
      expect(before).toBeDefined();

      // A retry must not buy the retired hash more time, or a client stuck in
      // a loop could keep the exception open indefinitely.
      expect((await refresh(token)).status).toBe(200);

      const [after] = (await retiredEntries(sessionId)).filter(
        (entry) => entry.hash === hashToken(token),
      );
      expect(after?.expiresAt).toBe(before?.expiresAt);
    },
  );

  integrationTest(
    "rejects a correctly signed token that was never issued",
    async () => {
      const { sessionId } = await loginFreshSession();

      // Signature and session both valid, hash never stored. Without this the
      // grace window would be a way in rather than a retry tolerance.
      const forged = await generateRefreshToken(sessionId);
      expect((await refresh(forged)).status).toBe(401);
    },
  );

  integrationTest("bounds how many retired hashes are retained", async () => {
    const { sessionId, token } = await loginFreshSession();

    let current = token;
    for (let i = 0; i < 8; i += 1) {
      const response = await refresh(current);
      expect(response.status).toBe(200);
      current = refreshCookieValue(response);
    }

    // Every rotation retires one hash; the cap is what stops the column from
    // growing with the number of retries.
    expect((await retiredEntries(sessionId)).length).toBeLessThanOrEqual(5);
  });
});
