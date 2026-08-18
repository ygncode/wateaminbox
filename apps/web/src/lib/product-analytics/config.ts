import type { ProductAnalyticsConfig } from "./types";

/**
 * Conservative GA4 web measurement ID shape. GA4 web streams use `G-` plus
 * uppercase letters/digits; anything else (UA-, GTM-, AW- IDs, lowercase,
 * separators, URLs) is rejected so the loader URL can only ever be built from
 * a vetted token.
 */
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

/** The deployer opt-in switch accepts only the exact string "true". */
export function isEnabledFlag(value: unknown): boolean {
  return value === "true";
}

/**
 * Consent is required by default; only the literal string "false" bypasses
 * the in-app consent gate (an explicit operator policy decision).
 */
export function isConsentRequiredFlag(value: unknown): boolean {
  return value !== "false";
}

/** Returns the validated measurement ID, or null when unusable. */
export function normalizeMeasurementId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return MEASUREMENT_ID_PATTERN.test(id) ? id : null;
}

/**
 * Truth table: analytics is active only when the enable switch is exactly
 * "true" AND the measurement ID validates. Every other combination is
 * disabled, including a retained ID with the switch off.
 */
export function resolveProductAnalyticsConfig(env: {
  gaEnabled?: unknown;
  gaMeasurementId?: unknown;
  gaRequireConsent?: unknown;
}): ProductAnalyticsConfig {
  const measurementId = normalizeMeasurementId(env.gaMeasurementId);
  const enabled = isEnabledFlag(env.gaEnabled) && measurementId !== null;
  return {
    enabled,
    measurementId: enabled ? measurementId : null,
    requireConsent: isConsentRequiredFlag(env.gaRequireConsent),
  };
}

/** Reads the compile-time Vite values. Changing them requires a rebuild. */
export function readBuildTimeConfig(): ProductAnalyticsConfig {
  return resolveProductAnalyticsConfig({
    gaEnabled: import.meta.env.VITE_GA_ENABLED,
    gaMeasurementId: import.meta.env.VITE_GA_MEASUREMENT_ID,
    gaRequireConsent: import.meta.env.VITE_GA_REQUIRE_CONSENT,
  });
}
