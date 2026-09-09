import { describe, expect, test } from "bun:test";
import { shouldOfferMergeSuggestions } from "./MergeSuggestionsSection";

const base = {
  role: "owner" as string | null | undefined,
  isGroup: false,
  isLoading: false,
  suggestionCount: 1,
};

describe("shouldOfferMergeSuggestions", () => {
  test("offers a merge to an owner or admin with candidates", () => {
    expect(shouldOfferMergeSuggestions(base)).toBe(true);
    expect(shouldOfferMergeSuggestions({ ...base, role: "admin" })).toBe(true);
  });

  test("hides it from a member, who the API would refuse anyway", () => {
    expect(shouldOfferMergeSuggestions({ ...base, role: "member" })).toBe(
      false,
    );
    expect(shouldOfferMergeSuggestions({ ...base, role: null })).toBe(false);
    expect(shouldOfferMergeSuggestions({ ...base, role: undefined })).toBe(
      false,
    );
  });

  test("never offers to merge a group, which is a thread and not a person", () => {
    expect(shouldOfferMergeSuggestions({ ...base, isGroup: true })).toBe(false);
  });

  test("stays silent until the answer has arrived", () => {
    // Rendering an empty section while loading reads as "no duplicates found",
    // which is a claim the UI cannot make yet.
    expect(shouldOfferMergeSuggestions({ ...base, isLoading: true })).toBe(
      false,
    );
  });

  test("shows nothing when there are no candidates", () => {
    expect(shouldOfferMergeSuggestions({ ...base, suggestionCount: 0 })).toBe(
      false,
    );
  });
});
