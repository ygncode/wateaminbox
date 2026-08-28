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

function getEnvSafePositiveInteger(
  key: string,
  defaultValue: number,
  maxValue: number = Number.MAX_SAFE_INTEGER,
): number {
  const value = process.env[key];
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > maxValue
  ) {
    throw new Error(
      `Environment variable ${key} must be an integer between 1 and ${maxValue}`,
    );
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
  API_REPLICA_COUNT: getEnvSafePositiveInteger("API_REPLICA_COUNT", 1, 10),

  // Database. Pool limits are per replica; size the aggregate across every API
  // container plus orchestrator/workers and retain operator headroom.
  DATABASE_URL: getEnv("DATABASE_URL", ""),
  PUBLIC_DB_POOL_MAX: getEnvSafePositiveInteger("PUBLIC_DB_POOL_MAX", 10, 50),

  // Auth
  // Deliberately has no default in any environment. A built-in development
  // key is not a safeguard: a process that merely forgot NODE_ENV would run
  // with a signing key published in this repository, so every token would
  // still be forgeable. `validateSigningSecrets` turns a missing or blank
  // value into a startup failure instead. Local development supplies it
  // through .env; tests inject it explicitly (apps/api/bunfig.toml).
  JWT_SECRET: getEnv("JWT_SECRET", ""),
  JWT_ACCESS_EXPIRES_IN: getEnv("JWT_ACCESS_EXPIRES_IN", "15m"),
  JWT_REFRESH_EXPIRES_IN: getEnv("JWT_REFRESH_EXPIRES_IN", "7d"),

  // Email. Only the selected provider's credentials are required, so a
  // deployment on one provider never has to invent values for the other.
  MAIL_DRIVER: getEnv("MAIL_DRIVER", isProduction ? "resend" : "log"),
  RESEND_API_KEY: getEnv("RESEND_API_KEY", ""),
  // Cloudflare Email Service (MAIL_DRIVER=cloudflare). The token needs the
  // Email Sending: Edit permission on the account that owns the sender domain.
  CLOUDFLARE_ACCOUNT_ID: getEnv("CLOUDFLARE_ACCOUNT_ID", ""),
  CLOUDFLARE_EMAIL_API_TOKEN: getEnv("CLOUDFLARE_EMAIL_API_TOKEN", ""),
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
  // No default, for the same reason as JWT_SECRET: this key signs the tokens
  // that authorize realtime channel subscriptions, so a published default
  // would let anyone mint a subscription to any workspace's channels.
  CENTRIFUGO_TOKEN_HMAC_SECRET: getEnv("CENTRIFUGO_TOKEN_HMAC_SECRET", ""),
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
  // Cloudflare R2 uses region "auto" and its account S3 API endpoint. MinIO
  // development keeps us-east-1. Path style is explicit for both providers.
  S3_REGION: getEnv("S3_REGION", isProduction ? "auto" : "us-east-1"),
  S3_FORCE_PATH_STYLE: getEnvBoolean("S3_FORCE_PATH_STYLE", true),
  // Comma-separated former path-style endpoints accepted only to recover an
  // object key from persisted legacy URLs. New requests are always signed for
  // S3_ENDPOINT.
  S3_LEGACY_ENDPOINTS: getEnv("S3_LEGACY_ENDPOINTS", ""),
  S3_SIGNED_URL_TTL_SECONDS: getEnvNumber("S3_SIGNED_URL_TTL_SECONDS", 5 * 60),

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
  RATE_LIMIT_MEMORY_MAX_ITEMS: getEnvSafePositiveInteger(
    "RATE_LIMIT_MEMORY_MAX_ITEMS",
    10000,
    1_000_000,
  ),
  RATE_LIMIT_POSTGRES_CLEANUP_INTERVAL_SECONDS: getEnvSafePositiveInteger(
    "RATE_LIMIT_POSTGRES_CLEANUP_INTERVAL_SECONDS",
    60,
    86_400,
  ),
  RATE_LIMIT_POSTGRES_CLEANUP_BATCH_SIZE: getEnvSafePositiveInteger(
    "RATE_LIMIT_POSTGRES_CLEANUP_BATCH_SIZE",
    1000,
    10_000,
  ),
  // Forwarded client IP headers are accepted only from these exact proxy IPs.
  TRUSTED_PROXY_IPS: getEnv("TRUSTED_PROXY_IPS", ""),
  TRUSTED_PROXY_IP_HEADER: getEnv(
    "TRUSTED_PROXY_IP_HEADER",
    "x-forwarded-for",
  ).toLowerCase(),

  // Database pooling
  TENANT_DB_POOL_MAX: getEnvSafePositiveInteger("TENANT_DB_POOL_MAX", 20, 50),

  // Realtime fan-out. Workspace membership is cached between conversation
  // events and invalidated on every company_members write, so a revocation
  // applies on the next event in this process. The TTL only bounds staleness
  // for writes made outside those paths - or on another API replica, whose
  // cache this process cannot invalidate. Set to 0 to always read live.
  REALTIME_MEMBERSHIP_CACHE_TTL_MS: getEnvNumber(
    "REALTIME_MEMBERSHIP_CACHE_TTL_MS",
    5_000,
  ),
  // Minimum gap between repeats of the same ephemeral signal (typing/presence)
  // for one conversation. Distinct states are never suppressed.
  REALTIME_EPHEMERAL_MIN_INTERVAL_MS: getEnvNumber(
    "REALTIME_EPHEMERAL_MIN_INTERVAL_MS",
    1_500,
  ),
} as const;

