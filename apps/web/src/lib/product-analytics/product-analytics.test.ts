import { describe, expect, it } from "bun:test";
import { CONSENT_STORAGE_KEY } from "./consent";
import { buildGtagScriptUrl, gaDisableKey, removeGaCookies } from "./ga4";
import { createProductAnalytics } from "./index";
import type {
  AnalyticsWindowLike,
  ConsentStorage,
  ProductAnalyticsConfig,
  ProductAnalyticsEnvironment,
} from "./types";

const VALID_ID = "G-ABC123XYZ9";
const ENABLED_CONFIG: ProductAnalyticsConfig = {
  enabled: true,
  measurementId: VALID_ID,
  requireConsent: true,
};
const DISABLED_CONFIG: ProductAnalyticsConfig = {
  enabled: false,
  measurementId: null,
  requireConsent: true,
};

interface Harness {
  env: ProductAnalyticsEnvironment;
  win: AnalyticsWindowLike;
  injectedScripts: string[];
  scriptErrorHandlers: Array<() => void>;
  cookieRemovals: number;
  store: Map<string, string>;
}

function createHarness(
  config: ProductAnalyticsConfig,
  options: {
    storedConsent?: string;
    storage?: ConsentStorage | null;
    pathname?: string;
  } = {},
): Harness {
  const store = new Map<string, string>();
  if (options.storedConsent)
    store.set(CONSENT_STORAGE_KEY, options.storedConsent);
  const win: AnalyticsWindowLike = {};
  const harness: Harness = {
    win,
    injectedScripts: [],
    scriptErrorHandlers: [],
    cookieRemovals: 0,
    store,
    env: {
      config,
      storage:
        options.storage !== undefined
          ? options.storage
          : {
              getItem: (key) => store.get(key) ?? null,
              setItem: (key, value) => void store.set(key, value),
              removeItem: (key) => void store.delete(key),
            },
      win,
      injectScript: (src, onError) => {
        harness.injectedScripts.push(src);
        harness.scriptErrorHandlers.push(onError);
      },
      getPathname: () =>
        options.pathname ?? "/w/8f6f27a1-4a2e/chat/abc123def456",
      getOrigin: () => "https://inbox.example.com",
      removeAnalyticsCookies: () => {
        harness.cookieRemovals += 1;
      },
    },
  };
  return harness;
}

/** dataLayer entries are `arguments` objects; normalize them to arrays. */
function commands(win: AnalyticsWindowLike): unknown[][] {
  return (win.dataLayer ?? []).map((entry) =>
    Array.from(entry as ArrayLike<unknown>),
  );
}

function eventsIn(win: AnalyticsWindowLike): Array<[string, unknown]> {
  return commands(win)
    .filter((command) => command[0] === "event")
    .map((command) => [command[1] as string, command[2]]);
}

describe("disabled analytics", () => {
  it("never creates a dataLayer, injects a script, or emits an event", () => {
    const harness = createHarness(DISABLED_CONFIG, {
      storedConsent: "granted",
    });
    const analytics = createProductAnalytics(harness.env);

    expect(analytics.isConfigured()).toBe(false);
    analytics.initialize();
    analytics.trackPage("/login");
    analytics.track("login", { method: "email" });
    analytics.setConsent("granted");

    expect(harness.win.dataLayer).toBeUndefined();
    expect(harness.injectedScripts).toEqual([]);
  });
});

