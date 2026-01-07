import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Standard error response structure
 */
interface ErrorResponse {
  error: string
  details?: unknown
}

/**
 * Create a standardized error response
 */
function createErrorResponse(error: string, details?: unknown): ErrorResponse {
  return details ? { error, details } : { error }
}

/**
 * Return a 400 Bad Request response
 */
export function badRequest(c: Context, message: string = 'Bad Request', details?: unknown) {
  return c.json(createErrorResponse(message, details), 400 as ContentfulStatusCode)
}

/**
 * Return a 401 Unauthorized response
 */
export function unauthorized(c: Context, message: string = 'Unauthorized') {
  return c.json(createErrorResponse(message), 401 as ContentfulStatusCode)
}

/**
 * Return a 403 Forbidden response
 */
export function forbidden(c: Context, message: string = 'Forbidden') {
  return c.json(createErrorResponse(message), 403 as ContentfulStatusCode)
}

/**
 * Return a 404 Not Found response
 */
export function notFound(c: Context, resource: string = 'Resource') {
  return c.json(createErrorResponse(`${resource} not found`), 404 as ContentfulStatusCode)
}

/**
 * Return a 409 Conflict response
 */
export function conflict(c: Context, message: string = 'Conflict') {
  return c.json(createErrorResponse(message), 409 as ContentfulStatusCode)
}

/**
 * Return a 422 Unprocessable Entity response
 */
export function unprocessable(c: Context, message: string = 'Unprocessable Entity', details?: unknown) {
  return c.json(createErrorResponse(message, details), 422 as ContentfulStatusCode)
}

/**
 * Return a 429 Too Many Requests response
 */
export function tooManyRequests(c: Context, message: string = 'Too many requests') {
  return c.json(createErrorResponse(message), 429 as ContentfulStatusCode)
}

/**
 * Return a 500 Internal Server Error response
 */
export function serverError(c: Context, message: string = 'Internal server error') {
  return c.json(createErrorResponse(message), 500 as ContentfulStatusCode)
}

/**
 * Return a 503 Service Unavailable response
 */
export function serviceUnavailable(c: Context, message: string = 'Service unavailable') {
  return c.json(createErrorResponse(message), 503 as ContentfulStatusCode)
}

/**
 * Custom error classes for typed error handling
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, details)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404)
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403)
    this.name = 'ForbiddenError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict') {
    super(message, 409)
    this.name = 'ConflictError'
  }
}
