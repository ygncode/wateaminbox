import { describe, expect, test } from "bun:test";
import { isDoubleTouchTap } from "./mobile-message-gestures";

describe("mobile message gestures", () => {
  test("recognizes two nearby taps inside the reaction window", () => {
    expect(
      isDoubleTouchTap(
        { at: 1_000, x: 40, y: 80 },
        { at: 1_280, x: 49, y: 91 },
      ),
    ).toBe(true);
  });

  test("does not turn a slow second tap or swipe into a reaction", () => {
    expect(
      isDoubleTouchTap(
        { at: 1_000, x: 40, y: 80 },
        { at: 1_351, x: 40, y: 80 },
      ),
    ).toBe(false);
    expect(
      isDoubleTouchTap(
        { at: 1_000, x: 40, y: 80 },
        { at: 1_200, x: 90, y: 80 },
      ),
    ).toBe(false);
  });
});
