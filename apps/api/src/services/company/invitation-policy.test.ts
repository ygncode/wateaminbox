import { describe, expect, test } from "bun:test";
import {
  invitationEmailMatches,
  normalizeInvitationEmail,
} from "./invitations.js";

describe("invitation recipient policy", () => {
  test("normalizes invitation email addresses", () => {
    expect(normalizeInvitationEmail("  Person@Example.COM ")).toBe(
      "person@example.com",
    );
  });

  test("matches recipients case-insensitively but rejects another address", () => {
    expect(
      invitationEmailMatches("Person@example.com", "person@EXAMPLE.com"),
    ).toBe(true);
    expect(
      invitationEmailMatches("person@example.com", "other@example.com"),
    ).toBe(false);
  });
});
