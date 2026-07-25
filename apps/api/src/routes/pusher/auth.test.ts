import { describe, expect, test } from "bun:test";
import { canAuthorizePusherChannel } from "./auth.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

describe("Pusher user channel authorization", () => {
  test("allows the authenticated company and user channels", () => {
    expect(
      canAuthorizePusherChannel({
        channelName: `private-company-${companyId}`,
        companyId,
        userId,
      }),
    ).toBe(true);
    expect(
      canAuthorizePusherChannel({
        channelName: `private-company-${companyId}-user-${userId}`,
        companyId,
        userId,
      }),
    ).toBe(true);
  });
  test("rejects another user or company", () => {
    expect(
      canAuthorizePusherChannel({
        channelName: `private-company-${companyId}-user-33333333-3333-4333-8333-333333333333`,
        companyId,
        userId,
      }),
    ).toBe(false);
    expect(
      canAuthorizePusherChannel({
        channelName: "private-company-44444444-4444-4444-8444-444444444444",
        companyId,
        userId,
      }),
    ).toBe(false);
  });
});
