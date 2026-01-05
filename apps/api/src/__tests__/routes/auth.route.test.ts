/**
 * Unit tests for Auth Routes Rate Limiting
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'
import type { RateLimitStore, RateLimitResult } from '../../lib/rate-limit-store'
import { createRateLimitMiddleware } from '../../middleware/rate-limit'
import { DEFAULT_RATE_LIMIT_CONFIG } from '../../config/rate-limit.config'

// Mock rate limit store for testing
class MockRateLimitStore implements RateLimitStore {
  private counters = new Map<string, number>()

  async increment(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const current = this.counters.get(key) || 0
    const newCount = current + 1
    this.counters.set(key, newCount)

    const allowed = newCount <= limit
    const now = Math.floor(Date.now() / 1000)

    return {
      allowed,
      currentCount: newCount,
      limit,
      resetAt: now + windowSeconds,
      retryAfter: windowSeconds,
    }
  }

  async reset(key: string): Promise<void> {
    this.counters.delete(key)
  }

  async clear(): Promise<void> {
    this.counters.clear()
  }

  async close(): Promise<void> {
    this.counters.clear()
  }

  // Helper to get current count
  getCount(key: string): number {
    return this.counters.get(key) || 0
  }
}

describe('Auth Routes Rate Limiting', () => {
  let store: MockRateLimitStore
  let app: Hono

  beforeEach(() => {
    store = new MockRateLimitStore()
    app = new Hono()

    const config = DEFAULT_RATE_LIMIT_CONFIG

    // Set up auth-like routes with rate limiters
    // Login: 5 attempts per 15 minutes
    const loginRateLimiter = createRateLimitMiddleware({
      store,
      tier: config.tiers.auth.login,
      keyStrategy: 'ip',
      keyPrefix: 'auth-login',
    })

    // Register: 3 attempts per hour
    const registerRateLimiter = createRateLimitMiddleware({
      store,
      tier: config.tiers.auth.register,
      keyStrategy: 'ip',
      keyPrefix: 'auth-register',
    })

    // Forgot password: 3 attempts per hour
    const forgotPasswordRateLimiter = createRateLimitMiddleware({
      store,
      tier: config.tiers.auth.forgotPassword,
      keyStrategy: 'ip',
      keyPrefix: 'auth-forgot-password',
    })

    // Refresh: 20 attempts per minute
    const refreshRateLimiter = createRateLimitMiddleware({
      store,
      tier: config.tiers.auth.refresh,
      keyStrategy: 'ip',
      keyPrefix: 'auth-refresh',
    })

    // Register endpoints
    app.post('/api/auth/login', loginRateLimiter, (c) => c.json({ message: 'Login successful' }))
    app.post('/api/auth/register', registerRateLimiter, (c) => c.json({ message: 'Registration successful' }))
    app.post('/api/auth/forgot-password', forgotPasswordRateLimiter, (c) => c.json({ message: 'Email sent' }))
    app.post('/api/auth/refresh', refreshRateLimiter, (c) => c.json({ message: 'Token refreshed' }))
  })

  afterEach(async () => {
    await store.close()
  })

  describe('POST /api/auth/login', () => {
    it('should allow 5 login attempts per 15 minutes per IP', async () => {
      const ip = '192.168.1.100'

      // First 5 requests should be allowed
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        })
        expect(res.status).toBe(200)
      }

      // 6th request should be rate limited
      const res6 = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res6.status).toBe(429)
    })

    it('should track login attempts separately by IP', async () => {
      const ip1 = '192.168.1.100'
      const ip2 = '192.168.1.101'

      // IP1 makes 5 attempts
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip1 },
        })
        expect(res.status).toBe(200)
      }

      // IP1 should now be rate limited
      const res1Limited = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip1 },
      })
      expect(res1Limited.status).toBe(429)

      // IP2 should still be able to make requests
      const res2 = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip2 },
      })
      expect(res2.status).toBe(200)
    })

    it('should set rate limit headers on login endpoint', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': '192.168.1.100' },
      })

      expect(res.headers.get('X-RateLimit-Limit')).toBe('5')
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
      expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy()
    })

    it('should return 429 with Retry-After header when limit exceeded', async () => {
      const ip = '192.168.1.100'

      // Make 5 requests to exhaust the limit
      for (let i = 0; i < 5; i++) {
        await app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        })
      }

      // Next request should be rate limited
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })

      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBeTruthy()

      const body = await res.json()
      expect(body.error).toBe('Too Many Requests')
    })
  })

  describe('POST /api/auth/register', () => {
    it('should allow 3 registration attempts per hour per IP', async () => {
      const ip = '192.168.1.200'

      // First 3 requests should be allowed
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/api/auth/register', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        })
        expect(res.status).toBe(200)
      }

      // 4th request should be rate limited
      const res4 = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res4.status).toBe(429)
    })

    it('should have stricter limits than login', async () => {
      const ip = '192.168.1.201'

      // Register allows only 3 attempts
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/api/auth/register', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        })
        expect(res.status).toBe(200)
      }

      const resLimited = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(resLimited.status).toBe(429)
      expect(resLimited.headers.get('X-RateLimit-Limit')).toBe('3')
    })
  })

  describe('POST /api/auth/forgot-password', () => {
    it('should allow 3 forgot password attempts per hour per IP', async () => {
      const ip = '192.168.1.300'

      // First 3 requests should be allowed
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        })
        expect(res.status).toBe(200)
      }

      // 4th request should be rate limited
      const res4 = await app.request('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res4.status).toBe(429)
    })

    it('should prevent email enumeration attacks via rate limiting', async () => {
      const ip = '192.168.1.301'

      // Exhaust the limit with requests
      for (let i = 0; i < 3; i++) {
        await app.request('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        })
      }

      // Attacker cannot probe for valid emails
      const res = await app.request('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res.status).toBe(429)
    })
  })

  describe('POST /api/auth/refresh', () => {
    it('should allow 20 refresh attempts per minute per IP', async () => {
      const ip = '192.168.1.400'

      // First 20 requests should be allowed
      for (let i = 0; i < 20; i++) {
        const res = await app.request('/api/auth/refresh', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        })
        expect(res.status).toBe(200)
      }

      // 21st request should be rate limited
      const res21 = await app.request('/api/auth/refresh', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res21.status).toBe(429)
    })

    it('should have higher limit than other auth endpoints', async () => {
      const ip = '192.168.1.401'

      // Refresh allows 20 requests (more than login's 5 or register's 3)
      const res = await app.request('/api/auth/refresh', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })

      expect(res.headers.get('X-RateLimit-Limit')).toBe('20')
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('19')
    })
  })

  describe('Cross-endpoint isolation', () => {
    it('should track each auth endpoint independently', async () => {
      const ip = '192.168.1.500'

      // Exhaust login limit (5)
      for (let i = 0; i < 5; i++) {
        await app.request('/api/auth/login', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        })
      }

      // Login should be rate limited
      const loginRes = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(loginRes.status).toBe(429)

      // But register should still work (different rate limit)
      const registerRes = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(registerRes.status).toBe(200)

      // And refresh should also work
      const refreshRes = await app.request('/api/auth/refresh', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(refreshRes.status).toBe(200)
    })
  })
})
