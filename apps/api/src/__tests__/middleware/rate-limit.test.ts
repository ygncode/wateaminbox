/**
 * Unit tests for Rate Limit Middleware
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'
import type { RateLimitStore, RateLimitResult } from '../../lib/rate-limit-store'
import {
  createRateLimitMiddleware,
  ipRateLimit,
  userRateLimit,
  tenantRateLimit,
  userTenantRateLimit,
  skipPaths,
  skipMethods,
  RATE_LIMIT_HEADERS,
} from '../../middleware/rate-limit'

// Extend Hono context for testing
declare module 'hono' {
  interface ContextVariableMap {
    user: {
      id: string
      email: string
      name: string | null
      emailVerifiedAt: Date | null
    }
    companyId: string
  }
}

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

  // Helper to manually set count
  setCount(key: string, count: number): void {
    this.counters.set(key, count)
  }
}

describe('Rate Limit Middleware', () => {
  let store: MockRateLimitStore
  let app: Hono

  beforeEach(() => {
    store = new MockRateLimitStore()
    app = new Hono()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('createRateLimitMiddleware', () => {
    it('should allow requests within the limit', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 5, windowSeconds: 60 },
        keyStrategy: 'ip',
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ message: 'ok' })
    })

    it('should set rate limit headers on allowed requests', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 5, windowSeconds: 60 },
        keyStrategy: 'ip',
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })

      expect(res.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('5')
      expect(res.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe('4')
      expect(res.headers.get(RATE_LIMIT_HEADERS.RESET)).toBeTruthy()
    })

    it('should return 429 when limit is exceeded', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 2, windowSeconds: 60 },
        keyStrategy: 'ip',
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      // First request - allowed
      const res1 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res1.status).toBe(200)

      // Second request - allowed
      const res2 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res2.status).toBe(200)

      // Third request - rate limited
      const res3 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res3.status).toBe(429)

      const body = await res3.json()
      expect(body.error).toBe('Too Many Requests')
      expect(res3.headers.get(RATE_LIMIT_HEADERS.RETRY_AFTER)).toBeTruthy()
    })

    it('should track requests separately for different IPs', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res1 = await app.request('/test', {
        headers: { 'x-forwarded-for': '192.168.1.1' },
      })
      expect(res1.status).toBe(200)

      // Different IP should have its own limit
      const res2 = await app.request('/test', {
        headers: { 'x-forwarded-for': '192.168.1.2' },
      })
      expect(res2.status).toBe(200)
    })

    it('should skip rate limiting when skip function returns true', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
        skip: (c) => c.req.path === '/health',
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))
      app.get('/health', (c) => c.json({ status: 'healthy' }))

      // First /test request - allowed
      const res1 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res1.status).toBe(200)

      // Second /test request - rate limited
      const res2 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res2.status).toBe(429)

      // /health requests are not rate limited
      const res3 = await app.request('/health', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res3.status).toBe(200)

      const res4 = await app.request('/health', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res4.status).toBe(200)
    })

    it('should use custom key generator when provided', async () => {
      const customKey = 'api-key:abc123'

      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 2, windowSeconds: 60 },
        keyStrategy: 'ip',
        generateKey: () => customKey,
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      // Both requests use the same custom key
      const res1 = await app.request('/test')
      expect(res1.status).toBe(200)

      const res2 = await app.request('/test')
      expect(res2.status).toBe(200)

      const res3 = await app.request('/test')
      expect(res3.status).toBe(429)
    })

    it('should use custom onLimitReached handler when provided', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
        onLimitReached: (c, result) => {
          return c.json({
            error: 'Custom Rate Limit Exceeded',
            limit: result.limit,
            retryAfter: result.retryAfter,
          }, 429)
        },
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res1 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res2.status).toBe(429)

      const body = await res2.json()
      expect(body.error).toBe('Custom Rate Limit Exceeded')
      expect(body.limit).toBe(1)
    })

    it('should not set headers when setHeaders is false', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 5, windowSeconds: 60 },
        keyStrategy: 'ip',
        setHeaders: false,
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })

      expect(res.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBeNull()
      expect(res.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBeNull()
    })
  })

  describe('IP-based key generation', () => {
    it('should use x-forwarded-for header when present', async () => {
      app.use('*', ipRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })

      expect(res.status).toBe(200)
    })

    it('should use x-real-ip header when x-forwarded-for is not present', async () => {
      app.use('*', ipRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test', {
        headers: { 'x-real-ip': '10.0.0.2' },
      })

      expect(res.status).toBe(200)
    })

    it('should use cf-connecting-ip header when present', async () => {
      app.use('*', ipRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test', {
        headers: { 'cf-connecting-ip': '10.0.0.3' },
      })

      expect(res.status).toBe(200)
    })

    it('should handle multiple IPs in x-forwarded-for header', async () => {
      app.use('*', ipRateLimit(store, { requests: 1, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res1 = await app.request('/test', {
        headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3' },
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/test', {
        headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.4' },
      })
      expect(res2.status).toBe(429)
    })
  })

  describe('User-based key generation', () => {
    it('should use user ID when authenticated', async () => {
      // Mock user context with all required fields
      const mockUser = { id: 'user-123', email: 'test@example.com', name: null, emailVerifiedAt: null }

      app.use('*', async (c, next) => {
        c.set('user', mockUser)
        await next()
      })

      app.use('*', userRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok', userId: c.get('user')?.id }))

      const res = await app.request('/test')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.userId).toBe('user-123')
    })

    it('should fall back to IP when user is not authenticated', async () => {
      app.use('*', userRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })

      expect(res.status).toBe(200)
    })
  })

  describe('Tenant-based key generation', () => {
    it('should use company ID when tenant context exists', async () => {
      app.use('*', async (c, next) => {
        c.set('companyId', 'company-456')
        await next()
      })

      app.use('*', tenantRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok', companyId: c.get('companyId') }))

      const res = await app.request('/test')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.companyId).toBe('company-456')
    })

    it('should fall back to IP when tenant context is missing', async () => {
      app.use('*', tenantRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })

      expect(res.status).toBe(200)
    })
  })

  describe('User+Tenant key generation', () => {
    it('should combine user and tenant IDs when both exist', async () => {
      app.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', email: 'user@example.com', name: null, emailVerifiedAt: null })
        c.set('companyId', 'company-456')
        await next()
      })

      app.use('*', userTenantRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test')
      expect(res.status).toBe(200)
    })

    it('should use only user ID when tenant is missing', async () => {
      app.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', email: 'user@example.com', name: null, emailVerifiedAt: null })
        await next()
      })

      app.use('*', userTenantRateLimit(store, { requests: 5, windowSeconds: 60 }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res = await app.request('/test')
      expect(res.status).toBe(200)
    })
  })

  describe('skipPaths helper', () => {
    it('should skip rate limiting for exact path matches', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
        skip: skipPaths(['/health', '/status']),
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))
      app.get('/health', (c) => c.json({ status: 'healthy' }))
      app.get('/status', (c) => c.json({ status: 'ok' }))

      // /test should be rate limited
      const res1 = await app.request('/test')
      expect(res1.status).toBe(200)

      const res2 = await app.request('/test')
      expect(res2.status).toBe(429)

      // /health and /status should not be rate limited
      const res3 = await app.request('/health')
      expect(res3.status).toBe(200)

      const res4 = await app.request('/status')
      expect(res4.status).toBe(200)
    })

    it('should skip rate limiting for path prefix matches', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
        skip: skipPaths(['/webhooks']),
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))
      app.get('/webhooks/stripe', (c) => c.json({ message: 'webhook received' }))

      // /test should be rate limited
      const res1 = await app.request('/test')
      expect(res1.status).toBe(200)

      const res2 = await app.request('/test')
      expect(res2.status).toBe(429)

      // /webhooks/* should not be rate limited
      const res3 = await app.request('/webhooks/stripe')
      expect(res3.status).toBe(200)

      const res4 = await app.request('/webhooks/stripe')
      expect(res4.status).toBe(200)
    })

    it('should support regex patterns', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
        skip: skipPaths([/^\/webhooks\//]),
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))
      app.get('/webhooks/stripe', (c) => c.json({ message: 'webhook received' }))

      // /test should be rate limited
      const res1 = await app.request('/test')
      expect(res1.status).toBe(200)

      const res2 = await app.request('/test')
      expect(res2.status).toBe(429)

      // /webhooks/* should not be rate limited
      const res3 = await app.request('/webhooks/stripe')
      expect(res3.status).toBe(200)

      const res4 = await app.request('/webhooks/stripe')
      expect(res4.status).toBe(200)
    })
  })

  describe('skipMethods helper', () => {
    it('should skip rate limiting for specified HTTP methods', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
        skip: skipMethods(['GET', 'HEAD']),
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))
      app.post('/test', (c) => c.json({ message: 'created' }))

      // GET requests should not be rate limited
      const res1 = await app.request('/test', { method: 'GET' })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/test', { method: 'GET' })
      expect(res2.status).toBe(200)

      // POST requests should be rate limited
      const res3 = await app.request('/test', { method: 'POST' })
      expect(res3.status).toBe(200)

      const res4 = await app.request('/test', { method: 'POST' })
      expect(res4.status).toBe(429)
    })
  })

  describe('Key prefix', () => {
    it('should use custom key prefix', async () => {
      const storeWithTracking = new MockRateLimitStore()

      app.use('*', createRateLimitMiddleware({
        store: storeWithTracking,
        tier: { requests: 5, windowSeconds: 60 },
        keyStrategy: 'ip',
        keyPrefix: 'custom',
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })

      // The key should start with 'custom' prefix
      // Note: We can't directly inspect the key from the store without exposing it
      // This test verifies the middleware runs without error
      expect(storeWithTracking.getCount('custom:ip:127.0.0.1')).toBe(1)

      await storeWithTracking.close()
    })
  })

  describe('Header values', () => {
    it('should calculate remaining correctly', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 10, windowSeconds: 60 },
        keyStrategy: 'ip',
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      const res1 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res1.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe('9')

      const res2 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res2.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe('8')

      const res3 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })
      expect(res3.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe('7')
    })

    it('should include Retry-After header on 429 response', async () => {
      app.use('*', createRateLimitMiddleware({
        store,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
      }))

      app.get('/test', (c) => c.json({ message: 'ok' }))

      await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })

      const res2 = await app.request('/test', {
        headers: { 'x-forwarded-for': '127.0.0.1' },
      })

      expect(res2.status).toBe(429)
      expect(res2.headers.get(RATE_LIMIT_HEADERS.RETRY_AFTER)).toBe('60')
    })
  })
})
