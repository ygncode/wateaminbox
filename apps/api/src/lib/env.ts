import { isIP } from "node:net";

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
  NATS_TOKEN: getEnv("NATS_TOKEN", ""),

  // S3 Storage
  S3_ENDPOINT: getEnv("S3_ENDPOINT", "http://localhost:4450"),
  S3_ACCESS_KEY: getEnv("S3_ACCESS_KEY", isProduction ? "" : "minioadmin"),
  S3_SECRET_KEY: getEnv("S3_SECRET_KEY", isProduction ? "" : "minioadmin"),
  S3_BUCKET: getEnv("S3_BUCKET", isProduction ? "" : "whatsapp-media"),
  S3_REGION: getEnv("S3_REGION", "us-east-1"),

  // Search
  MEILISEARCH_URL: getEnv("MEILISEARCH_URL", "http://localhost:7700"),
  MEILISEARCH_API_KEY: getEnv("MEILISEARCH_API_KEY", "development_master_key"),

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

export type Env = typeof env;

const unsafeCredentialValues = new Set([
  "admin",
  "development_master_key",
  "minioadmin",
  "password",
  "postgres",
  "root",
  "secret",
  "test",
]);

function isLocalHostname(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    host === "host.docker.internal" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function productionURL(
  name: string,
  value: string,
  protocols: readonly string[],
): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL in production`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(
      `${name} must use one of these protocols in production: ${protocols.join(", ")}`,
    );
  }
  if (!parsed.hostname) {
    throw new Error(`${name} must include a hostname in production`);
  }
  if (isLocalHostname(parsed.hostname)) {
    throw new Error(
      `${name} must not use a local development host in production`,
    );
  }
  return parsed;
}

function decodedCredential(value: string): string {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function assertCredentialIsSafe(name: string, value: string): void {
  const normalized = decodedCredential(value.trim());
  if (
    !normalized ||
    unsafeCredentialValues.has(normalized) ||
    /^(?:change[-_ ]?me|development(?:[-_]|$)|example(?:[-_]|$)|replace[-_ ]?with|your[-_])/.test(
      normalized,
    ) ||
    /x{6,}$/.test(normalized)
  ) {
    throw new Error(`${name} must not use a development or placeholder value`);
  }
}

function assertServiceURL(
  name: string,
  value: string,
  protocols: readonly string[],
): URL {
  if (!value.trim()) {
    throw new Error(`${name} is required in production`);
  }
  return productionURL(name, value, protocols);
}

function validateCORSOrigins(value: string): void {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error(
      "CORS_ORIGINS must contain at least one origin in production",
    );
  }

  for (const origin of origins) {
    if (origin === "*" || origin.toLowerCase() === "null") {
      throw new Error("CORS_ORIGINS must not contain wildcard or null origins");
    }
    const parsed = productionURL("CORS_ORIGINS", origin, ["http:", "https:"]);
    if (parsed.protocol !== "https:") {
      throw new Error("CORS_ORIGINS entries must use HTTPS in production");
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== "/" && parsed.pathname !== "")
    ) {
      throw new Error(
        "CORS_ORIGINS entries must be origins without paths or credentials",
      );
    }
  }
}

function validateTrustedProxies(config: Env): void {
  const proxies = config.TRUSTED_PROXY_IPS.split(",")
    .map((proxy) => proxy.trim())
    .filter(Boolean);
  for (const proxy of proxies) {
    if (proxy === "*" || proxy.includes("/") || isIP(proxy) === 0) {
      throw new Error(
        "TRUSTED_PROXY_IPS must contain only exact proxy IP addresses",
      );
    }
    if (proxy === "0.0.0.0" || proxy === "::") {
      throw new Error("TRUSTED_PROXY_IPS must not trust unspecified addresses");
    }
  }

  const supportedHeaders = new Set([
    "cf-connecting-ip",
    "true-client-ip",
    "x-forwarded-for",
    "x-real-ip",
  ]);
  if (
    proxies.length > 0 &&
    !supportedHeaders.has(config.TRUSTED_PROXY_IP_HEADER)
  ) {
    throw new Error(
      "TRUSTED_PROXY_IP_HEADER must name a supported client IP header",
    );
  }
}

export function validateProductionEnv(config: Env = env): void {
  if (!["log", "resend"].includes(config.MAIL_DRIVER)) {
    throw new Error("MAIL_DRIVER must be one of: log, resend");
  }
  if (config.NODE_ENV !== "production") return;

  const required = {
    DATABASE_URL: config.DATABASE_URL,
    JWT_SECRET: config.JWT_SECRET,
    CENTRIFUGO_API_URL: config.CENTRIFUGO_API_URL,
    CENTRIFUGO_HEALTH_URL: config.CENTRIFUGO_HEALTH_URL,
    CENTRIFUGO_API_KEY: config.CENTRIFUGO_API_KEY,
    CENTRIFUGO_TOKEN_HMAC_SECRET: config.CENTRIFUGO_TOKEN_HMAC_SECRET,
    NATS_URL: config.NATS_URL,
    S3_ENDPOINT: config.S3_ENDPOINT,
    S3_BUCKET: config.S3_BUCKET,
    MEILISEARCH_URL: config.MEILISEARCH_URL,
    MEILISEARCH_API_KEY: config.MEILISEARCH_API_KEY,
    RESEND_API_KEY: config.RESEND_API_KEY,
    EMAIL_FROM: config.EMAIL_FROM,
    APP_URL: config.APP_URL,
    CORS_ORIGINS: config.CORS_ORIGINS,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value.trim())
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`,
    );
  }

  const database = assertServiceURL("DATABASE_URL", config.DATABASE_URL, [
    "postgres:",
    "postgresql:",
  ]);
  if (
    (decodedCredential(database.username) === "postgres" &&
      decodedCredential(database.password) === "postgres") ||
    (database.password &&
      unsafeCredentialValues.has(decodedCredential(database.password)))
  ) {
    throw new Error(
      "DATABASE_URL must not use development database credentials",
    );
  }

  for (const natsURL of config.NATS_URL.split(",").map((url) => url.trim())) {
    const nats = assertServiceURL("NATS_URL", natsURL, [
      "nats:",
      "tls:",
      "ws:",
      "wss:",
    ]);
    const username = decodedCredential(nats.username);
    const password = decodedCredential(nats.password);
    if (
      (password && unsafeCredentialValues.has(password)) ||
      (!password && username && unsafeCredentialValues.has(username))
    ) {
      throw new Error("NATS_URL must not use development NATS credentials");
    }
  }

  assertServiceURL("S3_ENDPOINT", config.S3_ENDPOINT, ["http:", "https:"]);
  if (Boolean(config.S3_ACCESS_KEY) !== Boolean(config.S3_SECRET_KEY)) {
    throw new Error(
      "S3_ACCESS_KEY and S3_SECRET_KEY must either both be set or both be omitted for workload identity",
    );
  }
  if (config.S3_ACCESS_KEY && config.S3_SECRET_KEY) {
    assertCredentialIsSafe("S3_ACCESS_KEY", config.S3_ACCESS_KEY);
    assertCredentialIsSafe("S3_SECRET_KEY", config.S3_SECRET_KEY);
  }

  assertServiceURL("MEILISEARCH_URL", config.MEILISEARCH_URL, [
    "http:",
    "https:",
  ]);
  assertCredentialIsSafe("MEILISEARCH_API_KEY", config.MEILISEARCH_API_KEY);

  const appURL = assertServiceURL("APP_URL", config.APP_URL, [
    "http:",
    "https:",
  ]);
  if (appURL.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS in production");
  }
  validateCORSOrigins(config.CORS_ORIGINS);
  validateTrustedProxies(config);

  if (config.MAIL_DRIVER !== "resend") {
    throw new Error("MAIL_DRIVER must be resend in production");
  }
  assertCredentialIsSafe("RESEND_API_KEY", config.RESEND_API_KEY);
  const fromAddress = config.EMAIL_FROM.trim().match(
    /(?:^|<)([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>?$/,
  )?.[1];
  if (!fromAddress) {
    throw new Error(
      "EMAIL_FROM must contain a valid email address in production",
    );
  }
  if (/@example\.(?:com|net|org)$/i.test(fromAddress)) {
    throw new Error(
      "EMAIL_FROM must not use a reserved example domain in production",
    );
  }

  if (config.JWT_SECRET.length < 32) {
    throw new Error(
      "JWT_SECRET must contain at least 32 characters in production",
    );
  }
  assertCredentialIsSafe("JWT_SECRET", config.JWT_SECRET);

  assertServiceURL("CENTRIFUGO_API_URL", config.CENTRIFUGO_API_URL, [
    "http:",
    "https:",
  ]);
  assertServiceURL("CENTRIFUGO_HEALTH_URL", config.CENTRIFUGO_HEALTH_URL, [
    "http:",
    "https:",
  ]);
  assertCredentialIsSafe("CENTRIFUGO_API_KEY", config.CENTRIFUGO_API_KEY);
  if (config.CENTRIFUGO_TOKEN_HMAC_SECRET.length < 32) {
    throw new Error(
      "CENTRIFUGO_TOKEN_HMAC_SECRET must contain at least 32 characters in production",
    );
  }
  assertCredentialIsSafe(
    "CENTRIFUGO_TOKEN_HMAC_SECRET",
    config.CENTRIFUGO_TOKEN_HMAC_SECRET,
  );
  if (config.JWT_SECRET === config.CENTRIFUGO_TOKEN_HMAC_SECRET) {
    throw new Error("JWT and Centrifugo signing secrets must be different");
  }

  if (!config.RATE_LIMIT_ENABLED) {
    throw new Error("RATE_LIMIT_ENABLED must be true in production");
  }
  if (!["memory", "redis"].includes(config.RATE_LIMIT_STORE_TYPE)) {
    throw new Error("RATE_LIMIT_STORE_TYPE must be one of: memory, redis");
  }
  if (config.RATE_LIMIT_STORE_TYPE === "redis") {
    const redis = assertServiceURL(
      "RATE_LIMIT_REDIS_URL",
      config.RATE_LIMIT_REDIS_URL,
      ["redis:", "rediss:"],
    );
    if (
      redis.password &&
      unsafeCredentialValues.has(decodedCredential(redis.password))
    ) {
      throw new Error(
        "RATE_LIMIT_REDIS_URL must not use development Redis credentials",
      );
    }
  }
}

validateProductionEnv();
