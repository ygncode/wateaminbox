import { describe, expect, test } from "bun:test";
import { formatChatListTime } from "@wateaminbox/shared";

describe("chat list timestamps", () => {
  test("includes the year for conversations from a previous year", () => {
    expect(formatChatListTime("2020-08-11T12:00:00Z")).toContain("2020");
  });
});
