/**
 * Integration tests for Rate Limiting
 *
 * Tests rate limiting across the full request lifecycle, including:
 * - Auth endpoint blocking after limit exceeded
 * - Cross-IP separation of rate limit counters
 * - Rate limit header presence on all responses
 * - 429 responses with Retry-After header
 * - Endpoint-specific rate limiting
 * - Multiple endpoint types (auth, messaging, resources)
 *
 * These tests use the actual rate limit store and middleware with simulated endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { Hono } from 'hono'
import type { RateLimitStore, RateLimitResult } from '../../lib/rate-limit-store'
import { MemoryRateLimitStore } from '../../lib/rate-limit-store'
import { createRateLimitMiddleware, RATE_LIMIT_HEADERS } from '../../middleware/rate-limit'
import { getRateLimitConfig } from '../../config/rate-limit.config'

// ============================================================================
// Mock Setup
// ============================================================================

interface MockUser {
  id: string
  email: string
  passwordHash: string
  emailVerifiedAt: Date | null
  createdAt: Date
}

// Mock database for auth operations
const mockUsers = new Map<string, MockUser>()

function resetMockDatabase() {
  mockUsers.clear()
}

function createMockUser(email: string, password: string): MockUser {
  const user: MockUser = {
    id: `user-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    email,
    passwordHash: `hashed-${password}`,
    emailVerifiedAt: null,
    createdAt: new Date(),
  }
  mockUsers.set(email, user)
  return user
}

// ============================================================================
// Mock rate limit store with tracking capabilities for testing
// ============================================================================

class TestRateLimitStore implements RateLimitStore {
  private store: RateLimitStore
  public incrementCalls: Array<{ key: string; limit: number; windowSeconds: number }> = []

  constructor(innerStore: RateLimitStore) {
    this.store = innerStore
  }

  async increment(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    this.incrementCalls.push({ key, limit, windowSeconds })
    return this.store.increment(key, limit, windowSeconds)
  }

  async reset(key: string): Promise<void> {
    return this.store.reset(key)
  }

  async clear(): Promise<void> {
    return this.store.clear()
  }

  async close(): Promise<void> {
    return this.store.close()
  }

  getTrackedKeys(): string[] {
    return Array.from(new Set(this.incrementCalls.map((c) => c.key)))
  }

  getCountForKey(key: string): number {
    return this.incrementCalls.filter((c) => c.key === key).length
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a test app with auth-like endpoints and rate limiting
 * This simulates the full request lifecycle without importing actual routes
 */
function createTestAppWithRateLimiting(store: RateLimitStore): Hono {
  const config = getRateLimitConfig()
  const app = new Hono()

  // Login rate limiter: 5 attempts per 15 minutes
  const loginRateLimiter = createRateLimitMiddleware({
    store,
    tier: config.tiers.auth.login,
    keyStrategy: 'ip',
    keyPrefix: 'auth-login',
  })

  // Register rate limiter: 3 attempts per hour
  const registerRateLimiter = createRateLimitMiddleware({
    store,
    tier: config.tiers.auth.register,
    keyStrategy: 'ip',
    keyPrefix: 'auth-register',
  })

  // Forgot password rate limiter: 3 attempts per hour
  const forgotPasswordRateLimiter = createRateLimitMiddleware({
    store,
    tier: config.tiers.auth.forgotPassword,
    keyStrategy: 'ip',
    keyPrefix: 'auth-forgot-password',
  })

  // Refresh token rate limiter: 20 attempts per minute
  const refreshRateLimiter = createRateLimitMiddleware({
    store,
    tier: config.tiers.auth.refresh,
    keyStrategy: 'ip',
    keyPrefix: 'auth-refresh',
  })

  // Message send rate limiter: 60 per minute
  const messageSendRateLimiter = createRateLimitMiddleware({
    store,
    tier: config.tiers.messaging.send,
    keyStrategy: 'ip',
    keyPrefix: 'messaging-send',
  })

  // Analytics rate limiter: 20 per minute
  const analyticsRateLimiter = createRateLimitMiddleware({
    store,
    tier: config.tiers.resource.analytics,
    keyStrategy: 'ip',
    keyPrefix: 'resource-analytics',
  })

  // Register endpoints
  app.post('/api/auth/login', loginRateLimiter, (c) => c.json({ message: 'Login successful' }, 200))
  app.post('/api/auth/register', registerRateLimiter, (c) => c.json({ message: 'Registration successful' }, 201))
  app.post(
    '/api/auth/forgot-password',
    forgotPasswordRateLimiter,
    (c) => c.json({ message: 'Email sent' }, 200)
  )
  app.post('/api/auth/refresh', refreshRateLimiter, (c) => c.json({ message: 'Token refreshed' }, 200))
  app.post('/api/messages', messageSendRateLimiter, (c) => c.json({ message: 'Message sent' }, 201))
  app.get('/api/analytics', analyticsRateLimiter, (c) => c.json({ data: [] }, 200))

  return app
}

