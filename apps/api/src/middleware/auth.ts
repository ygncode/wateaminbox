import { Context, Next } from "hono";
import { verifyAccessToken } from "../lib/jwt.js";
import {
  getUserById,
  hasActiveSession,
  updateSessionActivity,
} from "../services/auth.service.js";

// Extend Hono's context variables
declare module "hono" {
  interface ContextVariableMap {
    user: {
      id: string;
      email: string;
      name: string | null;
      avatarKey?: string | null;
      emailVerifiedAt: Date | null;
    };
    session: {
      id: string;
    };
  }
}

/**
 * Extract Bearer token from Authorization header
 */
function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Authentication middleware
 * Requires a valid JWT access token in the Authorization header
 */
export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  const token = extractToken(authHeader);

  if (!token) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Missing or invalid Authorization header",
      },
      401,
    );
  }

  // Verify the JWT token
  const payload = await verifyAccessToken(token);
  if (!payload) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Invalid or expired token",
      },
      401,
    );
  }

  // Confirm both the user and referenced session still exist. This makes
  // logout/session revocation effective immediately rather than at JWT expiry.
  const [user, sessionIsActive] = await Promise.all([
    getUserById(payload.userId),
    hasActiveSession(payload.sessionId, payload.userId),
  ]);
  if (!user || !sessionIsActive) {
    return c.json(
      {
        error: "Unauthorized",
        message: "User session is no longer active",
      },
      401,
    );
  }

  // Update session activity (fire and forget)
  updateSessionActivity(payload.sessionId).catch(() => {
    // Ignore errors for session activity updates
  });

  // Set user and session in context
  c.set("user", {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarKey: user.avatarKey,
    emailVerifiedAt: user.emailVerifiedAt,
  });
  c.set("session", {
    id: payload.sessionId,
  });

  await next();
};

/**
 * Optional auth middleware
 * Continues even if no auth is provided, but sets user context if valid token exists
 */
export const optionalAuthMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");
  const token = extractToken(authHeader);

  if (token) {
    const payload = await verifyAccessToken(token);
    if (payload) {
      const [user, sessionIsActive] = await Promise.all([
        getUserById(payload.userId),
        hasActiveSession(payload.sessionId, payload.userId),
      ]);
      if (user && sessionIsActive) {
        c.set("user", {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarKey: user.avatarKey,
          emailVerifiedAt: user.emailVerifiedAt,
        });
        c.set("session", {
          id: payload.sessionId,
        });

        // Update session activity (fire and forget)
        updateSessionActivity(payload.sessionId).catch(() => {});
      }
    }
  }

  await next();
};

/**
 * Require email verification middleware
 * Must be used after authMiddleware
 */
export const requireEmailVerification = async (c: Context, next: Next) => {
  const user = c.get("user");

  if (!user) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Authentication required",
      },
      401,
    );
  }

  if (!user.emailVerifiedAt) {
    return c.json(
      {
        error: "Forbidden",
        message: "Email verification required",
      },
      403,
    );
  }

  await next();
};
