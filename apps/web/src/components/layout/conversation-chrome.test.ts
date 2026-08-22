import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONVERSATION_BOTTOM_INSET_CLASS,
  isConversationDetailPath,
  MOBILE_NAV_CONVERSATION_CLASS,
  MOBILE_NAV_DEFAULT_CLASS,
  resolveAppShellChrome,
  SHELL_MAIN_CONVERSATION_CLASS,
  SHELL_MAIN_NAV_RESERVE_CLASS,
} from "./conversation-chrome";
import { KEYBOARD_INSET_CSS_VAR } from "@/hooks/ui/keyboard-inset";

const WORKSPACE = "11111111-2222-3333-4444-555555555555";

/**
 * Tailwind breakpoints the conversation chrome switches on. `base` is the
 * phone, `md` the tablet two-pane layout, `lg` the desktop three-column one.
 */
const BREAKPOINTS = ["base", "md", "lg"] as const;
type Breakpoint = (typeof BREAKPOINTS)[number];

/**
 * Resolves the utility that actually wins at a breakpoint: Tailwind's variants
 * are min-width, so the last prefix at or below the breakpoint applies.
 */
function resolveAt(classes: string, property: string, at: Breakpoint): string {
  const order: Breakpoint[] = ["base", "md", "lg"];
  const limit = order.indexOf(at);
  let winner = "";
  for (const token of classes.split(/\s+/).filter(Boolean)) {
    const [maybeVariant, ...rest] = token.split(":");
    const variant = rest.length ? maybeVariant : "base";
    const utility = rest.length ? rest.join(":") : token;
    if (!utility.startsWith(`${property}-`)) continue;
    const index = order.indexOf(variant as Breakpoint);
    if (index === -1 || index > limit) continue;
    winner = utility;
  }
  return winner;
}

describe("isConversationDetailPath", () => {
  it("is true only when a contact id addresses one conversation", () => {
    expect(isConversationDetailPath(`/w/${WORKSPACE}/chat/contact-1`)).toBe(
      true,
    );
    expect(isConversationDetailPath(`/w/${WORKSPACE}/chat`)).toBe(false);
  });

  it("still treats the list as the list under the groups filter", () => {
    // The filter lives in the query string, which never reaches this rule.
    expect(isConversationDetailPath(`/w/${WORKSPACE}/chat`)).toBe(false);
  });

  it("leaves every other destination alone", () => {
    for (const destination of [
      "dashboard",
      "broadcasts",
      "team",
      "audit",
      "settings",
      "notifications",
    ]) {
      expect(isConversationDetailPath(`/w/${WORKSPACE}/${destination}`)).toBe(
        false,
      );
      expect(
        isConversationDetailPath(`/w/${WORKSPACE}/${destination}/anything`),
      ).toBe(false);
    }
  });

  it("recognises the legacy non-workspace conversation path", () => {
    expect(isConversationDetailPath("/chat/contact-1")).toBe(true);
    expect(isConversationDetailPath("/chat")).toBe(false);
  });

  it("does not mistake the workspace root or an unknown path for a chat", () => {
    expect(isConversationDetailPath("/")).toBe(false);
    expect(isConversationDetailPath(`/w/${WORKSPACE}`)).toBe(false);
    expect(isConversationDetailPath("/somewhere/else")).toBe(false);
  });
});

describe("resolveAppShellChrome", () => {
  it("keeps the floating bar and its reserved height on the conversation list", () => {
    const chrome = resolveAppShellChrome(`/w/${WORKSPACE}/chat`);
    expect(chrome.isConversationDetail).toBe(false);
    expect(chrome.navClass).toBe(MOBILE_NAV_DEFAULT_CLASS);
    expect(chrome.mainPaddingClass).toBe(SHELL_MAIN_NAV_RESERVE_CLASS);
  });

  it("keeps them on every non-chat destination", () => {
    for (const path of [
      `/w/${WORKSPACE}/dashboard`,
      `/w/${WORKSPACE}/broadcasts`,
      `/w/${WORKSPACE}/settings/profile`,
    ]) {
      expect(resolveAppShellChrome(path).navClass).toBe(
        MOBILE_NAV_DEFAULT_CLASS,
      );
    }
  });

  it("withdraws them once a conversation is open", () => {
    const chrome = resolveAppShellChrome(`/w/${WORKSPACE}/chat/contact-1`);
    expect(chrome.isConversationDetail).toBe(true);
    expect(chrome.navClass).toBe(MOBILE_NAV_CONVERSATION_CLASS);
    expect(chrome.mainPaddingClass).toBe(SHELL_MAIN_CONVERSATION_CLASS);
  });
});

