import { describe, expect, test } from "bun:test";
import {
  assertNormalizedChannelEvent,
  type ChannelAdapter,
  type ChannelCapabilities,
  type OutboundMessageIntent,
  type ProviderIngress,
  type ProviderSendResult,
  type ResolvedCapabilities,
} from "@wateaminbox/shared";
import { TelegramBotAdapter } from "../providers/telegram-bot/adapter";
import { classifyTelegramSendFailure } from "../providers/telegram-bot/transport";
import { WhatsAppLinkedDeviceAdapter } from "../providers/whatsapp-linked-device/adapter";
import { storedContentType } from "../../services/channel-attachment-fetch.service";
import {
  ChannelAdapterRegistry,
  resolveAdapterCapabilities,
} from "./adapter-registry";
import { channelEventPayloadDigest } from "./event-processor";

const context = {
  companyId: "11111111-1111-4111-8111-111111111111",
  channelAccountId: "22222222-2222-4222-8222-222222222222",
  now: "2026-09-08T12:00:00.000Z",
};

const encoder = new TextEncoder();
const CAPABILITY_FLAGS: Array<keyof ChannelCapabilities> = [
  "typing",
  "readReceipts",
  "reactions",
  "messageEditing",
  "messageDeletion",
  "templates",
  "groups",
  "multipleRecipients",
  "outboundInitiation",
  "scheduledMessages",
];

function sendIntent(
  extras: Partial<OutboundMessageIntent> = {},
): OutboundMessageIntent {
  return {
    id: "intent-1",
    companyId: context.companyId,
    channelAccountId: context.channelAccountId,
    conversationId: "33333333-3333-4333-8333-333333333333",
    operation: "send",
    idempotencyKey: "key",
    requestFingerprint: "a".repeat(64),
    normalizedPayload: { messageType: "text", textContent: "hi" },
    attemptKey: "intent-1:1",
    ...extras,
  };
}

