import { describe, expect, test } from "bun:test";
import type { NormalizedChannelEvent } from "@wateaminbox/shared";
import { channelEventPayloadDigest } from "./event-processor";

function event(
  receivedAt: string,
  textContent = "hello",
): NormalizedChannelEvent {
  return {
    contractVersion: 1,
    eventId: "telegram:42:message.upsert",
    companyId: "11111111-1111-4111-8111-111111111111",
    channelAccountId: "22222222-2222-4222-8222-222222222222",
    channel: "telegram",
    provider: "telegram_bot",
    kind: "message.upsert",
    providerOccurredAt: "2026-09-08T12:00:00.000Z",
    receivedAt,
    payload: {
      conversation: {
        externalThreadId: "10",
        clientThreadKey: "telegram:10",
        kind: "direct",
      },
      externalMessageId: "20",
      externalIdentityScope: "telegram-thread:10",
      direction: "inbound",
      normalizedType: "text",
      textContent,
    },
  };
}

describe("channel event payload digest", () => {
  test("is stable across provider redelivery receive times", () => {
    expect(channelEventPayloadDigest(event("2026-09-08T12:00:01.000Z"))).toBe(
      channelEventPayloadDigest(event("2026-09-08T12:05:00.000Z")),
    );
  });

  test("still detects identity reuse with changed provider data", () => {
    expect(
      channelEventPayloadDigest(event("2026-09-08T12:00:01.000Z")),
    ).not.toBe(
      channelEventPayloadDigest(event("2026-09-08T12:00:01.000Z", "changed")),
    );
  });
});
