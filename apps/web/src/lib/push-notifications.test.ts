import { describe, expect, test } from "bun:test";
import { parsePushPayload } from "./push-notifications";

describe("push payload parsing", () => {
  test("accepts versioned internal payloads", () => {
    expect(
      parsePushPayload({
        version: 1,
        type: "message",
        title: "Ada",
        body: "Hello",
        tag: "message-1",
        actionUrl: "/chat/1",
      })?.actionUrl,
    ).toBe("/chat/1");
  });
  test("rejects unknown versions and protocol-relative clicks", () => {
    expect(
      parsePushPayload({
        version: 2,
        type: "message",
        title: "Ada",
        body: "Hello",
        tag: "message-1",
        actionUrl: "/chat/1",
      }),
    ).toBeNull();
    expect(
      parsePushPayload({
        version: 1,
        type: "message",
        title: "Ada",
        body: "Hello",
        tag: "message-1",
        actionUrl: "//example.com",
      }),
    ).toBeNull();
  });
});
