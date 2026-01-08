import { Hono } from 'hono'
import { createLogger, formatError } from '../../lib/logger.js'
import { formatZodErrors, successWithMessage, validationError } from '../../lib/response.js'
import { authMiddleware } from '../../middleware/auth.js'
import { login, refreshSession, revokeSession } from '../../services/auth.service.js'
import { loginRateLimiter, refreshRateLimiter } from './rate-limiters.js'
import { loginSchema, refreshTokenSchema } from './schemas.js'
import { getDeviceInfo, handleAuthError } from './utils.js'

const logger = createLogger('AuthRoutes:Login')

export const loginRoutes = new Hono()

/**
 * POST /login
 * Login with email and password
 * Rate limit: 5 attempts per 15 minutes per IP
 */
loginRoutes.post('/login', loginRateLimiter, async (c) => {
  try {
    const body = await c.req.json()
    const result = loginSchema.safeParse(body)

    if (!result.success) {
      return validationError(c, formatZodErrors(result.error.errors))
    }

    const deviceInfo = {
      ...result.data.deviceInfo,
      ...getDeviceInfo(c),
    }

    const { user, tokens, session } = await login(
      result.data.email,
      result.data.password,
      deviceInfo
    )

    return successWithMessage(c, 'Login successful', {
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
    })
  } catch (error) {
    return handleAuthError(c, error, logger, formatError, 'Login error')
  }
})

/**
 * POST /logout
 * Logout the current session
 */
loginRoutes.post('/logout', authMiddleware, async (c) => {
  try {
    const user = c.get('user')
    const session = c.get('session')

    await revokeSession(session.id, user.id)

    return c.json({ message: 'Logged out successfully' })
  } catch (error) {
    return handleAuthError(c, error, logger, formatError, 'Logout error')
  }
})

/**
 * POST /refresh
 * Refresh access token using refresh token
 * Rate limit: 20 attempts per minute per IP
 */
loginRoutes.post('/refresh', refreshRateLimiter, async (c) => {
  try {
    const body = await c.req.json()
    const result = refreshTokenSchema.safeParse(body)

    if (!result.success) {
      return validationError(c, formatZodErrors(result.error.errors))
    }

    const { tokens } = await refreshSession(result.data.refreshToken)

    return successWithMessage(c, 'Token refreshed successfully', {
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    })
  } catch (error) {
    return handleAuthError(c, error, logger, formatError, 'Token refresh error')
  }
})
