/**
 * Unit tests for import.service.ts
 *
 * Tests contact import functionality including:
 * - Transaction atomicity (all changes rollback on critical error)
 * - Transaction commit on success
 * - Validation errors don't cause rollback
 * - Contact + Tag atomicity within same transaction
 * - Error categorization (validation vs critical)
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'

// Track transaction state for testing
let transactionState = {
  isActive: false,
  shouldRollback: false,
  committed: false,
  rolledBack: false,
  operations: [] as string[],
}

function resetTransactionState() {
  transactionState = {
    isActive: false,
    shouldRollback: false,
    committed: false,
    rolledBack: false,
    operations: [],
  }
}

// Track if the transaction callback threw an error
let _transactionCallbackThrew = false
let _transactionCallbackError: unknown = null

// Mock kysely module before importing the service
const mockTransactionExecute = mock(
  async (callback: (trx: unknown) => Promise<unknown>): Promise<unknown> => {
    transactionState.isActive = true
    _transactionCallbackThrew = false
    _transactionCallbackError = null

    try {
      const mockTrx = createMockTransaction()
      const result = await callback(mockTrx)

      // If callback succeeded without throwing, transaction commits
      transactionState.committed = true
      transactionState.isActive = false
      return result
    } catch (error) {
      // Callback threw an error - transaction rolls back
      _transactionCallbackThrew = true
      _transactionCallbackError = error
      transactionState.rolledBack = true
      transactionState.isActive = false
      throw error // Re-throw to simulate actual transaction rollback behavior
    }
  }
)

const mockSelectFrom = mock(() => mockQueryBuilder)
const mockSelect = mock(() => mockQueryBuilder)
const mockWhere = mock(() => mockQueryBuilder)
const mockOr = mock(() => true)
const mockExecuteTakeFirst = mock(() => Promise.resolve(null))
const mockExecute = mock(() => Promise.resolve([]))

const mockQueryBuilder = {
  selectFrom: mockSelectFrom,
  select: mockSelect,
  where: mockWhere,
  or: mockOr,
  executeTakeFirst: mockExecuteTakeFirst,
  execute: mockExecute,
  innerJoin: mock(() => mockQueryBuilder),
  leftJoin: mock(() => mockQueryBuilder),
  orderBy: mock(() => mockQueryBuilder),
  limit: mock(() => mockQueryBuilder),
  offset: mock(() => mockQueryBuilder),
}

// Create a mock transaction object
function createMockTransaction() {
  return {
    selectFrom: mockSelectFrom,
    select: mockSelect,
    where: mockWhere,
    or: mockOr,
    executeTakeFirst: mockExecuteTakeFirst,
    execute: mockExecute,
    insertInto: mock(() => mockInsertBuilder),
    updateTable: mock(() => mockUpdateBuilder),
  }
}

const mockReturning = mock(() => ({
  executeTakeFirst: mock(() => Promise.resolve({ id: 'contact-1' })),
  executeTakeFirstOrThrow: mock(() =>
    Promise.resolve({
      id: 'tag-1',
      name: 'VIP',
      color: '#ef4444',
      created_by: 'user-1',
      created_at: new Date(),
    })
  ),
}))

const mockValues = mock(() => ({
  returning: mockReturning,
  execute: mockExecute, // For contact_tags insert which doesn't use returning
}))

const mockInsertBuilder = {
  values: mockValues,
  returning: mockReturning,
}

const mockSet = mock(() => ({ where: mock(() => ({ execute: mockExecute })) }))

const mockUpdateBuilder = {
  set: mockSet,
}

const mockKyselyInstance = {
  transaction: mock(() => ({
    execute: mockTransactionExecute,
  })),
  selectFrom: mockSelectFrom,
  insertInto: mock(() => mockInsertBuilder),
  updateTable: mock(() => mockUpdateBuilder),
}

mock.module('kysely', () => ({
  Kysely: mock(() => mockKyselyInstance),
  Transaction: class MockTransaction {},
}))

// Import the service after mocking
import {
  type ContactImportRow,
  ImportCriticalError,
  ImportValidationError,
  importContacts,
  mapToContactRow,
  normalizePhoneNumber,
  parseCSV,
} from '../../services/import/index.js'

describe('ImportService - Transaction Atomicity', () => {
  beforeEach(() => {
    resetTransactionState()
    mockSelectFrom.mockClear()
    mockSelect.mockClear()
    mockWhere.mockClear()
    mockExecuteTakeFirst.mockClear()
    mockExecute.mockClear()
    mockTransactionExecute.mockClear()
    mockValues.mockClear()
    mockSet.mockClear()
    mockReturning.mockClear()
  })

  describe('Transaction Rollback on Critical Error', () => {
    it('should rollback all changes when a critical database error occurs', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        { phone_number: '+1234567890', custom_name: 'John Doe', tags: 'VIP' },
        { phone_number: '+9876543210', custom_name: 'Jane Smith', tags: 'Lead' },
      ]

      // Mock tag pre-fetch to return no existing tags
      mockExecute.mockResolvedValueOnce([])

      // Mock contact existence check for first contact - not found
      mockExecuteTakeFirst.mockResolvedValueOnce(null)

      // Mock contact insert for first contact - succeeds
      mockReturning
        .mockImplementationOnce(() => ({
          executeTakeFirst: mock(() =>
            Promise.resolve({
              id: 'contact-1',
              jid: '1234567890@s.whatsapp.net',
              phone_number: '1234567890',
            })
          ),
        }))
        // Mock tag creation - this will succeed
        .mockImplementationOnce(() => ({
          executeTakeFirst: mock(() =>
            Promise.resolve({
              id: 'tag-1',
              name: 'VIP',
            })
          ),
        }))

      // Mock contact existence check for second contact - not found
      mockExecuteTakeFirst.mockResolvedValueOnce(null)

      // Mock contact insert for second contact - simulate critical DB error
      mockReturning.mockImplementationOnce(() => ({
        executeTakeFirst: mock(() => Promise.reject(new Error('Database connection lost'))),
      }))

      // Act & Assert
      const error = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1',
        { createTags: true, updateExisting: true }
      ).catch((e) => e)

      // Verify the error is ImportCriticalError (wrapped by the service)
      expect(error).toBeInstanceOf(ImportCriticalError)
      expect((error as ImportCriticalError).message).toContain('Failed to import contact')

      // Verify transaction was rolled back, not committed
      expect(transactionState.committed).toBe(false)
      expect(transactionState.rolledBack).toBe(true)
    })

    it('should wrap database errors in ImportCriticalError', async () => {
      // Arrange
      const rows: ContactImportRow[] = [{ phone_number: '+1234567890', custom_name: 'John Doe' }]

      // Mock tag pre-fetch
      mockExecute.mockResolvedValueOnce([])

      // Mock contact existence check - database throws error
      mockExecuteTakeFirst.mockRejectedValueOnce(new Error('Connection timeout'))

      // Act & Assert
      const error = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1'
      ).catch((e) => e)

      expect(error).toBeInstanceOf(ImportCriticalError)
      expect((error as ImportCriticalError).message).toContain('Failed to import contact')
    })
  })

  describe('Transaction Commit on Success', () => {
    it('should commit all changes when import succeeds', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        {
          phone_number: '+1234567890',
          custom_name: 'John Doe',
          tags: 'VIP',
        },
        {
          phone_number: '+9876543210',
          custom_name: 'Jane Smith',
          tags: 'Lead',
        },
      ]

      // Mock tag pre-fetch - no existing tags
      mockExecute.mockResolvedValueOnce([])

      // Sequence of calls for executeTakeFirst:
      // 1. Contact 1 existence check (null - not found)
      // 2. Contact 1 tag assignment check (null - not assigned)
      // 3. Contact 2 existence check (null - not found)
      // 4. Contact 2 tag assignment check (null - not assigned)
      mockExecuteTakeFirst.mockResolvedValue(null)

      // Sequence of calls for returning().executeTakeFirst():
      // 1. Contact 1 insert → returns contact-1
      // 2. Tag "VIP" insert → returns tag-vip
      // 3. Contact 2 insert → returns contact-2
      // 4. Tag "Lead" insert → returns tag-lead
      let returningCallCount = 0
      mockReturning.mockImplementation(() => ({
        executeTakeFirst: mock(() => {
          returningCallCount++
          switch (returningCallCount) {
            case 1:
              return Promise.resolve({
                id: 'contact-1',
                jid: '1234567890@s.whatsapp.net',
              })
            case 2:
              return Promise.resolve({ id: 'tag-vip', name: 'VIP' })
            case 3:
              return Promise.resolve({
                id: 'contact-2',
                jid: '9876543210@s.whatsapp.net',
              })
            case 4:
              return Promise.resolve({ id: 'tag-lead', name: 'Lead' })
            default:
              return Promise.resolve({ id: `default-${returningCallCount}` })
          }
        }),
      }))

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1',
        { createTags: true }
      )

      // Assert
      expect(transactionState.committed).toBe(true)
      expect(transactionState.rolledBack).toBe(false)
      expect(result.total).toBe(2)
      expect(result.created).toBe(2)
      expect(result.errors).toBe(0)
    })

    it('should complete transaction when all contacts are updated', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        { phone_number: '+1234567890', custom_name: 'John Updated' },
      ]

      // Mock tag pre-fetch
      mockExecute.mockResolvedValueOnce([])

      // Mock contact exists
      mockExecuteTakeFirst.mockResolvedValue({
        id: 'existing-contact-1',
        jid: '1234567890@s.whatsapp.net',
      })

      // Mock update succeeds
      mockExecute.mockResolvedValueOnce([])

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1',
        { updateExisting: true }
      )

      // Assert
      expect(transactionState.committed).toBe(true)
      expect(result.total).toBe(1)
      expect(result.updated).toBe(1)
      expect(result.created).toBe(0)
    })
  })

  describe("Validation Errors Don't Cause Rollback", () => {
    it('should continue processing and commit when validation errors occur', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        { phone_number: '+1234567890', custom_name: 'Valid Contact' }, // Valid
        { phone_number: '123' }, // Invalid - too short
        { phone_number: '+9876543210', custom_name: 'Another Valid' }, // Valid
      ]

      // Mock tag pre-fetch
      mockExecute.mockResolvedValueOnce([])

      // Mock contact not found for all
      mockExecuteTakeFirst.mockResolvedValue(null)

      let contactInsertCount = 0
      mockReturning.mockImplementation(() => ({
        executeTakeFirst: mock(() => {
          contactInsertCount++
          return Promise.resolve({
            id: `contact-${contactInsertCount}`,
            jid: `${contactInsertCount === 1 ? '1234567890' : '9876543210'}@s.whatsapp.net`,
          })
        }),
      }))

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1'
      )

      // Assert - transaction should commit
      expect(transactionState.committed).toBe(true)
      expect(transactionState.rolledBack).toBe(false)

      // Only 2 valid contacts should be created
      expect(result.created).toBe(2)
      expect(result.errors).toBe(1)
      expect(result.total).toBe(3)

      // Verify the error was logged
      expect(result.results[1]).toMatchObject({
        status: 'error',
        error: 'Invalid phone number',
      })
    })

    it('should handle duplicate contacts as validation errors when updateExisting is false', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        { phone_number: '+1234567890', custom_name: 'New Contact' },
        { phone_number: '+1234567890', custom_name: 'Duplicate Contact' },
      ]

      // Mock tag pre-fetch
      mockExecute.mockResolvedValueOnce([])

      // First contact doesn't exist
      mockExecuteTakeFirst
        .mockResolvedValueOnce(null) // First check - not found
        .mockResolvedValueOnce({
          id: 'contact-1',
          jid: '1234567890@s.whatsapp.net',
        }) // Second check - found (duplicate)

      // Mock insert for first contact
      mockReturning.mockImplementation(() => ({
        executeTakeFirst: mock(() =>
          Promise.resolve({
            id: 'contact-1',
            jid: '1234567890@s.whatsapp.net',
          })
        ),
      }))

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1',
        { updateExisting: false }
      )

      // Assert
      expect(transactionState.committed).toBe(true)
      expect(result.created).toBe(1)
      expect(result.errors).toBe(1)
      expect(result.results[1]).toMatchObject({
        status: 'error',
        error: 'Contact already exists',
      })
    })

    it('should import remaining contacts after encountering validation error', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        { phone_number: 'abc' }, // Invalid phone number
        { phone_number: '+1234567890', custom_name: 'Valid Contact 1' },
        { phone_number: '+9876543210', custom_name: 'Valid Contact 2' },
      ]

      // Mock tag pre-fetch
      mockExecute.mockResolvedValueOnce([])

      // All contacts not found (invalid phone will be caught before DB check)
      mockExecuteTakeFirst.mockResolvedValue(null)

      let insertCount = 0
      mockReturning.mockImplementation(() => ({
        executeTakeFirst: mock(() => {
          insertCount++
          return Promise.resolve({
            id: `contact-${insertCount}`,
            jid: `${insertCount === 1 ? '1234567890' : '9876543210'}@s.whatsapp.net`,
          })
        }),
      }))

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1'
      )

      // Assert
      expect(transactionState.committed).toBe(true)
      expect(result.total).toBe(3)
      expect(result.created).toBe(2) // 2 valid contacts
      expect(result.errors).toBe(1) // 1 invalid phone
      expect(result.results[0].status).toBe('error')
      expect(result.results[1].status).toBe('created')
      expect(result.results[2].status).toBe('created')
    })
  })

  describe('Contact + Tag Atomicity', () => {
    it('should create contact and tags within the same transaction', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        {
          phone_number: '+1234567890',
          custom_name: 'John Doe',
          tags: 'VIP,Lead,Customer',
        },
      ]

      // Mock tag pre-fetch - no existing tags
      mockExecute.mockResolvedValueOnce([])

      // Mock contact not found
      mockExecuteTakeFirst.mockResolvedValue(null)

      let operationCount = 0
      const operations: string[] = []

      // Mock returning to track operations
      mockReturning.mockImplementation(() => ({
        executeTakeFirst: mock(() => {
          operationCount++
          if (operationCount === 1) {
            operations.push('insert-contact')
            return Promise.resolve({
              id: 'contact-1',
              jid: '1234567890@s.whatsapp.net',
            })
          }
          operations.push(`insert-tag-${operationCount}`)
          return Promise.resolve({
            id: `tag-${operationCount}`,
            name: `Tag${operationCount}`,
          })
        }),
      }))

      // Mock contact tag check
      mockExecuteTakeFirst.mockImplementation(() => Promise.resolve(null))

      // Mock insert into contact_tags
      const _mockContactTagInsert = mock(() => ({ execute: mock(() => Promise.resolve([])) }))

      mockInsertBuilder.values = mock((values: unknown) => {
        if (values && typeof values === 'object' && 'contact_id' in values) {
          // This is contact_tags insert
          return { execute: mock(() => Promise.resolve([])) }
        }
        return { returning: mockReturning }
      })

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1',
        { createTags: true }
      )

      // Assert - transaction was committed
      expect(transactionState.committed).toBe(true)
      expect(result.created).toBe(1)

      // Verify contact was created
      expect(operations).toContain('insert-contact')

      // Verify tags were created (3 tags)
      expect(operationCount).toBeGreaterThan(1) // 1 contact + at least some tags
    })

    it('should use transaction for both create and update scenarios', async () => {
      // Arrange - mix of new and existing contacts
      const rows: ContactImportRow[] = [
        { phone_number: '+1234567890', custom_name: 'New Contact', tags: 'VIP' },
        { phone_number: '+9876543210', custom_name: 'Updated Contact', tags: 'Lead' },
      ]

      // Mock tag pre-fetch
      mockExecute.mockResolvedValueOnce([])

      // Sequence of executeTakeFirst calls:
      // 1. Contact 1 existence check → null (not found, will be created)
      // 2. Contact_tag check for VIP → null (not assigned)
      // 3. Contact 2 existence check → existing-contact (found, will be updated)
      // 4. Contact_tag check for Lead → null (not assigned)
      let executeTakeFirstCallCount = 0
      mockExecuteTakeFirst.mockImplementation(() => {
        executeTakeFirstCallCount++
        switch (executeTakeFirstCallCount) {
          case 1: // Contact 1 existence
            return Promise.resolve(null)
          case 2: // Contact_tag VIP check
            return Promise.resolve(null)
          case 3: // Contact 2 existence
            return Promise.resolve({
              id: 'existing-contact',
              jid: '9876543210@s.whatsapp.net',
            })
          case 4: // Contact_tag Lead check
            return Promise.resolve(null)
          default:
            return Promise.resolve(null)
        }
      })

      // Sequence of returning().executeTakeFirst() calls:
      // 1. Contact 1 insert → new-contact
      // 2. Tag VIP insert → tag-vip
      // 3. Tag Lead insert → tag-lead
      let returningCallCount = 0
      mockReturning.mockImplementation(() => ({
        executeTakeFirst: mock(() => {
          returningCallCount++
          switch (returningCallCount) {
            case 1:
              return Promise.resolve({ id: 'new-contact', jid: '1234567890@s.whatsapp.net' })
            case 2:
              return Promise.resolve({ id: 'tag-vip', name: 'VIP' })
            case 3:
              return Promise.resolve({ id: 'tag-lead', name: 'Lead' })
            default:
              return Promise.resolve({ id: `default-${returningCallCount}` })
          }
        }),
      }))

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1',
        { updateExisting: true }
      )

      // Assert - single transaction for both create and update
      expect(transactionState.committed).toBe(true)
      expect(result.created).toBe(1)
      expect(result.updated).toBe(1)
    })
  })

  describe('Error Categorization', () => {
    it('should accurately count validation errors', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        { phone_number: '1' }, // Too short
        { phone_number: '12' }, // Too short
        { phone_number: '+1234567890' }, // Valid
      ]

      // Mock tag pre-fetch
      mockExecute.mockResolvedValueOnce([])

      // Mock contact not found
      mockExecuteTakeFirst.mockResolvedValue(null)

      mockReturning.mockImplementation(() => ({
        executeTakeFirst: mock(() =>
          Promise.resolve({ id: 'contact-1', jid: '1234567890@s.whatsapp.net' })
        ),
      }))

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1'
      )

      // Assert
      expect(result.errors).toBe(2)
      expect(result.created).toBe(1)
      expect(result.results.filter((r) => r.status === 'error')).toHaveLength(2)
    })

    it('should propagate critical errors wrapped in ImportCriticalError', async () => {
      // Arrange
      const rows: ContactImportRow[] = [{ phone_number: '+1234567890', custom_name: 'Test' }]

      // Mock tag pre-fetch - succeeds
      mockExecute.mockResolvedValueOnce([])

      // Mock contact existence check - not found
      mockExecuteTakeFirst.mockResolvedValueOnce(null)

      // Mock contact insert - simulate critical DB error during insert
      mockReturning.mockImplementationOnce(() => ({
        executeTakeFirst: mock(() => Promise.reject(new Error('Connection pool exhausted'))),
      }))

      // Act & Assert
      const errorPromise = importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1'
      )

      const error = await errorPromise.catch((e) => e)

      // Verify error is ImportCriticalError
      expect(error).toBeInstanceOf(ImportCriticalError)
      expect(error.message).toContain('Failed to import contact')
      expect((error as ImportCriticalError).cause).toBeDefined()
    })

    it('should provide accurate ImportSummary counts after validation errors', async () => {
      // Arrange
      const rows: ContactImportRow[] = [
        { phone_number: '+1111111111', custom_name: 'Valid 1' },
        { phone_number: 'bad' }, // Invalid
        { phone_number: '+2222222222', custom_name: 'Valid 2' },
        { phone_number: '+3333333333', custom_name: 'Valid 3' },
        { phone_number: 'also-bad' }, // Invalid
      ]

      // Mock tag pre-fetch
      mockExecute.mockResolvedValueOnce([])

      // Mock contact not found for all
      mockExecuteTakeFirst.mockResolvedValue(null)

      let insertCount = 0
      mockReturning.mockImplementation(() => ({
        executeTakeFirst: mock(() => {
          insertCount++
          return Promise.resolve({
            id: `contact-${insertCount}`,
            jid: `${['1111111111', '2222222222', '3333333333'][insertCount - 1]}@s.whatsapp.net`,
          })
        }),
      }))

      // Act
      const result = await importContacts(
        mockKyselyInstance as Parameters<typeof importContacts>[0],
        rows,
        'user-1'
      )

      // Assert
      expect(result.total).toBe(5)
      expect(result.created).toBe(3)
      expect(result.errors).toBe(2)
      expect(result.updated).toBe(0)
      expect(result.skipped).toBe(0)

      // Verify each result
      expect(result.results[0].status).toBe('created')
      expect(result.results[1].status).toBe('error')
      expect(result.results[2].status).toBe('created')
      expect(result.results[3].status).toBe('created')
      expect(result.results[4].status).toBe('error')
    })
  })
})

describe('ImportService - Utility Functions', () => {
  describe('parseCSV', () => {
    it('should parse CSV with headers', () => {
      const csv = 'phone_number,name,tags\n+1234567890,John Doe,VIP\n+9876543210,Jane Smith,Lead'
      const result = parseCSV(csv)

      expect(result).toHaveLength(2)
      expect(result[0].phone_number).toBe('+1234567890')
      expect(result[0].name).toBe('John Doe')
      expect(result[1].phone_number).toBe('+9876543210')
    })

    it('should handle quoted values', () => {
      const csv = 'phone_number,name\n+1234567890,"Doe, John"'
      const result = parseCSV(csv)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Doe, John')
    })

    it('should normalize column names to lowercase with underscores', () => {
      const csv = 'Phone Number,Custom Name\n+1234567890,John'
      const result = parseCSV(csv)

      expect(result[0].phone_number).toBe('+1234567890')
      expect(result[0].custom_name).toBe('John')
    })

    it('should return empty array for invalid CSV', () => {
      const result = parseCSV('header')
      expect(result).toHaveLength(0)
    })

    it('should skip empty rows', () => {
      const csv = 'phone_number,name\n+1234567890,John\n\n+9876543210,Jane'
      const result = parseCSV(csv)

      expect(result).toHaveLength(2)
    })
  })

  describe('normalizePhoneNumber', () => {
    it('should strip non-digit characters and add JID suffix', () => {
      const result = normalizePhoneNumber('+1 (234) 567-8900')

      expect(result.phoneNumber).toBe('12345678900')
      expect(result.jid).toBe('12345678900@s.whatsapp.net')
    })

    it('should handle numbers without + prefix', () => {
      const result = normalizePhoneNumber('1234567890')

      expect(result.phoneNumber).toBe('1234567890')
      expect(result.jid).toBe('1234567890@s.whatsapp.net')
    })

    it('should handle numbers with 00 international prefix', () => {
      const result = normalizePhoneNumber('00441234567890')

      expect(result.phoneNumber).toBe('441234567890')
      expect(result.jid).toBe('441234567890@s.whatsapp.net')
    })

    it('should preserve digits after stripping', () => {
      const result = normalizePhoneNumber('+1-800-555-1234')

      expect(result.phoneNumber).toBe('18005551234')
    })
  })

  describe('mapToContactRow', () => {
    it('should map CSV row to ContactImportRow with phone_number', () => {
      const row = { phone_number: '+1234567890', name: 'John Doe', notes: 'Test', tags: 'VIP' }
      const result = mapToContactRow(row)

      expect(result).toEqual({
        phone_number: '+1234567890',
        custom_name: 'John Doe',
        notes: 'Test',
        tags: 'VIP',
      })
    })

    it('should handle alternative column names', () => {
      const row = { phone: '1234567890', fullname: 'Jane Smith' }
      const result = mapToContactRow(row)

      expect(result?.phone_number).toBe('1234567890')
      expect(result?.custom_name).toBe('Jane Smith')
    })

    it('should return null if no phone number column found', () => {
      const row = { name: 'John Doe', notes: 'Test' }
      const result = mapToContactRow(row)

      expect(result).toBeNull()
    })

    it('should handle missing optional fields', () => {
      const row = { phone_number: '1234567890' }
      const result = mapToContactRow(row)

      expect(result).toEqual({
        phone_number: '1234567890',
        custom_name: undefined,
        notes: undefined,
        tags: undefined,
      })
    })

    it('should try multiple phone column name variations', () => {
      expect(mapToContactRow({ phone: '123' })?.phone_number).toBe('123')
      expect(mapToContactRow({ mobile: '456' })?.phone_number).toBe('456')
      expect(mapToContactRow({ whatsapp: '789' })?.phone_number).toBe('789')
      expect(mapToContactRow({ number: '012' })?.phone_number).toBe('012')
    })

    it('should try multiple name column variations', () => {
      const result = mapToContactRow({ phone_number: '123', full_name: 'Full Name' })
      expect(result?.custom_name).toBe('Full Name')
    })

    it('should try multiple notes column variations', () => {
      const result = mapToContactRow({ phone_number: '123', note: 'Test Note' })
      expect(result?.notes).toBe('Test Note')
    })

    it('should try multiple tags column variations', () => {
      const result = mapToContactRow({ phone_number: '123', label: 'Test Label' })
      expect(result?.tags).toBe('Test Label')
    })
  })

  describe('ImportValidationError', () => {
    it('should create validation error with message', () => {
      const error = new ImportValidationError('Invalid phone number')

      expect(error.message).toBe('Invalid phone number')
      expect(error.name).toBe('ImportValidationError')
    })

    it('should be instanceof ImportValidationError', () => {
      const error = new ImportValidationError('Test')

      expect(error instanceof ImportValidationError).toBe(true)
      expect(error instanceof Error).toBe(true)
    })
  })

  describe('ImportCriticalError', () => {
    it('should create critical error with message', () => {
      const error = new ImportCriticalError('Database error')

      expect(error.message).toBe('Database error')
      expect(error.name).toBe('ImportCriticalError')
      expect(error.cause).toBeUndefined()
    })

    it('should create critical error with cause', () => {
      const cause = new Error('Original error')
      const error = new ImportCriticalError('Wrapped error', cause)

      expect(error.cause).toBe(cause)
    })

    it('should be instanceof ImportCriticalError', () => {
      const error = new ImportCriticalError('Test')

      expect(error instanceof ImportCriticalError).toBe(true)
      expect(error instanceof Error).toBe(true)
    })
  })
})
