import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { AuthError } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { signInWithGoogle } from "./google-auth.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const PASSWORD = "Google-link-test-password-123!";
const emails: string[] = [];

function email(): string {
  const value = `google-${crypto.randomUUID()}@example.com`;
  emails.push(value);
  return value;
}

afterAll(async () => {
  if (emails.length === 0) return;
  // user_identities and user_sessions cascade from users.
  await db.deleteFrom("users").where("email", "in", emails).execute();
});

async function identities(userId: string) {
  return db
    .selectFrom("user_identities")
    .where("user_id", "=", userId)
    .select(["provider", "subject"])
    .execute();
}

describe("signInWithGoogle", () => {
  integrationTest("creates a verified user on first sign-in", async () => {
    const address = email();
    const subject = crypto.randomUUID();
    const result = await signInWithGoogle({
      subject,
      email: address,
      name: "New Person",
    });

    expect(result.created).toBe(true);
    expect(result.user.email).toBe(address);
    expect(result.user.emailVerifiedAt).not.toBeNull();
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(await identities(result.user.id)).toEqual([
      { provider: "google", subject },
    ]);

    const again = await signInWithGoogle({
      subject,
      email: address,
      name: "New Person",
    });
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(result.user.id);
  });

  integrationTest(
    "links a verified password account and keeps its password",
    async () => {
      const address = email();
      const user = await db
        .insertInto("users")
        .values({
          email: address,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .returning(["id", "password_hash"])
        .executeTakeFirstOrThrow();

      const result = await signInWithGoogle({
        subject: crypto.randomUUID(),
        email: address,
        name: null,
      });
      expect(result.created).toBe(false);
      expect(result.user.id).toBe(user.id);

      const after = await db
        .selectFrom("users")
        .where("id", "=", user.id)
        .select("password_hash")
        .executeTakeFirstOrThrow();
      expect(after.password_hash).toBe(user.password_hash);
    },
  );

  integrationTest(
    "takes over an unverified account by discarding its unproven password",
    async () => {
      const address = email();
      // Someone registered this address without ever proving they own it.
      const squatter = await db
        .insertInto("users")
        .values({
          email: address,
          password_hash: await hashPassword(PASSWORD),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await db
        .insertInto("auth_tokens")
        .values({
          user_id: squatter.id,
          type: "email_verification",
          token_hash: crypto.randomUUID(),
          expires_at: new Date(Date.now() + 60_000),
        })
        .execute();

      const result = await signInWithGoogle({
        subject: crypto.randomUUID(),
        email: address,
        name: null,
      });
      expect(result.user.id).toBe(squatter.id);
      expect(result.user.emailVerifiedAt).not.toBeNull();

      const row = await db
        .selectFrom("users")
        .where("id", "=", squatter.id)
        .select("password_hash")
        .executeTakeFirstOrThrow();
      expect(await verifyPassword(PASSWORD, row.password_hash)).toBe(false);
      const tokens = await db
        .selectFrom("auth_tokens")
        .where("user_id", "=", squatter.id)
        .select("id")
        .execute();
      expect(tokens).toEqual([]);
    },
  );

  integrationTest(
    "refuses to re-bind an email linked to another Google account",
    async () => {
      const address = email();
      await signInWithGoogle({
        subject: crypto.randomUUID(),
        email: address,
        name: null,
      });

      let caught: unknown;
      try {
        await signInWithGoogle({
          subject: crypto.randomUUID(),
          email: address,
          name: null,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AuthError);
      expect((caught as AuthError).code).toBe("GOOGLE_ACCOUNT_MISMATCH");
    },
  );

  integrationTest(
    "signs in by subject even after the Google email changes",
    async () => {
      const original = email();
      const changed = email();
      const subject = crypto.randomUUID();
      const first = await signInWithGoogle({
        subject,
        email: original,
        name: null,
      });
      const second = await signInWithGoogle({
        subject,
        email: changed,
        name: null,
      });
      expect(second.user.id).toBe(first.user.id);
      expect(second.user.email).toBe(original);
    },
  );
});
