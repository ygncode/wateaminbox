import { randomUUID } from "node:crypto";
import * as jose from "jose";
import { nowMs, toDbDate } from "@wateaminbox/shared";
import { env } from "./env.js";

const SECRET = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = "wateaminbox-api";
const AUDIENCE = "wateaminbox";

export interface AccessTokenPayload {
  userId: string;
  sessionId: string;
}

export interface RefreshTokenPayload {
  sessionId: string;
  tokenId: string;
}

/**
 * Parse duration string to seconds
 * Supports: 15m, 1h, 7d, etc.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 60 * 60 * 24;
    default:
      throw new Error(`Invalid duration unit: ${unit}`);
  }
}

/**
 * Generate an access token for a user session
 * @param userId - The user's ID
 * @param sessionId - The session ID
 * @returns JWT access token string
 */
export async function generateAccessToken(
  userId: string,
  sessionId: string,
): Promise<string> {
  const expiresIn = parseDuration(env.JWT_ACCESS_EXPIRES_IN);

  return await new jose.SignJWT({ userId, sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(Math.floor(nowMs() / 1000) + expiresIn)
    .setSubject(userId)
    .sign(SECRET);
}

/**
 * Generate a refresh token for a session
 * @param sessionId - The session ID
 * @returns JWT refresh token string
 */
export async function generateRefreshToken(sessionId: string): Promise<string> {
  const expiresIn = parseDuration(env.JWT_REFRESH_EXPIRES_IN);

  return await new jose.SignJWT({ sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(Math.floor(nowMs() / 1000) + expiresIn)
    .sign(SECRET);
}

/**
 * Verify an access token and extract its payload
 * @param token - The JWT access token to verify
 * @returns The decoded payload or null if invalid
 */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (
      typeof payload.userId !== "string" ||
      typeof payload.sessionId !== "string"
    ) {
      return null;
    }

    return {
      userId: payload.userId,
      sessionId: payload.sessionId,
    };
  } catch {
    return null;
  }
}

/**
 * Verify a refresh token and extract its payload
 * @param token - The JWT refresh token to verify
 * @returns The decoded payload or null if invalid
 */
export async function verifyRefreshToken(
  token: string,
): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (
      typeof payload.sessionId !== "string" ||
      typeof payload.jti !== "string"
    ) {
      return null;
    }

    return {
      sessionId: payload.sessionId,
      tokenId: payload.jti,
    };
  } catch {
    return null;
  }
}

/**
 * Decode a token without verifying it (for debugging)
 * @param token - The JWT token to decode
 * @returns The decoded payload or null if invalid format
 */
export function decodeToken(token: string): jose.JWTPayload | null {
  try {
    return jose.decodeJwt(token);
  } catch {
    return null;
  }
}

/**
 * Calculate the expiration date for a refresh token
 * @returns Date when the refresh token expires
 */
export function getRefreshTokenExpiry(): Date {
  const expiresIn = parseDuration(env.JWT_REFRESH_EXPIRES_IN);
  return toDbDate(nowMs() + expiresIn * 1000);
}
