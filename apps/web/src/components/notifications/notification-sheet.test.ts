import { describe, expect, test } from "bun:test";
import {
  NOTIFICATION_SCRIM_CLASS,
  NOTIFICATION_SHEET_CLASS,
  NOTIFICATION_SHEET_EMBEDDED_CLASS,
  SHEET_FOCUSABLE_SELECTOR,
} from "./notification-sheet";

const zIndexOf = (classes: string) => Number(classes.match(/z-(\d+)/)?.[1]);

describe("notification sheet presentation", () => {
  test("takes over the whole viewport on mobile", () => {
    expect(NOTIFICATION_SHEET_CLASS).toContain("fixed");
    expect(NOTIFICATION_SHEET_CLASS).toContain("inset-0");
    expect(NOTIFICATION_SHEET_CLASS).toContain("h-dvh");
    expect(NOTIFICATION_SHEET_CLASS).toContain("w-full");
  });

  test("anchors flush to the right edge from md upwards", () => {
    expect(NOTIFICATION_SHEET_CLASS).toContain("md:right-0");
    expect(NOTIFICATION_SHEET_CLASS).toContain("md:inset-y-0");
    // inset-0 pins the left edge on mobile; md must release it
    expect(NOTIFICATION_SHEET_CLASS).toContain("md:left-auto");
    expect(NOTIFICATION_SHEET_CLASS).toContain("md:h-dvh");
  });

  test("keeps no gap or rounding that would make it read as a floating card", () => {
    expect(NOTIFICATION_SHEET_CLASS).not.toMatch(/(^|\s)rounded/);
    expect(NOTIFICATION_SHEET_CLASS).not.toMatch(/(^|:)top-\d/);
    expect(NOTIFICATION_SHEET_CLASS).not.toMatch(/(^|:)right-[1-9]/);
  });

  test("stays a bounded, separated column on md+", () => {
    expect(NOTIFICATION_SHEET_CLASS).toMatch(/md:w-\[[^\]]+\]/);
    expect(NOTIFICATION_SHEET_CLASS).toMatch(/md:max-w-\[[^\]]+\]/);
    expect(NOTIFICATION_SHEET_CLASS).toContain("md:border-l");
  });

  test("scrim covers the viewport and sits behind the sheet", () => {
    expect(NOTIFICATION_SCRIM_CLASS).toContain("fixed inset-0");
    expect(zIndexOf(NOTIFICATION_SCRIM_CLASS)).toBeLessThan(
      zIndexOf(NOTIFICATION_SHEET_CLASS),
    );
  });

  test("embedded presentation fills its container, not the viewport", () => {
    expect(NOTIFICATION_SHEET_EMBEDDED_CLASS).toContain("absolute inset-0");
    expect(NOTIFICATION_SHEET_EMBEDDED_CLASS).not.toContain("fixed");
    expect(NOTIFICATION_SHEET_EMBEDDED_CLASS).toContain("h-full");
  });

  test("focus selector covers the controls the sheet renders", () => {
    expect(SHEET_FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
    expect(SHEET_FOCUSABLE_SELECTOR).toContain("a[href]");
    // notification rows are role="button" with tabIndex=0
    expect(SHEET_FOCUSABLE_SELECTOR).toContain(
      '[tabindex]:not([tabindex="-1"])',
    );
  });
});
