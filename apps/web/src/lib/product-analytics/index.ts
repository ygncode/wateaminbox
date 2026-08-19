import { readBuildTimeConfig } from "./config";
import { readStoredConsent, writeStoredConsent } from "./consent";
import { sanitizeEvent } from "./events";
import {
  CONSENT_DENIED_UPDATE,
  type Ga4Runtime,
  gaDisableKey,
  removeGaCookies,
  type SanitizedPage,
  startGa4,
} from "./ga4";
import {
  buildPageLocation,
  canonicalizeRoute,
  shouldTrackPageView,
} from "./routes";
import type {
  AnalyticsWindowLike,
  ConsentDecision,
  ConsentState,
  ConsentStorage,
  ProductAnalyticsEnvironment,
  ProductAnalyticsEventName,
  ProductAnalyticsEvents,
} from "./types";

export { bucketRecipientCount } from "./events";
export { createNavigationDeduper } from "./routes";
export type {
  ConsentDecision,
  ConsentState,
  ProductAnalyticsEvents,
} from "./types";

export interface ProductAnalytics {
  /** True when the deployer enabled GA with a valid measurement ID. */
  isConfigured(): boolean;
  /** True when each browser must grant consent before anything loads. */
  isConsentRequired(): boolean;
  /** Loads GA if (and only if) configuration and consent permit it. */
  initialize(): void;
  /** Sends a sanitized page view for a navigation. */
  trackPage(pathname: string): void;
  /** Sends an allowlisted product event. */
  track<K extends ProductAnalyticsEventName>(
    name: K,
    params: ProductAnalyticsEvents[K],
  ): void;
  getConsent(): ConsentState;
  setConsent(decision: ConsentDecision): void;
  /** Notifies on consent changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** True when a re-grant after an in-session withdrawal needs a reload. */
  isReloadRequired(): boolean;
  /** Clears in-memory state and re-reads stored consent (test/reset hook). */
  reset(): void;
}

/**
 * Every method is a safe no-op when analytics is disabled or consent does not
 * permit collection, and no failure may escape into application behavior.
 * Calls made before consent is granted are discarded, never replayed.
 */
export function createProductAnalytics(
  env: ProductAnalyticsEnvironment,
): ProductAnalytics {
  let runtime: Ga4Runtime | null = null;
  let consent: ConsentState = readStoredConsent(env.storage);
  // After a withdrawal the loaded tag must not be reinitialized; collection
  // can only restart on the next full page load.
  let stoppedUntilReload = false;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Listener failures must not break analytics or other listeners.
      }
    }
  };

  const collectionAllowed = () =>
    env.config.enabled &&
    !stoppedUntilReload &&
    (consent === "granted" ||
      (!env.config.requireConsent && consent !== "denied"));

  const sanitizedLocation = (): SanitizedPage => {
    const route = canonicalizeRoute(env.getPathname());
    return {
      page_location: buildPageLocation(env.getOrigin(), route.path),
      page_title: route.title,
    };
  };

  const initialize = () => {
    try {
      if (runtime || !collectionAllowed()) return;
      if (!env.win || !env.config.measurementId) return;
      runtime = startGa4(
        env.win,
        env.injectScript,
        env.config.measurementId,
        sanitizedLocation(),
      );
    } catch {
      // Never block the application on analytics startup.
    }
  };

  const dispatch = (name: string, params: Record<string, unknown>) => {
    if (!collectionAllowed()) return;
    initialize();
    if (!runtime) return;
    runtime.gtag("event", name, params);
  };

  return {
    isConfigured: () => env.config.enabled,
    isConsentRequired: () => env.config.requireConsent,
    initialize,
    getConsent: () => consent,
    isReloadRequired: () => stoppedUntilReload,

    setConsent(decision) {
      try {
        if (!env.config.enabled) return;
        const previous = consent;
        consent = decision;
        writeStoredConsent(env.storage, decision);
        if (decision === "denied") {
          if (runtime) {
            // Full withdrawal: gtag's per-property disable flag stops even
            // the cookieless Consent Mode pings that a denial update alone
            // still allows, then deny everything, stop dispatching, and
            // remove the GA cookies that are removable on this host.
            if (env.win && env.config.measurementId) {
              env.win[gaDisableKey(env.config.measurementId)] = true;
            }
            runtime.gtag("consent", "update", CONSENT_DENIED_UPDATE);
            stoppedUntilReload = true;
            env.removeAnalyticsCookies();
          }
        } else if (previous !== "granted") {
          initialize();
        }
        notify();
      } catch {
        // Consent handling must never throw into the UI.
      }
    },

    trackPage(pathname) {
      try {
        if (!collectionAllowed()) return;
        // Redirect-only locations (root, legacy paths, workspace index,
        // unknown wildcards) never settle on screen; tracking them would
        // count one user navigation as several page views.
        if (!shouldTrackPageView(pathname)) return;
        const route = canonicalizeRoute(pathname);
        const page: SanitizedPage = {
          page_location: buildPageLocation(env.getOrigin(), route.path),
          page_title: route.title,
        };
        initialize();
        if (!runtime) return;
        // Re-pin the tag's persistent page state on every navigation so
        // automatically collected events (user_engagement, scrolls) also see
        // only the canonical location and never the raw browser URL/referrer.
        runtime.gtag("set", { ...page, page_referrer: "" });
        runtime.gtag("event", "page_view", { ...page, page_path: route.path });
      } catch {
        // Analytics failures never block navigation.
      }
    },

    track(name, params) {
      try {
        const sanitized = sanitizeEvent(name, params);
        if (!sanitized) return;
        // The sanitized location is attached explicitly so GA never derives
        // the raw browser URL for custom events.
        dispatch(sanitized.name, {
          ...sanitized.params,
          ...sanitizedLocation(),
        });
      } catch {
        // Analytics failures never block user actions.
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    reset() {
      runtime = null;
      stoppedUntilReload = false;
      consent = readStoredConsent(env.storage);
      notify();
    },
  };
}

function safeLocalStorage(): ConsentStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function createBrowserEnvironment(): ProductAnalyticsEnvironment {
  const hasWindow = typeof window !== "undefined";
  const hasDocument = typeof document !== "undefined";
  return {
    config: readBuildTimeConfig(),
    storage: safeLocalStorage(),
    // Double cast: Window has no string index signature, but the flag key
    // (ga-disable-<id>) is a documented dynamic gtag.js property.
    win: hasWindow ? (window as unknown as AnalyticsWindowLike) : null,
    injectScript: (src, onError) => {
      if (!hasDocument) return;
      // Load the loader at most once, and never from index.html.
      if (document.querySelector(`script[src="${src}"]`)) return;
      const script = document.createElement("script");
      script.async = true;
      script.src = src;
      script.onerror = onError;
      document.head.appendChild(script);
    },
    getPathname: () => (hasWindow ? window.location.pathname : "/"),
    getOrigin: () => (hasWindow ? window.location.origin : "https://localhost"),
    removeAnalyticsCookies: () => {
      if (hasDocument && hasWindow) {
        removeGaCookies(document, window.location.hostname);
      }
    },
  };
}

/**
 * Application-wide facade. No component outside this integration may call
 * window.gtag or touch the dataLayer directly.
 */
export const productAnalytics: ProductAnalytics = createProductAnalytics(
  createBrowserEnvironment(),
);
