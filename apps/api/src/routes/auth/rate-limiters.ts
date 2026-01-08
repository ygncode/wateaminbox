import { rateLimitConfig, rateLimitStore } from '../../lib/rate-limit-store.js'
import { createConditionalRateLimiter } from '../../middleware/rate-limit.js'

// Login rate limiter: 5 attempts per 15 minutes
export const loginRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.auth.login,
    keyStrategy: 'ip',
    keyPrefix: 'auth-login',
  },
  rateLimitConfig.enabled
)

// Register rate limiter: 3 attempts per hour
export const registerRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.auth.register,
    keyStrategy: 'ip',
    keyPrefix: 'auth-register',
  },
  rateLimitConfig.enabled
)

// Forgot password rate limiter: 3 attempts per hour
export const forgotPasswordRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.auth.forgotPassword,
    keyStrategy: 'ip',
    keyPrefix: 'auth-forgot-password',
  },
  rateLimitConfig.enabled
)

// Refresh token rate limiter: 20 attempts per minute
export const refreshRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.auth.refresh,
    keyStrategy: 'ip',
    keyPrefix: 'auth-refresh',
  },
  rateLimitConfig.enabled
)
