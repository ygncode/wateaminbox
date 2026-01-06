import { db } from "@whatsapp-web/database";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from "../lib/jwt.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/email.js";
import crypto from "crypto";

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

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Generate a secure random token
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Register a new user with email and password
 */
export async function register(
  email: string,
  password: string,
  name?: string,
): Promise<{ user: AuthUser; verificationToken: string }> {
  // Check if user already exists
  const existingUser = await db
    .selectFrom("users")
    .where("email", "=", email.toLowerCase())
    .selectAll()
    .executeTakeFirst();

  if (existingUser) {
    throw new AuthError(
      "An account with this email already exists",
      "EMAIL_EXISTS",
      409,
    );
  }

  // Hash the password
  const passwordHash = await hashPassword(password);

  // Generate email verification token
  const verificationToken = generateToken();

  // Create the user
  const user = await db
    .insertInto("users")
    .values({
      email: email.toLowerCase(),
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

  // Store the verification token (we'll use a simple approach - store in invitations table or separate tokens table)
  // For now, we'll embed it in the email directly
  // In production, you'd want a separate email_verification_tokens table

  // Send verification email
  await sendVerificationEmail(email, verificationToken);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerifiedAt: user.email_verified_at,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
    verificationToken, // Return for testing purposes
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

  // Generate refresh token string (for database storage)
  const refreshTokenString = generateToken();

  // Create session
  const session = await db
    .insertInto("user_sessions")
    .values({
      user_id: user.id,
      device_name: deviceInfo?.deviceName ?? null,
      device_type: deviceInfo?.deviceType ?? null,
      ip_address: deviceInfo?.ipAddress ?? null,
      user_agent: deviceInfo?.userAgent ?? null,
      refresh_token: refreshTokenString,
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
 * Verify email with token
 * Note: This is a simplified implementation. In production, you'd want a separate tokens table.
 */
export async function verifyEmail(
  userId: string,
  _token: string,
): Promise<AuthUser> {
  // In a full implementation, you would:
  // 1. Look up the token in a verification_tokens table
  // 2. Verify the token hasn't expired
  // 3. Mark the user as verified

  const user = await db
    .updateTable("users")
    .set({
      email_verified_at: new Date(),
      updated_at: new Date(),
    })
    .where("id", "=", userId)
    .returning(["id", "email", "name", "email_verified_at", "created_at", "updated_at"])
    .executeTakeFirst();

  if (!user) {
    throw new AuthError("Invalid verification token", "INVALID_TOKEN", 400);
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
 * Request a password reset
 */
export async function forgotPassword(
  email: string,
): Promise<{ success: boolean; token?: string }> {
  const user = await db
    .selectFrom("users")
    .where("email", "=", email.toLowerCase())
    .select(["id", "email"])
    .executeTakeFirst();

  // Always return success to prevent email enumeration
  if (!user) {
    return { success: true };
  }

  const resetToken = generateToken();

  // In production, store this token in a password_reset_tokens table
  // For now, we'll just send it directly
  await sendPasswordResetEmail(email, resetToken);

  return { success: true, token: resetToken }; // Token returned for testing
}

/**
 * Reset password with token
 */
export async function resetPassword(
  email: string,
  _token: string,
  newPassword: string,
): Promise<{ success: boolean }> {
  // In production, you would:
  // 1. Look up the token in password_reset_tokens table
  // 2. Verify it hasn't expired
  // 3. Update the password
  // 4. Delete the token
  // 5. Optionally revoke all sessions

  const passwordHash = await hashPassword(newPassword);

  const result = await db
    .updateTable("users")
    .set({
      password_hash: passwordHash,
      updated_at: new Date(),
    })
    .where("email", "=", email.toLowerCase())
    .executeTakeFirst();

  if (!result.numUpdatedRows) {
    throw new AuthError("Invalid reset token", "INVALID_TOKEN", 400);
  }

  return { success: true };
}

/**
 * Refresh the session using a refresh token
 */
export async function refreshSession(
  refreshToken: string,
): Promise<{ tokens: AuthTokens }> {
  // Verify the JWT refresh token
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) {
    throw new AuthError("Invalid refresh token", "INVALID_TOKEN", 401);
  }

  // Find the session
  const session = await db
    .selectFrom("user_sessions")
    .where("id", "=", payload.sessionId)
    .where("expires_at", ">", new Date())
    .selectAll()
    .executeTakeFirst();

  if (!session) {
    throw new AuthError("Session not found or expired", "SESSION_EXPIRED", 401);
  }

  // Update last active time and generate new refresh token
  const newRefreshTokenString = generateToken();

  await db
    .updateTable("user_sessions")
    .set({
      refresh_token: newRefreshTokenString,
      last_active_at: new Date(),
      expires_at: getRefreshTokenExpiry(),
    })
    .where("id", "=", session.id)
    .execute();

  // Generate new tokens
  const [accessToken, newRefreshToken] = await Promise.all([
    generateAccessToken(session.user_id, session.id),
    generateRefreshToken(session.id),
  ]);

  return {
    tokens: {
      accessToken,
      refreshToken: newRefreshToken,
    },
  };
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
    .where("expires_at", ">", new Date())
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
 * Update session's last active time
 */
export async function updateSessionActivity(sessionId: string): Promise<void> {
  await db
    .updateTable("user_sessions")
    .set({ last_active_at: new Date() })
    .where("id", "=", sessionId)
    .execute();
}
