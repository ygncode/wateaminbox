import { describe, expect, test } from "bun:test";
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
import { readTools } from "./tools/read.js";
import { writeTools } from "./tools/write.js";

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
});
