/**
 * Unit tests for rate limit store implementations
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
  type RateLimitResult,
} from '../../lib/rate-limit-store'

describe('RateLimitStore Interface', () => {
  it('should have required methods', () => {
    const store = new MemoryRateLimitStore()
    expect(store.increment).toBeDefined()
    expect(store.reset).toBeDefined()
    expect(store.clear).toBeDefined()
    expect(store.close).toBeDefined()
  })
})

describe('MemoryRateLimitStore', () => {
  let store: MemoryRateLimitStore

  beforeEach(() => {
    store = new MemoryRateLimitStore(100)
  })

  afterEach(async () => {
    await store.clear()
    await store.close()
  })

  describe('increment', () => {
    it('should create new counter on first request', async () => {
      const result = await store.increment('test-key', 10, 60)

      expect(result.allowed).toBe(true)
      expect(result.currentCount).toBe(1)
      expect(result.limit).toBe(10)
      expect(result.resetAt).toBeGreaterThan(0)
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('should increment counter on subsequent requests', async () => {
      await store.increment('test-key', 10, 60)
      const result = await store.increment('test-key', 10, 60)

      expect(result.allowed).toBe(true)
      expect(result.currentCount).toBe(2)
    })

    it('should return allowed=false when limit exceeded', async () => {
      const limit = 3

      for (let i = 0; i < limit; i++) {
        await store.increment('test-key', limit, 60)
      }

      const result = await store.increment('test-key', limit, 60)

      expect(result.allowed).toBe(false)
      expect(result.currentCount).toBe(4)
    })

    it('should reset counter after window expires', async () => {
      // Set a very short window (10ms)
      const windowMs = 10

      await store.increment('test-key', 5, windowMs / 1000)
      await store.increment('test-key', 5, windowMs / 1000)

      const result1 = await store.increment('test-key', 5, windowMs / 1000)
      expect(result1.currentCount).toBe(3)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, windowMs + 10))

      const result2 = await store.increment('test-key', 5, windowMs / 1000)
      expect(result2.currentCount).toBe(1)
    })

    it('should track different keys independently', async () => {
      const result1 = await store.increment('key-1', 5, 60)
      const result2 = await store.increment('key-2', 10, 60)

      expect(result1.currentCount).toBe(1)
      expect(result1.limit).toBe(5)

      expect(result2.currentCount).toBe(1)
      expect(result2.limit).toBe(10)
    })

    it('should calculate resetAt correctly', async () => {
      const windowSeconds = 60
      const beforeTime = Math.floor(Date.now() / 1000)

      const result = await store.increment('test-key', 10, windowSeconds)

      const afterTime = Math.floor(Date.now() / 1000)

      // resetAt should be approximately now + windowSeconds
      expect(result.resetAt).toBeGreaterThanOrEqual(beforeTime + windowSeconds)
      expect(result.resetAt).toBeLessThanOrEqual(afterTime + windowSeconds + 1)
    })

    it('should calculate retryAfter correctly', async () => {
      const windowSeconds = 60

      const result = await store.increment('test-key', 10, windowSeconds)

      // retryAfter should be close to windowSeconds
      expect(result.retryAfter).toBeGreaterThan(0)
      expect(result.retryAfter).toBeLessThanOrEqual(windowSeconds)
    })
  })

  describe('reset', () => {
    it('should reset counter for specific key', async () => {
      await store.increment('test-key', 10, 60)
      await store.increment('test-key', 10, 60)
      await store.increment('test-key', 10, 60)

      const beforeReset = await store.increment('test-key', 10, 60)
      expect(beforeReset.currentCount).toBe(4)

      await store.reset('test-key')

      const afterReset = await store.increment('test-key', 10, 60)
      expect(afterReset.currentCount).toBe(1)
    })

    it('should not affect other keys', async () => {
      await store.increment('key-1', 10, 60)
      await store.increment('key-1', 10, 60)
      await store.increment('key-2', 10, 60)

      await store.reset('key-1')

      const result1 = await store.increment('key-1', 10, 60)
      const result2 = await store.increment('key-2', 10, 60)

      expect(result1.currentCount).toBe(1)
      expect(result2.currentCount).toBe(2)
    })
  })

  describe('clear', () => {
    it('should clear all counters', async () => {
      await store.increment('key-1', 10, 60)
      await store.increment('key-2', 10, 60)
      await store.increment('key-3', 10, 60)

      expect(store.size).toBe(3)

      await store.clear()

      expect(store.size).toBe(0)

      const result1 = await store.increment('key-1', 10, 60)
      const result2 = await store.increment('key-2', 10, 60)

      expect(result1.currentCount).toBe(1)
      expect(result2.currentCount).toBe(1)
    })
  })

  describe('close', () => {
    it('should close without errors', async () => {
      const testStore = new MemoryRateLimitStore()

      let error: Error | undefined
      try {
        await testStore.close()
      } catch (e) {
        error = e as Error
      }
      expect(error).toBeUndefined()
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used entries when maxItems exceeded', async () => {
      const maxItems = 3
      const smallStore = new MemoryRateLimitStore(maxItems)

      // Fill up to max - access order: key-1, key-2, key-3 (key-3 is MRU)
      await smallStore.increment('key-1', 10, 60)
      await smallStore.increment('key-2', 10, 60)
      await smallStore.increment('key-3', 10, 60)

      expect(smallStore.size).toBe(3)

      // Add key-4 - should evict key-1 (LRU)
      // New access order: key-2, key-3, key-4
      await smallStore.increment('key-4', 10, 60)

      expect(smallStore.size).toBe(3)

      // Access key-2 to make it more recent
      // New access order: key-3, key-4, key-2
      await smallStore.increment('key-2', 10, 60)

      // Add key-5 - should evict key-3 (now LRU)
      // New access order: key-4, key-2, key-5
      await smallStore.increment('key-5', 10, 60)

      expect(smallStore.size).toBe(3)

      // Verify key-1 was evicted (should start fresh)
      const result1 = await smallStore.increment('key-1', 10, 60)
      expect(result1.currentCount).toBe(1)

      // Verify key-2 still has its count (incremented twice)
      const result2 = await smallStore.increment('key-2', 10, 60)
      expect(result2.currentCount).toBe(3)

      await smallStore.close()
    })

    it('should track access order correctly', async () => {
      const maxItems = 3
      const smallStore = new MemoryRateLimitStore(maxItems)

      // Initial access order: key-1, key-2, key-3
      await smallStore.increment('key-1', 10, 60)
      await smallStore.increment('key-2', 10, 60)
      await smallStore.increment('key-3', 10, 60)

      // Access key-1 to make it most recent
      // Access order: key-2, key-3, key-1
      await smallStore.increment('key-1', 10, 60)

      // Add key-4 - should evict key-2 (LRU)
      // Access order: key-3, key-1, key-4
      await smallStore.increment('key-4', 10, 60)

      // Verify key-2 was evicted (starts fresh)
      const result2 = await smallStore.increment('key-2', 10, 60)
      expect(result2.currentCount).toBe(1)

      // Verify key-1 still has its count (incremented twice)
      const result1 = await smallStore.increment('key-1', 10, 60)
      expect(result1.currentCount).toBe(3)

      await smallStore.close()
    })
  })

  describe('size property', () => {
    it('should report correct number of entries', async () => {
      expect(store.size).toBe(0)

      await store.increment('key-1', 10, 60)
      expect(store.size).toBe(1)

      await store.increment('key-2', 10, 60)
      expect(store.size).toBe(2)

      await store.reset('key-1')
      // Reset doesn't immediately remove from map, but on next access
      // Actually, reset does remove the key
      expect(store.size).toBe(1)

      await store.clear()
      expect(store.size).toBe(0)
    })
  })
})

describe('RedisRateLimitStore', () => {
  // Note: Redis tests require actual Redis connection
  // These tests verify the class structure and fail-open behavior

  describe('without Redis connection', () => {
    it('should throw error when Redis URL is invalid', async () => {
      const store = new RedisRateLimitStore('redis://invalid:6379')

      // First call should try to connect and throw
      await expect(store.increment('test', 10, 60)).rejects.toThrow()
    })

    it('should have all required methods', () => {
      const store = new RedisRateLimitStore('redis://localhost:6379')
      expect(store.increment).toBeDefined()
      expect(store.reset).toBeDefined()
      expect(store.clear).toBeDefined()
      expect(store.close).toBeDefined()
    })
  })

  describe('constructor', () => {
    it('should accept Redis URL', () => {
      const store = new RedisRateLimitStore('redis://localhost:6379')
      expect(store).toBeDefined()
    })

    it('should accept Redis URL with password', () => {
      const store = new RedisRateLimitStore('redis://:password@localhost:6379')
      expect(store).toBeDefined()
    })

    it('should accept Redis URL with database', () => {
      const store = new RedisRateLimitStore('redis://localhost:6379/2')
      expect(store).toBeDefined()
    })
  })

  describe('close', () => {
    it('should close without errors even when not connected', async () => {
      const store = new RedisRateLimitStore('redis://localhost:6379')
      let error: Error | undefined
      try {
        await store.close()
      } catch (e) {
        error = e as Error
      }
      expect(error).toBeUndefined()
    })
  })
})

describe('Integration tests (memory store)', () => {
  let store: RateLimitStore

  beforeEach(() => {
    store = new MemoryRateLimitStore()
  })

  afterEach(async () => {
    await store.clear()
    await store.close()
  })

  it('should handle realistic rate limiting scenario', async () => {
    const limit = 100
    const windowSeconds = 60

    // Simulate normal traffic
    for (let i = 0; i < 50; i++) {
      const result = await store.increment('user:123', limit, windowSeconds)
      expect(result.allowed).toBe(true)
      expect(result.currentCount).toBe(i + 1)
    }

    // Hit the limit
    for (let i = 50; i < limit + 10; i++) {
      const result = await store.increment('user:123', limit, windowSeconds)
      expect(result.currentCount).toBe(i + 1)
      expect(result.allowed).toBe(i < limit)
    }

    // Verify headers info
    const lastResult = await store.increment('user:123', limit, windowSeconds)
    expect(lastResult.limit).toBe(limit)
    expect(lastResult.resetAt).toBeGreaterThan(0)
    expect(lastResult.retryAfter).toBeGreaterThan(0)
  })

  it('should handle multiple users independently', async () => {
    const limit = 10

    // User 1 makes 5 requests
    for (let i = 0; i < 5; i++) {
      const result = await store.increment('user:1', limit, 60)
      expect(result.allowed).toBe(true)
    }

    // User 2 makes 8 requests
    for (let i = 0; i < 8; i++) {
      const result = await store.increment('user:2', limit, 60)
      expect(result.allowed).toBe(true)
    }

    // User 1 makes 6 more requests (11 total - should be rate limited)
    let allowedCount = 0
    for (let i = 0; i < 6; i++) {
      const result = await store.increment('user:1', limit, 60)
      if (result.allowed) allowedCount++
    }
    expect(allowedCount).toBe(5) // Only 5 more allowed (10 - 5 = 5)

    // User 2 makes 3 more requests (11 total - should be rate limited)
    allowedCount = 0
    for (let i = 0; i < 3; i++) {
      const result = await store.increment('user:2', limit, 60)
      if (result.allowed) allowedCount++
    }
    expect(allowedCount).toBe(2) // Only 2 more allowed (10 - 8 = 2)
  })
})
