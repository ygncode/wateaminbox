import { describe, expect, test } from "bun:test";
import { listContactsQuerySchema } from "./contact.js";
import { listConversationsQuerySchema } from "./conversation.js";

for (const [name, schema] of [
  ["contacts", listContactsQuerySchema],
  ["conversations", listConversationsQuerySchema],
] as const) {
  describe(`${name} unreadOnly`, () => {
    test("accepts an account UUID but rejects malformed or all-account sentinels", () => {
      const channelAccountId = "00000000-0000-4000-8000-000000000001";
      expect(schema.parse({ channelAccountId }).channelAccountId).toBe(
        channelAccountId,
      );
      expect(schema.parse({}).channelAccountId).toBeUndefined();
      for (const value of ["", "all", "not-a-uuid", true]) {
        expect(schema.safeParse({ channelAccountId: value }).success).toBe(
          false,
        );
      }
    });
    test("defaults off and accepts only explicit boolean strings", () => {
      expect(schema.parse({}).unreadOnly).toBe(false);
      expect(schema.parse({ unreadOnly: "false" }).unreadOnly).toBe(false);
      expect(schema.parse({ unreadOnly: "true" }).unreadOnly).toBe(true);
      for (const unreadOnly of ["", "1", "0", "TRUE", "yes", true, false]) {
        expect(schema.safeParse({ unreadOnly }).success).toBe(false);
      }
    });
  });
}
