import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createLogger, formatError } from "../../lib/logger.js";
import { successMessage, successWithMessage } from "../../lib/response.js";
import { loginSchema, refreshTokenSchema } from "../../lib/schemas/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  login,
  refreshSession,
  revokeSession,
} from "../../services/auth.service.js";
import { loginRateLimiter, refreshRateLimiter } from "./rate-limiters.js";
import { getDeviceInfo, handleAuthError } from "./utils.js";

const logger = createLogger("AuthRoutes:Login");

export const loginRoutes = new Hono();

/**
 * POST /login
 * Login with email and password
 * Rate limit: 5 attempts per 15 minutes per IP
 */
loginRoutes.post(
  "/login",
  loginRateLimiter,
  zValidator("json", loginSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");

      const deviceInfo = {
        ...body.deviceInfo,
        ...getDeviceInfo(c),
      };

      const { user, tokens, session } = await login(
        body.email,
        body.password,
        deviceInfo,
      );

      return successWithMessage(c, "Login successful", {
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
      return handleAuthError(c, error, logger, formatError, "Login error");
    }
  },
);

/**
 * POST /logout
 * Logout the current session
 */
loginRoutes.post("/logout", authMiddleware, async (c) => {
  try {
    const user = c.get("user");
    const session = c.get("session");

    await revokeSession(session.id, user.id);

    return successMessage(c, "Logged out successfully");
  } catch (error) {
    return handleAuthError(c, error, logger, formatError, "Logout error");
  }
});

/**
 * POST /refresh
 * Refresh access token using refresh token
 * Rate limit: 20 attempts per minute per IP
 */
loginRoutes.post(
  "/refresh",
  refreshRateLimiter,
  zValidator("json", refreshTokenSchema),
  async (c) => {
    try {
      const body = c.req.valid("json");

      const { tokens } = await refreshSession(body.refreshToken);

      return successWithMessage(c, "Token refreshed successfully", {
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      });
    } catch (error) {
      return handleAuthError(
        c,
        error,
        logger,
        formatError,
        "Token refresh error",
      );
    }
  },
);
