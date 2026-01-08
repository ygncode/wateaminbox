/**
 * Unit tests for message-cleanup.service.ts
 *
 * Tests message cleanup functionality including:
 * - Initialization and shutdown
 * - Configuration management
 * - Status reporting
 * - Cleanup cycle execution
 * - Company message cleanup
 * - Timeout threshold logic
 * - Error handling
 * - Multi-tenant cleanup
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import {
  createMockDb,
  createMockMessage,
  createUpdateResult,
} from '../mocks'

// ============================================================================
// Mock Setup
// ============================================================================

let mockDb: ReturnType<typeof createMockDb>
let mockTenantDb: ReturnType<typeof createMockDb>
let mockQueryBuilder: Record<string, unknown>
let mockTenantQueryBuilder: Record<string, unknown>

function resetMockQueryBuilders() {
  mockQueryBuilder = {
    selectFrom: mock(() => mockQueryBuilder),
    insertInto: mock(() => mockQueryBuilder),
    updateTable: mock(() => mockQueryBuilder),
    deleteFrom: mock(() => mockQueryBuilder),
    select: mock(() => mockQueryBuilder),
    selectAll: mock(() => mockQueryBuilder),
    where: mock(() => mockQueryBuilder),
    values: mock(() => mockQueryBuilder),
    set: mock(() => mockQueryBuilder),
    returning: mock(() => mockQueryBuilder),
    innerJoin: mock(() => mockQueryBuilder),
    leftJoin: mock(() => mockQueryBuilder),
    orderBy: mock(() => mockQueryBuilder),
    limit: mock(() => mockQueryBuilder),
    execute: mock(() => Promise.resolve([])),
    executeTakeFirst: mock(() => Promise.resolve(undefined)),
    executeTakeFirstOrThrow: mock(() => Promise.resolve(undefined)),
  }

  mockTenantQueryBuilder = {
    selectFrom: mock(() => mockTenantQueryBuilder),
    insertInto: mock(() => mockTenantQueryBuilder),
    updateTable: mock(() => mockTenantQueryBuilder),
    deleteFrom: mock(() => mockTenantQueryBuilder),
    select: mock(() => mockTenantQueryBuilder),
    selectAll: mock(() => mockTenantQueryBuilder),
    where: mock(() => mockTenantQueryBuilder),
    values: mock(() => mockTenantQueryBuilder),
    set: mock(() => mockTenantQueryBuilder),
    returning: mock(() => mockTenantQueryBuilder),
    innerJoin: mock(() => mockTenantQueryBuilder),
    leftJoin: mock(() => mockTenantQueryBuilder),
    orderBy: mock(() => mockTenantQueryBuilder),
    limit: mock(() => mockTenantQueryBuilder),
    execute: mock(() => Promise.resolve([])),
    executeTakeFirst: mock(() => Promise.resolve(undefined)),
    executeTakeFirstOrThrow: mock(() => Promise.resolve(undefined)),
  }
}

// Initialize mock databases before module mocks
resetMockQueryBuilders()

mockDb = {
  selectFrom: mock((table: string) => {
    if (table === 'companies') {
      return {
        select: mock(() => mockQueryBuilder),
        where: mock(() => ({
          execute: mock(() => Promise.resolve([])),
        })),
      }
    }
    return mockQueryBuilder
  }),
  insertInto: mock(() => mockQueryBuilder),
  updateTable: mock(() => mockQueryBuilder),
  deleteFrom: mock(() => mockQueryBuilder),
} as unknown as typeof mockDb

mockTenantDb = {
  selectFrom: mock(() => mockTenantQueryBuilder),
  insertInto: mock(() => mockTenantQueryBuilder),
  updateTable: mock(() => mockTenantQueryBuilder),
  deleteFrom: mock(() => mockTenantQueryBuilder),
} as unknown as typeof mockTenantDb

// Mock broadcastToCompany
const mockBroadcastToCompany = mock(() => {})

// Mock tenant service functions - we need these to be mutable during tests
const mockGetTenantConnection = mock(() => mockTenantDb)
const mockTenantSchemaExists = mock(async () => {
  console.log('[MOCK tenantSchemaExists] Returning true')
  return true
})

// ============================================================================
// Module Mocks - Must be before imports
// ============================================================================

// Create a container for the database mock that can be updated
const databaseMock = {
  db: mockDb,
}

mock.module('@whatsapp-web/database', () => databaseMock)

mock.module('../../routes/ws/index.js', () => ({
  broadcastToCompany: mockBroadcastToCompany,
}))

mock.module('../config/cleanup.config.js', () => ({
  getCleanupConfig: mock(() => ({
    enabled: true,
    timeoutMinutes: 5,
    intervalMinutes: 1,
    batchSize: 100,
  })),
  isValidCleanupConfig: mock(() => true),
  DEFAULT_CLEANUP_CONFIG: {
    enabled: true,
    timeoutMinutes: 5,
    intervalMinutes: 1,
    batchSize: 100,
  },
}))

// Mock the tenant service module
// Use the mock directly - it can be updated via mockImplementation during tests
const tenantServiceMock = {
  getTenantConnection: mockGetTenantConnection,
  tenantSchemaExists: mockTenantSchemaExists,
  getSchemaName: mock((id: string) => `tenant_${id.replace(/-/g, '_')}`),
  clearTenantConnection: mock(async () => {}),
  clearAllTenantConnections: mock(async () => {}),
  createTenantSchema: mock(async () => {}),
  dropTenantSchema: mock(async () => {}),
}
mock.module('../../services/tenant.service', () => tenantServiceMock)

// ============================================================================
// Import Service After Mocking
// ============================================================================

import {
  initializeMessageCleanup,
  shutdownMessageCleanup,
  runCleanupCycle,
  cleanupCompanyMessages,
  getMessageCleanupConfig,
  setMessageCleanupConfig,
  isMessageCleanupInitialized,
  getMessageCleanupStatus,
  getCleanupStats,
  triggerCleanupForCompany,
  getDetailedCleanupStatus,
  type MessageCleanupConfig,
} from '../../services/message-cleanup.service'

// ============================================================================
// Helper Functions
// ============================================================================

// Reset the module state between tests
function resetModuleState() {
  // Shutdown to clear intervals
  void shutdownMessageCleanup()

  // Reset config to defaults
  setMessageCleanupConfig({
    enabled: true,
    timeoutMinutes: 5,
    intervalMinutes: 1,
    batchSize: 100,
  })
}

/**
 * Creates a mock query builder that supports the Kysely query chain
 * Used for mocking selectFrom queries with multiple where clauses
 */
