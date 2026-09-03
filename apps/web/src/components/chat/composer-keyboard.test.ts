import { describe, expect, test } from "bun:test";
import { shouldSendMessageOnEnter } from "./composer-keyboard";

const enterKey = {
  key: "Enter",
  shiftKey: false,
  isComposing: false,
};

describe("message composer keyboard behavior", () => {
  test("inserts a newline for Enter on mobile", () => {
    expect(shouldSendMessageOnEnter({ ...enterKey, isMobile: true })).toBe(
      false,
    );
  });

  test("sends for unmodified Enter on desktop", () => {
    expect(shouldSendMessageOnEnter({ ...enterKey, isMobile: false })).toBe(
      true,
    );
  });

  test("inserts a newline for Shift+Enter on desktop", () => {
    expect(
      shouldSendMessageOnEnter({
        ...enterKey,
        isMobile: false,
        shiftKey: true,
      }),
    ).toBe(false);
  });

  test("does not send while an input method is composing text", () => {
    expect(
      shouldSendMessageOnEnter({
        ...enterKey,
        isMobile: false,
        isComposing: true,
      }),
    ).toBe(false);
  });
});