/**
 * Helper to make multiple requests to an endpoint
 */
async function makeRequests(
  app: Hono,
  path: string,
  count: number,
  ip: string,
  method: 'GET' | 'POST' = 'POST'
): Promise<number[]> {
  const results: number[] = []
  for (let i = 0; i < count; i++) {
    const res = await app.request(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: method === 'POST' ? JSON.stringify({ test: 'data' }) : undefined,
    })
    results.push(res.status)
  }
  return results
}

// ============================================================================
// Test Setup
// ============================================================================

describe('Rate Limiting - Integration Tests', () => {
  let store: TestRateLimitStore
  let testApp: Hono

  beforeEach(async () => {
    // Reset state
    resetMockDatabase()

    // Create a fresh store for each test
    const memoryStore = new MemoryRateLimitStore(1000)
    store = new TestRateLimitStore(memoryStore)

    // Create test app with rate-limited endpoints
    testApp = createTestAppWithRateLimiting(store)
  })

  afterEach(async () => {
    await store.close()
  })

  // ========================================================================
  // Auth Endpoint Rate Limiting Tests
  // ========================================================================

  describe('Auth Endpoint Rate Limiting', () => {
    it('should block login requests after 5 failed attempts', async () => {
      const ip = '192.168.1.100'

      // First 5 requests should be allowed
      const results = await makeRequests(testApp, '/api/auth/login', 5, ip)
      expect(results.every((status) => status === 200)).toBe(true)

      // 6th request should be rate limited
      const rateLimitedRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      expect(rateLimitedRes.status).toBe(429)

      const body = await rateLimitedRes.json()
      expect(body.error).toBe('Too Many Requests')

      // Should include Retry-After header
      const retryAfter = rateLimitedRes.headers.get(RATE_LIMIT_HEADERS.RETRY_AFTER)
      expect(retryAfter).toBeTruthy()
      // Default login window is 900 seconds (15 minutes)
      expect(Number.parseInt(retryAfter || '0', 10)).toBe(900)
    })

    it('should allow login from different IP when one IP is rate limited', async () => {
      const ip1 = '192.168.1.100'
      const ip2 = '192.168.1.200'

      // Exhaust rate limit for IP1
      await makeRequests(testApp, '/api/auth/login', 5, ip1)

      // 6th request from IP1 should be rate limited
      const rateLimitedRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip1,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(rateLimitedRes.status).toBe(429)

      // IP2 should still be allowed
      const allowedRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip2,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(allowedRes.status).toBe(200)
    })

    it('should block register requests after 3 attempts', async () => {
      const ip = '10.0.0.50'

      // First 3 requests should be allowed
      const results = await makeRequests(testApp, '/api/auth/register', 3, ip)
      expect(results.every((status) => status === 201)).toBe(true)

      // 4th request should be rate limited
      const rateLimitedRes = await testApp.request('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      expect(rateLimitedRes.status).toBe(429)

      const body = await rateLimitedRes.json()
      expect(body.error).toBe('Too Many Requests')
    })

    it('should block forgot-password requests after 3 attempts', async () => {
      const ip = '10.0.1.75'

      // First 3 requests should be allowed
      const results = await makeRequests(testApp, '/api/auth/forgot-password', 3, ip)
      expect(results.every((status) => status === 200)).toBe(true)

      // 4th request should be rate limited
      const rateLimitedRes = await testApp.request('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      expect(rateLimitedRes.status).toBe(429)
    })

    it('should allow 20 refresh token requests per minute', async () => {
      const ip = '10.0.2.100'

      // Try 20 requests - all should be allowed
      const results = await makeRequests(testApp, '/api/auth/refresh', 20, ip)
      expect(results.length).toBe(20)
      expect(results.every((status) => status === 200)).toBe(true)

      // 21st request should be rate limited
      const rateLimitedRes = await testApp.request('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      expect(rateLimitedRes.status).toBe(429)
    })
  })

  // ========================================================================
  // Cross-IP Separation Tests
  // ========================================================================

  describe('Cross-IP Separation', () => {
    it('should track rate limits independently for different IPs', async () => {
      const ips = ['192.168.1.1', '192.168.1.2', '192.168.1.3']

      // Each IP should get its own rate limit allowance
      const results: Record<string, number[]> = {}

      for (const ip of ips) {
        results[ip] = []
        for (let i = 0; i < 5; i++) {
          const res = await testApp.request('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': ip,
            },
            body: JSON.stringify({ test: 'data' }),
          })
          results[ip].push(res.status)
        }
      }

      // Each IP should have been able to make 5 requests
      for (const ip of ips) {
        expect(results[ip]).toHaveLength(5)
        expect(results[ip].every((status) => status === 200)).toBe(true)
      }
    })

    it('should handle x-forwarded-for with multiple IPs correctly', async () => {
      // Exhaust limit for first IP in chain
      for (let i = 0; i < 5; i++) {
        await testApp.request('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.1, 198.51.100.1, 192.0.2.1',
          },
          body: JSON.stringify({ test: 'data' }),
        })
      }

      // Same first IP should be rate limited
      const rateLimitedRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.1, 198.51.100.2',
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(rateLimitedRes.status).toBe(429)

      // Different first IP should be allowed
      const allowedRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.2, 198.51.100.1',
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(allowedRes.status).toBe(200)
    })

    it('should fall back to x-real-ip when x-forwarded-for is missing', async () => {
      const ip = '10.20.30.40'

      // Exhaust limit using x-real-ip
      for (let i = 0; i < 5; i++) {
        await testApp.request('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-real-ip': ip,
          },
          body: JSON.stringify({ test: 'data' }),
        })
      }

      // Same x-real-ip should be rate limited
      const rateLimitedRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-real-ip': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(rateLimitedRes.status).toBe(429)
    })

    it('should fall back to cf-connecting-ip when available', async () => {
      const ip = '172.16.0.1'

      // Exhaust limit using cf-connecting-ip
      for (let i = 0; i < 5; i++) {
        await testApp.request('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': ip,
          },
          body: JSON.stringify({ test: 'data' }),
        })
      }

      // Same cf-connecting-ip should be rate limited
      const rateLimitedRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(rateLimitedRes.status).toBe(429)
    })
  })

  // ========================================================================
  // Rate Limit Header Tests
  // ========================================================================

  describe('Rate Limit Headers', () => {
    it('should include X-RateLimit-Limit header on all auth requests', async () => {
      const res = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.10.10.10',
        },
        body: JSON.stringify({ test: 'data' }),
      })

      // Login limit is 5 by default
      const limitHeader = res.headers.get(RATE_LIMIT_HEADERS.LIMIT)
      expect(limitHeader).toBe('5')
    })

    it('should include X-RateLimit-Remaining header on all auth requests', async () => {
      const ip = '10.10.10.11'

      // First request
      const res1 = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      const remaining1 = res1.headers.get(RATE_LIMIT_HEADERS.REMAINING)
      expect(remaining1).toBe('4') // 5 - 1 = 4

      // Second request
      const res2 = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      const remaining2 = res2.headers.get(RATE_LIMIT_HEADERS.REMAINING)
      expect(remaining2).toBe('3') // 5 - 2 = 3
    })

    it('should include X-RateLimit-Reset header on all auth requests', async () => {
      const res = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.10.10.12',
        },
        body: JSON.stringify({ test: 'data' }),
      })

      const resetHeader = res.headers.get(RATE_LIMIT_HEADERS.RESET)
      expect(resetHeader).toBeTruthy()

      // Should be a Unix timestamp in the future
      const resetTime = Number.parseInt(resetHeader || '0', 10)
      const now = Math.floor(Date.now() / 1000)
      expect(resetTime).toBeGreaterThan(now)
    })

    it('should set X-RateLimit-Remaining to 0 when limit is reached', async () => {
      const ip = '10.10.10.13'

      // Make 4 requests
      await makeRequests(testApp, '/api/auth/login', 4, ip)

      // 5th request should have remaining = 0
      const res5 = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      const remaining5 = res5.headers.get(RATE_LIMIT_HEADERS.REMAINING)
      expect(remaining5).toBe('0')
    })

    it('should include Retry-After header on 429 responses', async () => {
      const ip = '10.10.10.14'

      // Exhaust rate limit
      await makeRequests(testApp, '/api/auth/login', 5, ip)

      // Next request should be rate limited
      const res = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      expect(res.status).toBe(429)

      const retryAfter = res.headers.get(RATE_LIMIT_HEADERS.RETRY_AFTER)
      expect(retryAfter).toBeTruthy()

      // Retry-After should be a positive number of seconds
      const retryAfterSeconds = Number.parseInt(retryAfter || '0', 10)
      expect(retryAfterSeconds).toBeGreaterThan(0)

      // For login, window is 900 seconds
      expect(retryAfterSeconds).toBe(900)
    })

    it('should include all rate limit headers on 429 responses', async () => {
      const ip = '10.10.10.15'

      // Exhaust rate limit
      await makeRequests(testApp, '/api/auth/login', 5, ip)

      // Get rate limited response
      const res = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      expect(res.status).toBe(429)

      // Check all headers are present
      expect(res.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('5')
      expect(res.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe('0')
      expect(res.headers.get(RATE_LIMIT_HEADERS.RESET)).toBeTruthy()
      expect(res.headers.get(RATE_LIMIT_HEADERS.RETRY_AFTER)).toBe('900')
    })

    it('should show different limit values for different endpoints', async () => {
      const ip = '10.10.10.16'

      // Login endpoint
      const loginRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(loginRes.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('5')

      // Register endpoint
      const registerRes = await testApp.request('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(registerRes.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('3')

      // Refresh endpoint
      const refreshRes = await testApp.request('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(refreshRes.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('20')

      // Messages endpoint
      const messagesRes = await testApp.request('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(messagesRes.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('60')

      // Analytics endpoint
      const analyticsRes = await testApp.request('/api/analytics', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
      })
      expect(analyticsRes.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('20')
    })
  })

  // ========================================================================
  // Independent Endpoint Tracking Tests
  // ========================================================================

  describe('Independent Endpoint Tracking', () => {
    it('should track login and register limits independently', async () => {
      const ip = '10.10.10.20'

      // Exhaust login limit (5 requests)
      await makeRequests(testApp, '/api/auth/login', 5, ip)

      // Login should be rate limited
      const loginRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(loginRes.status).toBe(429)

      // Register should still work (different limit, 3 requests)
      const registerRes = await testApp.request('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(registerRes.status).not.toBe(429)
    })

    it('should track refresh token limit independently from login', async () => {
      const ip = '10.10.10.21'

      // Exhaust login limit (5 requests)
      await makeRequests(testApp, '/api/auth/login', 5, ip)

      // Login should be rate limited
      const loginRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(loginRes.status).toBe(429)

      // Refresh should still work (different limit, 20 requests)
      const refreshRes = await testApp.request('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(refreshRes.status).toBe(200)
    })

    it('should track forgot-password limit independently', async () => {
      const ip = '10.10.10.22'

      // Exhaust forgot-password limit (3 requests)
      await makeRequests(testApp, '/api/auth/forgot-password', 3, ip)

      // forgot-password should be rate limited
      const forgotRes = await testApp.request('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(forgotRes.status).toBe(429)

      // Login should still work (different limit, 5 requests)
      const loginRes = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })
      expect(loginRes.status).toBe(200)
    })
  })

  // ========================================================================
  // Custom Rate Limit Middleware Tests
  // ========================================================================

  describe('Custom Rate Limit Middleware', () => {
    it('should work with custom rate limit tiers', async () => {
      const customStore = new MemoryRateLimitStore(100)
      const customApp = new Hono()

      // Create a very restrictive rate limiter
      const strictLimiter = createRateLimitMiddleware({
        store: customStore,
        tier: { requests: 2, windowSeconds: 60 },
        keyStrategy: 'ip',
        keyPrefix: 'custom-strict',
      })

      customApp.use('/test', strictLimiter)
      customApp.post('/test', (c) => c.json({ message: 'ok' }))

      // First 2 requests should succeed
      const res1 = await customApp.request('/test', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.20.30.40' },
      })
      expect(res1.status).toBe(200)
      expect(res1.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('2')

      const res2 = await customApp.request('/test', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.20.30.40' },
      })
      expect(res2.status).toBe(200)
      expect(res2.headers.get(RATE_LIMIT_HEADERS.REMAINING)).toBe('0')

      // 3rd request should be rate limited
      const res3 = await customApp.request('/test', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.20.30.40' },
      })
      expect(res3.status).toBe(429)

      await customStore.close()
    })

    it('should allow skip function to bypass rate limiting', async () => {
      const customStore = new MemoryRateLimitStore(100)
      const customApp = new Hono()

      const limiterWithSkip = createRateLimitMiddleware({
        store: customStore,
        tier: { requests: 1, windowSeconds: 60 },
        keyStrategy: 'ip',
        skip: (c) => c.req.path === '/bypass',
      })

      customApp.use('*', limiterWithSkip)
      customApp.post('/limited', (c) => c.json({ message: 'limited' }))
      customApp.post('/bypass', (c) => c.json({ message: 'bypassed' }))

      const ip = '10.20.30.50'

      // Limited endpoint should block after 1 request
      const res1 = await customApp.request('/limited', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res1.status).toBe(200)

      const res2 = await customApp.request('/limited', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res2.status).toBe(429)

      // Bypass endpoint should never be rate limited
      const res3 = await customApp.request('/bypass', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res3.status).toBe(200)

      const res4 = await customApp.request('/bypass', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      })
      expect(res4.status).toBe(200)

      await customStore.close()
    })
  })

  // ========================================================================
  // Error Response Format Tests
  // ========================================================================

  describe('Error Response Format', () => {
    it('should return consistent error format on rate limit exceeded', async () => {
      const ip = '10.10.10.30'

      // Exhaust rate limit
      await makeRequests(testApp, '/api/auth/login', 5, ip)

      const res = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      expect(res.status).toBe(429)

      const body = await res.json()
      expect(body).toHaveProperty('error', 'Too Many Requests')
    })

    it('should include JSON content type on 429 responses', async () => {
      const ip = '10.10.10.31'

      // Exhaust rate limit
      await makeRequests(testApp, '/api/auth/login', 5, ip)

      const res = await testApp.request('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ test: 'data' }),
      })

      expect(res.status).toBe(429)
      expect(res.headers.get('content-type')).toContain('application/json')
    })
  })

  // ========================================================================
  // Full Request Lifecycle Tests
  // ========================================================================

  describe('Full Request Lifecycle', () => {
    it('should complete full request cycle with rate limiting', async () => {
      const ip = '10.10.10.40'

      // Make requests within limit
      for (let i = 0; i < 3; i++) {
        const res = await testApp.request('/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': ip,
          },
          body: JSON.stringify({ test: 'data' }),
        })

        expect(res.status).toBe(200)
        expect(res.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe('5')
        expect(Number.parseInt(res.headers.get(RATE_LIMIT_HEADERS.REMAINING) || '0', 10)).toBe(
          4 - i
        )
        expect(res.headers.get(RATE_LIMIT_HEADERS.RESET)).toBeTruthy()
      }

      // Verify keys were tracked
      const trackedKeys = store.getTrackedKeys()
      expect(trackedKeys.length).toBeGreaterThan(0)
      expect(trackedKeys.some((k) => k.includes('auth-login'))).toBe(true)
    })

    it('should handle multiple endpoints in sequence correctly', async () => {
      const ip = '10.10.10.41'

      // Sequence of requests to different endpoints
      const endpoints = [
        { path: '/api/auth/login', limit: 5, method: 'POST' as const, expectedStatus: 200 },
        { path: '/api/auth/register', limit: 3, method: 'POST' as const, expectedStatus: 201 },
        { path: '/api/auth/refresh', limit: 20, method: 'POST' as const, expectedStatus: 200 },
        { path: '/api/messages', limit: 60, method: 'POST' as const, expectedStatus: 201 },
        { path: '/api/analytics', limit: 20, method: 'GET' as const, expectedStatus: 200 },
      ]

      for (const endpoint of endpoints) {
        const res = await testApp.request(endpoint.path, {
          method: endpoint.method,
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': ip,
          },
          body: endpoint.method === 'POST' ? JSON.stringify({ test: 'data' }) : undefined,
        })

        expect(res.status).toBe(endpoint.expectedStatus)
        expect(res.headers.get(RATE_LIMIT_HEADERS.LIMIT)).toBe(String(endpoint.limit))
      }
    })
  })
})
