import { AppError, ValidationError } from '../../lib/errors.js'

/**
 * Validation error during import - doesn't abort transaction
 * Used for data validation issues like invalid phone numbers
 * Extends ValidationError for consistent error handling
 */
export class ImportValidationError extends ValidationError {
  constructor(message: string) {
    super(message)
    this.name = 'ImportValidationError'
  }
}

/**
 * Critical error during import - causes transaction rollback
 * Used for database errors and other critical failures
 * Extends AppError for consistent error handling
 */
export class ImportCriticalError extends AppError {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message, 500)
    this.name = 'ImportCriticalError'
  }
}
