import { describe, expect, test } from "bun:test";
import { listContactsQuerySchema } from "./contact.js";
import { listConversationsQuerySchema } from "./conversation.js";

for (const [name, schema] of [
  ["contacts", listContactsQuerySchema],
  ["conversations", listConversationsQuerySchema],
] as const) {
  describe(`${name} unreadOnly`, () => {
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
