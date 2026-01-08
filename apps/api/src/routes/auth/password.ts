import { Hono } from 'hono'
import { createLogger, formatError } from '../../lib/logger.js'
import { validatePasswordStrength } from '../../lib/password.js'
import { formatZodErrors, successMessage, validationError } from '../../lib/response.js'
import { forgotPassword, resetPassword } from '../../services/auth.service.js'
import { forgotPasswordRateLimiter } from './rate-limiters.js'
import { forgotPasswordSchema, resetPasswordSchema } from './schemas.js'
import { handleAuthError } from './utils.js'

const logger = createLogger('AuthRoutes:Password')

export const passwordRoutes = new Hono()

/**
 * POST /forgot-password
 * Request a password reset email
 * Rate limit: 3 attempts per hour per IP
 */
passwordRoutes.post('/forgot-password', forgotPasswordRateLimiter, async (c) => {
  try {
    const body = await c.req.json()
    const result = forgotPasswordSchema.safeParse(body)

    if (!result.success) {
      return validationError(c, formatZodErrors(result.error.errors))
    }

    await forgotPassword(result.data.email)

    // Always return success to prevent email enumeration
    return successMessage(
      c,
      'If an account exists with this email, you will receive a password reset link.'
    )
  } catch (error) {
    logger.error({ err: formatError(error) }, 'Forgot password error')
    // Always return success to prevent email enumeration
    return successMessage(
      c,
      'If an account exists with this email, you will receive a password reset link.'
    )
  }
})

/**
 * POST /reset-password
 * Reset password with token
 */
passwordRoutes.post('/reset-password', async (c) => {
  try {
    const body = await c.req.json()
    const result = resetPasswordSchema.safeParse(body)

    if (!result.success) {
      return validationError(c, formatZodErrors(result.error.errors))
    }

    // Additional password strength validation
    const passwordCheck = validatePasswordStrength(result.data.password)
    if (!passwordCheck.isValid) {
      return validationError(c, [{ field: 'password', message: passwordCheck.message }])
    }

    await resetPassword(result.data.email, result.data.token, result.data.password)

    return successMessage(c, 'Password reset successfully')
  } catch (error) {
    return handleAuthError(c, error, logger, formatError, 'Reset password error')
  }
})
