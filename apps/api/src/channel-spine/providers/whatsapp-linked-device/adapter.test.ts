import { describe, expect, test } from "bun:test";
import { WhatsAppLinkedDeviceAdapter } from "./adapter";

describe("WhatsApp linked-device adapter", () => {
  test("publishes explicit composer and action capabilities", async () => {
    const capabilities =
      await new WhatsAppLinkedDeviceAdapter().resolveCapabilities({
        companyId: "11111111-1111-4111-8111-111111111111",
        channelAccountId: "22222222-2222-4222-8222-222222222222",
        now: "2026-09-08T12:00:00.000Z",
      });
    expect(capabilities.typing).toBe(true);
    expect(capabilities.templates).toBe(false);
    expect(capabilities.actions.deleteForEveryone).toBe(true);
    expect(
      capabilities.messageTypes.find(({ type }) => type === "image"),
    ).toMatchObject({
      enabled: true,
      attachment: { maxCount: 30 },
    });
  });

  test("fails closed when the outbound transport is not composed", async () => {
    const result = await new WhatsAppLinkedDeviceAdapter().send({
      id: "intent-1",
      companyId: "11111111-1111-4111-8111-111111111111",
      channelAccountId: "22222222-2222-4222-8222-222222222222",
      conversationId: "33333333-3333-4333-8333-333333333333",
      operation: "send",
      idempotencyKey: "idem-1",
      requestFingerprint: "fingerprint",
      normalizedPayload: { type: "text", text: "hi" },
      attemptKey: "attempt-1",
    });
    expect(result).toEqual({
      outcome: "permanent_failure",
      errorCode: "adapter_not_wired",
    });
  });
});
