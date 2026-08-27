import { afterAll, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { app } from "../app.js";
import type { EmailResult } from "../lib/email.js";
import { AuthError } from "../lib/errors.js";
import { getAuditLogs } from "./audit.service.js";
import {
  login,
  refreshSession,
  register,
  resendVerification,
  updateProfile,
  verifyEmail,
} from "./auth.service.js";
import { createTenantSchema, dropTenantSchema } from "./tenant.service.js";

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
    "carries an invitation through verification and joins the matching workspace",
    async () => {
      const ownerId = crypto.randomUUID();
      const companyId = crypto.randomUUID();
      const invitationToken = crypto.randomUUID();
      const invitedEmail = `invited-${crypto.randomUUID()}@example.com`;
      const verificationTokens: string[] = [];
      const deliveredInvitationTokens: Array<string | undefined> = [];

      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `owner-${ownerId}@example.com`,
            password_hash: "test",
            email_verified_at: new Date(),
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Invited workspace",
            schema_name: `test_${companyId.replaceAll("-", "_")}`,
          })
          .execute();
        await createTenantSchema(companyId);
        await db
          .insertInto("company_stats")
          .values({ company_id: companyId, active_users: 1 })
          .execute();
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: ownerId, role: "owner" })
          .execute();
        await db
          .insertInto("invitations")
          .values({
            company_id: companyId,
            email: invitedEmail,
            token: invitationToken,
            invited_by: ownerId,
            expires_at: new Date(Date.now() + 60_000),
          })
          .execute();

        await expect(
          register(
            `wrong-${crypto.randomUUID()}@example.com`,
            PASSWORD,
            "Wrong recipient",
            captureDelivery([]),
            invitationToken,
          ),
        ).rejects.toMatchObject({ code: "INVITATION_EMAIL_MISMATCH" });

        const registered = await register(
          invitedEmail.toUpperCase(),
          PASSWORD,
          "Invited teammate",
          async (_email, token, deliveredInvitationToken) => {
            verificationTokens.push(token);
            deliveredInvitationTokens.push(deliveredInvitationToken);
            return { success: true };
          },
          invitationToken,
        );
        createdUserIds.push(registered.user.id);

        expect(deliveredInvitationTokens).toEqual([invitationToken]);
        const verificationResponse = await app.request(
          "/api/auth/verify-email",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              token: verificationTokens[0],
              invitationToken,
            }),
          },
        );
        expect(verificationResponse.status).toBe(200);
        expect(await verificationResponse.json()).toMatchObject({
          invitationAccepted: true,
          companyId,
          user: { email: invitedEmail, emailVerified: true },
        });
        expect(
          await db
            .selectFrom("company_members")
            .where("company_id", "=", companyId)
            .where("user_id", "=", registered.user.id)
            .select("role")
            .executeTakeFirst(),
        ).toEqual({ role: "member" });
        expect(
          (
            await db
              .selectFrom("company_stats")
              .where("company_id", "=", companyId)
              .select("active_users")
              .executeTakeFirstOrThrow()
          ).active_users,
        ).toBe(2);
        expect(
          (await getAuditLogs({ companyId })).logs.map((log) => ({
            action: log.action,
            entityId: log.entityId,
          })),
        ).toContainEqual({
          action: "invitation.accepted",
          entityId: expect.any(String),
        });
      } finally {
        await dropTenantSchema(companyId);
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
      }
    },
    30_000,
  );

  integrationTest(
    "rolls verification back when invitation acceptance fails unexpectedly",
    async () => {
      const ownerId = crypto.randomUUID();
      const companyId = crypto.randomUUID();
      const invitationToken = crypto.randomUUID();
      const invitedEmail = `retry-${crypto.randomUUID()}@example.com`;
      const verificationTokens: string[] = [];
      let registeredUserId: string | undefined;

      try {
        await db
          .insertInto("users")
          .values({
            id: ownerId,
            email: `owner-${ownerId}@example.com`,
            password_hash: "test",
            email_verified_at: new Date(),
          })
          .execute();
        await db
          .insertInto("companies")
          .values({
            id: companyId,
            name: "Retry workspace",
            schema_name: `test_${companyId.replaceAll("-", "_")}`,
          })
          .execute();
        await createTenantSchema(companyId);
        await db
          .insertInto("company_stats")
          .values({ company_id: companyId, active_users: 2_147_483_647 })
          .execute();
        await db
          .insertInto("company_members")
          .values({ company_id: companyId, user_id: ownerId, role: "owner" })
          .execute();
        await db
          .insertInto("invitations")
          .values({
            company_id: companyId,
            email: invitedEmail,
            token: invitationToken,
            invited_by: ownerId,
            expires_at: new Date(Date.now() + 60_000),
          })
          .execute();

        const registered = await register(
          invitedEmail,
          PASSWORD,
          "Retry teammate",
          captureDelivery(verificationTokens),
          invitationToken,
        );
        registeredUserId = registered.user.id;
        createdUserIds.push(registered.user.id);

        const verify = () =>
          app.request("/api/auth/verify-email", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              token: verificationTokens[0],
              invitationToken,
            }),
          });

        expect((await verify()).status).toBe(500);
        expect(
          await db
            .selectFrom("users")
            .where("id", "=", registered.user.id)
            .select("email_verified_at")
            .executeTakeFirstOrThrow(),
        ).toEqual({ email_verified_at: null });
        expect(
          await db
            .selectFrom("company_members")
            .where("company_id", "=", companyId)
            .where("user_id", "=", registered.user.id)
            .select("id")
            .executeTakeFirst(),
        ).toBeUndefined();

        await db
          .updateTable("company_stats")
          .set({ active_users: 1 })
          .where("company_id", "=", companyId)
          .execute();
        expect((await verify()).status).toBe(200);
        expect(
          await db
            .selectFrom("company_members")
            .where("company_id", "=", companyId)
            .where("user_id", "=", registered.user.id)
            .select("id")
            .executeTakeFirst(),
        ).toBeDefined();
      } finally {
        await dropTenantSchema(companyId);
        await db.deleteFrom("companies").where("id", "=", companyId).execute();
        await db.deleteFrom("users").where("id", "=", ownerId).execute();
        if (registeredUserId) {
          await db
            .deleteFrom("users")
            .where("id", "=", registeredUserId)
            .execute();
        }
      }
    },
    30_000,
  );

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
