import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import type { EmailResult } from "../lib/email.js";
import { AuthError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { register, updateProfile } from "./auth.service.js";

/**
 * DB-gated end-to-end proof for the email-change TOCTOU fix.
 *
 * `auth-update-profile-toctou.test.ts` deterministically injects a synthetic
 * 23505 to cover the catch path without a database; this file forces a REAL
 * `users_email_key` unique_violation by racing two concurrent users (or two
 * registrations) onto the same target email, and asserts the losing client
 * gets the friendly HTTP 409 `EMAIL_EXISTS` contract — not the HTTP 500 the
 * raw driver error would have produced before the fix. It runs only under
 * `RUN_DB_INTEGRATION=1` with a migrated Postgres on `DATABASE_URL`.
 */

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Toctou-test-password-123!";
const createdUserIds: string[] = [];

// Avoid real email delivery: the verification link is discarded, and the
// losing path never reaches delivery anyway (the transaction rejects first).
const noopSender = async (): Promise<EmailResult> => ({
  success: true,
  messageId: "test",
});

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  await db.deleteFrom("users").where("id", "in", createdUserIds).execute();
});

describe("updateProfile email-change TOCTOU (real database)", () => {
  integrationTest(
    "the loser of a concurrent email change gets EMAIL_EXISTS 409, not 500",
    async () => {
      const hash = await hashPassword(PASSWORD);
      const userA = crypto.randomUUID();
      const userB = crypto.randomUUID();
      const targetEmail = `toctou-${crypto.randomUUID()}@example.com`;

      await db
        .insertInto("users")
        .values([
          {
            id: userA,
            email: `a-${userA}@example.com`,
            password_hash: hash,
            email_verified_at: new Date(),
          },
          {
            id: userB,
            email: `b-${userB}@example.com`,
            password_hash: hash,
            email_verified_at: new Date(),
          },
        ])
        .execute();
      createdUserIds.push(userA, userB);

      // Both pre-checks pass (the target email is free), then both UPDATE to it
      // inside their own transactions. The unique constraint lets exactly one
      // commit win; the loser's UPDATE fails with 23505 mid-transaction.
      const results = await Promise.allSettled([
        updateProfile(
          userA,
          { email: targetEmail, currentPassword: PASSWORD },
          noopSender,
        ),
        updateProfile(
          userB,
          { email: targetEmail, currentPassword: PASSWORD },
          noopSender,
        ),
      ]);

      const rejected = results.filter((r) => r.status === "rejected");
      const fulfilled = results.filter((r) => r.status === "fulfilled");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const loser = (rejected[0] as PromiseRejectedResult).reason;
      expect(loser).toBeInstanceOf(AuthError);
      expect(loser).toMatchObject({
        code: "EMAIL_EXISTS",
        statusCode: 409,
        message: "An account with this email already exists",
      });
    },
  );
});

describe("register email-uniqueness TOCTOU (real database)", () => {
  integrationTest(
    "the loser of a concurrent registration gets EMAIL_EXISTS 409, not 500",
    async () => {
      const targetEmail = `toctou-reg-${crypto.randomUUID()}@example.com`;

      const results = await Promise.allSettled([
        register(targetEmail, PASSWORD, "User One", noopSender),
        register(targetEmail, PASSWORD, "User Two", noopSender),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = fulfilled[0] as unknown as {
        value: { user: { id: string } };
      };
      createdUserIds.push(winner.value.user.id);

      const loser = (rejected[0] as PromiseRejectedResult).reason;
      expect(loser).toBeInstanceOf(AuthError);
      expect(loser).toMatchObject({
        code: "EMAIL_EXISTS",
        statusCode: 409,
        message: "An account with this email already exists",
      });
    },
  );
});
