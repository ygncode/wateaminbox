import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { badRequest } from "../../lib/errors.js";
import { createLogger, formatError } from "../../lib/logger.js";
import { validatePasswordStrength } from "../../lib/password.js";
import {
  successData,
  successMessage,
  successWithMessage,
  validationError,
} from "../../lib/response.js";
import {
  changePasswordSchema,
  updateProfileSchema,
} from "../../lib/schemas/index.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  changePassword,
  getUserSessions,
  revokeAllSessions,
  revokeSession,
  toAuthUserResponse,
  updateProfile,
} from "../../services/auth.service.js";
import { handleAuthError } from "./utils.js";

export const sessionRoutes = new Hono();
const logger = createLogger("AuthRoutes:Session");

/**
 * GET /sessions
 * List all active sessions for the current user
 */
sessionRoutes.get("/sessions", authMiddleware, async (c) => {
  const user = c.get("user");
  const currentSession = c.get("session");
  const sessions = await getUserSessions(user.id);

  return successData(c, {
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
});

/**
 * DELETE /sessions/:id
 * Delete a specific session
 */
sessionRoutes.delete("/sessions/:id", authMiddleware, async (c) => {
  const sessionId = c.req.param("id");
  const user = c.get("user");
  const currentSession = c.get("session");

  if (sessionId === currentSession.id) {
    return badRequest(
      c,
      "Cannot delete current session. Use /auth/logout instead.",
    );
  }

  await revokeSession(sessionId, user.id);

  return successMessage(c, "Session deleted successfully");
});

/**
 * DELETE /sessions
 * Logout all sessions except the current one
 */
sessionRoutes.delete("/sessions", authMiddleware, async (c) => {
  const user = c.get("user");
  const currentSession = c.get("session");

  const { count } = await revokeAllSessions(user.id, currentSession.id);

  return successWithMessage(
    c,
    `Successfully logged out of ${count} other session(s)`,
    { count },
  );
});

/**
 * GET /me
 * Get current user information
 */
sessionRoutes.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");

  return successData(c, {
    user: await toAuthUserResponse(user),
  });
});

/**
 * PATCH /me
 * Update the current user's name, email, or profile image.
 */
sessionRoutes.patch(
  "/me",
  authMiddleware,
  zValidator("json", updateProfileSchema),
  async (c) => {
    try {
      const user = c.get("user");
      const result = await updateProfile(user.id, c.req.valid("json"));
      return successWithMessage(c, "Profile updated successfully", {
        user: await toAuthUserResponse(result.user),
        emailVerificationSent: result.emailVerificationSent,
      });
    } catch (error) {
      return handleAuthError(
        c,
        error,
        logger,
        formatError,
        "Profile update error",
      );
    }
  },
);

/**
 * POST /change-password
 * Change the current user's password and revoke other device sessions.
 */
sessionRoutes.post(
  "/change-password",
  authMiddleware,
  zValidator("json", changePasswordSchema),
  async (c) => {
    try {
      const user = c.get("user");
      const session = c.get("session");
      const body = c.req.valid("json");
      const passwordCheck = validatePasswordStrength(body.newPassword);
      if (!passwordCheck.isValid) {
        return validationError(c, [
          {
            field: "newPassword",
            message: passwordCheck.message ?? "Password is not strong enough",
          },
        ]);
      }

      const result = await changePassword(
        user.id,
        session.id,
        body.currentPassword,
        body.newPassword,
      );
      return successWithMessage(c, "Password changed successfully", result);
    } catch (error) {
      return handleAuthError(
        c,
        error,
        logger,
        formatError,
        "Password change error",
      );
    }
  },
);
