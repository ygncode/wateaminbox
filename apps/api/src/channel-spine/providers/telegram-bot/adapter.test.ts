import { describe, expect, mock, test } from "bun:test";
import type { ProviderIngress } from "@wateaminbox/shared";
import {
  TelegramBotAdapter,
  TelegramIngressVerificationError,
} from "./adapter";

const encoder = new TextEncoder();

function ingress(body: unknown, secret = "correct-secret"): ProviderIngress {
  return {
    rawBody: encoder.encode(JSON.stringify(body)),
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    receivedAt: "2026-09-08T12:00:01.000Z",
    trustedContext: {
      companyId: "11111111-1111-4111-8111-111111111111",
      channelAccountId: "22222222-2222-4222-8222-222222222222",
    },
  };
}

const privateMessage = {
  update_id: 100,
  message: {
    message_id: 50,
    date: 1_788_868_800,
    chat: { id: 42, type: "private", first_name: "Ada" },
    from: { id: 42, is_bot: false, first_name: "Ada", username: "ada" },
    text: "hello",
  },
};

describe("Telegram Bot adapter", () => {
  test("resolves a tenant secret asynchronously before normalization", async () => {
    const resolver = mock(async () => "correct-secret");
    const adapter = new TelegramBotAdapter({ resolveWebhookSecret: resolver });

    const events = await adapter.verifyAndNormalizeIngress(
      ingress(privateMessage),
    );

    expect(resolver).toHaveBeenCalledWith({
      companyId: "11111111-1111-4111-8111-111111111111",
      channelAccountId: "22222222-2222-4222-8222-222222222222",
    });
    expect(events.map(({ kind }) => kind)).toEqual([
      "endpoint.upsert",
      "conversation.upsert",
      "message.upsert",
    ]);
    expect(events[2]).toMatchObject({
      eventId: "telegram:100:message.upsert",
      channel: "telegram",
      provider: "telegram_bot",
      kind: "message.upsert",
      payload: {
        conversation: { externalThreadId: "42", kind: "direct" },
        externalMessageId: "50",
        direction: "inbound",
        normalizedType: "text",
        textContent: "hello",
      },
    });
  });

  test("fails closed for missing, unknown, and mismatched secrets", async () => {
    const missingExpected = new TelegramBotAdapter({
      resolveWebhookSecret: async () => null,
    });
    await expect(
      missingExpected.verifyAndNormalizeIngress(ingress(privateMessage)),
    ).rejects.toBeInstanceOf(TelegramIngressVerificationError);

    const adapter = new TelegramBotAdapter({
      resolveWebhookSecret: async () => "correct-secret",
    });
    await expect(
      adapter.verifyAndNormalizeIngress(ingress(privateMessage, "wrong")),
    ).rejects.toBeInstanceOf(TelegramIngressVerificationError);
    const withoutHeader = ingress(privateMessage);
    withoutHeader.headers = {};
    await expect(
      adapter.verifyAndNormalizeIngress(withoutHeader),
    ).rejects.toBeInstanceOf(TelegramIngressVerificationError);

    const unavailableResolver = new TelegramBotAdapter({
      resolveWebhookSecret: async () => {
        throw new Error("secret-store detail");
      },
    });
    await expect(
      unavailableResolver.verifyAndNormalizeIngress(ingress(privateMessage)),
    ).rejects.toBeInstanceOf(TelegramIngressVerificationError);

    const duplicateHeader = ingress(privateMessage);
    duplicateHeader.headers = {
      "x-telegram-bot-api-secret-token": "correct-secret",
      "X-Telegram-Bot-Api-Secret-Token": "correct-secret",
    };
    await expect(
      adapter.verifyAndNormalizeIngress(duplicateHeader),
    ).rejects.toBeInstanceOf(TelegramIngressVerificationError);
  });

  test("does not parse malformed JSON until authentication succeeds", async () => {
    const adapter = new TelegramBotAdapter({
      resolveWebhookSecret: async () => "correct-secret",
    });
    const input = ingress(privateMessage, "wrong");
    input.rawBody = encoder.encode("not-json");
    await expect(
      adapter.verifyAndNormalizeIngress(input),
    ).rejects.toBeInstanceOf(TelegramIngressVerificationError);

    input.headers = { "x-telegram-bot-api-secret-token": "correct-secret" };
    await expect(adapter.verifyAndNormalizeIngress(input)).rejects.toThrow(
      "Invalid Telegram webhook JSON",
    );
  });

  test("publishes conservative static capabilities", async () => {
    const adapter = new TelegramBotAdapter({
      resolveWebhookSecret: async () => "unused",
    });
    const capabilities = await adapter.resolveCapabilities({
      companyId: "company",
      channelAccountId: "account",
      now: "2026-09-08T12:00:00.000Z",
    });

    expect(capabilities).toMatchObject({
      readReceipts: false,
      reactions: true,
      messageEditing: true,
      templates: false,
      multipleRecipients: false,
      outboundInitiation: false,
      scheduledMessages: false,
      version: "telegram-bot:v1",
    });
  });

  test("delegates outbound work and otherwise fails closed", async () => {
    const send = mock(async () => ({
      outcome: "confirmed" as const,
      externalMessageId: "900",
    }));
    const perform = mock(async () => ({ outcome: "confirmed" as const }));
    const adapter = new TelegramBotAdapter({
      resolveWebhookSecret: async () => "unused",
      outboundTransport: { send, perform },
    });
    const sendIntent = {
      id: "intent-1",
      companyId: "company",
      channelAccountId: "account",
      conversationId: "conversation",
      operation: "send",
      idempotencyKey: "idem",
      requestFingerprint: "fingerprint",
      normalizedPayload: { type: "text", text: "hi" },
      attemptKey: "attempt",
    };
    expect(await adapter.send(sendIntent)).toEqual({
      outcome: "confirmed",
      externalMessageId: "900",
    });
    expect(send).toHaveBeenCalledWith(sendIntent);

    const unwired = new TelegramBotAdapter({
      resolveWebhookSecret: async () => "unused",
    });
    expect(await unwired.send(sendIntent)).toEqual({
      outcome: "permanent_failure",
      errorCode: "adapter_not_wired",
    });
    expect(
      await unwired.perform({
        companyId: "company",
        channelAccountId: "account",
        conversationId: "conversation",
        operation: "react",
        idempotencyKey: "idem",
        payload: {},
      }),
    ).toEqual({
      outcome: "permanent_failure",
      errorCode: "adapter_not_wired",
    });
  });
});
