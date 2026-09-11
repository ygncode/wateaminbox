import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { setCompanyId } from "@/lib/api/client";
import { queryKeys } from "../query-keys";
import { groupKeys, type GroupDetail } from "../useGroups";
import {
  applyContactUpdateToCaches,
  type ContactDetail,
} from "./useContactDetails";

const COMPANY_ID = "company-a";
const GROUP_ID = "group-1";
const CONTACT_ID = "contact-1";

function contactDetail(overrides: Partial<ContactDetail> = {}): ContactDetail {
  return {
    id: GROUP_ID,
    jid: "120363000000000000@g.us",
    phoneNumber: null,
    pushName: null,
    customName: null,
    displayName: "Weekend Runners",
    isGroup: true,
    isBlocked: false,
    isOnline: false,
    lastSeen: null,
    profilePictureUrl: null,
    notesShared: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    connection: null,
    assignment: null,
    tags: [],
    ...overrides,
  };
}

function groupDetail(overrides: Partial<GroupDetail> = {}): GroupDetail {
  return {
    id: GROUP_ID,
    jid: "120363000000000000@g.us",
    name: "Weekend Runners",
    displayName: "Weekend Runners",
    customName: null,
    whatsappName: "Weekend Runners",
    description: null,
    profilePictureUrl: null,
    participantCount: 3,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    participants: [],
    tags: [],
    connection: null,
    isAdmin: true,
    isMember: true,
    canAdminister: true,
    settings: {
      ownerJid: null,
      isAnnounce: false,
      isLocked: false,
      isEphemeral: false,
      disappearingTimer: 0,
      isJoinApprovalRequired: false,
      memberAddMode: null,
      isMember: true,
      syncedAt: null,
    },
    inviteLink: null,
    inviteLinkUpdatedAt: null,
    leaveSemantics: "",
    ...overrides,
  };
}

/**
 * Seeds the three caches a rename touches: the contact the profile panel reads,
 * the group detail the leave dialog reads, and the group list the sidebar reads.
 */
function seedGroupRename(client: QueryClient) {
  setCompanyId(COMPANY_ID);
  const contactKey = queryKeys.contacts.detail(GROUP_ID);
  const detailKey = groupKeys.detail(GROUP_ID);
  const listKey = groupKeys.lists();

  client.setQueryData(contactKey, contactDetail());
  client.setQueryData(detailKey, groupDetail());
  client.setQueryData(listKey, { data: [] });

  return { contactKey, detailKey, listKey };
}

/** The alias-first name the sidebar row and the leave dialog render. */
function renderedGroupName(client: QueryClient) {
  return client.getQueryData<GroupDetail>(groupKeys.detail(GROUP_ID))
    ?.displayName;
}

describe("applying a contact update to the caches that render it", () => {
  test("a group rename updates the group detail the leave dialog renders", () => {
    const client = new QueryClient();
    seedGroupRename(client);

    applyContactUpdateToCaches(client, {
      contactId: GROUP_ID,
      update: contactDetail({
        customName: "Saturday Crew",
        updatedAt: "2026-02-02T00:00:00.000Z",
      }),
    });

    // The rename arrives through `PATCH /contacts/:id`, whose previous
    // `onSuccess` touched only the `contacts` domain, so the sidebar and the
    // leave dialog kept rendering the old alias.
    expect(renderedGroupName(client)).toBe("Saturday Crew");
  });

  test("a group rename invalidates the group list the sidebar renders", () => {
    const client = new QueryClient();
    const { listKey } = seedGroupRename(client);
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);

    applyContactUpdateToCaches(client, {
      contactId: GROUP_ID,
      update: contactDetail({ customName: "Saturday Crew" }),
    });

    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  test("clearing the alias falls back to the group's WhatsApp name", () => {
    const client = new QueryClient();
    seedGroupRename(client);
    applyContactUpdateToCaches(client, {
      contactId: GROUP_ID,
      update: contactDetail({ customName: "Saturday Crew" }),
    });

    applyContactUpdateToCaches(client, {
      contactId: GROUP_ID,
      update: contactDetail({ customName: null }),
    });

    expect(renderedGroupName(client)).toBe("Weekend Runners");
  });

  test("keeps the contact detail cache in step", () => {
    const client = new QueryClient();
    const { contactKey } = seedGroupRename(client);

    applyContactUpdateToCaches(client, {
      contactId: GROUP_ID,
      update: contactDetail({
        customName: "Saturday Crew",
        notesShared: "Runs at 7am",
      }),
    });

    const cached = client.getQueryData<ContactDetail>(contactKey);
    expect(cached?.customName).toBe("Saturday Crew");
    expect(cached?.notesShared).toBe("Runs at 7am");
    // The PATCH response omits `isGroup`, and group handling depends on it, so
    // the merge must not drop what the panel already knew.
    expect(cached?.isGroup).toBe(true);
  });

  test("does not touch the group caches for a direct contact", () => {
    const client = new QueryClient();
    const { listKey, detailKey } = seedGroupRename(client);
    client.setQueryData(
      queryKeys.contacts.detail(CONTACT_ID),
      contactDetail({ id: CONTACT_ID, isGroup: false, displayName: "Ada" }),
    );

    applyContactUpdateToCaches(client, {
      contactId: CONTACT_ID,
      update: contactDetail({
        id: CONTACT_ID,
        isGroup: false,
        customName: "Ada Lovelace",
      }),
    });

    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(client.getQueryData<GroupDetail>(detailKey)?.displayName).toBe(
      "Weekend Runners",
    );
  });

  test("tolerates a contact that was never cached", () => {
    const client = new QueryClient();
    setCompanyId(COMPANY_ID);

    expect(() =>
      applyContactUpdateToCaches(client, {
        contactId: "never-opened",
        update: contactDetail({ id: "never-opened" }),
      }),
    ).not.toThrow();
  });
});
