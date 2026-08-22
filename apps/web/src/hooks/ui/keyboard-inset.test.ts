import { describe, expect, it } from "bun:test";
import {
  KEYBOARD_MIN_OVERLAP_PX,
  resolveKeyboardInset,
  type ViewportMetrics,
} from "./keyboard-inset";

const metrics = (
  overrides: Partial<ViewportMetrics> = {},
): ViewportMetrics => ({
  layoutViewportHeight: 844,
  visualViewportHeight: 844,
  visualViewportOffsetTop: 0,
  visualViewportScale: 1,
  ...overrides,
});

describe("resolveKeyboardInset", () => {
  it("is zero with no keyboard on screen", () => {
    expect(resolveKeyboardInset(metrics())).toBe(0);
  });

  it("is zero on a browser that resizes the layout viewport itself", () => {
    // Android Chrome with interactive-widget=resizes-content: both viewports
    // shrink together, so there is nothing left for the composer to pay.
    expect(
      resolveKeyboardInset(
        metrics({ layoutViewportHeight: 508, visualViewportHeight: 508 }),
      ),
    ).toBe(0);
  });

  it("reports the covered strip when only the visual viewport shrinks", () => {
    // iOS Safari: the layout viewport keeps its height and the keyboard sits
    // on top of it.
    expect(resolveKeyboardInset(metrics({ visualViewportHeight: 508 }))).toBe(
      336,
    );
  });

  it("accounts for the page having scrolled under the visual viewport", () => {
    expect(
      resolveKeyboardInset(
        metrics({ visualViewportHeight: 508, visualViewportOffsetTop: 100 }),
      ),
    ).toBe(236);
  });

  it("ignores overlaps too small to be a keyboard", () => {
    const belowThreshold = 844 - (KEYBOARD_MIN_OVERLAP_PX - 1);
    expect(
      resolveKeyboardInset(metrics({ visualViewportHeight: belowThreshold })),
    ).toBe(0);

    const atThreshold = 844 - KEYBOARD_MIN_OVERLAP_PX;
    expect(
      resolveKeyboardInset(metrics({ visualViewportHeight: atThreshold })),
    ).toBe(KEYBOARD_MIN_OVERLAP_PX);
  });

  it("ignores a shrunken visual viewport caused by pinch zoom", () => {
    expect(
      resolveKeyboardInset(
        metrics({ visualViewportHeight: 400, visualViewportScale: 2.4 }),
      ),
    ).toBe(0);
  });

  it("never pads away more than most of the screen", () => {
    expect(resolveKeyboardInset(metrics({ visualViewportHeight: 10 }))).toBe(
      Math.round(844 * 0.7),
    );
  });

  it("stays at zero for nonsense measurements instead of guessing", () => {
    expect(resolveKeyboardInset(metrics({ layoutViewportHeight: 0 }))).toBe(0);
    expect(
      resolveKeyboardInset(metrics({ visualViewportHeight: Number.NaN })),
    ).toBe(0);
    expect(
      resolveKeyboardInset(metrics({ visualViewportScale: Number.NaN })),
    ).toBe(0);
  });

  it("never returns a negative inset when the visual viewport is taller", () => {
    expect(resolveKeyboardInset(metrics({ visualViewportHeight: 900 }))).toBe(
      0,
    );
  });
});
