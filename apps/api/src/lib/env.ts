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

  // Feature flags
  DEBUG: getEnvBoolean("DEBUG", false),
} as const;

export type Env = typeof env;
