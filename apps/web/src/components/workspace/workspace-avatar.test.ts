import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

/**
 * WorkspaceAvatar renders its logo as an h-full/w-full image, so the element
 * must always have dimensions. A caller that omitted them rendered a full-size
 * logo that tore the consent screen apart, so the component now carries a
 * default that tailwind-merge lets any caller override.
 */
const source = readFileSync(
  new URL("./WorkspaceAvatar.tsx", import.meta.url),
  "utf8",
);

describe("WorkspaceAvatar sizing", () => {
  // The cn(...) call, from its opening to the caller's className argument.
  const cnCall = source.slice(
    source.indexOf("className={cn("),
    source.indexOf("className,", source.indexOf("className={cn(")),
  );

  test("carries its own height and width", () => {
    expect(cnCall).not.toBe("");
    expect(cnCall).toMatch(/\bh-\d/);
    expect(cnCall).toMatch(/\bw-\d/);
  });

  test("still applies the caller's className last so it can override", () => {
    // tailwind-merge resolves conflicts in favour of the later class, so the
    // caller's className must be the final argument.
    expect(cnCall).toMatch(/h-\d[\s\S]*$/);
    const afterDefaults = source.slice(source.indexOf("className={cn("));
    expect(afterDefaults.indexOf("h-9")).toBeLessThan(
      afterDefaults.indexOf("className,", 1),
    );
  });
});
