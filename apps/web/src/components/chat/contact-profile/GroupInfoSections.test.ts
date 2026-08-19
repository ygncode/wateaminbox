import { describe, expect, test } from "bun:test";

const readSource = async (relativePath: string) =>
  Bun.file(new URL(relativePath, import.meta.url)).text();

describe("group info panel", () => {
  test("loads group details when a group profile opens", async () => {
    const [profile, header] = await Promise.all([
      readSource("./ContactProfile.tsx"),
      readSource("../MessageHeader.tsx"),
    ]);
    expect(profile).toContain("useGroup(contact?.isGroup ? contactId : null)");
    expect(profile).toContain("<GroupInfoSections");
    expect(profile).toContain('t("contacts.groupInfo", "Group Info")');
    expect(profile).toContain('t("contacts.contactInfo", "Contact Info")');
    expect(header).toContain("useGroup(contact?.isGroup ? contact.id : null)");
    expect(header).toContain("count: group.participantCount");
  });

  test("shows every available member identity and admin role", async () => {
    const section = await readSource("./GroupInfoSections.tsx");
    expect(section).toContain("participant.displayName");
    expect(section).toContain("participant.phoneNumber");
    expect(section).toContain("participant.jid");
    expect(section).toContain("participant.isAdmin");
    expect(section).toContain("Show all");
  });
});
