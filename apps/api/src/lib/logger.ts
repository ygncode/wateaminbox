/**
 * Structured logging utility using Pino
 *
 * Usage:
 * - import { logger } from '@/lib/logger'
 * - logger.info('Message', { key: 'value' })
 * - logger.error('Error', { error, context })
 * - logger.child({ service: 'name' }) - Create child logger with context
 *
 * Log levels: trace, debug, info, warn, error, fatal
 */

import pino, { type Logger } from "pino";
import { env } from "./env";

// Define log level mapping
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

// Create the base logger configuration
const loggerOptions: pino.LoggerOptions = {
  level: (env.LOG_LEVEL as LogLevel) || "info",
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    env: env.NODE_ENV,
    service: "whatsapp-api",
  },
};

// In development with LOG_PRETTY=true, use pino-pretty for readable output
// In production, use JSON format for structured logging
const transport =
  env.NODE_ENV === "development" && env.LOG_PRETTY
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname,env,service",
          messageFormat: "[{module}] {msg}",
        },
      })
    : undefined;

/**
 * Main application logger
 */
export const logger: Logger = transport
  ? pino(loggerOptions, transport)
  : pino(loggerOptions);

/**
 * Create a child logger with a specific module/service context
 *
 * @example
 * const log = createLogger('MessageHandler')
 * log.info('Processing message', { messageId: '123' })
 */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}

/**
 * Helper to create structured error objects for logging
 * Pino handles Error objects specially, but this ensures consistent formatting
 */
export function formatError(error: unknown): {
  message: string;
  name?: string;
  stack?: string;
  code?: string;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: (error as Error & { code?: string }).code,
    };
  }
  return {
    message: String(error),
  };
}

/**
 * Request logging middleware context
 * Used to add correlation IDs to requests
 */
export interface RequestLogContext {
  requestId: string;
  method: string;
  path: string;
  userId?: string;
  companyId?: string;
}

/**
 * Create a logger with request context
 * Typically used in middleware to create per-request loggers
 */
export function createRequestLogger(context: RequestLogContext): Logger {
  return logger.child({
    module: "HTTP",
    ...context,
  });
}

// Export pino types for consumers
export type { Logger, LogLevel };
