import { describe, expect, test } from "bun:test";
import { shouldDismissBottomSheet } from "./bottom-sheet-gesture";

describe("bottom sheet dismissal gesture", () => {
  test("dismisses after a deliberate downward drag", () => {
    expect(
      shouldDismissBottomSheet({
        offsetY: 150,
        velocityY: 0.2,
        panelHeight: 600,
      }),
    ).toBe(true);
  });

  test("dismisses a short, fast downward flick", () => {
    expect(
      shouldDismissBottomSheet({
        offsetY: 32,
        velocityY: 0.8,
        panelHeight: 600,
      }),
    ).toBe(true);
  });

  test("keeps the sheet open after a short, slow pull", () => {
    expect(
      shouldDismissBottomSheet({
        offsetY: 40,
        velocityY: 0.2,
        panelHeight: 600,
      }),
    ).toBe(false);
  });

  test("does not dismiss when the gesture moves upward", () => {
    expect(
      shouldDismissBottomSheet({
        offsetY: 0,
        velocityY: -1,
        panelHeight: 600,
      }),
    ).toBe(false);
  });
});
