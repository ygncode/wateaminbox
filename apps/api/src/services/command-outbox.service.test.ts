import { describe, expect, test } from "bun:test";
import { buildSendMessageCommand } from "../lib/nats/client.js";
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

  test("preserves the temporary WhatsApp ID in queued sends", async () => {
    const command = await buildSendMessageCommand(
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
});
