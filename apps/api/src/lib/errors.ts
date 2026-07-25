import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Standard error response structure
 */
interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Create a standardized error response
 */
function createErrorResponse(error: string, details?: unknown): ErrorResponse {
  return details ? { error, details } : { error };
}

/**
 * Return a 400 Bad Request response
 */
export function badRequest(
  c: Context,
  message: string = "Bad Request",
  details?: unknown,
) {
  return c.json(
    createErrorResponse(message, details),
    400 as ContentfulStatusCode,
  );
}

/**
 * Return a 401 Unauthorized response
 */
export function unauthorized(c: Context, message: string = "Unauthorized") {
  return c.json(createErrorResponse(message), 401 as ContentfulStatusCode);
}

/**
 * Return a 403 Forbidden response
 */
export function forbidden(c: Context, message: string = "Forbidden") {
  return c.json(createErrorResponse(message), 403 as ContentfulStatusCode);
}

/**
 * Return a 404 Not Found response
 */
export function notFound(c: Context, resource: string = "Resource") {
  return c.json(
    createErrorResponse(`${resource} not found`),
    404 as ContentfulStatusCode,
  );
}

/**
 * Return a 409 Conflict response
 */
export function conflict(c: Context, message: string = "Conflict") {
  return c.json(createErrorResponse(message), 409 as ContentfulStatusCode);
}

/**
 * Return a 422 Unprocessable Entity response
 */
export function unprocessable(
  c: Context,
  message: string = "Unprocessable Entity",
  details?: unknown,
) {
  return c.json(
    createErrorResponse(message, details),
    422 as ContentfulStatusCode,
  );
}

/**
 * Return a 429 Too Many Requests response
 */
export function tooManyRequests(
  c: Context,
  message: string = "Too many requests",
) {
  return c.json(createErrorResponse(message), 429 as ContentfulStatusCode);
}

/**
 * Return a 500 Internal Server Error response
 */
export function serverError(
  c: Context,
  message: string = "Internal server error",
) {
  return c.json(createErrorResponse(message), 500 as ContentfulStatusCode);
}

/**
 * Return a 503 Service Unavailable response
 */
export function serviceUnavailable(
  c: Context,
  message: string = "Service unavailable",
) {
  return c.json(createErrorResponse(message), 503 as ContentfulStatusCode);
}

/**
 * Custom error classes for typed error handling
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Conflict") {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export class TableNotFoundError extends AppError {
  constructor(tableName: string) {
    super(`Table '${tableName}' does not exist`, 404);
    this.name = "TableNotFoundError";
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = "Service unavailable") {
    super(message, 503);
    this.name = "ServiceUnavailableError";
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string = "Too many requests") {
    super(message, 429);
    this.name = "TooManyRequestsError";
  }
}

// ============================================================================
// Auth Errors
// ============================================================================

export class AuthError extends AppError {
  code: string;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message, statusCode);
    this.name = "AuthError";
    this.code = code;
  }
}

// ============================================================================
// Company Errors
// ============================================================================

export class CompanyNotFoundError extends NotFoundError {
  constructor(companyId: string) {
    super(`Company with ID ${companyId}`);
    this.name = "CompanyNotFoundError";
  }
}

export class InvitationNotFoundError extends NotFoundError {
  constructor(tokenOrId: string) {
    super(`Invitation with token/id ${tokenOrId}`);
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationExpiredError extends ValidationError {
  constructor() {
    super("Invitation has expired");
    this.name = "InvitationExpiredError";
  }
}

export class InvitationEmailMismatchError extends ForbiddenError {
  constructor() {
    super("This invitation was sent to a different email address");
    this.name = "InvitationEmailMismatchError";
  }
}

export class InvitationDeliveryError extends ServiceUnavailableError {
  constructor(email: string) {
    super(`Could not send the invitation email to ${email}`);
    this.name = "InvitationDeliveryError";
  }
}

export class UserAlreadyMemberError extends ConflictError {
  constructor(email: string) {
    super(`User ${email} is already a member of this company`);
    this.name = "UserAlreadyMemberError";
  }
}

export class InsufficientPermissionsError extends ForbiddenError {
  constructor(action: string) {
    super(`Insufficient permissions to ${action}`);
    this.name = "InsufficientPermissionsError";
  }
}

// ============================================================================
// WhatsApp Connection Errors
// ============================================================================

export class ConnectionNotFoundError extends NotFoundError {
  constructor(connectionId: string) {
    super(`WhatsApp connection ${connectionId}`);
    this.name = "ConnectionNotFoundError";
  }
}

export class ConnectionAlreadyExistsError extends ConflictError {
  constructor(companyId: string) {
    super(`WhatsApp connection already exists for company ${companyId}`);
    this.name = "ConnectionAlreadyExistsError";
  }
}

export class InvalidConnectionStateError extends ValidationError {
  constructor(currentState: string, requiredState: string) {
    super(`Connection is ${currentState}, but must be ${requiredState}`);
    this.name = "InvalidConnectionStateError";
  }
}

export class MaxConnectionsExceededError extends TooManyRequestsError {
  currentCount: number;
  maxAllowed: number;

  constructor(currentCount: number, maxAllowed: number) {
    super(
      `Maximum WhatsApp connections exceeded. Current: ${currentCount}, Max allowed: ${maxAllowed}`,
    );
    this.name = "MaxConnectionsExceededError";
    this.currentCount = currentCount;
    this.maxAllowed = maxAllowed;
  }
}

/**
 * Check if an error is a PostgreSQL "relation does not exist" error
 * and extract the table name if so.
 */
export function isTableNotFoundError(error: unknown): string | null {
  if (error instanceof Error) {
    // PostgreSQL error pattern: relation "schema.table" does not exist
    const match = error.message.match(/relation "([^"]+)" does not exist/);
    if (match) {
      return match[1];
    }
    // Alternative pattern: table "table" does not exist
    const altMatch = error.message.match(/table "([^"]+)" does not exist/);
    if (altMatch) {
      return altMatch[1];
    }
    // Generic "does not exist" check
    if (error.message.includes("does not exist")) {
      return "unknown";
    }
  }
  return null;
}
