import { describe, expect, test } from "bun:test";
import { listContactsQuerySchema } from "./contact.js";
import { listTagsQuerySchema } from "./tag.js";

const TAG_ONE = "11111111-1111-4111-8111-111111111111";
const TAG_TWO = "22222222-2222-4222-8222-222222222222";

describe("tag query schemas", () => {
  test("normalizes tag catalog search", () => {
    expect(listTagsQuerySchema.parse({ search: "  priority  " })).toMatchObject(
      { search: "priority", limit: 50, offset: 0 },
    );
    expect(listTagsQuerySchema.parse({ search: "   " }).search).toBeUndefined();
  });

  test("parses a comma-separated contact tag filter", () => {
    expect(
      listContactsQuerySchema.parse({ tagIds: `${TAG_ONE}, ${TAG_TWO}` })
        .tagIds,
    ).toEqual([TAG_ONE, TAG_TWO]);
  });

  test("rejects invalid and oversized tag filters", () => {
    expect(() =>
      listContactsQuerySchema.parse({ tagIds: `${TAG_ONE},not-a-uuid` }),
    ).toThrow();
    expect(() =>
      listContactsQuerySchema.parse({
        tagIds: Array.from({ length: 51 }, () => TAG_ONE).join(","),
      }),
    ).toThrow();
  });
});
