import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSendMessageCommand } from "../lib/nats/client.js";
import { NatsCommandPublisher } from "../lib/nats/command-builder.js";
import {
  getCommandOutboxBacklog,
  getOutboxRetryDelayMs,
  prepareOutboxPayload,
  resetCommandOutboxBacklogCache,
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
    expect(source).toContain('.where("next_attempt_at", "=", row.claimUntil)');
    expect(
      source.match(/\.where\("next_attempt_at", "=", claimUntil\)/g),
    ).toHaveLength(2);
    expect(source.indexOf("await publish(")).toBeLessThan(
      source.indexOf('status: "published"'),
    );
    expect(source).toContain(
      "Published outbox command but could not persist its outcome",
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

  test("carries group mention JIDs in a queued text send", async () => {
    const command = await buildSendMessageCommand(
      "company-id",
      "connection-id",
      "120363000000000000@g.us",
      "hello @6585719494172749",
      "text",
      "user-id",
      "pending_internal-id",
      undefined,
      undefined,
      undefined,
      ["6585719494172749@lid"],
    );

    expect(command.mentioned_jids).toEqual(["6585719494172749@lid"]);
  });

  test("carries WhatsApp album association data in an ordered media send", async () => {
    const album = {
      id: "3EB0000102030405FAFBFF",
      index: 1,
      count: 3,
      imageCount: 2,
      videoCount: 1,
    };
    const command = await buildSendMessageCommand(
      "company-id",
      "connection-id",
      "15551234567@s.whatsapp.net",
      "",
      "image",
      "user-id",
      "pending_internal-id",
      undefined,
      undefined,
      undefined,
      undefined,
      album,
    );

    expect(command).toMatchObject({
      media_album_id: album.id,
      media_album_index: 1,
      media_album_count: 3,
      media_album_image_count: 2,
      media_album_video_count: 1,
    });
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

/**
 * The backlog scan issues one query per active tenant. `/health/ready` is
 * unauthenticated, so an uncached read would let anyone fan a cheap probe out
 * across every tenant schema.
 */
describe("command outbox backlog is not recomputed per probe", () => {
  beforeEach(() => {
    resetCommandOutboxBacklogCache();
  });

  test("repeated probes reuse one scan", async () => {
    let scans = 0;
    const load = async () => {
      scans++;
      return { pending: 3, oldestPendingAt: null };
    };

    expect(await getCommandOutboxBacklog(load)).toEqual({
      pending: 3,
      oldestPendingAt: null,
    });
    await getCommandOutboxBacklog(load);
    await getCommandOutboxBacklog(load);

    expect(scans).toBe(1);
  });

  test("concurrent probes share a single in-flight scan", async () => {
    let scans = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = async () => {
      scans++;
      await gate;
      return { pending: 7, oldestPendingAt: null };
    };

    const probes = Promise.all([
      getCommandOutboxBacklog(load),
      getCommandOutboxBacklog(load),
      getCommandOutboxBacklog(load),
    ]);
    release?.();

    expect(await probes).toEqual([
      { pending: 7, oldestPendingAt: null },
      { pending: 7, oldestPendingAt: null },
      { pending: 7, oldestPendingAt: null },
    ]);
    expect(scans).toBe(1);
  });

  test("a failed scan is not cached, so the next probe retries", async () => {
    let scans = 0;
    const load = async () => {
      scans++;
      if (scans === 1) throw new Error("postgres unavailable");
      return { pending: 0, oldestPendingAt: null };
    };

    await expect(getCommandOutboxBacklog(load)).rejects.toThrow(
      "postgres unavailable",
    );
    expect(await getCommandOutboxBacklog(load)).toEqual({
      pending: 0,
      oldestPendingAt: null,
    });
    expect(scans).toBe(2);
  });
});
