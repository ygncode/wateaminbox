import type { AnalyticsWindowLike } from "./types";

const GTAG_SCRIPT_BASE = "https://www.googletagmanager.com/gtag/js";

/** Callers must pass a value already validated by normalizeMeasurementId. */
export function buildGtagScriptUrl(measurementId: string): string {
  return `${GTAG_SCRIPT_BASE}?id=${encodeURIComponent(measurementId)}`;
}

export interface Ga4Runtime {
  gtag: (...args: unknown[]) => void;
}

/** Canonicalized page fields pinned onto the tag; never the raw browser URL. */
export interface SanitizedPage {
  page_location: string;
  page_title: string;
}

/**
 * gtag.js's documented kill switch: with this window property set, the tag
 * stops measuring for the property entirely — including the cookieless
 * Consent Mode pings that a consent-denial update alone still allows.
 */
export function gaDisableKey(measurementId: string): string {
  return `ga-disable-${measurementId}`;
}

export const CONSENT_DENIED_UPDATE = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
} as const;

/**
 * Boots the gtag command queue and injects the loader script. Commands pushed
 * before the script finishes loading are queued on the dataLayer, so events
 * are never lost to load latency. Only analytics storage is ever granted; all
 * advertising signals stay denied (Consent Mode v2) and Google Signals /
 * ad-personalization are additionally disabled on the tag itself.
 *
 * The sanitized page and an empty referrer are pinned both persistently
 * (`set`) and on the config command: GA's automatically collected events
 * (`first_visit`, `session_start`, `user_engagement`) fire at config time
 * even with `send_page_view: false` and would otherwise derive the raw
 * browser URL and referrer — which can carry invite/reset tokens.
 */
export function startGa4(
  win: AnalyticsWindowLike,
  injectScript: (src: string, onError: () => void) => void,
  measurementId: string,
  initialPage: SanitizedPage,
): Ga4Runtime {
  const dataLayer = (win.dataLayer = win.dataLayer ?? []);
  function gtag(..._args: unknown[]) {
    // gtag.js only interprets `arguments` objects pushed onto the dataLayer;
    // plain arrays are silently ignored for command tuples.
    dataLayer.push(arguments);
  }

  gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  gtag("js", new Date());
  gtag("set", { ...initialPage, page_referrer: "" });
  gtag("config", measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    ...initialPage,
    page_referrer: "",
  });

  try {
    injectScript(buildGtagScriptUrl(measurementId), () => {
      // A blocked or failed loader (ad blocker, offline) is expected and must
      // never surface as an application error.
    });
  } catch {
    // Same policy: analytics failures never affect the application.
  }

  return { gtag };
}

/**
 * Expires the GA cookies that are removable from the current host after a
 * consent withdrawal. Cookies set on a parent domain are attempted for each
 * ancestor domain; unremovable ones are left for the browser/user.
 */
export function removeGaCookies(
  doc: { cookie: string },
  hostname: string,
): void {
  try {
    const names = doc.cookie
      .split(";")
      .map((entry) => entry.split("=", 1)[0].trim())
      .filter((name) => name === "_ga" || name.startsWith("_ga_"));

    const labels = hostname.split(".");
    const domains: (string | null)[] = [null];
    for (let index = 0; index < labels.length - 1; index += 1) {
      domains.push(labels.slice(index).join("."));
    }

    const expiry = "expires=Thu, 01 Jan 1970 00:00:00 GMT";
    for (const name of names) {
      for (const domain of domains) {
        doc.cookie = `${name}=; ${expiry}; path=/${
          domain ? `; domain=${domain}` : ""
        }`;
      }
    }
  } catch {
    // Cookie access can throw in hardened browser modes; ignore.
  }
}
