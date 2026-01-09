/**
 * WebSocket Logging Utility
 *
 * Provides structured, configurable logging for WebSocket operations.
 * Supports different log levels and can be configured via environment
 * variable or runtime setting.
 */

/**
 * Log levels in order of verbosity (debug being most verbose)
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

/**
 * Get the configured log level from environment or default
 */
function getConfiguredLogLevel(): LogLevel {
  // Check environment variable first
  const envLevel = import.meta.env.VITE_WS_LOG_LEVEL as string | undefined;
  if (envLevel && isValidLogLevel(envLevel)) {
    return envLevel;
  }

  // Default: in production, only show warnings and errors
  // In development, show info and above
  if (import.meta.env.PROD) {
    return "warn";
  }

  return "info";
}

function isValidLogLevel(level: string): level is LogLevel {
  return ["debug", "info", "warn", "error", "none"].includes(level);
}

/**
 * WebSocket Logger class
 *
 * Usage:
 * ```ts
 * import { wsLogger } from './websocket-logger'
 *
 * wsLogger.debug('Connection state changed', { state: 'connecting' })
 * wsLogger.info('Connected to server')
 * wsLogger.warn('Connection timeout, retrying...')
 * wsLogger.error('Failed to connect', error)
 * ```
 */
class WebSocketLogger {
  private _level: LogLevel;
  private readonly prefix = "[WebSocket]";

  constructor() {
    this._level = getConfiguredLogLevel();
  }

  /**
   * Get the current log level
   */
  get level(): LogLevel {
    return this._level;
  }

  /**
   * Set the log level at runtime
   */
  setLevel(level: LogLevel): void {
    this._level = level;
  }

  /**
   * Check if a log level should be displayed
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this._level];
  }

  /**
   * Format the log message with prefix and level
   */
  private formatMessage(level: LogLevel, message: string): string {
    return `${this.prefix} [${level.toUpperCase()}] ${message}`;
  }

  /**
   * Log a debug message (most verbose)
   * Use for: connection state changes, ping/pong, message queueing
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message), ...args);
    }
  }

  /**
   * Log an info message
   * Use for: successful connections, reconnections
   */
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message), ...args);
    }
  }

  /**
   * Log a warning message
   * Use for: connection timeouts, reconnection attempts
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message), ...args);
    }
  }

  /**
   * Log an error message
   * Use for: connection failures, auth errors, parse errors
   */
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message), ...args);
    }
  }

  /**
   * Create a child logger with a sub-prefix
   * Useful for logging from specific components
   */
  child(subPrefix: string): ChildWebSocketLogger {
    return new ChildWebSocketLogger(this, subPrefix);
  }
}

/**
 * Child logger with a sub-prefix
 */
class ChildWebSocketLogger {
  constructor(
    private parent: WebSocketLogger,
    private subPrefix: string,
  ) {}

  private formatMessage(message: string): string {
    return `[${this.subPrefix}] ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    this.parent.debug(this.formatMessage(message), ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.parent.info(this.formatMessage(message), ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.parent.warn(this.formatMessage(message), ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.parent.error(this.formatMessage(message), ...args);
  }
}

/**
 * Singleton instance of the WebSocket logger
 */
export const wsLogger = new WebSocketLogger();

/**
 * Export the logger class for testing purposes
 */
export { WebSocketLogger };