describe("bottom navigation visibility", () => {
  /** `flex`/`hidden` are bare utilities, so resolve them by hand. */
  function visibility(classes: string, at: Breakpoint): string {
    const order: Breakpoint[] = ["base", "md", "lg"];
    const limit = order.indexOf(at);
    let winner = "";
    for (const token of classes.split(/\s+/).filter(Boolean)) {
      const [maybeVariant, ...rest] = token.split(":");
      const variant = rest.length ? maybeVariant : "base";
      const utility = rest.length ? rest.join(":") : token;
      if (utility !== "flex" && utility !== "hidden") continue;
      const index = order.indexOf(variant as Breakpoint);
      if (index === -1 || index > limit) continue;
      winner = utility;
    }
    return winner;
  }

  it("shows the bar on phone and tablet and hides it on desktop by default", () => {
    expect(visibility(MOBILE_NAV_DEFAULT_CLASS, "base")).toBe("flex");
    expect(visibility(MOBILE_NAV_DEFAULT_CLASS, "md")).toBe("flex");
    expect(visibility(MOBILE_NAV_DEFAULT_CLASS, "lg")).toBe("hidden");
  });

  it("hides the bar at every width once a conversation is open", () => {
    for (const at of BREAKPOINTS) {
      expect([at, visibility(MOBILE_NAV_CONVERSATION_CLASS, at)]).toEqual([
        at,
        "hidden",
      ]);
    }
  });

  it("leaves desktop exactly as it was: the rail owns navigation either way", () => {
    expect(visibility(MOBILE_NAV_DEFAULT_CLASS, "lg")).toBe(
      visibility(MOBILE_NAV_CONVERSATION_CLASS, "lg"),
    );
  });
});

describe("bottom inset ownership", () => {
  const shellPad = (classes: string, at: Breakpoint) =>
    resolveAt(classes, "pb", at);

  const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
  const insetRule =
    css
      .split(`.${CONVERSATION_BOTTOM_INSET_CLASS} {`)[1]
      ?.split("}")[0]
      ?.replace(/\s+/g, " ")
      .trim() ?? "";

  it("reserves the bar's height exactly where the bar is rendered", () => {
    expect(shellPad(SHELL_MAIN_NAV_RESERVE_CLASS, "base")).toContain("5.5rem");
    expect(shellPad(SHELL_MAIN_NAV_RESERVE_CLASS, "md")).toContain("5.5rem");
    expect(shellPad(SHELL_MAIN_NAV_RESERVE_CLASS, "lg")).toBe("pb-0");
  });

  it("reserves nothing at any width once a conversation is open", () => {
    for (const at of BREAKPOINTS) {
      expect([at, shellPad(SHELL_MAIN_CONVERSATION_CLASS, at)]).toEqual([
        at,
        "pb-0",
      ]);
    }
  });

  it("keeps the desktop reserve identical on the list and on a conversation", () => {
    expect(shellPad(SHELL_MAIN_CONVERSATION_CLASS, "lg")).toBe(
      shellPad(SHELL_MAIN_NAV_RESERVE_CLASS, "lg"),
    );
  });

  it("hands the whole bottom inset to the conversation footer, at every width", () => {
    // The shell never pays on a detail route, so nothing can double up with
    // the footer's own inset.
    for (const at of BREAKPOINTS) {
      expect([at, shellPad(SHELL_MAIN_CONVERSATION_CLASS, at)]).toEqual([
        at,
        "pb-0",
      ]);
    }
    expect(insetRule).not.toBe("");
  });

  it("takes the greater of the home indicator and the keyboard, never their sum", () => {
    // Both insets describe the same strip of screen. Summing them lifts the
    // composer a home-indicator's height above an open keyboard - the normal
    // case on iOS, where the safe-area env stays non-zero while VisualViewport
    // reports the overlap.
    expect(insetRule).toStartWith("padding-bottom: max(");
    expect(insetRule).toContain("env(safe-area-inset-bottom)");
    expect(insetRule).toContain(`var(${KEYBOARD_INSET_CSS_VAR}, 0px)`);
    expect(insetRule).not.toContain("+");
    expect(insetRule).not.toContain("calc(");
  });

  it("is a single padding-bottom declaration, so nothing can stack on it", () => {
    expect(insetRule.match(/padding-bottom:/g)).toHaveLength(1);
    // A bare utility name, not a Tailwind `pb-*`, so no variant of it can also
    // apply at another breakpoint.
    expect(CONVERSATION_BOTTOM_INSET_CLASS.split(/\s+/)).toHaveLength(1);
    expect(CONVERSATION_BOTTOM_INSET_CLASS).not.toStartWith("pb-");
  });

  it("falls back to the home indicator alone when no keyboard is reported", () => {
    // `var(--wa-keyboard-inset, 0px)` is the fallback that makes max() degrade
    // to the safe area on every browser without a published inset.
    expect(insetRule).toContain(", 0px)");
  });
});

/**
 * Tailwind extracts utilities by scanning source text. A class assembled from
 * a shared constant - `` `pb-[${RESERVE}] lg:pb-0` `` - type-checks, passes
 * every assertion above, and still ships a stylesheet with no such rule in it,
 * which puts the composer back underneath the floating bar. This is the only
 * check that can see that mistake, because it is a property of the source text
 * rather than of the exported value.
 */
describe("class constants stay scannable by Tailwind", () => {
  const source = readFileSync(
    new URL("./conversation-chrome.ts", import.meta.url),
    "utf8",
  );
  const exported = [...source.matchAll(/export const (\w*CLASS) =/g)].map(
    ([, name]) => name,
  );
  const declarations = [
    ...source.matchAll(/export const (\w*CLASS) =\s*([\s\S]*?);\n/g),
  ];

  it("declares every exported class as a plain string literal", () => {
    const interpolated = declarations
      .filter(([, , value]) => value.includes("`") || value.includes("${"))
      .map(([, name]) => name);
    expect(interpolated).toEqual([]);
  });

  it("inspects every exported class, so none can slip past the rule", () => {
    expect(declarations.map(([, name]) => name)).toEqual(exported);
    expect(exported.length).toBeGreaterThan(0);
  });
});
