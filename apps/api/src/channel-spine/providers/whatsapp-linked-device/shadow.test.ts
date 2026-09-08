import { describe, expect, test } from "bun:test";
import { deterministicChannelUuid } from "./shadow";

describe("linked-device shadow identities", () => {
  test("derives stable UUIDv5-shaped IDs with purpose separation", () => {
    const first = deterministicChannelUuid(
      "linked-device-endpoint",
      "account-a",
      "user@s.whatsapp.net",
    );
    expect(first).toBe(
      deterministicChannelUuid(
        "linked-device-endpoint",
        "account-a",
        "user@s.whatsapp.net",
      ),
    );
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first).not.toBe(
      deterministicChannelUuid(
        "linked-device-conversation",
        "account-a",
        "user@s.whatsapp.net",
      ),
    );
    expect(first).not.toBe(
      deterministicChannelUuid(
        "linked-device-endpoint",
        "account-b",
        "user@s.whatsapp.net",
      ),
    );
  });
});
