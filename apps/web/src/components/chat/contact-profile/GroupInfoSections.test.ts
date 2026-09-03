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

  test("opens a member's contact info from their row when one exists", async () => {
    const section = await readSource("./GroupInfoSections.tsx");
    expect(section).toContain("participant.contactId");
    expect(section).toContain("onOpenProfile?.(profileContactId)");
    // Named for screen readers rather than relying on the visible name alone,
    // which repeats for every row in the list.
    expect(section).toContain('t("groups.openParticipantProfile"');
    expect(section).toContain("focus-visible:ring-2");
  });

  test("leaves a member with no contact record as static text", async () => {
    const section = await readSource("./GroupInfoSections.tsx");
    expect(section).toContain(
      "const canOpenProfile = Boolean(profileContactId && onOpenProfile);",
    );
    expect(section).toContain(
      '<div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>',
    );
  });

  test("keeps the identity control out of the admin action buttons", async () => {
    const section = await readSource("./GroupInfoSections.tsx");
    // The row holds both the identity control and the promote/remove buttons;
    // a button inside a button would be invalid and ambiguous to activate.
    const rowStart = section.indexOf("function ParticipantRow");
    const row = section.slice(rowStart);
    expect(row.indexOf("{identity}")).toBeLessThan(row.indexOf("<IconAction"));
    expect(section).not.toContain(
      '<button type="button" onClick={() => onOpenProfile',
    );
  });

  test("wires the panel host through to the member rows", async () => {
    const [profile, page] = await Promise.all([
      readSource("./ContactProfile.tsx"),
      readSource("../../../pages/ChatPage.tsx"),
    ]);
    expect(profile).toContain(
      "onOpenParticipantProfile={onOpenParticipantProfile}",
    );
    const rightPanel = page.slice(page.indexOf("const rightPanel"));
    expect(rightPanel).toContain(
      "onOpenParticipantProfile={handleOpenParticipantProfile}",
    );
    // The panel follows the member, while the thread stays on the group.
    expect(rightPanel).toContain("contactId={profileContactId || null}");
  });

  test("makes the in-thread sender identity open the same panel", async () => {
    const bubble = await readSource("../MessageBubble.tsx");
    expect(bubble).toContain("resolveParticipantContactId");
    expect(bubble).toContain("onOpenParticipantProfile(contactId)");
    expect(bubble).toContain('t("chat.openParticipantProfile"');
    // Selection mode and the context menu both live on the wrapping row.
    expect(bubble).toContain("event.stopPropagation();");
    // The gutter placeholder carries no identity and must stay inert.
    expect(bubble).toContain(
      "if (hidden || selectionMode || !contactId || !onOpenParticipantProfile) {",
    );
  });

  test("stands down while messages are being selected", async () => {
    const bubble = await readSource("../MessageBubble.tsx");
    // Multi-select makes the whole row the target; an identity control inside
    // it would swallow the tap that was meant to extend the selection.
    expect(bubble).toContain("selectionMode={selectionMode}");
    expect(bubble).toContain(
      "if (selectionMode || !contactId || !onOpenParticipantProfile) {",
    );
  });
});