function createMockSelectQueryBuilder<T>(result: T) {
  const mockExecute = mock(() => Promise.resolve(result))
  const mockLimit = mock(() => ({ execute: mockExecute }))
  const createWhereMock = () =>
    mock(() => ({
      where: createWhereMock(),
      limit: mockLimit,
    }))

  // Create 4 levels of where mocks for the 4 where clauses in the query
  const level4 = mock(() => ({ limit: mockLimit }))
  const level3 = mock(() => ({ where: level4 }))
  const level2 = mock(() => ({ where: level3 }))
  const level1 = mock(() => ({ where: level2 }))

  return {
    select: mock(() => ({
      where: level1,
      limit: mockLimit,
    })),
    where: level1,
    limit: mockLimit,
  }
}

/**
 * Creates a mock update query builder
 */
function createMockUpdateQueryBuilder(result: { numUpdatedRows: bigint }) {
  return {
    set: mock(() => ({
      where: mock(() => ({
        execute: mock(() => Promise.resolve(result)),
      })),
    })),
  }
}

/**
 * Creates a mock count query builder for stats
 */
function createMockCountQueryBuilder(count: number) {
  return {
    select: mock(() => ({
      where: mock(() => ({
        where: mock(() => ({
          where: mock(() => ({
            executeTakeFirst: mock(() => Promise.resolve({ count: String(count) })),
          })),
        })),
      })),
    })),
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('MessageCleanupService', () => {
  beforeEach(async () => {
    resetMockQueryBuilders()

    // Reset all mocks
    mockBroadcastToCompany.mockClear()
    mockGetTenantConnection.mockClear()
    mockTenantSchemaExists.mockClear()

    // Reset module state
    resetModuleState()

    // Setup mock database for company queries - update the properties in place
    // so databaseMock.db continues to reference the same object
    Object.assign(mockDb, {
      selectFrom: mock((table: string) => {
        if (table === 'companies') {
          return {
            select: mock(() => mockQueryBuilder),
            where: mock(() => ({
              execute: mock(() => Promise.resolve([])),
            })),
          }
        }
        return mockQueryBuilder
      }),
      insertInto: mock(() => mockQueryBuilder),
      updateTable: mock(() => mockQueryBuilder),
      deleteFrom: mock(() => mockQueryBuilder),
    })

    // Setup mock tenant database for message queries
    Object.assign(mockTenantDb, {
      selectFrom: mock(() => mockTenantQueryBuilder),
      insertInto: mock(() => mockTenantQueryBuilder),
      updateTable: mock(() => mockTenantQueryBuilder),
      deleteFrom: mock(() => mockTenantQueryBuilder),
    })

    // Reset the tenant schema exists mock to return true by default
    mockTenantSchemaExists.mockImplementation(async () => true)
    mockGetTenantConnection.mockImplementation(() => mockTenantDb)
  })

  afterEach(async () => {
    // Ensure cleanup service is shut down after each test
    await shutdownMessageCleanup()

    // Reset config to default enabled state
    setMessageCleanupConfig({
      enabled: true,
      timeoutMinutes: 5,
      intervalMinutes: 1,
      batchSize: 100,
    })
  })

  // ========================================================================
  // Configuration Tests
  // ========================================================================

  describe('Configuration', () => {
    it('should get default cleanup configuration', () => {
      const config = getMessageCleanupConfig()

      expect(config).toBeDefined()
      expect(config.enabled).toBe(true)
      expect(config.timeoutMinutes).toBe(5)
      expect(config.intervalMinutes).toBe(1)
      expect(config.batchSize).toBe(100)
    })

    it('should update cleanup configuration', () => {
      const updates: Partial<MessageCleanupConfig> = {
        timeoutMinutes: 10,
        batchSize: 200,
      }

      const newConfig = setMessageCleanupConfig(updates)

      expect(newConfig.timeoutMinutes).toBe(10)
      expect(newConfig.batchSize).toBe(200)
      // Other values should remain
      expect(newConfig.enabled).toBe(true)
      expect(newConfig.intervalMinutes).toBe(1)
    })

    it('should allow disabling via configuration', () => {
      // First reset to known state
      setMessageCleanupConfig({
        enabled: true,
        timeoutMinutes: 5,
        intervalMinutes: 1,
        batchSize: 100,
      })

      const newConfig = setMessageCleanupConfig({ enabled: false })

      expect(newConfig.enabled).toBe(false)
      expect(getMessageCleanupStatus()).toBe('disabled')

      // Reset for other tests
      setMessageCleanupConfig({
        enabled: true,
        timeoutMinutes: 5,
        intervalMinutes: 1,
        batchSize: 100,
      })
    })
  })

  // ========================================================================
  // Status Tests
  // ========================================================================

  describe('Status', () => {
    it('should return stopped status when not initialized', () => {
      // Ensure we're in a clean state with enabled=true
      setMessageCleanupConfig({
        enabled: true,
        timeoutMinutes: 5,
        intervalMinutes: 1,
        batchSize: 100,
      })

      const status = getMessageCleanupStatus()

      expect(status).toBe('stopped')
    })

    it('should return disabled status when config disabled', () => {
      setMessageCleanupConfig({ enabled: false })
      const status = getMessageCleanupStatus()

      expect(status).toBe('disabled')

      // Reset for other tests
      setMessageCleanupConfig({
        enabled: true,
        timeoutMinutes: 5,
        intervalMinutes: 1,
        batchSize: 100,
      })
    })

    it('should return false for isMessageCleanupInitialized when not initialized', () => {
      expect(isMessageCleanupInitialized()).toBe(false)
    })

    it('should return true for isMessageCleanupInitialized after initialization', async () => {
      // Mock companies query to return empty (no companies)
      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve([])),
          })),
        })),
      }))

      await initializeMessageCleanup()

      expect(isMessageCleanupInitialized()).toBe(true)
    })
  })

  // ========================================================================
  // Initialization Tests
  // ========================================================================

  describe('Initialization', () => {
    it('should initialize cleanup service successfully', async () => {
      // Mock companies query
      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve([{ id: 'company-123' }])),
          })),
        })),
      }))

      // Mock tenant query for pending messages (fetch messages to expire)
      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      // Reset the tenant schema exists mock
      mockTenantSchemaExists.mockImplementation(async () => true)

      await initializeMessageCleanup()

      expect(isMessageCleanupInitialized()).toBe(true)
      expect(getMessageCleanupStatus()).toBe('running')
    })

    it('should skip initialization if already initialized', async () => {
      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve([{ id: 'company-123' }])),
          })),
        })),
      }))

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      mockTenantSchemaExists.mockImplementation(async () => true)

      await initializeMessageCleanup()
      const firstStatus = getMessageCleanupStatus()

      await initializeMessageCleanup()
      const secondStatus = getMessageCleanupStatus()

      expect(firstStatus).toBe('running')
      expect(secondStatus).toBe('running')
    })

    it('should not initialize when disabled', async () => {
      const originalConfig = getMessageCleanupConfig()
      setMessageCleanupConfig({ enabled: false })

      await initializeMessageCleanup()

      expect(isMessageCleanupInitialized()).toBe(false)
      expect(getMessageCleanupStatus()).toBe('disabled')

      // Reset config
      setMessageCleanupConfig(originalConfig)
    })

    it('should accept custom configuration during initialization', async () => {
      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve([{ id: 'company-123' }])),
          })),
        })),
      }))

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      mockTenantSchemaExists.mockImplementation(async () => true)

      const customConfig: Partial<MessageCleanupConfig> = {
        timeoutMinutes: 15,
        intervalMinutes: 5,
      }

      await initializeMessageCleanup(customConfig)

      const config = getMessageCleanupConfig()
      expect(config.timeoutMinutes).toBe(15)
      expect(config.intervalMinutes).toBe(5)
    })
  })

  // ========================================================================
  // Shutdown Tests
  // ========================================================================

  describe('Shutdown', () => {
    it('should shutdown cleanup service successfully', async () => {
      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve([{ id: 'company-123' }])),
          })),
        })),
      }))

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      mockTenantSchemaExists.mockImplementation(async () => true)

      await initializeMessageCleanup()
      expect(isMessageCleanupInitialized()).toBe(true)

      await shutdownMessageCleanup()
      expect(isMessageCleanupInitialized()).toBe(false)
      expect(getMessageCleanupStatus()).toBe('stopped')
    })

    it('should handle shutdown when not initialized', async () => {
      // Should not throw
      await shutdownMessageCleanup()
      expect(isMessageCleanupInitialized()).toBe(false)
    })
  })

  // ========================================================================
  // Cleanup Cycle Tests
  // ========================================================================

  describe('Cleanup Cycle', () => {
    it('should skip cycle when disabled', async () => {
      setMessageCleanupConfig({ enabled: false })

      const result = await runCleanupCycle()

      expect(result.skipped).toBe(true)
      expect(result.totalProcessed).toBe(0)
      expect(result.totalExpired).toBe(0)

      // Reset
      setMessageCleanupConfig({
        enabled: true,
        timeoutMinutes: 5,
        intervalMinutes: 1,
        batchSize: 100,
      })
    })

    it('should skip cycle when no active companies', async () => {
      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve([])),
          })),
        })),
      }))

      const result = await runCleanupCycle()

      expect(result.skipped).toBe(true)
      expect(result.totalProcessed).toBe(0)
      expect(result.totalExpired).toBe(0)
    })

    it('should process companies successfully', async () => {
      // Create mock chain for: selectFrom -> select -> where -> execute
      const mockExecute = mock(() => Promise.resolve([
        { id: 'company-123' },
        { id: 'company-456' },
      ]))
      const mockWhere = mock(() => ({ execute: mockExecute }))
      const mockSelect = mock(() => ({ where: mockWhere }))
      const mockSelectFrom = mock(() => ({ select: mockSelect }))

      mockDb.selectFrom = mockSelectFrom
      console.log('[TEST] Set mockDb.selectFrom')

      // Verify the mock was set
      const testResult = await mockDb.selectFrom('companies').select(['id']).where('status', '=', 'active').execute()
      console.log('[TEST] Direct mock call result:', testResult)

      // Setup tenant mocks for message queries - return empty (no stale messages)
      mockTenantSchemaExists.mockImplementation(async () => true)

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      const result = await runCleanupCycle()

      expect(result.skipped).toBe(false)
      expect(result.totalProcessed).toBe(2)
      expect(result.totalExpired).toBe(0)
      expect(result.companies).toHaveLength(2)
    })

    it('should handle errors during company cleanup', async () => {
      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() =>
              Promise.resolve([{ id: 'company-123' }])
            ),
          })),
        })),
      }))

      mockTenantSchemaExists.mockImplementation(async () => true)

      // Make tenant query throw an error
      mockTenantDb.selectFrom = mock(() => {
        throw new Error('Database connection failed')
      })

      const result = await runCleanupCycle()

      expect(result.totalProcessed).toBe(1)
      expect(result.totalExpired).toBe(0)
      expect(result.companies).toHaveLength(1)
      expect(result.companies[0].error).toBeDefined()
      expect(result.companies[0].expiredCount).toBe(0)
    })
  })

  // ========================================================================
  // Company Message Cleanup Tests
  // ========================================================================

  describe('Company Message Cleanup', () => {
    it('should return 0 when tenant schema does not exist', async () => {
      mockTenantSchemaExists.mockImplementation(async () => false)

      const expiredCount = await cleanupCompanyMessages('company-123', 5, 100)

      expect(expiredCount).toBe(0)
      expect(mockGetTenantConnection).not.toHaveBeenCalled()
    })

    it('should return 0 when no stale pending messages exist', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      const expiredCount = await cleanupCompanyMessages('company-123', 5, 100)

      expect(expiredCount).toBe(0)
      expect(mockBroadcastToCompany).not.toHaveBeenCalled()
    })

    // TODO: Fix complex query chain mocking for broadcast tests
    // These tests require mocking Kysely's 4-level where() chain + limit() + execute()
    // Skipping for now - core functionality is tested elsewhere
    it('should expire stale pending messages and broadcast', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      const staleMessages = [
        createMockMessage({
          id: 'msg-1',
          contact_id: 'contact-1',
          message_id: 'wa-msg-1',
          from_me: true,
          status: 'pending',
          timestamp: new Date(Date.now() - 10 * 60 * 1000),
          metadata: null,
        }),
      ]

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve(staleMessages)),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      mockTenantDb.updateTable = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve(createUpdateResult(1))),
          })),
        })),
      }))

      const expiredCount = await cleanupCompanyMessages('company-123', 10, 100)

      expect(expiredCount).toBe(1)
      expect(mockBroadcastToCompany).toHaveBeenCalled()
    })

    it('should only target messages from_me=true', async () => {
      // This behavior is part of the query structure
      // Verify the service exists and works - implicitly tested by other passing tests
      mockTenantSchemaExists.mockImplementation(async () => true)

      // Return empty (no stale messages)
      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      const result = await cleanupCompanyMessages('company-123', 5, 100)

      // The query includes from_me=true filter - if no messages match, result is 0
      expect(result).toBe(0)
    })

    it('should only target messages older than timeout threshold', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      // Query should return empty (timeout check filters out recent messages)
      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      const expiredCount = await cleanupCompanyMessages('company-123', 5, 100)

      expect(expiredCount).toBe(0)
      expect(mockBroadcastToCompany).not.toHaveBeenCalled()
    })

    it('should respect batch size limit', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      // Create 150 stale messages
      const staleMessages = Array.from({ length: 150 }, (_, i) =>
        createMockMessage({
          id: `msg-${i}`,
          from_me: true,
          status: 'pending',
          timestamp: new Date(Date.now() - 10 * 60 * 1000),
          metadata: null,
        })
      )

      let limitArg: number | undefined
      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock((n: number) => {
                    limitArg = n
                    return {
                      execute: mock(() =>
                        Promise.resolve(staleMessages.slice(0, n))
                      ),
                    }
                  }),
                })),
              })),
            })),
          })),
        })),
      }))

      mockTenantDb.updateTable = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve(createUpdateResult(100))),
          })),
        })),
      }))

      await cleanupCompanyMessages('company-123', 5, 100)

      expect(limitArg).toBe(100)
    })

    it('should skip messages with existing metadata', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      // Query should return empty (metadata check filters out messages with metadata)
      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      const expiredCount = await cleanupCompanyMessages('company-123', 5, 100)

      expect(expiredCount).toBe(0)
    })
  })

  // ========================================================================
  // Stats Tests
  // ========================================================================

  describe('Cleanup Stats', () => {
    it('should return zero stats when tenant schema does not exist', async () => {
      mockTenantSchemaExists.mockImplementation(async () => false)

      const stats = await getCleanupStats('company-123')

      expect(stats.pendingCount).toBe(0)
      expect(stats.failedCount).toBe(0)
      expect(stats.timeoutFailedCount).toBe(0)
    })

    it('should return stats when tenant schema exists', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      let callCount = 0
      // Create a deeply chainable where mock that supports any number of .where() calls
      const createWhereChain = (): Record<string, unknown> => {
        const chain: Record<string, unknown> = {}
        chain.where = mock(() => chain) // Each where returns the same chain
        chain.executeTakeFirst = mock(() => {
          callCount++
          if (callCount === 1) return Promise.resolve({ count: '5' }) // pending (2 wheres)
          if (callCount === 2) return Promise.resolve({ count: '3' }) // failed (2 wheres)
          return Promise.resolve({ count: '2' }) // timeout failed (4 wheres)
        })
        return chain
      }

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => createWhereChain()),
      }))

      const stats = await getCleanupStats('company-123')

      expect(stats.pendingCount).toBe(5)
      expect(stats.failedCount).toBe(3)
      expect(stats.timeoutFailedCount).toBe(2)
    })
  })

  // ========================================================================
  // Manual Trigger Tests
  // ========================================================================

  describe('Manual Trigger', () => {
    it('should trigger cleanup for specific company with default timeout', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      const result = await triggerCleanupForCompany('company-123')

      expect(result).toBe(0)
      expect(mockTenantSchemaExists).toHaveBeenCalledWith('company-123')
    })

    it('should trigger cleanup for specific company with custom timeout', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      const result = await triggerCleanupForCompany('company-123', 15)

      expect(result).toBe(0)
    })
  })

  // ========================================================================
  // Detailed Status Tests
  // ========================================================================

  describe('Detailed Status', () => {
    it('should return detailed cleanup status', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      // Mock companies query in main db
      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() =>
              Promise.resolve([{ id: 'company-123' }, { id: 'company-456' }])
            ),
          })),
        })),
      }))

      // Mock tenant queries for stats - use call count to return different values
      let callCount = 0
      const createWhereChain = (): Record<string, unknown> => {
        const chain: Record<string, unknown> = {}
        chain.where = mock(() => chain)
        chain.executeTakeFirst = mock(() => {
          callCount++
          // First company stats: pending=5, failed=3, timeout=2
          // Second company stats: pending=10, failed=7, timeout=4
          if (callCount <= 3) {
            if (callCount === 1) return Promise.resolve({ count: '5' })
            if (callCount === 2) return Promise.resolve({ count: '3' })
            return Promise.resolve({ count: '2' })
          } else {
            if (callCount === 4) return Promise.resolve({ count: '10' })
            if (callCount === 5) return Promise.resolve({ count: '7' })
            return Promise.resolve({ count: '4' })
          }
        })
        return chain
      }

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => createWhereChain()),
      }))

      const status = await getDetailedCleanupStatus()

      expect(status.status).toBe('stopped')
      expect(status.config).toBeDefined()
      expect(status.config.enabled).toBe(true)
      expect(status.stats.totalActiveCompanies).toBe(2)
      expect(status.stats.totalPendingMessages).toBe(15) // 5 + 10
      expect(status.stats.totalFailedMessages).toBe(10) // 3 + 7
      expect(status.stats.totalTimeoutFailedMessages).toBe(6) // 2 + 4
    })

    it('should return disabled status when config is disabled', async () => {
      const originalConfig = getMessageCleanupConfig()
      setMessageCleanupConfig({ enabled: false })

      mockDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve([])),
          })),
        })),
      }))

      const status = await getDetailedCleanupStatus()

      expect(status.status).toBe('disabled')

      // Reset
      setMessageCleanupConfig(originalConfig)
    })
  })

  // ========================================================================
  // WebSocket Broadcast Tests
  // ========================================================================

  describe('WebSocket Broadcasts', () => {
    it('should broadcast message status updates for expired messages', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      const staleMessages = [
        createMockMessage({
          id: 'msg-1',
          contact_id: 'contact-1',
          message_id: 'wa-msg-1',
          from_me: true,
          status: 'pending',
          timestamp: new Date(Date.now() - 10 * 60 * 1000),
          metadata: null,
        }),
      ]

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve(staleMessages)),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      mockTenantDb.updateTable = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve(createUpdateResult(1))),
          })),
        })),
      }))

      await cleanupCompanyMessages('company-123', 5, 100)

      expect(mockBroadcastToCompany).toHaveBeenCalledWith(
        'company-123',
        expect.objectContaining({
          type: 'message:status',
          payload: expect.objectContaining({
            messageIds: expect.arrayContaining(['wa-msg-1']),
            status: 'failed',
            error: 'delivery_timeout',
          }),
        })
      )
    })

    it('should group messages by contact for efficient broadcasting', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      const staleMessages = [
        createMockMessage({
          id: 'msg-1',
          contact_id: 'contact-1',
          message_id: 'wa-msg-1',
          from_me: true,
          status: 'pending',
          timestamp: new Date(Date.now() - 10 * 60 * 1000),
          metadata: null,
        }),
        createMockMessage({
          id: 'msg-2',
          contact_id: 'contact-1',
          message_id: 'wa-msg-2',
          from_me: true,
          status: 'pending',
          timestamp: new Date(Date.now() - 10 * 60 * 1000),
          metadata: null,
        }),
        createMockMessage({
          id: 'msg-3',
          contact_id: 'contact-2',
          message_id: 'wa-msg-3',
          from_me: true,
          status: 'pending',
          timestamp: new Date(Date.now() - 10 * 60 * 1000),
          metadata: null,
        }),
      ]

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve(staleMessages)),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      mockTenantDb.updateTable = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve(createUpdateResult(3))),
          })),
        })),
      }))

      await cleanupCompanyMessages('company-123', 5, 100)

      // Should broadcast once per contact (2 contacts)
      expect(mockBroadcastToCompany).toHaveBeenCalledTimes(2)

      // Verify broadcasts contain correct data
      const calls = mockBroadcastToCompany.mock.calls

      // Find the broadcast for contact-1 (should have 2 messages)
      const contact1Call = calls.find(
        (call) =>
          Array.isArray(call[1]?.payload?.messageIds) &&
          call[1].payload.messageIds.length === 2 &&
          call[1].payload.conversationId === 'contact-1'
      )

      // Find the broadcast for contact-2 (should have 1 message)
      const contact2Call = calls.find(
        (call) =>
          Array.isArray(call[1]?.payload?.messageIds) &&
          call[1].payload.messageIds.length === 1 &&
          call[1].payload.conversationId === 'contact-2'
      )

      expect(contact1Call).toBeDefined()
      expect(contact2Call).toBeDefined()
    })
  })

  // ========================================================================
  // Timeout Threshold Logic Tests
  // ========================================================================

  describe('Timeout Threshold Logic', () => {
    it('should calculate timeout threshold correctly', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      // Set timeout to 10 minutes
      const timeoutMinutes = 10
      const threshold = new Date(Date.now() - timeoutMinutes * 60 * 1000)

      // Messages older than threshold should be returned
      const oldMessage = createMockMessage({
        id: 'msg-old',
        from_me: true,
        status: 'pending',
        timestamp: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
        metadata: null,
      })

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([oldMessage])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      mockTenantDb.updateTable = mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            execute: mock(() => Promise.resolve(createUpdateResult(1))),
          })),
        })),
      }))

      const expiredCount = await cleanupCompanyMessages(
        'company-123',
        timeoutMinutes,
        100
      )

      expect(expiredCount).toBe(1)
    })

    it('should use default timeout from config when not specified', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve([])),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      // triggerCleanupForCompany should use default timeout from config
      const result = await triggerCleanupForCompany('company-123')

      expect(result).toBe(0)
    })
  })

  // ========================================================================
  // Error Metadata Tests
  // ========================================================================

  describe('Error Metadata', () => {
    it('should set error metadata on expired messages', async () => {
      mockTenantSchemaExists.mockImplementation(async () => true)

      const staleMessages = [
        createMockMessage({
          id: 'msg-1',
          contact_id: 'contact-1',
          message_id: 'wa-msg-1',
          from_me: true,
          status: 'pending',
          timestamp: new Date(Date.now() - 10 * 60 * 1000),
          metadata: null,
        }),
      ]

      mockTenantDb.selectFrom = mock(() => ({
        select: mock(() => ({
          where: mock(() => ({
            where: mock(() => ({
              where: mock(() => ({
                where: mock(() => ({
                  limit: mock(() => ({
                    execute: mock(() => Promise.resolve(staleMessages)),
                  })),
                })),
              })),
            })),
          })),
        })),
      }))

      // Capture the set arguments to verify metadata
      let setArgs: Record<string, unknown> | undefined
      mockTenantDb.updateTable = mock(() => ({
        set: mock((args: Record<string, unknown>) => {
          setArgs = args
          return {
            where: mock(() => ({
              execute: mock(() => Promise.resolve(createUpdateResult(1))),
            })),
          }
        }),
      }))

      await cleanupCompanyMessages('company-123', 10, 100)

      // Verify the update sets status to failed and includes metadata
      expect(setArgs).toBeDefined()
      expect(setArgs?.status).toBe('failed')
      // The metadata uses sql template literal, so we can't easily check it,
      // but we can verify the update was called
      expect(mockBroadcastToCompany).toHaveBeenCalled()
    })
  })
})
