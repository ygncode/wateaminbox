import { describe, expect, test } from "bun:test";
import {
  assertNormalizedChannelEvent,
  isChannel,
  isChannelProvider,
  isDurableChannelEvent,
  type NormalizedChannelEvent,
} from "./contracts";

function event(
  overrides: Partial<NormalizedChannelEvent> = {},
): NormalizedChannelEvent {
  return {
    contractVersion: 1,
    eventId: "telegram:update:42",
    companyId: "11111111-1111-4111-8111-111111111111",
    channelAccountId: "22222222-2222-4222-8222-222222222222",
    channel: "telegram",
    provider: "telegram_bot",
    kind: "message.upsert",
    receivedAt: "2026-09-08T12:00:00.000Z",
    payload: {
      conversation: {
        externalThreadId: "chat:123",
        clientThreadKey: "telegram:chat:123",
        kind: "direct",
      },
      externalMessageId: "42",
      externalIdentityScope: "chat:123",
      direction: "inbound",
      normalizedType: "text",
      textContent: "hello",
    },
    ...overrides,
  } as NormalizedChannelEvent;
}

describe("channel-neutral contracts", () => {
  test("recognizes stable channels and providers", () => {
    expect(isChannel("telegram")).toBe(true);
    expect(isChannel("sms")).toBe(false);
    expect(isChannelProvider("whatsapp_linked_device")).toBe(true);
    expect(isChannelProvider("unknown")).toBe(false);
  });

  test("keeps durable and transient event lanes explicit", () => {
    expect(isDurableChannelEvent(event())).toBe(true);
    expect(
      isDurableChannelEvent(
        event({
          kind: "typing.update",
          payload: {
            conversation: {
              clientThreadKey: "telegram:chat:123",
              kind: "direct",
            },
            isTyping: true,
          },
        } as Partial<NormalizedChannelEvent>),
      ),
    ).toBe(false);
  });

  test("validates trusted envelope identity and timestamps", () => {
    expect(() => assertNormalizedChannelEvent(event())).not.toThrow();
    expect(() =>
      assertNormalizedChannelEvent(event({ companyId: " " })),
    ).toThrow("company ID");
    expect(() =>
      assertNormalizedChannelEvent(event({ receivedAt: "not-a-date" })),
    ).toThrow("receivedAt");
  });
});
