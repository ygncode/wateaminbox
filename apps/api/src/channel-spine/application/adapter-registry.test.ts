import { describe, expect, test } from "bun:test";
import type { ChannelAdapter, ResolvedCapabilities } from "@wateaminbox/shared";
import {
  ChannelAdapterRegistry,
  resolveAdapterCapabilities,
} from "./adapter-registry";

const capabilities: ResolvedCapabilities = {
  typing: true,
  readReceipts: true,
  reactions: true,
  messageEditing: false,
  messageDeletion: true,
  templates: false,
  groups: true,
  multipleRecipients: false,
  outboundInitiation: true,
  scheduledMessages: true,
  messageTypes: [{ type: "text", enabled: true, maxTextLength: 4096 }],
  actions: {
    reply: true,
    quote: true,
    forward: true,
    retry: true,
    starLocally: true,
    deleteLocally: true,
    deleteForEveryone: true,
    groupMentions: false,
    remoteHistory: false,
  },
  attachment: { enabled: true, maxCount: 1 },
  constraints: {},
  unavailableReasons: {},
  version: "telegram:v1",
};

function telegramAdapter(): ChannelAdapter {
  return {
    channel: "telegram",
    provider: "telegram_bot",
    verifyAndNormalizeIngress: async () => [],
    resolveCapabilities: async () => capabilities,
    send: async () => ({ outcome: "accepted" }),
    perform: async () => ({ outcome: "confirmed" }),
  };
}

describe("channel adapter registry", () => {
  test("registers adapters by exact channel/provider pair", () => {
    const registry = new ChannelAdapterRegistry();
    const adapter = telegramAdapter();
    registry.register(adapter);
    expect(registry.has("telegram", "telegram_bot")).toBe(true);
    expect(registry.get("telegram", "telegram_bot")).toBe(adapter);
    expect(() => registry.get("whatsapp", "telegram_bot")).toThrow(
      "not registered",
    );
    expect(() => registry.register(adapter)).toThrow("already registered");
  });

  test("fails closed when capability resolution is unavailable", async () => {
    const registry = new ChannelAdapterRegistry();
    const resolved = await resolveAdapterCapabilities(
      registry,
      "telegram",
      "telegram_bot",
      {
        companyId: "company-a",
        channelAccountId: "account-a",
        now: "2026-09-08T12:00:00.000Z",
      },
    );
    expect(resolved.outboundInitiation).toBe(false);
    expect(resolved.actions.reply).toBe(false);
    expect(resolved.actions.starLocally).toBe(true);
    expect(resolved.version).toContain("unavailable");
  });
});
