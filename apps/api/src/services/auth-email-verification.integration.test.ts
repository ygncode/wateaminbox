import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import type { EmailResult } from "../lib/email.js";
import { AuthError } from "../lib/errors.js";
import {
  login,
  refreshSession,
  register,
  resendVerification,
  updateProfile,
  verifyEmail,
} from "./auth.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;
const PASSWORD = "Verification-test-password-123!";
const createdUserIds: string[] = [];

function captureDelivery(tokens: string[]) {
  return async (_email: string, token: string): Promise<EmailResult> => {
    tokens.push(token);
    return { success: true, messageId: crypto.randomUUID() };
  };
}

const failedDelivery = async (): Promise<EmailResult> => ({
  success: false,
  error: "provider unavailable",
});

async function tokenCount(userId: string): Promise<number> {
  const result = await db
    .selectFrom("auth_tokens")
    .where("user_id", "=", userId)
    .where("type", "=", "email_verification")
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  return Number(result.count);
}

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  await db.deleteFrom("users").where("id", "in", createdUserIds).execute();
});

describe("email verification enforcement", () => {
  integrationTest(
    "keeps an account when initial delivery fails but creates no usable session",
    async () => {
      const email = `verification-failed-${crypto.randomUUID()}@example.com`;
      const result = await register(
        email,
        PASSWORD,
        "Failed delivery",
        failedDelivery,
      );
      createdUserIds.push(result.user.id);

      expect(result.verificationEmailSent).toBe(false);
      expect(await tokenCount(result.user.id)).toBe(0);
      const loginResponse = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(loginResponse.status).toBe(403);
      expect(await loginResponse.json()).toMatchObject({
        error: "EMAIL_NOT_VERIFIED",
      });
      expect(loginResponse.headers.get("set-cookie")).toBeNull();
      expect(
        await db
          .selectFrom("user_sessions")
          .where("user_id", "=", result.user.id)
          .select("id")
          .execute(),
      ).toHaveLength(0);
    },
  );

  integrationTest(
    "blocks login until verification and keeps an older delivered link valid after resend",
    async () => {
      const email = `verification-resend-${crypto.randomUUID()}@example.com`;
      const tokens: string[] = [];
      const result = await register(
        email,
        PASSWORD,
        "Successful delivery",
        captureDelivery(tokens),
      );
      createdUserIds.push(result.user.id);

      expect(result.verificationEmailSent).toBe(true);
      expect(tokens).toHaveLength(1);
      await expect(login(email, PASSWORD)).rejects.toMatchObject({
        code: "EMAIL_NOT_VERIFIED",
      });

      await expect(
        resendVerification(email, PASSWORD, captureDelivery(tokens)),
      ).resolves.toEqual({ alreadyVerified: false });
      expect(tokens).toHaveLength(2);
      expect(await tokenCount(result.user.id)).toBe(2);

      await verifyEmail(tokens[0]);
      const authenticated = await login(email, PASSWORD);
      expect(authenticated.user.emailVerifiedAt).toBeInstanceOf(Date);

      const unusedTokens = await db
        .selectFrom("auth_tokens")
        .where("user_id", "=", result.user.id)
        .where("type", "=", "email_verification")
        .where("used_at", "is", null)
        .select("id")
        .execute();
      expect(unusedTokens).toHaveLength(0);
    },
  );

  integrationTest(
    "preserves a delivered link when resend delivery fails",
    async () => {
      const email = `verification-preserve-${crypto.randomUUID()}@example.com`;
      const tokens: string[] = [];
      const result = await register(
        email,
        PASSWORD,
        undefined,
        captureDelivery(tokens),
      );
      createdUserIds.push(result.user.id);

      await expect(
        resendVerification(email, PASSWORD, failedDelivery),
      ).rejects.toMatchObject({
        code: "VERIFICATION_EMAIL_DELIVERY_FAILED",
        statusCode: 503,
      });
      expect(await tokenCount(result.user.id)).toBe(1);
      await expect(verifyEmail(tokens[0])).resolves.toMatchObject({ email });
    },
  );

  integrationTest(
    "requires valid credentials to resend and rejects refresh after verification is removed",
    async () => {
      const email = `verification-refresh-${crypto.randomUUID()}@example.com`;
      const tokens: string[] = [];
      const result = await register(
        email,
        PASSWORD,
        undefined,
        captureDelivery(tokens),
      );
      createdUserIds.push(result.user.id);

      await expect(
        resendVerification(email, "wrong-password", captureDelivery([])),
      ).rejects.toBeInstanceOf(AuthError);

      await verifyEmail(tokens[0]);
      const authenticated = await login(email, PASSWORD);
      await db
        .updateTable("users")
        .set({ email_verified_at: null })
        .where("id", "=", result.user.id)
        .execute();

      await expect(
        refreshSession(authenticated.tokens.refreshToken),
      ).rejects.toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
      expect(
        await db
          .selectFrom("user_sessions")
          .where("id", "=", authenticated.session.id)
          .select("id")
          .executeTakeFirst(),
      ).toBeUndefined();
    },
  );

  integrationTest(
    "revokes active sessions when a profile email change requires verification",
    async () => {
      const email = `verification-change-${crypto.randomUUID()}@example.com`;
      const newEmail = `verification-changed-${crypto.randomUUID()}@example.com`;
      const tokens: string[] = [];
      const result = await register(
        email,
        PASSWORD,
        undefined,
        captureDelivery(tokens),
      );
      createdUserIds.push(result.user.id);
      await verifyEmail(tokens[0]);
      const authenticated = await login(email, PASSWORD);

      const update = await updateProfile(
        result.user.id,
        { email: newEmail, currentPassword: PASSWORD },
        failedDelivery,
      );
      expect(update).toMatchObject({
        emailVerificationRequired: true,
        emailVerificationSent: false,
        user: { email: newEmail, emailVerifiedAt: null },
      });
      expect(
        await db
          .selectFrom("user_sessions")
          .where("id", "=", authenticated.session.id)
          .select("id")
          .executeTakeFirst(),
      ).toBeUndefined();
      await expect(login(newEmail, PASSWORD)).rejects.toMatchObject({
        code: "EMAIL_NOT_VERIFIED",
      });
    },
  );

  integrationTest(
    "serializes a racing login with an email change so no unverified session survives",
    async () => {
      const email = `verification-race-${crypto.randomUUID()}@example.com`;
      const newEmail = `verification-raced-${crypto.randomUUID()}@example.com`;
      const tokens: string[] = [];
      const result = await register(
        email,
        PASSWORD,
        undefined,
        captureDelivery(tokens),
      );
      createdUserIds.push(result.user.id);
      await verifyEmail(tokens[0]);

      const [loginResult, updateResult] = await Promise.allSettled([
        login(email, PASSWORD),
        updateProfile(
          result.user.id,
          { email: newEmail, currentPassword: PASSWORD },
          captureDelivery([]),
        ),
      ]);

      expect(updateResult.status).toBe("fulfilled");
      if (loginResult.status === "rejected") {
        expect(loginResult.reason).toMatchObject({
          code: "EMAIL_NOT_VERIFIED",
        });
      }
      expect(
        await db
          .selectFrom("user_sessions")
          .where("user_id", "=", result.user.id)
          .select("id")
          .execute(),
      ).toHaveLength(0);
    },
  );

  integrationTest(
    "does not send another verification email for an already verified account",
    async () => {
      const email = `verification-complete-${crypto.randomUUID()}@example.com`;
      const tokens: string[] = [];
      const result = await register(
        email,
        PASSWORD,
        undefined,
        captureDelivery(tokens),
      );
      createdUserIds.push(result.user.id);
      await verifyEmail(tokens[0]);

      let sendCount = 0;
      const sender = async (): Promise<EmailResult> => {
        sendCount += 1;
        return { success: true };
      };
      await expect(
        resendVerification(email, PASSWORD, sender),
      ).resolves.toEqual({ alreadyVerified: true });
      expect(sendCount).toBe(0);
    },
  );
});
