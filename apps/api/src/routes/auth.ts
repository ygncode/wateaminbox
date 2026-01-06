import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  getUserSessions,
  AuthError,
} from "../services/auth.service.js";
import { validatePasswordStrength } from "../lib/password.js";
import { authMiddleware } from "../middleware/auth.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { createLogger, formatError } from "../lib/logger.js";

const logger = createLogger("AuthRoutes");

export const authRoutes = new Hono();

// Endpoint-specific rate limiters for auth endpoints
// These use IP-based keys since they're pre-authentication or token-based
// Only apply rate limiting if enabled in config

// Login rate limiter: 5 attempts per 15 minutes
const loginRateLimiter: MiddlewareHandler = rateLimitConfig.enabled
  ? createRateLimitMiddleware({
      store: rateLimitStore,
      tier: rateLimitConfig.tiers.auth.login,
      keyStrategy: "ip",
      keyPrefix: "auth-login",
    })
  : async (_c, next) => await next();

// Register rate limiter: 3 attempts per hour
const registerRateLimiter: MiddlewareHandler = rateLimitConfig.enabled
  ? createRateLimitMiddleware({
      store: rateLimitStore,
      tier: rateLimitConfig.tiers.auth.register,
      keyStrategy: "ip",
      keyPrefix: "auth-register",
    })
  : async (_c, next) => await next();

// Forgot password rate limiter: 3 attempts per hour
const forgotPasswordRateLimiter: MiddlewareHandler = rateLimitConfig.enabled
  ? createRateLimitMiddleware({
      store: rateLimitStore,
      tier: rateLimitConfig.tiers.auth.forgotPassword,
      keyStrategy: "ip",
      keyPrefix: "auth-forgot-password",
    })
  : async (_c, next) => await next();

