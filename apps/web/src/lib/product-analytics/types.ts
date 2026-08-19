/**
 * Optional GA4 product analytics ("product-analytics").
 *
 * This is distinct from the customer-facing workspace analytics in
 * `hooks/analytics` and `apps/api/src/services/analytics`: those power the
 * in-app dashboard, while this module optionally reports anonymous,
 * operator-owned usage telemetry to a self-hoster's own GA4 property.
 */

export type ConsentDecision = "granted" | "denied";
export type ConsentState = ConsentDecision | "unknown";

/**
 * The complete approved event contract. Only Stage 1 events are instrumented
 * today; Stage 2 names are part of the reviewed contract so future call sites
 * cannot invent names or parameters outside this map.
 */
export interface ProductAnalyticsEvents {
  login: { method: "email" };
  sign_up: { method: "email" };
  workspace_created: Record<string, never>;
  whatsapp_connection_setup_started: Record<string, never>;
  whatsapp_connection_connected: { connectionMode: "new" | "reconnect" };
  message_sent: {
    messageType: "text" | "image" | "video" | "audio" | "document" | "other";
  };
  conversation_resolved: Record<string, never>;
  teammate_invited: { role: "admin" | "member" };
  quick_reply_used: Record<string, never>;
  broadcast_created: {
    delivery: "immediate" | "scheduled";
    recipientBucket: "1-10" | "11-50" | "51-100" | "100+";
  };
  report_exported: {
    report: "dashboard" | "audit" | "contacts" | "other";
    format: "csv" | "json" | "other";
  };
}

export type ProductAnalyticsEventName = keyof ProductAnalyticsEvents;

export interface ProductAnalyticsConfig {
  /** True only when the deployer opted in AND the measurement ID is valid. */
  enabled: boolean;
  /** Validated GA4 web measurement ID, present only when enabled. */
  measurementId: string | null;
  /** When true, each browser must grant consent before gtag.js loads. */
  requireConsent: boolean;
}

/** The subset of Storage the consent store needs; injectable for tests. */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The subset of window the GA runtime needs; injectable for tests. The index
 * signature carries gtag.js's documented per-property opt-out flag
 * (`ga-disable-<measurementId>`), set on consent withdrawal.
 */
export interface AnalyticsWindowLike {
  dataLayer?: unknown[];
  [key: string]: unknown;
}

/**
 * Browser boundary injected into the facade so every behavior is testable
 * under Bun without a DOM dependency.
 */
export interface ProductAnalyticsEnvironment {
  config: ProductAnalyticsConfig;
  storage: ConsentStorage | null;
  win: AnalyticsWindowLike | null;
  injectScript: (src: string, onError: () => void) => void;
  getPathname: () => string;
  getOrigin: () => string;
  removeAnalyticsCookies: () => void;
}
