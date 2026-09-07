import { expect, test } from "bun:test";
import type { Context } from "hono";
import { settingsWriteTools } from "./tools/settings.js";

const context = (role?: string) =>
  ({
    get: (key: string) =>
      ({ companyRole: role, user: { id: "test" }, companyId: "test" })[key],
  }) as unknown as Context;
const tool = (name: string) => settingsWriteTools.find((t) => t.name === name)!;

test("SLA writes fail closed for members and missing roles before accessing storage", async () => {
  for (const role of ["member", undefined]) {
    await expect(
      tool("update_sla_policy").handler({}, context(role)),
    ).rejects.toThrow("owners and admins");
  }
});

test("automatic replies retain cross-field validation beyond the MCP raw shape", async () => {
  await expect(
    tool("update_auto_reply_settings").handler(
      {
        enabled: true,
        quickReplyId: null,
        delayMinutes: 5,
        sendMode: "always",
      },
      context("owner"),
    ),
  ).rejects.toThrow("Choose a quick reply");
});

test("invalid schedules and empty template edits fail before accessing storage", async () => {
  await expect(
    tool("update_auto_reply_settings").handler(
      {
        enabled: false,
        quickReplyId: null,
        delayMinutes: 0,
        sendMode: "always",
      },
      context("owner"),
    ),
  ).rejects.toThrow();
  await expect(
    tool("update_quick_reply").handler(
      { quickReplyId: crypto.randomUUID() },
      context("owner"),
    ),
  ).rejects.toThrow("at least one field");
});