describe("consent gating", () => {
  it("does not load GA while required consent is unknown or denied", () => {
    for (const storedConsent of [undefined, "denied"]) {
      const harness = createHarness(ENABLED_CONFIG, { storedConsent });
      const analytics = createProductAnalytics(harness.env);
      analytics.initialize();
      analytics.trackPage("/login");
      analytics.track("login", { method: "email" });
      expect(harness.win.dataLayer).toBeUndefined();
      expect(harness.injectedScripts).toEqual([]);
    }
  });

  it("discards pre-consent calls instead of replaying them", () => {
    const harness = createHarness(ENABLED_CONFIG);
    const analytics = createProductAnalytics(harness.env);

    analytics.trackPage("/login");
    analytics.track("login", { method: "email" });
    analytics.setConsent("granted");

    expect(eventsIn(harness.win)).toEqual([]);
  });

  it("granting consent initializes GA exactly once", () => {
    const harness = createHarness(ENABLED_CONFIG);
    const analytics = createProductAnalytics(harness.env);

    analytics.setConsent("granted");
    analytics.initialize();
    analytics.trackPage("/login");
    analytics.trackPage("/register");

    expect(harness.injectedScripts).toEqual([buildGtagScriptUrl(VALID_ID)]);
    const all = commands(harness.win);
    expect(all.filter((command) => command[0] === "config")).toHaveLength(1);
  });

  it("persists a decline without loading GA", () => {
    const harness = createHarness(ENABLED_CONFIG);
    const analytics = createProductAnalytics(harness.env);
    analytics.setConsent("denied");
    expect(harness.store.get(CONSENT_STORAGE_KEY)).toBe("denied");
    expect(harness.win.dataLayer).toBeUndefined();
    expect(harness.injectedScripts).toEqual([]);
  });

  it("initializes without the banner flow when consent is not required", () => {
    const harness = createHarness(
      { ...ENABLED_CONFIG, requireConsent: false },
      {},
    );
    const analytics = createProductAnalytics(harness.env);
    analytics.trackPage("/login");
    expect(harness.injectedScripts).toHaveLength(1);
    expect(eventsIn(harness.win)).toHaveLength(1);
  });

  it("still honors an explicit denial when consent is not required", () => {
    const harness = createHarness(
      { ...ENABLED_CONFIG, requireConsent: false },
      { storedConsent: "denied" },
    );
    const analytics = createProductAnalytics(harness.env);
    analytics.trackPage("/login");
    expect(harness.win.dataLayer).toBeUndefined();
    expect(harness.injectedScripts).toEqual([]);
  });

  it("treats corrupt or unavailable storage as not granted", () => {
    const throwing: ConsentStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    for (const storage of [null, throwing]) {
      const harness = createHarness(ENABLED_CONFIG, { storage });
      const analytics = createProductAnalytics(harness.env);
      expect(analytics.getConsent()).toBe("unknown");
      analytics.trackPage("/login");
      expect(harness.injectedScripts).toEqual([]);
      // Granting with broken storage must not throw either.
      analytics.setConsent("granted");
    }
  });
});

describe("initialization", () => {
  it("boots with consent defaults, signals off, and manual page views", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    analytics.initialize();

    const all = commands(harness.win);
    expect(all[0]).toEqual([
      "consent",
      "default",
      {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ]);
    const config = all.find((command) => command[0] === "config");
    expect(config?.[1]).toBe(VALID_ID);
    expect(config?.[2]).toEqual({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: "https://inbox.example.com/w/:workspace/chat/:contact",
      page_title: "Conversation",
      page_referrer: "",
    });
    expect(JSON.stringify(all)).not.toContain("debug_mode");
  });

  it("pins sanitized page state before config so automatic events cannot leak the raw URL", () => {
    // Consent granted while sitting on a token-bearing route: GA's automatic
    // first_visit/session_start fire at config time, so the tag state itself
    // must already be canonical with the referrer suppressed.
    const harness = createHarness(ENABLED_CONFIG, {
      storedConsent: "granted",
      pathname: "/invite/super-secret-invitation-token",
    });
    createProductAnalytics(harness.env).initialize();

    const all = commands(harness.win);
    const setIndex = all.findIndex((command) => command[0] === "set");
    const configIndex = all.findIndex((command) => command[0] === "config");
    expect(setIndex).toBeGreaterThanOrEqual(0);
    expect(setIndex).toBeLessThan(configIndex);
    expect(all[setIndex][1]).toEqual({
      page_location: "https://inbox.example.com/invite/:token",
      page_title: "Accept invitation",
      page_referrer: "",
    });
    expect(JSON.stringify(harness.win.dataLayer)).not.toContain("secret");
  });

  it("constructs the script URL only from the validated measurement ID", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    createProductAnalytics(harness.env).initialize();
    expect(harness.injectedScripts).toEqual([
      `https://www.googletagmanager.com/gtag/js?id=${VALID_ID}`,
    ]);
  });

  it("swallows script load errors instead of throwing", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    analytics.initialize();
    expect(() => {
      for (const onError of harness.scriptErrorHandlers) onError();
    }).not.toThrow();
    // Dispatch keeps queueing to the dataLayer without any application error.
    analytics.trackPage("/login");
    expect(eventsIn(harness.win)).toHaveLength(1);
  });

  it("does not throw when script injection itself fails", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    harness.env.injectScript = () => {
      throw new Error("CSP blocked");
    };
    const analytics = createProductAnalytics(harness.env);
    expect(() => {
      analytics.initialize();
      analytics.trackPage("/login");
    }).not.toThrow();
  });
});

