import { Hono } from 'hono'
import { badRequest, serverError } from '../../lib/errors.js'
import { createLogger, formatError } from '../../lib/logger.js'
import { successMessage, successWithMessage } from '../../lib/response.js'
import { authMiddleware } from '../../middleware/auth.js'
import {
  getUserSessions,
  revokeAllSessions,
  revokeSession,
} from '../../services/auth.service.js'
import { handleAuthError } from './utils.js'

const logger = createLogger('AuthRoutes:Session')

export const sessionRoutes = new Hono()

/**
 * GET /sessions
 * List all active sessions for the current user
 */
sessionRoutes.get('/sessions', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    const currentSession = c.get('session')
    const sessions = await getUserSessions(user.id)

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
    })
  } catch (error) {
    logger.error({ err: formatError(error) }, 'Get sessions error')
    return serverError(c)
  }
})

/**
 * DELETE /sessions/:id
 * Delete a specific session
 */
sessionRoutes.delete('/sessions/:id', authMiddleware, async (c) => {
  try {
    const sessionId = c.req.param('id')
    const user = c.get('user')
    const currentSession = c.get('session')

    if (sessionId === currentSession.id) {
      return badRequest(c, 'Cannot delete current session. Use /auth/logout instead.')
    }

    await revokeSession(sessionId, user.id)

    return successMessage(c, 'Session deleted successfully')
  } catch (error) {
    return handleAuthError(c, error, logger, formatError, 'Delete session error')
  }
})

/**
 * DELETE /sessions
 * Logout all sessions except the current one
 */
sessionRoutes.delete('/sessions', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    const currentSession = c.get('session')

    const { count } = await revokeAllSessions(user.id, currentSession.id)

    return successWithMessage(c, `Successfully logged out of ${count} other session(s)`, {
      count,
    })
  } catch (error) {
    logger.error({ err: formatError(error) }, 'Delete all sessions error')
    return serverError(c)
  }
})

/**
 * GET /me
 * Get current user information
 */
sessionRoutes.get('/me', authMiddleware, async (c) => {
  try {
    const user = c.get('user')

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: !!user.emailVerifiedAt,
      },
    })
  } catch (error) {
    logger.error({ err: formatError(error) }, 'Get user error')
    return serverError(c)
  }
})
