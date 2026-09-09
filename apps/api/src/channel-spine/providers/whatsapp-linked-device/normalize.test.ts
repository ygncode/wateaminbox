import { describe, expect, test } from "bun:test";
import type { MessageEvent } from "../../../lib/nats/index.js";
import { normalizeLinkedDeviceMessageEvent } from "./normalize";

function messageEvent(): MessageEvent {
  return {
    contractVersion: 1,
    eventId: "worker-event-1",
    type: "message",
    companyId: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222",
    timestamp: "2026-09-08T12:00:01.000Z",
    payload: {
      messageId: "provider-message-1",
      from: "6599999999:2@s.whatsapp.net",
      to: "6588888888@s.whatsapp.net",
      fromMe: false,
      content: "hello",
      messageType: "image",
      timestamp: "2026-09-08T12:00:00.000Z",
      mediaType: "image/jpeg",
      mediaSize: 42,
      mediaDirectPath: "/encrypted/provider/path",
      mediaKey: "secret-key-material",
    },
  };
}

describe("linked-device event normalization", () => {
  test("normalizes identity while excluding deferred-fetch secrets", () => {
    const event = normalizeLinkedDeviceMessageEvent(messageEvent());
    expect(event).toMatchObject({
      eventId: "worker-event-1",
      companyId: "11111111-1111-4111-8111-111111111111",
      channelAccountId: "22222222-2222-4222-8222-222222222222",
      channel: "whatsapp",
      provider: "whatsapp_linked_device",
      kind: "message.upsert",
      payload: {
        externalMessageId: "provider-message-1",
        externalIdentityScope: "linked-device-thread:6599999999@s.whatsapp.net",
        direction: "inbound",
        normalizedType: "image",
      },
    });
    expect(event.payload.sender?.externalId).toBe("6599999999@s.whatsapp.net");
    expect(event.payload.attachments?.[0]).toMatchObject({
      contentType: "image/jpeg",
      byteSize: 42,
      status: "pending",
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("secret-key-material");
    expect(serialized).not.toContain("/encrypted/provider/path");
  });

  test("uses a deterministic fallback event identity", () => {
    const input = messageEvent();
    delete input.eventId;
    expect(normalizeLinkedDeviceMessageEvent(input).eventId).toBe(
      normalizeLinkedDeviceMessageEvent(input).eventId,
    );
  });
});
