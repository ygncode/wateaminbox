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
  PORT: getEnvNumber("PORT", 4445),

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
  APP_URL: getEnv("APP_URL", "http://localhost:4444"),
  CORS_ORIGINS: getEnv(
    "CORS_ORIGINS",
    "http://localhost:4444,http://localhost:3000",
  ),

  // Pusher
  PUSHER_APP_ID: getEnv("PUSHER_APP_ID", ""),
  PUSHER_KEY: getEnv("PUSHER_KEY", ""),
  PUSHER_SECRET: getEnv("PUSHER_SECRET", ""),
  PUSHER_CLUSTER: getEnv("PUSHER_CLUSTER", "ap1"),

  // NATS
  NATS_URL: getEnv("NATS_URL", "nats://localhost:4448"),

  // S3 Storage
  S3_ENDPOINT: getEnv("S3_ENDPOINT", "http://localhost:4450"),
  S3_ACCESS_KEY: getEnv("S3_ACCESS_KEY", "minioadmin"),
  S3_SECRET_KEY: getEnv("S3_SECRET_KEY", "minioadmin"),
  S3_BUCKET: getEnv("S3_BUCKET", "whatsapp-media"),
  S3_REGION: getEnv("S3_REGION", "us-east-1"),

  // Feature flags
  DEBUG: getEnvBoolean("DEBUG", false),

  // Logging
  LOG_LEVEL: getEnv("LOG_LEVEL", "info"),
  LOG_PRETTY: getEnvBoolean("LOG_PRETTY", true),

  // Rate Limiting
  RATE_LIMIT_ENABLED: getEnvBoolean("RATE_LIMIT_ENABLED", true),
  RATE_LIMIT_STORE_TYPE: getEnv("RATE_LIMIT_STORE_TYPE", "memory"),
  RATE_LIMIT_REDIS_URL: getEnv("RATE_LIMIT_REDIS_URL", ""),
  RATE_LIMIT_MEMORY_MAX_ITEMS: getEnvNumber(
    "RATE_LIMIT_MEMORY_MAX_ITEMS",
    10000,
  ),
  // Forwarded client IP headers are accepted only from these exact proxy IPs.
  TRUSTED_PROXY_IPS: getEnv("TRUSTED_PROXY_IPS", ""),
  TRUSTED_PROXY_IP_HEADER: getEnv(
    "TRUSTED_PROXY_IP_HEADER",
    "x-forwarded-for",
  ).toLowerCase(),

  // Database pooling
  TENANT_DB_POOL_MAX: getEnvNumber("TENANT_DB_POOL_MAX", 20),
} as const;

function validateProductionEnv(): void {
  if (env.NODE_ENV !== "production") return;

  const required = {
    DATABASE_URL: env.DATABASE_URL,
    JWT_SECRET: env.JWT_SECRET,
    PUSHER_APP_ID: env.PUSHER_APP_ID,
    PUSHER_KEY: env.PUSHER_KEY,
    PUSHER_SECRET: env.PUSHER_SECRET,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }

  if (env.JWT_SECRET.length < 32) {
    throw new Error(
      "JWT_SECRET must contain at least 32 characters in production",
    );
  }
}

validateProductionEnv();

export type Env = typeof env;
