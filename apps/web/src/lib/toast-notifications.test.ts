import { describe, expect, test } from "bun:test";
import { parseToastNotificationPayload } from "./toast-notifications";

describe("realtime toast payload validation", () => {
  test("accepts typed payloads and rejects raw worker payloads", () => {
    expect(
      parseToastNotificationPayload({
        type: "error",
        title: "Failed",
        message: "Try again",
        connectionId: "one",
      })?.type,
    ).toBe("error");
    expect(parseToastNotificationPayload({ error: "raw error" })).toBeNull();
  });
});
