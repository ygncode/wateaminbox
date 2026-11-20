import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { THEME_IDS, THEMES } from "../lib/theme/themes";

/*
 * Design-system guardrails (see apps/web/DESIGN.md).
 *
 * 1. Components express colour only through semantic tokens. Raw palette
 *    utilities (`bg-gray-100`, `text-emerald-700`), arbitrary hex values
 *    (`bg-[#0b7a55]`), legacy names (`dark-*`, `whatsapp-*`) and `dark:`
 *    colour overrides would bypass the theme and break every theme but one.
 * 2. Every theme defines every variable, so adding a theme is one CSS block.
 * 3. The pre-paint script in index.html knows exactly the registered themes.
 */

const webRoot = resolve(import.meta.dir, "../..");
const srcRoot = resolve(webRoot, "src");
const themesCss = readFileSync(resolve(srcRoot, "styles/themes.css"), "utf8");
const tokensCss = readFileSync(resolve(srcRoot, "styles/tokens.css"), "utf8");

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTILITY =
  "bg|text|border|border-[trblxyse]|ring|ring-offset|divide|outline|fill|stroke|from|via|to|placeholder|decoration|caret|accent|shadow";

const RULES: { name: string; re: RegExp }[] = [
  {
    name: "raw Tailwind palette colour",
    re: new RegExp(
      `(?<![\\w-])(?:${COLOR_UTILITY})-(?:${PALETTE})-\\d{2,3}\\b`,
    ),
  },
  {
    name: "arbitrary hex colour",
    re: new RegExp(`(?<![\\w-])(?:${COLOR_UTILITY})-\\[#[0-9a-fA-F]{3,8}\\]`),
  },
  {
    name: "legacy colour name",
    re: /(?<![\w-])(?:bg|text|border|ring|fill|stroke|divide|accent)-(?:dark-(?:primary|secondary|elevated|tertiary|border|text-\w+)|whatsapp-[a-z0-9-]+)/,
  },
  {
    name: "dark: colour override (themes own dark values)",
    re: new RegExp(
      `(?<![\\w-])dark:(?:[a-z-]+:)*(?:${COLOR_UTILITY})-(?!none\\b)(?:[a-z]+(?:-[a-z0-9]+)*|\\[)`,
    ),
  },
];

/** Files that legitimately carry third-party brand colours. */
const ALLOW = new Set([
  "components/auth/GoogleSignInButton.tsx", // Google's mandated logo colours
]);

function sourceFiles(): string[] {
  return readdirSync(srcRoot, { recursive: true })
    .filter(
      (f): f is string =>
        typeof f === "string" &&
        /\.(tsx?|css)$/.test(f) &&
        !f.includes(".test.") &&
        !f.startsWith("styles/"),
    )
    .filter((f) => !ALLOW.has(f));
}

test("components use semantic colour tokens only", () => {
  const violations: string[] = [];
  for (const file of sourceFiles()) {
    const lines = readFileSync(resolve(srcRoot, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments document history
      for (const rule of RULES) {
        const m = line.match(rule.re);
        if (m) violations.push(`${file}:${i + 1} ${rule.name}: ${m[0]}`);
      }
    });
  }
  expect(violations).toEqual([]);
});

function themeBlocks(): Map<string, Set<string>> {
  const blocks = new Map<string, Set<string>>();
  const re = /\[data-theme="([a-z0-9-]+)"\][^{]*\{([^}]*)\}/g;
  for (const m of themesCss.matchAll(re)) {
    const vars = new Set(
      [...m[2].matchAll(/--([a-z0-9-]+)\s*:/g)].map((v) => v[1]),
    );
    blocks.set(m[1], vars);
  }
  return blocks;
}

test("every registered theme has a CSS block and vice versa", () => {
  expect([...themeBlocks().keys()].sort()).toEqual([...THEME_IDS].sort());
});

test("every theme defines every variable", () => {
  const blocks = themeBlocks();
  const all = new Set<string>();
  for (const vars of blocks.values()) for (const v of vars) all.add(v);
  const missing: string[] = [];
  for (const [id, vars] of blocks)
    for (const v of all) if (!vars.has(v)) missing.push(`${id}: --${v}`);
  expect(missing).toEqual([]);
});

test("every semantic token points at a variable all themes define", () => {
  const defined = themeBlocks().get("light") ?? new Set<string>();
  const missing = [
    ...tokensCss.matchAll(/--color-[a-z0-9-]+:\s*var\(--([a-z0-9-]+)\)/g),
  ]
    .map((m) => m[1])
    .filter((v) => !defined.has(v));
  expect(missing).toEqual([]);
});

test("index.html pre-paint script matches the theme registry", () => {
  const html = readFileSync(resolve(webRoot, "index.html"), "utf8");
  const block = html.match(/var THEMES = \{([\s\S]*?)\};/);
  expect(block).not.toBeNull();
  const entries = [
    ...(block?.[1] ?? "").matchAll(
      /(\w+): \['(light|dark)', '(#[0-9a-f]{6})'\]/g,
    ),
  ].map((m) => [m[1], m[2], m[3]]);
  expect(entries).toEqual(
    THEME_IDS.map((id) => [id, THEMES[id].appearance, THEMES[id].metaColor]),
  );
});

test("meta colour equals each theme's canvas", () => {
  const blocks = new Map<string, string>();
  for (const m of themesCss.matchAll(
    /\[data-theme="([a-z0-9-]+)"\][^{]*\{([^}]*)\}/g,
  )) {
    const canvas = m[2].match(/--canvas:\s*(#[0-9a-f]{6})/);
    if (canvas) blocks.set(m[1], canvas[1]);
  }
  for (const id of THEME_IDS) expect(blocks.get(id)).toBe(THEMES[id].metaColor);
});