describe("sanitized dispatch", () => {
  it("sends manually controlled, sanitized page views", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    analytics.trackPage("/w/8f6f27a1-4a2e/chat/abc123def456?token=secret#x");

    expect(eventsIn(harness.win)).toEqual([
      [
        "page_view",
        {
          page_location: "https://inbox.example.com/w/:workspace/chat/:contact",
          page_path: "/w/:workspace/chat/:contact",
          page_title: "Conversation",
        },
      ],
    ]);
  });

  it("skips redirect-only locations so one navigation yields one page view", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    // The redirect chain a fresh visit produces: / -> /chat -> /w/:id/chat.
    analytics.trackPage("/");
    analytics.trackPage("/chat");
    analytics.trackPage("/w/8f6f27a1/chat");
    // Workspace index and bare/unknown settings redirect internally too.
    analytics.trackPage("/w/8f6f27a1");
    analytics.trackPage("/w/8f6f27a1/settings");
    analytics.trackPage("/w/8f6f27a1/settings/not-a-section");
    analytics.trackPage("/w/8f6f27a1/settings/general");

    expect(eventsIn(harness.win).map(([, params]) => params)).toEqual([
      {
        page_location: "https://inbox.example.com/w/:workspace/chat",
        page_path: "/w/:workspace/chat",
        page_title: "Chat",
      },
      {
        page_location:
          "https://inbox.example.com/w/:workspace/settings/general",
        page_path: "/w/:workspace/settings/general",
        page_title: "Settings",
      },
    ]);
  });

  it("re-pins canonical page state with a suppressed referrer on every navigation", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    analytics.trackPage("/login");
    analytics.trackPage("/w/8f6f27a1/broadcasts/job-9?x=1");

    const sets = commands(harness.win)
      .filter((command) => command[0] === "set")
      .map((command) => command[1]);
    // One initial pin from startGa4 plus one per navigation.
    expect(sets).toHaveLength(3);
    for (const set of sets) {
      expect((set as Record<string, unknown>).page_referrer).toBe("");
    }
    expect(sets[1]).toEqual({
      page_location: "https://inbox.example.com/login",
      page_title: "Login",
      page_referrer: "",
    });
    expect(sets[2]).toEqual({
      page_location: "https://inbox.example.com/w/:workspace/broadcasts/:job",
      page_title: "Broadcast job",
      page_referrer: "",
    });
  });

  it("attaches the sanitized location to custom events, never the raw URL", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    analytics.track("workspace_created", {});

    const [[name, params]] = eventsIn(harness.win);
    expect(name).toBe("workspace_created");
    expect(params).toEqual({
      page_location: "https://inbox.example.com/w/:workspace/chat/:contact",
      page_title: "Conversation",
    });
    expect(JSON.stringify(harness.win.dataLayer)).not.toContain("8f6f27a1");
    expect(JSON.stringify(harness.win.dataLayer)).not.toContain("abc123def456");
  });

  it("drops events that fail the runtime allowlist", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    const loose = analytics.track as (name: string, params: unknown) => void;
    loose("purchase", { value: 100 });
    loose("login", { method: "sso" });
    loose("login", { method: "email", email: "person@example.com" });

    const events = eventsIn(harness.win);
    expect(events).toHaveLength(1);
    expect(events[0][1]).not.toHaveProperty("email");
  });
});