function telegramIngress(
  body: unknown,
  secret = "correct-secret",
  receivedAt = "2026-09-08T12:00:01.000Z",
): ProviderIngress {
  return {
    rawBody: encoder.encode(JSON.stringify(body)),
    headers: { "x-telegram-bot-api-secret-token": secret },
    receivedAt,
    trustedContext: {
      companyId: context.companyId,
      channelAccountId: context.channelAccountId,
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

function expectCapabilityContract(capabilities: ResolvedCapabilities) {
  expect(capabilities.version.trim().length).toBeGreaterThan(0);
  expect(Array.isArray(capabilities.messageTypes)).toBe(true);
  expect(typeof capabilities.attachment.enabled).toBe("boolean");
  for (const flag of CAPABILITY_FLAGS) {
    expect(typeof capabilities[flag]).toBe("boolean");
    if (!capabilities[flag]) {
      expect(capabilities.unavailableReasons[flag]?.code).toBeTruthy();
    }
  }
}

describe("channel adapter conformance", () => {
  const telegram = new TelegramBotAdapter({
    resolveWebhookSecret: async () => "correct-secret",
  });
  const linkedDevice = new WhatsAppLinkedDeviceAdapter();
  const adapters: ChannelAdapter[] = [telegram, linkedDevice];

  test("every adapter publishes identity and fail-closed capabilities", async () => {
    const registry = new ChannelAdapterRegistry();
    for (const adapter of adapters) {
      expect(adapter.channel.length).toBeGreaterThan(0);
      expect(adapter.provider.length).toBeGreaterThan(0);
      registry.register(adapter);
      expectCapabilityContract(await adapter.resolveCapabilities(context));
    }

    const unavailable = await resolveAdapterCapabilities(
      registry,
      "telegram",
      "meta_cloud",
      context,
    );
    expect(unavailable.outboundInitiation).toBe(false);
    expect(unavailable.version).toContain("unavailable:");
  });

  test("unwired outbound send and actions never throw unimplemented", async () => {
    for (const adapter of adapters) {
      const send = await adapter.send(sendIntent());
      expect(["unsupported", "permanent_failure", "uncertain"]).toContain(
        send.outcome,
      );
      if (send.outcome !== "accepted" && send.outcome !== "confirmed") {
        expect(send.errorCode.length).toBeGreaterThan(0);
      }
      const action = await adapter.perform({
        companyId: context.companyId,
        channelAccountId: context.channelAccountId,
        conversationId: sendIntent().conversationId,
        operation: "mark_read",
        idempotencyKey: "action-1",
        payload: {},
      });
      expect([
        "unsupported",
        "permanent_failure",
        "uncertain",
        "confirmed",
        "accepted",
      ]).toContain(action.outcome);
    }
  });

  test("Telegram HTTP ingress authenticates before normalization", async () => {
    await expect(
      telegram.verifyAndNormalizeIngress(
        telegramIngress(privateMessage, "wrong"),
      ),
    ).rejects.toThrow("Telegram webhook verification failed");

    const events = await telegram.verifyAndNormalizeIngress(
      telegramIngress(privateMessage),
    );
    expect(events.map(({ kind }) => kind)).toEqual([
      "endpoint.upsert",
      "conversation.upsert",
      "message.upsert",
    ]);
    for (const event of events) {
      assertNormalizedChannelEvent(event);
      expect(event.companyId).toBe(context.companyId);
      expect(event.channelAccountId).toBe(context.channelAccountId);
      expect(event.channel).toBe("telegram");
      expect(event.provider).toBe("telegram_bot");
    }
    expect(JSON.stringify(events)).not.toContain("correct-secret");
    expect(JSON.stringify(events)).not.toContain("bot_token");
  });

  test("Telegram replay keeps event identity and ignores receive time", async () => {
    const first = await telegram.verifyAndNormalizeIngress(
      telegramIngress(
        privateMessage,
        "correct-secret",
        "2026-09-08T12:00:01.000Z",
      ),
    );
    const replay = await telegram.verifyAndNormalizeIngress(
      telegramIngress(
        privateMessage,
        "correct-secret",
        "2026-09-08T12:05:00.000Z",
      ),
    );
    expect(first.map(({ eventId }) => eventId)).toEqual(
      replay.map(({ eventId }) => eventId),
    );
    const message = first.find((event) => event.kind === "message.upsert");
    const replayed = replay.find((event) => event.kind === "message.upsert");
    expect(message).toBeDefined();
    expect(replayed).toBeDefined();
    expect(channelEventPayloadDigest(message!)).toBe(
      channelEventPayloadDigest(replayed!),
    );
  });

  test("Telegram endpoint and conversation kinds stay scoped", async () => {
    const direct = await telegram.verifyAndNormalizeIngress(
      telegramIngress(privateMessage),
    );
    const conversation = direct.find(
      (event) => event.kind === "conversation.upsert",
    );
    expect(conversation?.payload).toMatchObject({
      conversation: {
        kind: "direct",
        clientThreadKey: "telegram:42",
        externalThreadId: "42",
      },
    });

    const group = await telegram.verifyAndNormalizeIngress(
      telegramIngress({
        update_id: 101,
        message: {
          message_id: 7,
          date: 1_788_868_800,
          chat: { id: -100, type: "supergroup", title: "Ops" },
          from: { id: 9, is_bot: false, first_name: "Ada" },
          text: "in group",
        },
      }),
    );
    expect(
      group.find((event) => event.kind === "conversation.upsert")?.payload,
    ).toMatchObject({
      conversation: { kind: "group", subject: "Ops" },
    });

    const thread = await telegram.verifyAndNormalizeIngress(
      telegramIngress({
        update_id: 102,
        message: {
          message_id: 8,
          message_thread_id: 55,
          date: 1_788_868_800,
          chat: { id: -100, type: "supergroup", title: "Ops" },
          from: { id: 9, is_bot: false, first_name: "Ada" },
          text: "in topic",
        },
      }),
    );
    expect(
      thread.find((event) => event.kind === "conversation.upsert")?.payload,
    ).toMatchObject({
      conversation: {
        kind: "thread",
        externalThreadId: "-100:thread:55",
      },
    });
  });

  test("Telegram edits, reactions, and deferred media are explicit events", async () => {
    const edited = await telegram.verifyAndNormalizeIngress(
      telegramIngress({
        update_id: 200,
        edited_message: {
          ...privateMessage.message,
          edit_date: 1_788_868_860,
          text: "hello edited",
        },
      }),
    );
    expect(edited.some((event) => event.kind === "message.edit")).toBe(true);

    const reacted = await telegram.verifyAndNormalizeIngress(
      telegramIngress({
        update_id: 201,
        message_reaction: {
          chat: { id: 42, type: "private" },
          message_id: 50,
          date: 1_788_868_870,
          user: { id: 42, is_bot: false, first_name: "Ada" },
          old_reaction: [],
          new_reaction: [{ type: "emoji", emoji: "👍" }],
        },
      }),
    );
    expect(reacted.some((event) => event.kind === "reaction.upsert")).toBe(
      true,
    );

    const photo = await telegram.verifyAndNormalizeIngress(
      telegramIngress({
        update_id: 202,
        message: {
          ...privateMessage.message,
          text: undefined,
          photo: [
            {
              file_id: "file-small",
              file_unique_id: "u1",
              width: 10,
              height: 10,
            },
            {
              file_id: "file-large",
              file_unique_id: "u2",
              mime_type: "image/jpeg",
              file_size: 2048,
              width: 800,
              height: 600,
            },
          ],
        },
      }),
    );
    const upsert = photo.find((event) => event.kind === "message.upsert");
    expect(upsert?.payload).toMatchObject({
      normalizedType: "image",
      attachments: [
        {
          ordinal: 0,
          kind: "image",
          providerAttachmentId: "file-large",
          status: "pending",
        },
      ],
    });
  });

  test("Telegram send outcomes cover success, failure, rate limit, and uncertain", async () => {
    const outcomes: ProviderSendResult[] = [
      { outcome: "confirmed", externalMessageId: "9" },
      { outcome: "permanent_failure", errorCode: "telegram_request_rejected" },
      {
        outcome: "transient_failure",
        errorCode: "telegram_rate_limited",
        retryAfterMs: 1000,
      },
      { outcome: "uncertain", errorCode: "telegram_send_outcome_unknown" },
    ];
    for (const result of outcomes) {
      const adapter = new TelegramBotAdapter({
        resolveWebhookSecret: async () => "correct-secret",
        outboundTransport: {
          send: async () => result,
          perform: async () => ({
            outcome: "unsupported",
            errorCode: "telegram_action_unsupported",
          }),
        },
      });
      expect(await adapter.send(sendIntent())).toEqual(result);
      expect(
        await adapter.perform({
          companyId: context.companyId,
          channelAccountId: context.channelAccountId,
          conversationId: sendIntent().conversationId,
          operation: "mark_read",
          idempotencyKey: "read",
          payload: {},
        }),
      ).toEqual({
        outcome: "unsupported",
        errorCode: "telegram_action_unsupported",
      });
    }

    expect(
      classifyTelegramSendFailure(new Error("Telegram Bot API is unavailable")),
    ).toEqual({
      outcome: "uncertain",
      errorCode: "telegram_send_outcome_unknown",
    });
    expect(
      classifyTelegramSendFailure(
        new Error("Telegram Bot API rejected the request"),
      ),
    ).toEqual({
      outcome: "permanent_failure",
      errorCode: "telegram_request_rejected",
    });
  });

  test("attachment storage pins inert MIME types", () => {
    expect(storedContentType("image/jpeg", "text/html")).toBe("image/jpeg");
    expect(storedContentType("text/html")).toBe("application/octet-stream");
    expect(storedContentType("image/svg+xml")).toBe("application/octet-stream");
    expect(storedContentType("application/javascript")).toBe(
      "application/octet-stream",
    );
  });

  test("linked-device HTTP ingress is explicitly unsupported", async () => {
    await expect(
      linkedDevice.verifyAndNormalizeIngress(telegramIngress(privateMessage)),
    ).rejects.toThrow("trusted NATS adapter");
    const capabilities = await linkedDevice.resolveCapabilities(context);
    expect(capabilities.readReceipts).toBe(true);
    expect(capabilities.outboundInitiation).toBe(true);
    expect(capabilities.messageEditing).toBe(false);
    expect(capabilities.unavailableReasons.messageEditing?.code).toBeTruthy();
  });
});