export type Env = typeof env;

const mailDrivers = ["log", "resend", "cloudflare"];
/** Drivers that actually hand a message to a provider. */
const deliveringMailDrivers = ["resend", "cloudflare"];

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

/**
 * Invariants that hold in every environment, not just production.
 *
 * HS256 accepts a zero-length key, so an empty signing secret does not fail
 * loudly - it silently makes every access token, refresh token, and realtime
 * connection token forgeable by anyone. That must be a startup failure in
 * development and test too, because those are exactly the processes an
 * operator can accidentally expose by forgetting to set NODE_ENV.
 */
export function validateSigningSecrets(config: Env = env): void {
  // Production reports empties through the required-variable check instead,
  // which lists every missing name at once rather than failing on the first.
  if (config.NODE_ENV !== "production") {
    const secrets = {
      JWT_SECRET: config.JWT_SECRET,
      CENTRIFUGO_TOKEN_HMAC_SECRET: config.CENTRIFUGO_TOKEN_HMAC_SECRET,
    };
    for (const [name, value] of Object.entries(secrets)) {
      if (!value.trim()) {
        throw new Error(
          `${name} is required and must not be blank. HS256 accepts a zero-length key, ` +
            `so starting without one would make every issued token forgeable. ` +
            `Set it in .env (generate one with: openssl rand -base64 48).`,
        );
      }
    }
  }

  if (
    config.JWT_SECRET.trim() &&
    config.JWT_SECRET === config.CENTRIFUGO_TOKEN_HMAC_SECRET
  ) {
    throw new Error("JWT and Centrifugo signing secrets must be different");
  }
}

/**
 * Credentials the selected mail provider needs. Requiring only these is what
 * lets a Cloudflare deployment omit `RESEND_API_KEY` entirely - and vice versa
 * - instead of supplying a placeholder for the provider it does not use.
 */
function requiredMailCredentials(config: Env): Record<string, string> {
  if (config.MAIL_DRIVER === "cloudflare") {
    return {
      CLOUDFLARE_ACCOUNT_ID: config.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_EMAIL_API_TOKEN: config.CLOUDFLARE_EMAIL_API_TOKEN,
    };
  }
  return { RESEND_API_KEY: config.RESEND_API_KEY };
}

function validateMailCredentials(config: Env): void {
  if (!deliveringMailDrivers.includes(config.MAIL_DRIVER)) {
    throw new Error(
      `MAIL_DRIVER must deliver mail in production; use one of: ${deliveringMailDrivers.join(", ")}`,
    );
  }

  if (config.MAIL_DRIVER === "cloudflare") {
    // Cloudflare account identifiers are 32 hex characters. Checking the shape
    // also rejects the ACCOUNT_ID placeholder carried in the example files.
    if (!/^[0-9a-f]{32}$/i.test(config.CLOUDFLARE_ACCOUNT_ID.trim())) {
      throw new Error(
        "CLOUDFLARE_ACCOUNT_ID must be a 32-character Cloudflare account ID in production",
      );
    }
    assertCredentialIsSafe(
      "CLOUDFLARE_EMAIL_API_TOKEN",
      config.CLOUDFLARE_EMAIL_API_TOKEN,
    );
    return;
  }

  assertCredentialIsSafe("RESEND_API_KEY", config.RESEND_API_KEY);
}

