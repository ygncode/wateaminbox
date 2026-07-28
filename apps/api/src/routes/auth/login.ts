import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { AuthError } from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { successMessage, successWithMessage } from "../../lib/response.js";
import { loginSchema } from "../../lib/schemas/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  login,
  refreshSession,
  revokeSession,
  toAuthUserResponse,
} from "../../services/auth.service.js";
import {
  clearRefreshTokenCookie,
  getRefreshTokenCookie,
  setRefreshTokenCookie,
} from "./cookies.js";
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
      const publicUser = await toAuthUserResponse(user);

      setRefreshTokenCookie(c, tokens.refreshToken);

      return successWithMessage(c, "Login successful", {
        user: {
          id: user.id,
          email: publicUser.email,
          name: publicUser.name,
          avatarUrl: publicUser.avatarUrl,
          gravatarUrl: publicUser.gravatarUrl,
          hasCustomAvatar: publicUser.hasCustomAvatar,
          emailVerified: publicUser.emailVerified,
        },
        tokens: {
          accessToken: tokens.accessToken,
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
    clearRefreshTokenCookie(c);

    return successMessage(c, "Logged out successfully");
  } catch (error) {
    clearRefreshTokenCookie(c);
    return handleAuthError(c, error, logger, formatError, "Logout error");
  }
});

/**
 * POST /refresh
 * Refresh access token using refresh token
 * Rate limit: 20 attempts per minute per IP
 */
loginRoutes.post("/refresh", refreshRateLimiter, async (c) => {
  try {
    const refreshToken = getRefreshTokenCookie(c);
    if (!refreshToken) {
      throw new AuthError("Refresh cookie is missing", "INVALID_TOKEN", 401);
    }

    const { tokens } = await refreshSession(refreshToken);
    setRefreshTokenCookie(c, tokens.refreshToken);

    return successWithMessage(c, "Token refreshed successfully", {
      tokens: {
        accessToken: tokens.accessToken,
      },
    });
  } catch (error) {
    clearRefreshTokenCookie(c);
    return handleAuthError(
      c,
      error,
      logger,
      formatError,
      "Token refresh error",
    );
  }
});
