import { describe, expect, test } from "bun:test";
import { ROLE_PRESETS } from "./permission.service.js";
import {
  type ContactViewerCandidate,
  mergeFanOutRecipients,
  selectContactViewerIds,
} from "./message-broadcast.service.js";

const OWNER = "owner-user";
const ADMIN = "admin-user";
const ASSIGNEE = "assignee-user";
const BYSTANDER = "bystander-user";

function member(
  userId: string,
  canViewAllChats = false,
): ContactViewerCandidate {
  return {
    userId,
    permissions: {
      ...ROLE_PRESETS.member,
      can_view_all_chats: canViewAllChats,
    },
  };
}

const candidates: ContactViewerCandidate[] = [
  { userId: OWNER, permissions: ROLE_PRESETS.owner },
  { userId: ADMIN, permissions: ROLE_PRESETS.admin },
  member(ASSIGNEE),
  member(BYSTANDER),
];

/**
 * `message:new` carries message content. Its recipient set must match the HTTP
 * guard (`hasContactVisibility`) exactly - a member who would get a 404 from
 * `GET /contacts/:id` must not receive that conversation over realtime either.
 */
describe("message:new fan-out matches HTTP contact visibility", () => {
  test("excludes a member who is neither assigned nor allowed to view all chats", () => {
    const viewers = selectContactViewerIds({
      candidates,
      assignedTo: ASSIGNEE,
    });

    expect(viewers).not.toContain(BYSTANDER);
    expect(viewers.sort()).toEqual([ADMIN, ASSIGNEE, OWNER].sort());
  });

  test("includes the active assignee even without can_view_all_chats", () => {
    expect(
      selectContactViewerIds({
        candidates: [member(ASSIGNEE)],
        assignedTo: ASSIGNEE,
      }),
    ).toEqual([ASSIGNEE]);
  });

  test("an unassigned contact reaches only members who can view all chats", () => {
    const viewers = selectContactViewerIds({ candidates, assignedTo: null });

    expect(viewers.sort()).toEqual([ADMIN, OWNER].sort());
    expect(viewers).not.toContain(ASSIGNEE);
    expect(viewers).not.toContain(BYSTANDER);
  });

  test("a granted can_view_all_chats override lets a plain member see it", () => {
    // Custom permissions merge over the role preset, so the override must be
    // honored rather than the bare role being consulted.
    expect(
      selectContactViewerIds({
        candidates: [member(BYSTANDER, true)],
        assignedTo: ASSIGNEE,
      }),
    ).toEqual([BYSTANDER]);
  });

  test("a reassignment moves delivery off the previous assignee", () => {
    const previous = selectContactViewerIds({
      candidates: [member(ASSIGNEE), member(BYSTANDER)],
      assignedTo: ASSIGNEE,
    });
    const current = selectContactViewerIds({
      candidates: [member(ASSIGNEE), member(BYSTANDER)],
      assignedTo: BYSTANDER,
    });

    expect(previous).toEqual([ASSIGNEE]);
    expect(current).toEqual([BYSTANDER]);
  });

  test("an empty company yields no recipients rather than a broadcast", () => {
    expect(
      selectContactViewerIds({ candidates: [], assignedTo: ASSIGNEE }),
    ).toEqual([]);
  });

  test("each recipient appears exactly once", () => {
    // An assignee who also holds can_view_all_chats satisfies both arms.
    const viewers = selectContactViewerIds({
      candidates: [member(ASSIGNEE, true)],
      assignedTo: ASSIGNEE,
    });
    expect(viewers).toEqual([ASSIGNEE]);
  });

  test("a stale assignment to a non-member adds nobody", () => {
    const viewers = selectContactViewerIds({
      candidates: [member(BYSTANDER)],
      assignedTo: "user-who-left-the-company",
    });
    expect(viewers).toEqual([]);
  });
});

/**
 * The resolver only ever sees the *current* assignment. An assignment change
 * therefore has to name the outgoing assignee explicitly, or their client
 * keeps showing a conversation it can no longer open.
 */
describe("assignment transitions reach both sides", () => {
  test("the outgoing assignee is included even though they no longer qualify", () => {
    expect(
      mergeFanOutRecipients([BYSTANDER], [ASSIGNEE, BYSTANDER]).sort(),
    ).toEqual([ASSIGNEE, BYSTANDER].sort());
  });

  test("a null previous assignee (first-ever claim) adds nobody", () => {
    expect(mergeFanOutRecipients([ASSIGNEE], [null, ASSIGNEE])).toEqual([
      ASSIGNEE,
    ]);
  });

  test("undefined entries are dropped rather than fanned out", () => {
    expect(mergeFanOutRecipients([], [undefined, null, ""])).toEqual([]);
  });

  test("explicit recipients never duplicate an existing viewer", () => {
    expect(mergeFanOutRecipients([OWNER, ASSIGNEE], [ASSIGNEE]).sort()).toEqual(
      [ASSIGNEE, OWNER].sort(),
    );
  });

  test("with no extra recipients the viewer set passes through unchanged", () => {
    expect(mergeFanOutRecipients([OWNER, ADMIN])).toEqual([OWNER, ADMIN]);
  });
});