describe("withdrawal", () => {
  it("sets the ga-disable flag so even cookieless pings stop", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    analytics.trackPage("/login");
    expect(harness.win[gaDisableKey(VALID_ID)]).toBeUndefined();

    analytics.setConsent("denied");
    expect(harness.win[gaDisableKey(VALID_ID)]).toBe(true);
  });

  it("does not set the ga-disable flag when GA never loaded", () => {
    const harness = createHarness(ENABLED_CONFIG);
    const analytics = createProductAnalytics(harness.env);
    analytics.setConsent("denied");
    expect(harness.win[gaDisableKey(VALID_ID)]).toBeUndefined();
  });

  it("denies Consent Mode signals, stops dispatch, and clears cookies", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    analytics.trackPage("/login");
    analytics.setConsent("denied");

    const consentUpdates = commands(harness.win).filter(
      (command) => command[0] === "consent" && command[1] === "update",
    );
    expect(consentUpdates).toEqual([
      [
        "consent",
        "update",
        {
          analytics_storage: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
        },
      ],
    ]);
    expect(harness.cookieRemovals).toBe(1);
    expect(harness.store.get(CONSENT_STORAGE_KEY)).toBe("denied");

    const before = eventsIn(harness.win).length;
    analytics.trackPage("/register");
    analytics.track("login", { method: "email" });
    expect(eventsIn(harness.win)).toHaveLength(before);
  });

  it("does not reinitialize the tag on a same-session re-grant", () => {
    const harness = createHarness(ENABLED_CONFIG, { storedConsent: "granted" });
    const analytics = createProductAnalytics(harness.env);
    analytics.trackPage("/login");
    analytics.setConsent("denied");
    analytics.setConsent("granted");

    expect(analytics.isReloadRequired()).toBe(true);
    const before = eventsIn(harness.win).length;
    analytics.trackPage("/register");
    expect(eventsIn(harness.win)).toHaveLength(before);
    expect(harness.injectedScripts).toHaveLength(1);
    // The re-grant is persisted, so the next page load collects again.
    expect(harness.store.get(CONSENT_STORAGE_KEY)).toBe("granted");
  });
});

describe("GA cookie removal", () => {
  it("expires only GA cookies, across the host's domain candidates", () => {
    const writes: string[] = [];
    const doc = {
      get cookie() {
        return "_ga=GA1.1.1; _ga_ABC123XYZ9=GS1.1.1; session=keep; theme=dark";
      },
      set cookie(value: string) {
        writes.push(value);
      },
    };
    removeGaCookies(doc, "app.inbox.example.com");

    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write).toContain("expires=Thu, 01 Jan 1970");
      expect(write.startsWith("_ga")).toBe(true);
    }
    expect(
      writes.some((write) => write.includes("domain=inbox.example.com")),
    ).toBe(true);
    expect(writes.some((write) => write.startsWith("session"))).toBe(false);
  });

  it("ignores cookie access failures", () => {
    const doc = {
      get cookie(): string {
        throw new Error("blocked");
      },
      set cookie(_value: string) {
        throw new Error("blocked");
      },
    };
    expect(() => removeGaCookies(doc, "example.com")).not.toThrow();
  });
});

describe("consent subscription", () => {
  it("notifies listeners on changes and supports unsubscribe", () => {
    const harness = createHarness(ENABLED_CONFIG);
    const analytics = createProductAnalytics(harness.env);
    let notified = 0;
    const unsubscribe = analytics.subscribe(() => {
      notified += 1;
    });
    analytics.setConsent("granted");
    expect(notified).toBe(1);
    unsubscribe();
    analytics.setConsent("denied");
    expect(notified).toBe(1);
  });
});
