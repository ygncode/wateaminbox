import { describe, expect, test } from "bun:test";
import type { MessageReaction } from "@wateaminbox/shared";
import {
  getReactionMutationEmoji,
  reconcileOwnReaction,
} from "./useReactionMutations";

const createdAt = new Date("2026-07-29T00:00:00.000Z");

describe("reaction mutations", () => {
  test("selecting the current own emoji toggles the reaction off", () => {
    expect(
      getReactionMutationEmoji(
        [
          {
            emoji: "❤️",
            isOwn: true,
          },
        ],
        "❤️",
      ),
    ).toBe("");
  });

  test("selecting a different emoji replaces the current reaction", () => {
    expect(
      getReactionMutationEmoji(
        [
          {
            emoji: "❤️",
            isOwn: true,
          },
        ],
        "👍",
      ),
    ).toBe("👍");
  });

  test("a successful removal does not leave an empty reaction in the cache", () => {
    const reactions: MessageReaction[] = [
      {
        emoji: "❤️",
        reactorJid: "6584042683@s.whatsapp.net",
        isOwn: true,
        createdAt,
      },
      {
        emoji: "👍",
        reactorJid: "84855316944@s.whatsapp.net",
        isOwn: false,
        createdAt,
      },
    ];

    expect(
      reconcileOwnReaction(reactions, {
        emoji: "",
        reactorJid: "6584042683@s.whatsapp.net",
        isOwn: true,
      }),
    ).toEqual([reactions[1]]);
  });
});
