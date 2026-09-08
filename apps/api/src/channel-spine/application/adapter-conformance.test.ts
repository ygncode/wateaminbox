import { describe, expect, test } from "bun:test";
import { TelegramBotAdapter } from "../providers/telegram-bot/adapter";
import { WhatsAppLinkedDeviceAdapter } from "../providers/whatsapp-linked-device/adapter";
import {
  ChannelAdapterRegistry,
  resolveAdapterCapabilities,
} from "./adapter-registry";

const context = {
  companyId: "11111111-1111-4111-8111-111111111111",
  channelAccountId: "22222222-2222-4222-8222-222222222222",
  now: "2026-09-08T12:00:00.000Z",
};

describe("channel adapter conformance", () => {
  test("Telegram and linked-device adapters fail closed without transports", async () => {
    const telegram = new TelegramBotAdapter({
      resolveWebhookSecret: async () => null,
    });
    const linkedDevice = new WhatsAppLinkedDeviceAdapter();
    const registry = new ChannelAdapterRegistry();
    registry.register(telegram);
    registry.register(linkedDevice);

    for (const adapter of [telegram, linkedDevice]) {
      expect(adapter.channel.length).toBeGreaterThan(0);
      expect(adapter.provider.length).toBeGreaterThan(0);
      const capabilities = await adapter.resolveCapabilities(context);
      expect(typeof capabilities.outboundInitiation).toBe("boolean");
      expect(typeof capabilities.typing).toBe("boolean");
      expect(Array.isArray(capabilities.messageTypes)).toBe(true);
      const send = await adapter.send({
        id: "intent-1",
        companyId: context.companyId,
        channelAccountId: context.channelAccountId,
        conversationId: "33333333-3333-4333-8333-333333333333",
        operation: "send",
        idempotencyKey: "key",
        requestFingerprint: "a".repeat(64),
        normalizedPayload: { messageType: "text", textContent: "hi" },
        attemptKey: "intent-1:1",
      });
      expect(["unsupported", "permanent_failure", "uncertain"]).toContain(
        send.outcome,
      );
    }

    const unavailable = await resolveAdapterCapabilities(
      registry,
      "telegram",
      "meta_cloud",
      context,
    );
    expect(unavailable.outboundInitiation).toBe(false);
  });
});
