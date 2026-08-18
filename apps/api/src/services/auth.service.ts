import crypto from "node:crypto";
import { type AuthTokenType, type Database, db } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import type { Kysely, Transaction } from "kysely";
import {
  type EmailResult,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "../lib/email.js";
import { AuthError } from "../lib/errors.js";
import { getGravatarUrl } from "../lib/gravatar.js";
import {
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiry,
  verifyRefreshToken,
} from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import type { UpdateProfileInput } from "../lib/schemas/auth.js";
import { hashToken } from "../lib/security.js";
import { deleteMedia, getPresignedUrl, uploadMedia } from "../lib/storage.js";

export interface DeviceInfo {
  deviceName?: string;
  deviceType?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserSession {
  id: string;
  userId: string;
  deviceName: string | null;
  deviceType: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: Date;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarKey: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthUserResponse {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string;
  gravatarUrl: string;
  hasCustomAvatar: boolean;
  emailVerified: boolean;
}

// Re-export AuthError for backward compatibility with routes
export { AuthError } from "../lib/errors.js";

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

type AuthDatabase = Kysely<Database> | Transaction<Database>;
type VerificationEmailSender = (
  email: string,
  token: string,
) => Promise<EmailResult>;

const emailNotVerifiedError = () =>
  new AuthError(
    "Verify your email address before signing in",
    "EMAIL_NOT_VERIFIED",
    403,
  );

/** Keep the access-control decision explicit and independently testable. */
export function assertEmailVerified(
  emailVerifiedAt: Date | null,
): asserts emailVerifiedAt is Date {
  if (!emailVerifiedAt) throw emailNotVerifiedError();
}

async function deliverVerificationEmail(
  email: string,
  token: string,
  emailSender: VerificationEmailSender,
): Promise<boolean> {
  try {
    return (await emailSender(email, token)).success;
  } catch {
    return false;
  }
}

async function discardAuthToken(token: string): Promise<void> {
  await db
    .deleteFrom("auth_tokens")
    .where("token_hash", "=", hashToken(token))
    .execute();
}

export async function toAuthUserResponse(
  user: Pick<AuthUser, "id" | "email" | "name" | "emailVerifiedAt"> & {
    avatarKey?: string | null;
  },
): Promise<AuthUserResponse> {
  const gravatarUrl = getGravatarUrl(user.email);
  let avatarUrl = gravatarUrl;
  if (user.avatarKey) {
    try {
      avatarUrl = await getPresignedUrl(user.avatarKey, 24 * 60 * 60);
    } catch {
      // Profile access should remain available if object storage is down.
    }
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl,
    gravatarUrl,
    hasCustomAvatar: Boolean(user.avatarKey),
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

async function uploadProfileAvatar(
  userId: string,
  avatarDataUrl: string,
): Promise<string> {
  const match = avatarDataUrl.match(
    /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/,
  );
  if (!match) throw new Error("Invalid profile image");
  const mimeType = match[1];
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const avatar = await uploadMedia(
    Buffer.from(match[2], "base64"),
    mimeType,
    `user-${userId}`,
    `profile-avatar.${extension}`,
  );
  return avatar.key;
}

async function issueAuthToken(
  database: AuthDatabase,
  userId: string,
  type: AuthTokenType,
  ttlMs: number,
  invalidateExisting: boolean = true,
): Promise<string> {
  const token = generateToken();

  if (invalidateExisting) {
    // New auth operations invalidate tokens from an earlier operation. A
    // verification resend opts out so an already-delivered link stays valid
    // until the replacement has also been accepted by the mail provider.
    await database
      .deleteFrom("auth_tokens")
      .where("user_id", "=", userId)
      .where("type", "=", type)
      .execute();
  } else {
    // Resends may preserve earlier delivered links, but dead rows must not
    // accumulate forever on an account that repeatedly requests new links.
    await database
      .deleteFrom("auth_tokens")
      .where("user_id", "=", userId)
      .where("type", "=", type)
      .where((eb) =>
        eb.or([
          eb("expires_at", "<=", toDbDate()),
          eb("used_at", "is not", null),
        ]),
      )
      .execute();
  }

  await database
    .insertInto("auth_tokens")
    .values({
      user_id: userId,
      type,
      token_hash: hashToken(token),
      expires_at: toDbDate(Date.now() + ttlMs),
      used_at: null,
    })
    .execute();

  return token;
}

/**
 * Register a new user with email and password
 */
export async function register(
  email: string,
  password: string,
  name?: string,
  emailSender: VerificationEmailSender = sendVerificationEmail,
): Promise<{ user: AuthUser; verificationEmailSent: boolean }> {
  const normalizedEmail = email.toLowerCase();
  const existingUser = await db
    .selectFrom("users")
    .where("email", "=", normalizedEmail)
    .select("id")
    .executeTakeFirst();

  if (existingUser) {
    throw new AuthError(
      "An account with this email already exists",
      "EMAIL_EXISTS",
      409,
    );
  }

  const passwordHash = await hashPassword(password);

  const { user, verificationToken } = await db
    .transaction()
    .execute(async (trx) => {
      const createdUser = await trx
        .insertInto("users")
        .values({
          email: normalizedEmail,
          password_hash: passwordHash,
          name: name || null,
        })
        .returning([
          "id",
          "email",
          "name",
          "avatar_key",
          "email_verified_at",
          "created_at",
          "updated_at",
        ])
        .executeTakeFirstOrThrow();

      const token = await issueAuthToken(
        trx,
        createdUser.id,
        "email_verification",
        EMAIL_VERIFICATION_TTL_MS,
      );

      return { user: createdUser, verificationToken: token };
    });

  const verificationEmailSent = await deliverVerificationEmail(
    user.email,
    verificationToken,
    emailSender,
  );
  if (!verificationEmailSent) {
    await discardAuthToken(verificationToken).catch(() => undefined);
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarKey: user.avatar_key,
      emailVerifiedAt: user.email_verified_at,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
    verificationEmailSent,
  };
}

/**
 * Login a user with email and password
 */
export async function login(
  email: string,
  password: string,
  deviceInfo?: DeviceInfo,
): Promise<{ user: AuthUser; tokens: AuthTokens; session: UserSession }> {
  // Find the user
  const user = await db
    .selectFrom("users")
    .where("email", "=", email.toLowerCase())
    .selectAll()
    .executeTakeFirst();

  if (!user) {
    throw new AuthError(
      "Invalid email or password",
      "INVALID_CREDENTIALS",
      401,
    );
  }

  // Verify password
  const isValidPassword = await verifyPassword(password, user.password_hash);
  if (!isValidPassword) {
    throw new AuthError(
      "Invalid email or password",
      "INVALID_CREDENTIALS",
      401,
    );
  }

  if (!user.email_verified_at) {
    // Revoke sessions created before verification became mandatory. This also
    // closes any session left behind after the account's email was changed.
    await db
      .deleteFrom("user_sessions")
      .where("user_id", "=", user.id)
      .execute();
    assertEmailVerified(user.email_verified_at);
  }

  const result = await db.transaction().execute(async (trx) => {
    // Serialize session creation with profile email changes. Without this lock,
    // an email change could mark the user unverified and delete sessions just
    // before a racing login inserts a new one.
    const lockedUser = await trx
      .selectFrom("users")
      .where("id", "=", user.id)
      .selectAll()
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (!lockedUser.email_verified_at) {
      await trx
        .deleteFrom("user_sessions")
        .where("user_id", "=", lockedUser.id)
        .execute();
      return null;
    }

    // Insert a unique placeholder until the signed refresh token can include the session ID.
    const refreshTokenPlaceholder = hashToken(generateToken());
    const session = await trx
      .insertInto("user_sessions")
      .values({
        user_id: lockedUser.id,
        device_name: deviceInfo?.deviceName ?? null,
        device_type: deviceInfo?.deviceType ?? null,
        ip_address: deviceInfo?.ipAddress ?? null,
        user_agent: deviceInfo?.userAgent ?? null,
        refresh_token: refreshTokenPlaceholder,
        expires_at: getRefreshTokenExpiry(),
      })
      .returning([
        "id",
        "user_id",
        "device_name",
        "device_type",
        "ip_address",
        "user_agent",
        "last_active_at",
        "created_at",
        "expires_at",
      ])
      .executeTakeFirstOrThrow();

    const [accessToken, refreshToken] = await Promise.all([
      generateAccessToken(lockedUser.id, session.id),
      generateRefreshToken(session.id),
    ]);

    await trx
      .updateTable("user_sessions")
      .set({ refresh_token: hashToken(refreshToken) })
      .where("id", "=", session.id)
      .execute();

    return {
      user: {
        id: lockedUser.id,
        email: lockedUser.email,
        name: lockedUser.name,
        avatarKey: lockedUser.avatar_key,
        emailVerifiedAt: lockedUser.email_verified_at,
        createdAt: lockedUser.created_at,
        updatedAt: lockedUser.updated_at,
      },
      tokens: {
        accessToken,
        refreshToken,
      },
      session: {
        id: session.id,
        userId: session.user_id,
        deviceName: session.device_name,
        deviceType: session.device_type,
        ipAddress: session.ip_address,
        userAgent: session.user_agent,
        lastActiveAt: session.last_active_at,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
      },
    };
  });

  if (!result) throw emailNotVerifiedError();
  return result;
}

/**
 * Verify an email using a hashed, expiring, single-use token.
 */
export async function verifyEmail(token: string): Promise<AuthUser> {
  const tokenHash = hashToken(token);

  return db.transaction().execute(async (trx) => {
    const storedToken = await trx
      .selectFrom("auth_tokens")
      .where("token_hash", "=", tokenHash)
      .where("type", "=", "email_verification")
      .where("used_at", "is", null)
      .where("expires_at", ">", toDbDate())
      .select(["id", "user_id"])
      .forUpdate()
      .executeTakeFirst();

    if (!storedToken) {
      throw new AuthError(
        "Invalid or expired verification token",
        "INVALID_TOKEN",
        400,
      );
    }

    const now = toDbDate();
    const user = await trx
      .updateTable("users")
      .set({ email_verified_at: now, updated_at: now })
      .where("id", "=", storedToken.user_id)
      .returning([
        "id",
        "email",
        "name",
        "avatar_key",
        "email_verified_at",
        "created_at",
        "updated_at",
      ])
      .executeTakeFirstOrThrow();

    await trx
      .updateTable("auth_tokens")
      .set({ used_at: now })
      .where("user_id", "=", storedToken.user_id)
      .where("type", "=", "email_verification")
      .where("used_at", "is", null)
      .execute();

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarKey: user.avatar_key,
      emailVerifiedAt: user.email_verified_at,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  });
}

/**
 * Reissue a verification link after validating the account password. Requiring
 * credentials lets delivery failures be reported accurately without exposing
 * whether an arbitrary email address has an account.
 */
export async function resendVerification(
  email: string,
  password: string,
  emailSender: VerificationEmailSender = sendVerificationEmail,
): Promise<{ alreadyVerified: boolean }> {
  const user = await db
    .selectFrom("users")
    .where("email", "=", email.trim().toLowerCase())
    .select(["id", "email", "password_hash", "email_verified_at"])
    .executeTakeFirst();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new AuthError(
      "Invalid email or password",
      "INVALID_CREDENTIALS",
      401,
    );
  }

  if (user.email_verified_at) return { alreadyVerified: true };

  const token = await issueAuthToken(
    db,
    user.id,
    "email_verification",
    EMAIL_VERIFICATION_TTL_MS,
    false,
  );
  const delivered = await deliverVerificationEmail(
    user.email,
    token,
    emailSender,
  );
  if (!delivered) {
    await discardAuthToken(token).catch(() => undefined);
    throw new AuthError(
      "We could not send a verification email. Please try again later.",
      "VERIFICATION_EMAIL_DELIVERY_FAILED",
      503,
    );
  }

  return { alreadyVerified: false };
}

/**
 * Request a password reset
 */
export async function forgotPassword(
  email: string,
): Promise<{ success: boolean }> {
  const user = await db
    .selectFrom("users")
    .where("email", "=", email.toLowerCase())
    .select(["id", "email"])
    .executeTakeFirst();

  // Always return success to prevent email enumeration.
  if (!user) {
    return { success: true };
  }

  const resetToken = await issueAuthToken(
    db,
    user.id,
    "password_reset",
    PASSWORD_RESET_TTL_MS,
  );
  await sendPasswordResetEmail(user.email, resetToken);

  return { success: true };
}

/**
 * Reset a password using a hashed, expiring, single-use token.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ success: boolean }> {
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(newPassword);

  await db.transaction().execute(async (trx) => {
    const storedToken = await trx
      .selectFrom("auth_tokens")
      .where("auth_tokens.token_hash", "=", tokenHash)
      .where("auth_tokens.type", "=", "password_reset")
      .where("auth_tokens.used_at", "is", null)
      .where("auth_tokens.expires_at", ">", toDbDate())
      .select(["auth_tokens.id", "auth_tokens.user_id"])
      .forUpdate("auth_tokens")
      .executeTakeFirst();

    if (!storedToken) {
      throw new AuthError(
        "Invalid or expired reset token",
        "INVALID_TOKEN",
        400,
      );
    }

    const now = toDbDate();
    await trx
      .updateTable("users")
      .set({ password_hash: passwordHash, updated_at: now })
      .where("id", "=", storedToken.user_id)
      .execute();

    await trx
      .updateTable("auth_tokens")
      .set({ used_at: now })
      .where("id", "=", storedToken.id)
      .execute();

    // A password reset invalidates every existing device session.
    await trx
      .deleteFrom("user_sessions")
      .where("user_id", "=", storedToken.user_id)
      .execute();
  });

  return { success: true };
}

/**
 * Update the signed-in user's profile. Changing email requires the current
 * password and starts a fresh email-verification cycle.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  emailSender: VerificationEmailSender = sendVerificationEmail,
): Promise<{
  user: AuthUser;
  emailVerificationRequired: boolean;
  emailVerificationSent: boolean;
}> {
  const current = await db
    .selectFrom("users")
    .where("id", "=", userId)
    .selectAll()
    .executeTakeFirst();
  if (!current) {
    throw new AuthError("User not found", "USER_NOT_FOUND", 404);
  }

  const normalizedEmail = input.email?.trim().toLowerCase();
  const emailChanged =
    normalizedEmail !== undefined && normalizedEmail !== current.email;

  if (emailChanged) {
    if (!input.currentPassword) {
      throw new AuthError(
        "Enter your current password to change your email",
        "CURRENT_PASSWORD_REQUIRED",
        400,
      );
    }
    if (!(await verifyPassword(input.currentPassword, current.password_hash))) {
      throw new AuthError(
        "Current password is incorrect",
        "INVALID_CURRENT_PASSWORD",
        401,
      );
    }
    const existing = await db
      .selectFrom("users")
      .where("email", "=", normalizedEmail)
      .where("id", "!=", userId)
      .select("id")
      .executeTakeFirst();
    if (existing) {
      throw new AuthError(
        "An account with this email already exists",
        "EMAIL_EXISTS",
        409,
      );
    }
  }

  let uploadedAvatarKey: string | null = null;
  if (typeof input.avatarDataUrl === "string") {
    uploadedAvatarKey = await uploadProfileAvatar(userId, input.avatarDataUrl);
  }

  const updateData: Record<string, unknown> = {
    updated_at: toDbDate(),
  };
  if (input.name !== undefined) updateData.name = input.name;
  if (emailChanged) {
    updateData.email = normalizedEmail;
    updateData.email_verified_at = null;
  }
  if (input.avatarDataUrl !== undefined) {
    updateData.avatar_key = uploadedAvatarKey;
  }

  let updated: {
    id: string;
    email: string;
    name: string | null;
    avatar_key: string | null;
    email_verified_at: Date | null;
    created_at: Date;
    updated_at: Date;
  };
  let verificationToken: string | null = null;

  try {
    const result = await db.transaction().execute(async (trx) => {
      const user = await trx
        .updateTable("users")
        .set(updateData)
        .where("id", "=", userId)
        .returning([
          "id",
          "email",
          "name",
          "avatar_key",
          "email_verified_at",
          "created_at",
          "updated_at",
        ])
        .executeTakeFirstOrThrow();

      let token: string | null = null;
      if (emailChanged && normalizedEmail) {
        token = await issueAuthToken(
          trx,
          userId,
          "email_verification",
          EMAIL_VERIFICATION_TTL_MS,
        );
        // Changing the login identity returns the account to an unverified
        // state, so every existing session must stop immediately.
        await trx
          .deleteFrom("user_sessions")
          .where("user_id", "=", userId)
          .execute();
      }
      return { user, verificationToken: token };
    });
    updated = result.user;
    verificationToken = result.verificationToken;
  } catch (error) {
    if (uploadedAvatarKey) {
      await deleteMedia(uploadedAvatarKey).catch(() => undefined);
    }
    throw error;
  }

  let emailVerificationSent = false;
  if (verificationToken && normalizedEmail) {
    emailVerificationSent = await deliverVerificationEmail(
      normalizedEmail,
      verificationToken,
      emailSender,
    );
    if (!emailVerificationSent) {
      await discardAuthToken(verificationToken).catch(() => undefined);
    }
  }

  if (
    input.avatarDataUrl !== undefined &&
    current.avatar_key &&
    current.avatar_key !== updated.avatar_key
  ) {
    await deleteMedia(current.avatar_key).catch(() => undefined);
  }

  return {
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      avatarKey: updated.avatar_key,
      emailVerifiedAt: updated.email_verified_at,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
    },
    emailVerificationRequired: emailChanged,
    emailVerificationSent,
  };
}

/**
 * Change the signed-in user's password and revoke every other device session.
 */
export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ revokedSessionCount: number }> {
  const user = await db
    .selectFrom("users")
    .where("id", "=", userId)
    .select(["password_hash"])
    .executeTakeFirst();
  if (!user) throw new AuthError("User not found", "USER_NOT_FOUND", 404);

  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new AuthError(
      "Current password is incorrect",
      "INVALID_CURRENT_PASSWORD",
      401,
    );
  }
  if (await verifyPassword(newPassword, user.password_hash)) {
    throw new AuthError(
      "New password must be different from your current password",
      "PASSWORD_UNCHANGED",
      400,
    );
  }

  const passwordHash = await hashPassword(newPassword);
  const revokedSessionCount = await db.transaction().execute(async (trx) => {
    await trx
      .updateTable("users")
      .set({ password_hash: passwordHash, updated_at: toDbDate() })
      .where("id", "=", userId)
      .execute();
    const revoked = await trx
      .deleteFrom("user_sessions")
      .where("user_id", "=", userId)
      .where("id", "!=", currentSessionId)
      .executeTakeFirst();
    return Number(revoked.numDeletedRows);
  });

  return { revokedSessionCount };
}

/**
 * Refresh the session using a refresh token
 */
export async function refreshSession(
  refreshToken: string,
): Promise<{ tokens: AuthTokens }> {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) {
    throw new AuthError("Invalid refresh token", "INVALID_TOKEN", 401);
  }

  const result = await db.transaction().execute(async (trx) => {
    const session = await trx
      .selectFrom("user_sessions as session")
      .innerJoin("users as user", "user.id", "session.user_id")
      .where("session.id", "=", payload.sessionId)
      .where("session.refresh_token", "=", hashToken(refreshToken))
      .where("session.expires_at", ">", toDbDate())
      .select(["session.id", "session.user_id", "user.email_verified_at"])
      .forUpdate("session")
      .executeTakeFirst();

    if (!session) {
      throw new AuthError(
        "Session not found, expired, or refresh token already used",
        "SESSION_EXPIRED",
        401,
      );
    }

    if (!session.email_verified_at) {
      await trx
        .deleteFrom("user_sessions")
        .where("id", "=", session.id)
        .execute();
      return null;
    }

    const [accessToken, newRefreshToken] = await Promise.all([
      generateAccessToken(session.user_id, session.id),
      generateRefreshToken(session.id),
    ]);

    await trx
      .updateTable("user_sessions")
      .set({
        refresh_token: hashToken(newRefreshToken),
        last_active_at: toDbDate(),
        expires_at: getRefreshTokenExpiry(),
      })
      .where("id", "=", session.id)
      .execute();

    return {
      tokens: {
        accessToken,
        refreshToken: newRefreshToken,
      },
    };
  });

  if (!result) throw emailNotVerifiedError();
  return result;
}

/**
 * Revoke a specific session
 */
export async function revokeSession(
  sessionId: string,
  userId: string,
): Promise<{ success: boolean }> {
  const result = await db
    .deleteFrom("user_sessions")
    .where("id", "=", sessionId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!result.numDeletedRows) {
    throw new AuthError("Session not found", "SESSION_NOT_FOUND", 404);
  }

  return { success: true };
}

/**
 * Revoke all sessions for a user
 */
export async function revokeAllSessions(
  userId: string,
  exceptSessionId?: string,
): Promise<{ count: number }> {
  let query = db.deleteFrom("user_sessions").where("user_id", "=", userId);

  if (exceptSessionId) {
    query = query.where("id", "!=", exceptSessionId);
  }

  const result = await query.executeTakeFirst();

  return { count: Number(result.numDeletedRows) };
}

/**
 * Get all sessions for a user
 */
export async function getUserSessions(userId: string): Promise<UserSession[]> {
  const sessions = await db
    .selectFrom("user_sessions")
    .where("user_id", "=", userId)
    .where("expires_at", ">", toDbDate())
    .select([
      "id",
      "user_id",
      "device_name",
      "device_type",
      "ip_address",
      "user_agent",
      "last_active_at",
      "created_at",
      "expires_at",
    ])
    .orderBy("last_active_at", "desc")
    .execute();

  return sessions.map((session) => ({
    id: session.id,
    userId: session.user_id,
    deviceName: session.device_name,
    deviceType: session.device_type,
    ipAddress: session.ip_address,
    userAgent: session.user_agent,
    lastActiveAt: session.last_active_at,
    createdAt: session.created_at,
    expiresAt: session.expires_at,
  }));
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const user = await db
    .selectFrom("users")
    .where("id", "=", userId)
    .select([
      "id",
      "email",
      "name",
      "avatar_key",
      "email_verified_at",
      "created_at",
      "updated_at",
    ])
    .executeTakeFirst();

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarKey: user.avatar_key,
    emailVerifiedAt: user.email_verified_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/**
 * Confirm that an access token still references an active, non-revoked session.
 */
export async function hasActiveSession(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const session = await db
    .selectFrom("user_sessions")
    .where("id", "=", sessionId)
    .where("user_id", "=", userId)
    .where("expires_at", ">", toDbDate())
    .select("id")
    .executeTakeFirst();

  return Boolean(session);
}

/**
 * Update session's last active time
 */
export async function updateSessionActivity(sessionId: string): Promise<void> {
  await db
    .updateTable("user_sessions")
    .set({ last_active_at: toDbDate() })
    .where("id", "=", sessionId)
    .execute();
}
