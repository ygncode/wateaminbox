import { describe, expect, test } from "bun:test";
import {
  getRealtimeToastOptions,
  parseToastNotificationPayload,
} from "./toast-notifications";

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

test("connection toast action navigates to the workspace Connections page", () => {
  const payload = parseToastNotificationPayload({
    type: "error",
    title: "WhatsApp logged out",
    message: "Reconnect",
    actionUrl: "/w/workspace/settings/connections",
    actionLabel: "Open connections",
  })!;
  let destination = "";
  const options = getRealtimeToastOptions(payload, (path) => {
    destination = path;
  });
  expect(options.action?.label).toBe("Open connections");
  options.action?.onClick();
  expect(destination).toBe("/w/workspace/settings/connections");
  expect(getRealtimeToastOptions(payload).action).toBeUndefined();
});
test("unsafe toast actions are discarded while the message remains visible", () => {
  for (const actionUrl of [
    "https://example.test",
    "//example.test",
    "/\\example.test",
    "/bad\npath",
  ]) {
    const payload = parseToastNotificationPayload({
      type: "error",
      title: "Offline",
      message: "Reconnect",
      actionUrl,
      actionLabel: "Open",
    })!;
    expect(payload.title).toBe("Offline");
    expect(payload.actionUrl).toBeUndefined();
    expect(getRealtimeToastOptions(payload, () => {}).action).toBeUndefined();
  }
});
