import type { ConsentDecision, ConsentState, ConsentStorage } from "./types";

/** Versioned so a future consent-scope change can re-prompt visitors. */
export const CONSENT_STORAGE_KEY = "wateaminbox:analytics-consent:v1";

/**
 * Unavailable, throwing, or corrupt storage is always treated as "unknown"
 * (which callers must treat as not-granted), never as implicit consent.
 */
export function readStoredConsent(
  storage: ConsentStorage | null,
): ConsentState {
  if (!storage) return "unknown";
  try {
    const value = storage.getItem(CONSENT_STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

/** Returns false when the decision could not be persisted. */
export function writeStoredConsent(
  storage: ConsentStorage | null,
  decision: ConsentDecision,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CONSENT_STORAGE_KEY, decision);
    return true;
  } catch {
    return false;
  }
}
