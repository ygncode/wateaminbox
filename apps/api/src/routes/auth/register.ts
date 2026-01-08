import { Hono } from 'hono'
import { createLogger, formatError } from '../../lib/logger.js'
import { validatePasswordStrength } from '../../lib/password.js'
import {
  createdWithMessage,
  formatZodErrors,
  successWithMessage,
  validationError,
} from '../../lib/response.js'
import { authMiddleware } from '../../middleware/auth.js'
import { register, verifyEmail } from '../../services/auth.service.js'
import { registerRateLimiter } from './rate-limiters.js'
import { registerSchema, verifyEmailSchema } from './schemas.js'
import { handleAuthError } from './utils.js'

const logger = createLogger('AuthRoutes:Register')

export const registerRoutes = new Hono()

/**
 * POST /register
 * Register a new user with email and password
 * Rate limit: 3 attempts per hour per IP
 */
registerRoutes.post('/register', registerRateLimiter, async (c) => {
  try {
    const body = await c.req.json()
    const result = registerSchema.safeParse(body)

    if (!result.success) {
      return validationError(c, formatZodErrors(result.error.errors))
    }

    // Additional password strength validation
    const passwordCheck = validatePasswordStrength(result.data.password)
    if (!passwordCheck.isValid) {
      return validationError(c, [{ field: 'password', message: passwordCheck.message }])
    }

    const { user } = await register(result.data.email, result.data.password, result.data.name)

    return createdWithMessage(
      c,
      'Registration successful. Please check your email to verify your account.',
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: !!user.emailVerifiedAt,
          createdAt: user.createdAt,
        },
      }
    )
  } catch (error) {
    return handleAuthError(c, error, logger, formatError, 'Registration error')
  }
})

/**
 * POST /verify-email
 * Verify email with token
 */
registerRoutes.post('/verify-email', authMiddleware, async (c) => {
  try {
    const body = await c.req.json()
    const result = verifyEmailSchema.safeParse(body)

    if (!result.success) {
      return validationError(c, formatZodErrors(result.error.errors))
    }

    const user = c.get('user')
    const updatedUser = await verifyEmail(user.id, result.data.token)

    return successWithMessage(c, 'Email verified successfully', {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        emailVerified: !!updatedUser.emailVerifiedAt,
      },
    })
  } catch (error) {
    return handleAuthError(c, error, logger, formatError, 'Email verification error')
  }
})
