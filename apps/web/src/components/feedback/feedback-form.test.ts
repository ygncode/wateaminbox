import { describe, expect, test } from "bun:test";
import {
  FEEDBACK_DISMISSED_KEY,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_MIN_LENGTH,
  isFeedbackSubmittable,
  readFeedbackDismissed,
  toFeedbackPayload,
  validateFeedbackDraft,
  writeFeedbackDismissed,
} from "./feedback-form";

const draft = (message: string, email = "") => ({ message, email });

describe("validateFeedbackDraft", () => {
  test("rejects a message shorter than the server minimum", () => {
    expect(validateFeedbackDraft(draft("too short"))).toBe("minLength");
    expect(validateFeedbackDraft(draft(""))).toBe("minLength");
  });

  test("counts the trimmed message, so whitespace cannot pad it", () => {
    const padded = `${" ".repeat(20)}hi${" ".repeat(20)}`;
    expect(validateFeedbackDraft(draft(padded))).toBe("minLength");
    expect(validateFeedbackDraft(draft("a".repeat(FEEDBACK_MIN_LENGTH)))).toBe(
      null,
    );
  });

  test("rejects a message past the server maximum", () => {
    expect(validateFeedbackDraft(draft("a".repeat(FEEDBACK_MAX_LENGTH)))).toBe(
      null,
    );
    expect(
      validateFeedbackDraft(draft("a".repeat(FEEDBACK_MAX_LENGTH + 1))),
    ).toBe("maxLength");
  });

  test("accepts an omitted email but rejects a malformed one", () => {
    const message = "This is long enough to submit.";
    expect(validateFeedbackDraft(draft(message, ""))).toBe(null);
    expect(validateFeedbackDraft(draft(message, "   "))).toBe(null);
    expect(validateFeedbackDraft(draft(message, "you@example.com"))).toBe(null);
    expect(validateFeedbackDraft(draft(message, "you@example"))).toBe(
      "invalidEmail",
    );
    expect(validateFeedbackDraft(draft(message, "you example.com"))).toBe(
      "invalidEmail",
    );
    expect(
      validateFeedbackDraft(draft(message, `${"a".repeat(250)}@example.com`)),
    ).toBe("invalidEmail");
  });

  test("reports the message problem first when both fields are wrong", () => {
    expect(validateFeedbackDraft(draft("short", "nope"))).toBe("minLength");
  });
});

describe("isFeedbackSubmittable", () => {
  test("tracks only the message bounds, since the email is optional", () => {
    expect(isFeedbackSubmittable(draft("short", "you@example.com"))).toBe(
      false,
    );
    expect(isFeedbackSubmittable(draft("a".repeat(FEEDBACK_MIN_LENGTH)))).toBe(
      true,
    );
    expect(isFeedbackSubmittable(draft("long enough message", "nope"))).toBe(
      true,
    );
  });
});

describe("toFeedbackPayload", () => {
  test("trims both fields", () => {
    expect(
      toFeedbackPayload(draft("  a real message  ", "  you@example.com  ")),
    ).toEqual({ message: "a real message", email: "you@example.com" });
  });

  test("omits the email key entirely when it is blank", () => {
    const payload = toFeedbackPayload(draft("a real message", "   "));
    expect(payload).toEqual({ message: "a real message" });
    expect("email" in payload).toBe(false);
  });
});

describe("feedback tab dismissal", () => {
  const store = () => {
    const values = new Map<string, string>();
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  };

  test("round-trips the dismissal flag", () => {
    const storage = store();
    expect(readFeedbackDismissed(storage)).toBe(false);
    writeFeedbackDismissed(storage);
    expect(storage.values.get(FEEDBACK_DISMISSED_KEY)).toBe("1");
    expect(readFeedbackDismissed(storage)).toBe(true);
  });

  test("treats any other stored value as not dismissed", () => {
    const storage = store();
    storage.setItem(FEEDBACK_DISMISSED_KEY, "0");
    expect(readFeedbackDismissed(storage)).toBe(false);
  });

  test("stays usable when storage is unavailable or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readFeedbackDismissed(null)).toBe(false);
    expect(readFeedbackDismissed(throwing)).toBe(false);
    expect(() => writeFeedbackDismissed(null)).not.toThrow();
    expect(() => writeFeedbackDismissed(throwing)).not.toThrow();
  });
});
