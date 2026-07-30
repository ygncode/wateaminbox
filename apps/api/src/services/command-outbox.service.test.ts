import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSendMessageCommand } from "../lib/nats/client.js";
import { NatsCommandPublisher } from "../lib/nats/command-builder.js";
import {
  getOutboxRetryDelayMs,
  prepareOutboxPayload,
} from "./command-outbox.service.js";

describe("command outbox", () => {
  test("uses bounded exponential retry delays", () => {
    expect(getOutboxRetryDelayMs(1)).toBe(2_000);
    expect(getOutboxRetryDelayMs(3)).toBe(8_000);
    expect(getOutboxRetryDelayMs(20)).toBe(60_000);
  });

  test("adds a stable command ID without mutating the command", () => {
    const command = { type: "kill" };
    expect(prepareOutboxPayload(command, "outbox-1")).toEqual({
      type: "kill",
      command_id: "outbox-1",
    });
    expect(command).toEqual({ type: "kill" });
  });

  test("preserves the multi-dispatcher lease and crash replay contract", () => {
    const source = readFileSync(
      new URL("./command-outbox.service.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(".forUpdate()");
    expect(source).toContain(".skipLocked()");
    expect(source).toContain('status: "claimed"');
    expect(source).toContain("publish(row.subject, row.payload, row.id)");
    expect(source).toContain('.where("status", "=", "claimed")');
    expect(source.indexOf("await publish(")).toBeLessThan(
      source.indexOf('status: "published"'),
    );
  });

  test("preserves the temporary WhatsApp ID in queued sends", async () => {
    const command = await buildSendMessageCommand(
      "company-id",
      "connection-id",
      "15551234567@s.whatsapp.net",
      "hello",
      "text",
      "user-id",
      "pending_internal-id",
    );

    expect(command.message_id).toBe("pending_internal-id");
    expect(command.connection_id).toBe("connection-id");
    expect(command.type).toBe("text");
    expect(command.to).toBe("15551234567@s.whatsapp.net");
  });

  test("builds a bounded per-conversation history request", async () => {
    const commands: Array<Record<string, unknown>> = [];
    const publisher = new NatsCommandPublisher(
      "company-id",
      "session-id",
      async (_subject, command) => {
        commands.push(command as unknown as Record<string, unknown>);
      },
      (companyId, connectionId) => `${companyId}.${connectionId}`,
    );

    await publisher.requestHistory({
      chatJid: "15551234567@s.whatsapp.net",
      oldestMessageId: "3EB0OLDEST",
      oldestFromMe: false,
      oldestTimestamp: "2026-01-01T00:00:00.000Z",
      count: 50,
    });

    expect(commands[0]).toEqual({
      type: "request_history",
      company_id: "company-id",
      connection_id: "session-id",
      chat_jid: "15551234567@s.whatsapp.net",
      oldest_message_id: "3EB0OLDEST",
      oldest_from_me: false,
      oldest_timestamp: "2026-01-01T00:00:00.000Z",
      count: 50,
    });
  });
});