// Refresh token rate limiter: 20 attempts per minute
const refreshRateLimiter: MiddlewareHandler = rateLimitConfig.enabled
  ? createRateLimitMiddleware({
      store: rateLimitStore,
      tier: rateLimitConfig.tiers.auth.refresh,
      keyStrategy: "ip",
      keyPrefix: "auth-refresh",
    })
  : async (_c, next) => await next();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name must be at most 255 characters")
    .optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  deviceInfo: z
    .object({
      deviceName: z.string().optional(),
      deviceType: z.string().optional(),
    })
    .optional(),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  token: z.string().min(1, "Token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

/**
 * Helper to extract device info from request
 */
function getDeviceInfo(c: {
  req: {
    header: (name: string) => string | undefined;
  };
}): { ipAddress?: string; userAgent?: string } {
  return {
    ipAddress:
      c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || undefined,
    userAgent: c.req.header("user-agent") || undefined,
  };
}

/**
 * POST /auth/register
 * Register a new user with email and password
 * Rate limit: 3 attempts per hour per IP
 */
authRoutes.post("/register", registerRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const result = registerSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        {
          error: "Validation Error",
          details: result.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        400,
      );
    }

    // Additional password strength validation
    const passwordCheck = validatePasswordStrength(result.data.password);
    if (!passwordCheck.isValid) {
      return c.json(
        {
          error: "Validation Error",
          details: [{ field: "password", message: passwordCheck.message }],
        },
        400,
      );
    }

    const { user } = await register(
      result.data.email,
      result.data.password,
      result.data.name,
    );

    return c.json(
      {
        message:
          "Registration successful. Please check your email to verify your account.",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: !!user.emailVerifiedAt,
          createdAt: user.createdAt,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(
        { error: error.code, message: error.message },
        error.statusCode as 400 | 401 | 403 | 404 | 409,
      );
    }
    logger.error({ err: formatError(error) }, "Registration error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * POST /auth/login
 * Login with email and password
 * Rate limit: 5 attempts per 15 minutes per IP
 */
authRoutes.post("/login", loginRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const result = loginSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        {
          error: "Validation Error",
          details: result.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        400,
      );
    }

    const deviceInfo = {
      ...result.data.deviceInfo,
      ...getDeviceInfo(c),
    };

    const { user, tokens, session } = await login(
      result.data.email,
      result.data.password,
      deviceInfo,
    );

    return c.json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: !!user.emailVerifiedAt,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(
        { error: error.code, message: error.message },
        error.statusCode as 400 | 401 | 403 | 404 | 409,
      );
    }
    logger.error({ err: formatError(error) }, "Login error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * POST /auth/logout
 * Logout the current session
 */
authRoutes.post("/logout", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const session = c.get("session");

    await revokeSession(session.id, user.id);

    return c.json({ message: "Logged out successfully" });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(
        { error: error.code, message: error.message },
        error.statusCode as 400 | 401 | 403 | 404 | 409,
      );
    }
    logger.error({ err: formatError(error) }, "Logout error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * POST /auth/verify-email
 * Verify email with token
 */
authRoutes.post("/verify-email", authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const result = verifyEmailSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        {
          error: "Validation Error",
          details: result.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        400,
      );
    }

    const user = c.get("user");
    const updatedUser = await verifyEmail(user.id, result.data.token);

    return c.json({
      message: "Email verified successfully",
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        emailVerified: !!updatedUser.emailVerifiedAt,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(
        { error: error.code, message: error.message },
        error.statusCode as 400 | 401 | 403 | 404 | 409,
      );
    }
    logger.error({ err: formatError(error) }, "Email verification error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * POST /auth/forgot-password
 * Request a password reset email
 * Rate limit: 3 attempts per hour per IP
 */
authRoutes.post("/forgot-password", forgotPasswordRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const result = forgotPasswordSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        {
          error: "Validation Error",
          details: result.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        400,
      );
    }

    await forgotPassword(result.data.email);

    // Always return success to prevent email enumeration
    return c.json({
      message:
        "If an account exists with this email, you will receive a password reset link.",
    });
  } catch (error) {
    logger.error({ err: formatError(error) }, "Forgot password error");
    // Always return success to prevent email enumeration
    return c.json({
      message:
        "If an account exists with this email, you will receive a password reset link.",
    });
  }
});

/**
 * POST /auth/reset-password
 * Reset password with token
 */
authRoutes.post("/reset-password", async (c) => {
  try {
    const body = await c.req.json();
    const result = resetPasswordSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        {
          error: "Validation Error",
          details: result.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        400,
      );
    }

    // Additional password strength validation
    const passwordCheck = validatePasswordStrength(result.data.password);
    if (!passwordCheck.isValid) {
      return c.json(
        {
          error: "Validation Error",
          details: [{ field: "password", message: passwordCheck.message }],
        },
        400,
      );
    }

    await resetPassword(
      result.data.email,
      result.data.token,
      result.data.password,
    );

    return c.json({ message: "Password reset successfully" });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(
        { error: error.code, message: error.message },
        error.statusCode as 400 | 401 | 403 | 404 | 409,
      );
    }
    logger.error({ err: formatError(error) }, "Reset password error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 * Rate limit: 20 attempts per minute per IP
 */
authRoutes.post("/refresh", refreshRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const result = refreshTokenSchema.safeParse(body);

    if (!result.success) {
      return c.json(
        {
          error: "Validation Error",
          details: result.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        400,
      );
    }

    const { tokens } = await refreshSession(result.data.refreshToken);

    return c.json({
      message: "Token refreshed successfully",
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(
        { error: error.code, message: error.message },
        error.statusCode as 400 | 401 | 403 | 404 | 409,
      );
    }
    logger.error({ err: formatError(error) }, "Token refresh error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * GET /auth/sessions
 * List all active sessions for the current user
 */
authRoutes.get("/sessions", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const currentSession = c.get("session");
    const sessions = await getUserSessions(user.id);

    return c.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        deviceName: session.deviceName,
        deviceType: session.deviceType,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        lastActiveAt: session.lastActiveAt,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        isCurrent: session.id === currentSession.id,
      })),
    });
  } catch (error) {
    logger.error({ err: formatError(error) }, "Get sessions error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * DELETE /auth/sessions/:id
 * Delete a specific session
 */
authRoutes.delete("/sessions/:id", authMiddleware, async (c) => {
  try {
    const sessionId = c.req.param("id");
    const user = c.get("user");
    const currentSession = c.get("session");

    if (sessionId === currentSession.id) {
      return c.json(
        {
          error: "Bad Request",
          message: "Cannot delete current session. Use /auth/logout instead.",
        },
        400,
      );
    }

    await revokeSession(sessionId, user.id);

    return c.json({ message: "Session deleted successfully" });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(
        { error: error.code, message: error.message },
        error.statusCode as 400 | 401 | 403 | 404 | 409,
      );
    }
    logger.error({ err: formatError(error) }, "Delete session error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * DELETE /auth/sessions
 * Logout all sessions except the current one
 */
authRoutes.delete("/sessions", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const currentSession = c.get("session");

    const { count } = await revokeAllSessions(user.id, currentSession.id);

    return c.json({
      message: `Successfully logged out of ${count} other session(s)`,
      count,
    });
  } catch (error) {
    logger.error({ err: formatError(error) }, "Delete all sessions error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

/**
 * GET /auth/me
 * Get current user information
 */
authRoutes.get("/me", authMiddleware, async (c) => {
  try {
    const user = c.get("user");

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: !!user.emailVerifiedAt,
      },
    });
  } catch (error) {
    logger.error({ err: formatError(error) }, "Get user error");
    return c.json({ error: "Internal Server Error" }, 500);
  }
});
