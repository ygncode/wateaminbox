import { describe, expect, test } from "bun:test";
import {
  getIdentityAvatarRenderKind,
  getIdentityPaletteIndex,
  isUnnamedIdentity,
} from "./identity-avatar-fallback";

describe("identity avatar fallbacks", () => {
  test("uses a user icon for phone-number and JID fallback names", () => {
    expect(isUnnamedIdentity("+66994862943")).toBe(true);
    expect(isUnnamedIdentity("447723442982")).toBe(true);
    expect(isUnnamedIdentity("277905926004845@lid")).toBe(true);
    expect(isUnnamedIdentity("Unknown contact")).toBe(true);
  });

  test("keeps initials for actual contact names", () => {
    expect(isUnnamedIdentity("Mai")).toBe(false);
    expect(isUnnamedIdentity("Set Kyar Wa Lar")).toBe(false);
  });

  test("always uses a group icon for groups, even when they have a name", () => {
    expect(getIdentityAvatarRenderKind("Dalat Hackathon", "group")).toBe(
      "group-icon",
    );
    expect(
      getIdentityAvatarRenderKind("120363380084647857@g.us", "group"),
    ).toBe("group-icon");
    expect(getIdentityAvatarRenderKind("Mai", "user")).toBe("initials");
  });

  test("assigns a stable color from the contact identity", () => {
    const identity = "66994862943@s.whatsapp.net";
    expect(getIdentityPaletteIndex(identity)).toBe(
      getIdentityPaletteIndex(identity),
    );
    expect(getIdentityPaletteIndex(identity)).not.toBe(
      getIdentityPaletteIndex("447723442982@s.whatsapp.net"),
    );
  });

  test("uses the group variant in the chat header and Group Info", async () => {
    const header = await Bun.file(
      new URL("../chat/MessageHeader.tsx", import.meta.url),
    ).text();
    const profile = await Bun.file(
      new URL("../chat/contact-profile/ProfileHeader.tsx", import.meta.url),
    ).text();
    expect(header).toContain('kind={contact.isGroup ? "group" : "user"}');
    expect(profile).toContain('kind={contact.isGroup ? "group" : "user"}');
  });

  test("is used across primary contact surfaces", async () => {
    const paths = [
      "../chat/ChatListItem.tsx",
      "../chat/MessageHeader.tsx",
      "../chat/ForwardMessageDialog.tsx",
      "../chat/contact-profile/ProfileHeader.tsx",
      "../chat/contact-profile/GroupInfoSections.tsx",
    ];
    for (const path of paths) {
      const source = await Bun.file(new URL(path, import.meta.url)).text();
      expect(source).toContain("<IdentityAvatarFallback");
    }
  });
});
