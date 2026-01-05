function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Environment variable ${key} is required`);
    }
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
}

function getEnvBoolean(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue === undefined) {
      throw new Error(`Environment variable ${key} is required`);
    }
    return defaultValue;
  }
  return value.toLowerCase() === "true" || value === "1";
}

export const env = {
  // Server
  NODE_ENV: getEnv("NODE_ENV", "development"),
  PORT: getEnvNumber("PORT", 3001),

  // Database
  DATABASE_URL: getEnv("DATABASE_URL", ""),

  // Auth
  JWT_SECRET: getEnv("JWT_SECRET", ""),
  JWT_ACCESS_EXPIRES_IN: getEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
  JWT_REFRESH_EXPIRES_IN: getEnv("JWT_REFRESH_EXPIRES_IN", "7d"),

  // Email (Resend)
  RESEND_API_KEY: getEnv("RESEND_API_KEY", ""),
  EMAIL_FROM: getEnv("EMAIL_FROM", "noreply@example.com"),

  // App
  APP_URL: getEnv("APP_URL", "http://localhost:3000"),

  // NATS
  NATS_URL: getEnv("NATS_URL", "nats://localhost:4222"),

  // S3 Storage
  S3_ENDPOINT: getEnv("S3_ENDPOINT", "http://localhost:9000"),
  S3_ACCESS_KEY: getEnv("S3_ACCESS_KEY", "minioadmin"),
  S3_SECRET_KEY: getEnv("S3_SECRET_KEY", "minioadmin"),
  S3_BUCKET: getEnv("S3_BUCKET", "whatsapp-media"),
  S3_REGION: getEnv("S3_REGION", "us-east-1"),

  // Feature flags
  DEBUG: getEnvBoolean("DEBUG", false),

  // Rate Limiting
  RATE_LIMIT_ENABLED: getEnvBoolean("RATE_LIMIT_ENABLED", true),
  RATE_LIMIT_STORE_TYPE: getEnv("RATE_LIMIT_STORE_TYPE", "memory"),
  RATE_LIMIT_REDIS_URL: getEnv("RATE_LIMIT_REDIS_URL", ""),
  RATE_LIMIT_MEMORY_MAX_ITEMS: getEnvNumber(
    "RATE_LIMIT_MEMORY_MAX_ITEMS",
    10000,
  ),
} as const;

export type Env = typeof env;
