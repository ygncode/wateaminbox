import { describe, expect, test } from "bun:test";
import {
  getSafeNotificationPath,
  navigateToNotificationTarget,
} from "./notification-navigation";

describe("safe notification navigation", () => {
  test("accepts one leading slash and rejects external targets", () => {
    expect(getSafeNotificationPath("/chat/123")).toBe("/chat/123");
    expect(getSafeNotificationPath("//example.com")).toBeNull();
    expect(getSafeNotificationPath("https://example.com")).toBeNull();
  });
  test("does not navigate an invalid target", () => {
    let path = "";
    expect(
      navigateToNotificationTarget("//example.com", (value) => {
        path = value;
      }),
    ).toBe(false);
    expect(path).toBe("");
  });
});
