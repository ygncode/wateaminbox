import { db, type AuthTokenType, type Database } from "@wateaminbox/database";
import { toDbDate } from "@wateaminbox/shared";
import crypto from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { sendPasswordResetEmail, sendVerificationEmail } from "../lib/email.js";
import { AuthError } from "../lib/errors.js";
import {
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiry,
  verifyRefreshToken,
} from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { hashToken } from "../lib/security.js";

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
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

async function issueAuthToken(
  database: AuthDatabase,
  userId: string,
  type: AuthTokenType,
  ttlMs: number,
): Promise<string> {
  const token = generateToken();

  // Only the newest token of each type remains valid for a user.
  await database
    .deleteFrom("auth_tokens")
    .where("user_id", "=", userId)
    .where("type", "=", type)
    .execute();

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
): Promise<{ user: AuthUser }> {
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

  await sendVerificationEmail(user.email, verificationToken);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerifiedAt: user.email_verified_at,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
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

  // Insert a unique placeholder until the signed refresh token can include the session ID.
  const refreshTokenPlaceholder = hashToken(generateToken());

  // Create session
  const session = await db
    .insertInto("user_sessions")
    .values({
      user_id: user.id,
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

  // Generate JWT tokens
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(user.id, session.id),
    generateRefreshToken(session.id),
  ]);

  await db
    .updateTable("user_sessions")
    .set({ refresh_token: hashToken(refreshToken) })
    .where("id", "=", session.id)
    .execute();

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerifiedAt: user.email_verified_at,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
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
      "email_verified_at",
      "created_at",
      "updated_at",
    ])
      .executeTakeFirstOrThrow();

    await trx
      .updateTable("auth_tokens")
      .set({ used_at: now })
      .where("id", "=", storedToken.id)
      .execute();

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.email_verified_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
  });
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
 * Refresh the session using a refresh token
 */
export async function refreshSession(
  refreshToken: string,
): Promise<{ tokens: AuthTokens }> {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) {
    throw new AuthError("Invalid refresh token", "INVALID_TOKEN", 401);
  }

  return db.transaction().execute(async (trx) => {
    const session = await trx
    .selectFrom("user_sessions")
    .where("id", "=", payload.sessionId)
      .where("refresh_token", "=", hashToken(refreshToken))
    .where("expires_at", ">", toDbDate())
    .selectAll()
      .forUpdate()
    .executeTakeFirst();

  if (!session) {
      throw new AuthError(
        "Session not found, expired, or refresh token already used",
        "SESSION_EXPIRED",
        401,
      );
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