export function validateProductionEnv(config: Env = env): void {
  if (!mailDrivers.includes(config.MAIL_DRIVER)) {
    throw new Error(`MAIL_DRIVER must be one of: ${mailDrivers.join(", ")}`);
  }
  validateSigningSecrets(config);
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
    S3_REGION: config.S3_REGION,
    MEILISEARCH_URL: config.MEILISEARCH_URL,
    MEILISEARCH_API_KEY: config.MEILISEARCH_API_KEY,
    ...requiredMailCredentials(config),
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

  const storageEndpoint = assertServiceURL("S3_ENDPOINT", config.S3_ENDPOINT, [
    "https:",
  ]);
  const r2Suffix = ".r2.cloudflarestorage.com";
  if (
    !storageEndpoint.hostname.toLowerCase().endsWith(r2Suffix) ||
    storageEndpoint.hostname.length <= r2Suffix.length
  ) {
    throw new Error(
      "S3_ENDPOINT must use a Cloudflare account R2 S3 endpoint ending .r2.cloudflarestorage.com",
    );
  }
  if (
    storageEndpoint.pathname !== "/" ||
    storageEndpoint.search ||
    storageEndpoint.hash ||
    storageEndpoint.username ||
    storageEndpoint.password
  ) {
    throw new Error(
      "S3_ENDPOINT must be a path-free HTTPS R2 S3 API endpoint without credentials, query, or fragment",
    );
  }
  if (config.S3_BUCKET !== "whatsapp-media") {
    throw new Error(
      "S3_BUCKET must remain whatsapp-media to preserve stable media references",
    );
  }
  if (config.S3_REGION !== "auto") {
    throw new Error("S3_REGION must be auto for Cloudflare R2 in production");
  }
  if (!config.S3_FORCE_PATH_STYLE) {
    throw new Error("S3_FORCE_PATH_STYLE must be true in production");
  }
  if (
    !Number.isInteger(config.S3_SIGNED_URL_TTL_SECONDS) ||
    config.S3_SIGNED_URL_TTL_SECONDS < 60 ||
    config.S3_SIGNED_URL_TTL_SECONDS > 15 * 60
  ) {
    throw new Error(
      "S3_SIGNED_URL_TTL_SECONDS must be between 60 and 900 seconds in production",
    );
  }
  for (const legacyEndpoint of config.S3_LEGACY_ENDPOINTS.split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    assertServiceURL("S3_LEGACY_ENDPOINTS", legacyEndpoint, [
      "http:",
      "https:",
    ]);
  }
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

  validateMailCredentials(config);
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
  // Distinctness is asserted by validateSigningSecrets in every environment.

  // A long membership TTL is exactly how a permission revocation ends up
  // taking effect minutes later on a replica. The cache is an optimization;
  // production must not be able to turn it into a policy window.
  if (
    !Number.isInteger(config.REALTIME_MEMBERSHIP_CACHE_TTL_MS) ||
    config.REALTIME_MEMBERSHIP_CACHE_TTL_MS < 0 ||
    config.REALTIME_MEMBERSHIP_CACHE_TTL_MS > 60_000
  ) {
    throw new Error(
      "REALTIME_MEMBERSHIP_CACHE_TTL_MS must be between 0 and 60000 in production",
    );
  }
  if (
    !Number.isInteger(config.REALTIME_EPHEMERAL_MIN_INTERVAL_MS) ||
    config.REALTIME_EPHEMERAL_MIN_INTERVAL_MS < 0 ||
    config.REALTIME_EPHEMERAL_MIN_INTERVAL_MS > 30_000
  ) {
    throw new Error(
      "REALTIME_EPHEMERAL_MIN_INTERVAL_MS must be between 0 and 30000 in production",
    );
  }

  if (!config.RATE_LIMIT_ENABLED) {
    throw new Error("RATE_LIMIT_ENABLED must be true in production");
  }
  if (!["memory", "postgres", "redis"].includes(config.RATE_LIMIT_STORE_TYPE)) {
    throw new Error(
      "RATE_LIMIT_STORE_TYPE must be one of: memory, postgres, redis",
    );
  }
  if (
    !Number.isSafeInteger(config.API_REPLICA_COUNT) ||
    config.API_REPLICA_COUNT <= 0 ||
    config.API_REPLICA_COUNT > 10
  ) {
    throw new Error("API_REPLICA_COUNT must be an integer between 1 and 10");
  }
  if (
    !Number.isSafeInteger(config.PUBLIC_DB_POOL_MAX) ||
    config.PUBLIC_DB_POOL_MAX <= 0 ||
    config.PUBLIC_DB_POOL_MAX > 50 ||
    !Number.isSafeInteger(config.TENANT_DB_POOL_MAX) ||
    config.TENANT_DB_POOL_MAX <= 0 ||
    config.TENANT_DB_POOL_MAX > 50
  ) {
    throw new Error(
      "API database pool limits must be integers between 1 and 50",
    );
  }
  if (
    !Number.isSafeInteger(config.RATE_LIMIT_MEMORY_MAX_ITEMS) ||
    config.RATE_LIMIT_MEMORY_MAX_ITEMS <= 0 ||
    config.RATE_LIMIT_MEMORY_MAX_ITEMS > 1_000_000 ||
    !Number.isSafeInteger(
      config.RATE_LIMIT_POSTGRES_CLEANUP_INTERVAL_SECONDS,
    ) ||
    config.RATE_LIMIT_POSTGRES_CLEANUP_INTERVAL_SECONDS <= 0 ||
    config.RATE_LIMIT_POSTGRES_CLEANUP_INTERVAL_SECONDS > 86_400 ||
    !Number.isSafeInteger(config.RATE_LIMIT_POSTGRES_CLEANUP_BATCH_SIZE) ||
    config.RATE_LIMIT_POSTGRES_CLEANUP_BATCH_SIZE <= 0 ||
    config.RATE_LIMIT_POSTGRES_CLEANUP_BATCH_SIZE > 10_000
  ) {
    throw new Error("Rate-limit lifecycle settings are outside safe bounds");
  }
  if (
    config.API_REPLICA_COUNT > 1 &&
    config.RATE_LIMIT_STORE_TYPE !== "postgres"
  ) {
    throw new Error(
      "RATE_LIMIT_STORE_TYPE=postgres is required when API_REPLICA_COUNT is greater than 1",
    );
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
