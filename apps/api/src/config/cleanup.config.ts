/**
 * Message Cleanup Configuration
 *
 * Environment variables:
 * - MESSAGE_CLEANUP_ENABLED: Enable/disable the cleanup service (default: true)
 * - MESSAGE_CLEANUP_TIMEOUT_MINUTES: Minutes before marking a pending message as failed (default: 5)
 * - MESSAGE_CLEANUP_INTERVAL_MINUTES: Minutes between cleanup cycles (default: 1)
 * - MESSAGE_CLEANUP_BATCH_SIZE: Number of messages to process per batch (default: 100)
 */

export interface MessageCleanupConfig {
  enabled: boolean;
  timeoutMinutes: number;
  intervalMinutes: number;
  batchSize: number;
}

/**
 * Get the cleanup configuration from environment variables
 * Uses sensible defaults when variables are not set
 */
export function getCleanupConfig(): MessageCleanupConfig {
  return {
    enabled: process.env.MESSAGE_CLEANUP_ENABLED !== "false",
    timeoutMinutes: parsePositiveInt(
      process.env.MESSAGE_CLEANUP_TIMEOUT_MINUTES,
      5,
    ),
    intervalMinutes: parsePositiveInt(
      process.env.MESSAGE_CLEANUP_INTERVAL_MINUTES,
      1,
    ),
    batchSize: parsePositiveInt(process.env.MESSAGE_CLEANUP_BATCH_SIZE, 100),
  };
}

/**
 * Parse a positive integer from an environment variable
 * Returns the default value if parsing fails or the value is not positive
 */
function parsePositiveInt(
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    console.warn(
      `[CleanupConfig] Invalid value "${value}" for environment variable, using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  return parsed;
}

/**
 * Validate a cleanup configuration object
 * Returns true if the configuration is valid
 */
export function isValidCleanupConfig(config: MessageCleanupConfig): boolean {
  if (typeof config.enabled !== "boolean") {
    return false;
  }

  if (typeof config.timeoutMinutes !== "number" || config.timeoutMinutes <= 0) {
    return false;
  }

  if (
    typeof config.intervalMinutes !== "number" ||
    config.intervalMinutes <= 0
  ) {
    return false;
  }

  if (typeof config.batchSize !== "number" || config.batchSize <= 0) {
    return false;
  }

  return true;
}

/**
 * Default configuration values
 */
export const DEFAULT_CLEANUP_CONFIG: MessageCleanupConfig = {
  enabled: true,
  timeoutMinutes: 5,
  intervalMinutes: 1,
  batchSize: 100,
};
