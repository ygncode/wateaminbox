import { Hono } from "hono";
import { badRequest } from "../../lib/errors.js";
import { successData, successMessage, successWithMessage } from "../../lib/response.js";
import { authMiddleware } from "../../middleware/auth.js";
import {
  getUserSessions,
  revokeAllSessions,
  revokeSession,
} from "../../services/auth.service.js";

export const sessionRoutes = new Hono();

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
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: !!user.emailVerifiedAt,
    },
  });
});
