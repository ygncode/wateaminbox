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

const nodeEnv = getEnv("NODE_ENV", "development");
const isProduction = nodeEnv === "production";

export const env = {
  // Server
  NODE_ENV: nodeEnv,
  PORT: getEnvNumber("PORT", 4445),

  // Database
  DATABASE_URL: getEnv("DATABASE_URL", ""),

  // Auth
  JWT_SECRET: getEnv("JWT_SECRET", ""),
  JWT_ACCESS_EXPIRES_IN: getEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
  JWT_REFRESH_EXPIRES_IN: getEnv("JWT_REFRESH_EXPIRES_IN", "7d"),

  // Email
  MAIL_DRIVER: getEnv("MAIL_DRIVER", isProduction ? "resend" : "log"),
  RESEND_API_KEY: getEnv("RESEND_API_KEY", ""),
  EMAIL_FROM: getEnv("EMAIL_FROM", "noreply@example.com"),

  // App
  APP_URL: getEnv("APP_URL", "http://localhost:4444"),
  CORS_ORIGINS: getEnv(
    "CORS_ORIGINS",
    "http://localhost:4444,http://localhost:3000",
  ),

  // Centrifugo realtime transport
  CENTRIFUGO_API_URL: getEnv(
    "CENTRIFUGO_API_URL",
    isProduction ? "" : "http://localhost:4451/api",
  ),
  CENTRIFUGO_HEALTH_URL: getEnv(
    "CENTRIFUGO_HEALTH_URL",
    isProduction ? "" : "http://localhost:4451/health",
  ),
  CENTRIFUGO_API_KEY: getEnv(
    "CENTRIFUGO_API_KEY",
    isProduction ? "" : "development-centrifugo-api-key",
  ),
  CENTRIFUGO_TOKEN_HMAC_SECRET: getEnv(
    "CENTRIFUGO_TOKEN_HMAC_SECRET",
    isProduction ? "" : "development-centrifugo-token-secret-change-me",
  ),
  CENTRIFUGO_REQUEST_TIMEOUT_MS: getEnvNumber(
    "CENTRIFUGO_REQUEST_TIMEOUT_MS",
    3000,
  ),

  // Web Push (optional; loaded-app fallback remains active when omitted)
  VAPID_PUBLIC_KEY: getEnv("VAPID_PUBLIC_KEY", ""),
  VAPID_PRIVATE_KEY: getEnv("VAPID_PRIVATE_KEY", ""),
  VAPID_SUBJECT: getEnv("VAPID_SUBJECT", ""),

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
  if (!["log", "resend"].includes(env.MAIL_DRIVER)) {
    throw new Error("MAIL_DRIVER must be one of: log, resend");
  }
  if (env.NODE_ENV !== "production") return;

  const required = {
    DATABASE_URL: env.DATABASE_URL,
    JWT_SECRET: env.JWT_SECRET,
    CENTRIFUGO_API_URL: env.CENTRIFUGO_API_URL,
    CENTRIFUGO_HEALTH_URL: env.CENTRIFUGO_HEALTH_URL,
    CENTRIFUGO_API_KEY: env.CENTRIFUGO_API_KEY,
    CENTRIFUGO_TOKEN_HMAC_SECRET: env.CENTRIFUGO_TOKEN_HMAC_SECRET,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }

  if (env.MAIL_DRIVER === "resend" && !env.RESEND_API_KEY) {
    throw new Error(
      "RESEND_API_KEY is required when MAIL_DRIVER=resend in production",
    );
  }

  if (env.JWT_SECRET.length < 32) {
    throw new Error(
      "JWT_SECRET must contain at least 32 characters in production",
    );
  }
  if (env.CENTRIFUGO_TOKEN_HMAC_SECRET.length < 32) {
    throw new Error(
      "CENTRIFUGO_TOKEN_HMAC_SECRET must contain at least 32 characters in production",
    );
  }
}

validateProductionEnv();

export type Env = typeof env;
