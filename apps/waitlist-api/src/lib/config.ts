import { ConfigurationError } from "./errors";
import type { Env } from "../types";

export interface RuntimeConfig {
  allowedOrigins: Set<string>;
  apiOrigin: string;
  fromEmail: string;
  marketingOrigin: string;
  secureCookies: boolean;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new ConfigurationError(`${name} is not configured`);
  }
  return value.trim();
}

function origin(value: string, name: string, requireHttps: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must be an absolute http(s) URL`);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ConfigurationError(`${name} must be an origin without a path`);
  }

  if (requireHttps && parsed.protocol !== "https:") {
    throw new ConfigurationError(
      `${name} must use HTTPS outside local development`,
    );
  }

  return parsed.origin;
}

function requiredSecret(value: string | undefined, name: string): void {
  if (!value || value.length < 32) {
    throw new ConfigurationError(`${name} must be at least 32 characters`);
  }
}

export function getRuntimeConfig(env: Env): RuntimeConfig {
  const isDevelopment = env.ENVIRONMENT === "development";
  requiredSecret(env.WAITLIST_TOKEN_SECRET, "WAITLIST_TOKEN_SECRET");
  requiredSecret(env.ADMIN_SESSION_SECRET, "ADMIN_SESSION_SECRET");
  required(env.ADMIN_PASSWORD_HASH, "ADMIN_PASSWORD_HASH");
  if (!isDevelopment && !env.TURNSTILE_SECRET_KEY?.trim()) {
    throw new ConfigurationError(
      "TURNSTILE_SECRET_KEY is required outside local development",
    );
  }

  const marketingOrigin = origin(
    required(env.MARKETING_ORIGIN, "MARKETING_ORIGIN"),
    "MARKETING_ORIGIN",
    !isDevelopment,
  );
  const apiOrigin = origin(
    required(env.PUBLIC_API_ORIGIN, "PUBLIC_API_ORIGIN"),
    "PUBLIC_API_ORIGIN",
    !isDevelopment,
  );
  const allowedOrigins = new Set(
    required(env.ALLOWED_ORIGINS, "ALLOWED_ORIGINS")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => origin(entry, "ALLOWED_ORIGINS", !isDevelopment)),
  );

  if (!allowedOrigins.has(marketingOrigin)) {
    throw new ConfigurationError(
      "ALLOWED_ORIGINS must include MARKETING_ORIGIN for the browser signup form",
    );
  }

  return {
    allowedOrigins,
    apiOrigin,
    fromEmail: required(env.WAITLIST_FROM_EMAIL, "WAITLIST_FROM_EMAIL"),
    marketingOrigin,
    secureCookies: !isDevelopment,
  };
}

export function allowedCorsOrigin(
  request: Request,
  config: RuntimeConfig,
): string | undefined {
  const value = request.headers.get("Origin");
  if (!value) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }

  if (parsed.origin !== value || !config.allowedOrigins.has(parsed.origin)) {
    return undefined;
  }

  return parsed.origin;
}

export function hasExactOrigin(
  request: Request,
  expectedOrigin: string,
): boolean {
  return request.headers.get("Origin") === expectedOrigin;
}
