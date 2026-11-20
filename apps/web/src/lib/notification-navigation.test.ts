import { describe, expect, test } from "bun:test";
import {
  chatNotificationPath,
  getSafeNotificationPath,
  navigateToNotificationTarget,
} from "./notification-navigation";

describe("safe notification navigation", () => {
  test("accepts one leading slash and rejects external targets", () => {
    expect(getSafeNotificationPath("/chat/123")).toBe("/chat/123");
    expect(getSafeNotificationPath("//example.com")).toBeNull();
    expect(getSafeNotificationPath("https://example.com")).toBeNull();
  });
  test("canonicalizes legacy workspace targets", () => {
    let path = "";
    expect(
      navigateToNotificationTarget(
        "/chat/contact-1",
        (value) => {
          path = value;
        },
        "workspace-1",
      ),
    ).toBe(true);
    expect(path).toBe("/w/workspace-1/chat/contact-1");
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

describe("chat alert targets", () => {
  test("opens the chat inside the workspace", () => {
    expect(chatNotificationPath("ws-1", "contact-1")).toBe(
      "/w/ws-1/chat/contact-1",
    );
  });

  test("keeps a merged customer's thread in ?thread=", () => {
    expect(chatNotificationPath("ws-1", "contact-1", "conv-9")).toBe(
      "/w/ws-1/chat/contact-1?thread=conv-9",
    );
    // The row's own thread is the canonical plain URL.
    expect(chatNotificationPath("ws-1", "contact-1", "contact-1")).toBe(
      "/w/ws-1/chat/contact-1",
    );
  });

  test("falls back to the legacy path before a workspace is known", () => {
    expect(chatNotificationPath(null, "conv-9")).toBe("/chat/conv-9");
  });
});
