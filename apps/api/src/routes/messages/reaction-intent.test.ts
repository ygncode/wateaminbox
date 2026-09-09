import { describe, expect, test } from "bun:test";
import { intentActorUserId } from "../../services/channel-outbound.service.js";
import { buildChannelReactionPayload } from "./reactions.js";

/**
 * Dispatch re-checks authorization by reading `actorUserId` out of an intent's
 * stored payload. An intent that omits it is not merely unauthenticated - it
 * is treated as revoked and dropped before the adapter runs, which is exactly
 * how a queued reaction reached "failed" while the UI showed it as applied.
 */
describe("channel reaction intents", () => {
  test("carry the actor that dispatch re-authorizes, and the provider's message id", () => {
    const payload = buildChannelReactionPayload({
      actorUserId: "user-1",
      emoji: "❤️",
      messageId: "message-1",
      externalMessageId: "23",
    });
    expect(intentActorUserId(payload)).toBe("user-1");
    // The adapter addresses the provider's own message, never our row id.
    expect(payload.externalMessageId).toBe("23");
    expect(payload.emoji).toBe("❤️");
  });

  test("dispatch refuses a payload with no usable actor", () => {
    expect(intentActorUserId({ emoji: "❤️" })).toBeNull();
    expect(intentActorUserId({ actorUserId: "" })).toBeNull();
    expect(intentActorUserId({ actorUserId: 42 })).toBeNull();
  });
});
