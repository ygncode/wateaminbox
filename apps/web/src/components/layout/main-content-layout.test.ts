import { describe, expect, it } from "bun:test";
import { MAIN_CONTENT_ROOT_CLASS } from "./main-content-layout";

/**
 * Guards the mobile/tablet conversation column against the flexbox default
 * that hid the composer in production: `MainContent` is a `flex-1` item of a
 * column flex container there, so without `min-h-0` its `min-height: auto`
 * resolves to the content-based minimum - the message list's whole scroll
 * height - and the composer is laid out below the shell's clipping box.
 */
describe("MAIN_CONTENT_ROOT_CLASS", () => {
  const classes = MAIN_CONTENT_ROOT_CLASS.split(/\s+/);

  it("pairs flex-1 with min-h-0 so the column cannot grow past its parent", () => {
    expect(classes).toContain("flex-1");
    expect(classes).toContain("min-h-0");
  });

  it("keeps min-w-0 so long unbroken message text cannot widen the column", () => {
    expect(classes).toContain("min-w-0");
  });

  it("stays a flex column, which is what the message list sizes against", () => {
    expect(classes).toContain("flex");
    expect(classes).toContain("flex-col");
  });

  it("never constrains its own height, which would strand the composer again", () => {
    expect(classes.filter((name) => /^(h|max-h)-/.test(name))).toBeEmpty();
  });
});
