import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import {
  clampLimit,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MAX_TEXT_LENGTH,
  McpToolError,
  toToolErrorMessage,
  truncateText,
} from "./tool-context.js";
import {
  fallbackInboundSenderLabel,
  memberDisplayName,
  readTools,
} from "./tools/read.js";
import { validateBroadcastSchedule, writeTools } from "./tools/write.js";

describe("clampLimit", () => {
  test("defaults and caps", () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
    expect(clampLimit(0)).toBe(DEFAULT_LIST_LIMIT);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(10_000)).toBe(MAX_LIST_LIMIT);
  });
});

describe("truncateText", () => {
  test("passes short text through and truncates long text", () => {
    expect(truncateText("hi")).toEqual({ text: "hi" });
    expect(truncateText(null)).toEqual({ text: null });
    const long = "x".repeat(MAX_TEXT_LENGTH + 5);
    const result = truncateText(long);
    expect(result.text?.length).toBe(MAX_TEXT_LENGTH);
    expect(result.truncated).toBe(true);
  });
});

describe("toToolErrorMessage", () => {
  test("exposes tool and app errors, hides everything else", () => {
    expect(toToolErrorMessage(new McpToolError("nope"))).toBe("nope");
    expect(toToolErrorMessage(new AppError("conflict", 409))).toBe("conflict");
    expect(toToolErrorMessage(new Error("secret stack"))).toBe(
      "The tool call failed due to an internal error",
    );
  });
});

describe("memberDisplayName", () => {
  test("does not derive a display name from private member fields", () => {
    expect(memberDisplayName(" Agent Smith ")).toBe("Agent Smith");
    expect(memberDisplayName(null)).toBe("Team member");
    expect(memberDisplayName("   ")).toBe("Team member");
  });
});

describe("fallbackInboundSenderLabel", () => {
  test("formats phone JIDs without presenting opaque LIDs as numbers", () => {
    expect(fallbackInboundSenderLabel("15551234567@s.whatsapp.net")).toBe(
      "+15551234567",
    );
    expect(fallbackInboundSenderLabel("123456789@lid")).toBe("123456789@lid");
    expect(fallbackInboundSenderLabel("123456789@hosted.lid")).toBe(
      "123456789@hosted.lid",
    );
    expect(fallbackInboundSenderLabel("123456789@g.us")).toBe("123456789@g.us");
  });
});

describe("validateBroadcastSchedule", () => {
  test("enforces the same 30-second to one-year window as REST", () => {
    const now = Date.UTC(2030, 0, 1);
    expect(() =>
      validateBroadcastSchedule(new Date(now + 29_999), now),
    ).toThrow("at least 30 seconds");
    expect(() =>
      validateBroadcastSchedule(new Date(now + 30_000), now),
    ).not.toThrow();
    expect(() =>
      validateBroadcastSchedule(new Date(now + 365 * 24 * 60 * 60 * 1000), now),
    ).not.toThrow();
    expect(() =>
      validateBroadcastSchedule(
        new Date(now + 365 * 24 * 60 * 60 * 1000 + 1),
        now,
      ),
    ).toThrow("within one year");
  });
});

describe("tool registry", () => {
  const allTools = [...readTools, ...writeTools];

  test("tool names are unique", () => {
    const names = allTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("read tools carry read scope, write tools write scope", () => {
    for (const tool of readTools) expect(tool.scope).toBe("read");
    for (const tool of writeTools) expect(tool.scope).toBe("write");
  });

  test("high-impact tools declare the expected permissions", () => {
    const byName = new Map(allTools.map((tool) => [tool.name, tool]));
    expect(byName.get("send_message")?.permission).toBe("can_send_messages");
    expect(byName.get("create_broadcast")?.permission).toBe(
      "can_send_bulk_messages",
    );
    expect(byName.get("unassign_contact")?.permission).toBe(
      "can_assign_contacts",
    );
    expect(byName.get("list_broadcasts")?.permission).toBe(
      "can_send_bulk_messages",
    );
  });

  test("broadcast creation requires a stable idempotency key", () => {
    const tool = writeTools.find(
      (candidate) => candidate.name === "create_broadcast",
    );
    expect(tool).toBeDefined();
    const schema = z.object(tool!.inputSchema);
    const input = {
      name: "Announcement",
      content: "Hello",
      contactIds: ["123e4567-e89b-42d3-a456-426614174000"],
      scheduledAt: "2030-01-01T00:00:00Z",
    };
    expect(schema.safeParse(input).success).toBe(false);
    expect(
      schema.safeParse({ ...input, idempotencyKey: "stable-key" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...input,
        name: "   ",
        idempotencyKey: "stable-key",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...input,
        content: "\t\n",
        idempotencyKey: "stable-key",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...input, idempotencyKey: "        " }).success,
    ).toBe(false);
    expect(
      schema.parse({
        ...input,
        name: " Announcement ",
        content: " Hello ",
        idempotencyKey: " stable-key ",
      }),
    ).toMatchObject({
      name: "Announcement",
      content: "Hello",
      idempotencyKey: "stable-key",
    });
  });
});
