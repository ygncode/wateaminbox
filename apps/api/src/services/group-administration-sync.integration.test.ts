/**
 * Group synchronization tests.
 *
 * These cover the other half of the "no optimistic state" rule: group state
 * only ever arrives here, from WhatsApp, and a partial change notification must
 * not clobber the fields it did not mention.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import type { GroupEvent } from "../lib/nats/index.js";
import { handleGroupEvent } from "./handlers/group-handlers.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const GROUP_JID = "120363000000000123@g.us";
const OWN_JID = "15550000001@s.whatsapp.net";
const MEMBER_JID = "15550000002@s.whatsapp.net";

function groupEvent(
  companyId: string,
  connectionId: string,
  payload: GroupEvent["payload"],
): GroupEvent {
  return {
    contractVersion: 1,
    type: "group",
    companyId,
    connectionId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

async function withTenant(
  run: (ctx: {
    companyId: string;
    connectionId: string;
    sessionId: string;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const schema = getSchemaName(companyId);

  try {
    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Sync test",
        jid: OWN_JID,
        status: "connected",
      })
      .execute();
    // Commands address a session, which is what their `connection_id` holds.
    const session = await tenantDb
      .insertInto("whatsapp_connection_sessions")
      .values({
        whatsapp_connection_id: connectionId,
        status: "connected",
        started_at: new Date(),
        connected_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await run({ companyId, connectionId, sessionId: session.id });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
  }
}

async function readGroup(companyId: string) {
  const tenantDb = getTenantConnection(companyId);
  const group = await tenantDb
    .selectFrom("groups")
    .selectAll()
    .where("jid", "=", GROUP_JID)
    .executeTakeFirst();
  if (!group) return null;
  const participants = await tenantDb
    .selectFrom("group_participants")
    .select(["participant_jid", "is_admin"])
    .where("group_id", "=", group.id)
    .orderBy("participant_jid", "asc")
    .execute();
  return { group, participants };
}

describe("group synchronization from WhatsApp", () => {
  integrationTest(
    "a snapshot creates the conversation, members and permissions",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "created",
            jid: GROUP_JID,
            snapshot: {
              jid: GROUP_JID,
              name: "Launch team",
              description: "Ship it",
              ownerJid: OWN_JID,
              participants: [
                { jid: OWN_JID, isAdmin: true },
                // Same member twice, once with a device suffix: WhatsApp does
                // this, and it must not produce two participant rows.
                {
                  jid: `${MEMBER_JID.split("@")[0]}:9@s.whatsapp.net`,
                  isAdmin: false,
                },
                { jid: MEMBER_JID, isAdmin: false },
              ],
              participantCount: 2,
              isAnnounce: true,
              isLocked: false,
              isJoinApprovalRequired: true,
              memberAddMode: "admin_add",
              isMember: true,
            },
          }),
        );

        const stored = await readGroup(companyId);
        expect(stored).not.toBeNull();
        expect(stored?.group.name).toBe("Launch team");
        expect(stored?.group.description).toBe("Ship it");
        expect(stored?.group.is_announce).toBe(true);
        expect(stored?.group.is_join_approval_required).toBe(true);
        expect(stored?.group.member_add_mode).toBe("admin_add");
        expect(stored?.group.metadata_synced_at).not.toBeNull();
        expect(stored?.participants).toEqual([
          { participant_jid: OWN_JID, is_admin: true },
          { participant_jid: MEMBER_JID, is_admin: false },
        ]);

        // The conversation itself has to exist so the group shows up in the
        // inbox rather than only in the groups table.
        const contact = await getTenantConnection(companyId)
          .selectFrom("contacts")
          .select(["is_group", "push_name"])
          .where("jid", "=", GROUP_JID)
          .executeTakeFirst();
        expect(contact?.is_group).toBe(true);
        expect(contact?.push_name).toBe("Launch team");
      });
    },
  );

  integrationTest(
    "a partial change leaves unmentioned settings alone",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: {
              jid: GROUP_JID,
              name: "Launch team",
              isAnnounce: true,
              isLocked: true,
              participants: [{ jid: OWN_JID, isAdmin: true }],
            },
          }),
        );

        // A rename notification mentions only the name.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: { jid: GROUP_JID, name: "Renamed" },
          }),
        );

        const stored = await readGroup(companyId);
        expect(stored?.group.name).toBe("Renamed");
        // Neither permission was in the second event, so neither may reset.
        expect(stored?.group.is_announce).toBe(true);
        expect(stored?.group.is_locked).toBe(true);
        // Nor may the member list be emptied by an event that omitted it.
        expect(stored?.participants).toHaveLength(1);
      });
    },
  );

  integrationTest(
    "leaving marks the membership ended without deleting anything",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: {
              jid: GROUP_JID,
              name: "Launch team",
              participants: [
                { jid: OWN_JID, isAdmin: true },
                { jid: MEMBER_JID, isAdmin: false },
              ],
            },
          }),
        );
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "invite_link",
            jid: GROUP_JID,
            inviteLink: "https://chat.whatsapp.com/CODE",
          }),
        );

        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "left",
            jid: GROUP_JID,
          }),
        );

        const stored = await readGroup(companyId);
        // The group and its history survive: WhatsApp cannot delete a group,
        // and the conversation stays as a record.
        expect(stored).not.toBeNull();
        expect(stored?.group.is_member).toBe(false);
        expect(stored?.participants).toHaveLength(2);
        // A link this account can no longer manage must not stay on offer.
        expect(stored?.group.invite_link).toBeNull();
      });
    },
  );

  integrationTest(
    "join requests replace the cached set instead of accumulating",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: { jid: GROUP_JID, name: "Launch team" },
          }),
        );

        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "join_requests",
            jid: GROUP_JID,
            joinRequests: [
              { jid: MEMBER_JID, requestedAt: "2026-01-01T00:00:00Z" },
              { jid: "15550000009@s.whatsapp.net" },
            ],
          }),
        );

        // One was approved elsewhere, so the next fetch returns only the other.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "join_requests",
            jid: GROUP_JID,
            joinRequests: [{ jid: MEMBER_JID }],
          }),
        );

        const requests = await getTenantConnection(companyId)
          .selectFrom("group_join_requests")
          .select(["requester_jid"])
          .execute();
        expect(requests.map((request) => request.requester_jid)).toEqual([
          MEMBER_JID,
        ]);
      });
    },
  );

  integrationTest(
    "a result for an unknown group is ignored rather than creating one",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        // Invite links and join requests only make sense for a group the
        // workspace already knows; inventing one from a stray event would
        // create a conversation nobody is in.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "invite_link",
            jid: GROUP_JID,
            inviteLink: "https://chat.whatsapp.com/CODE",
          }),
        );
        expect(await readGroup(companyId)).toBeNull();
      });
    },
  );
});

describe("group synchronization - repeated and concurrent events", () => {
  integrationTest(
    "re-syncing preserves when each member joined and only flips what changed",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: {
              jid: GROUP_JID,
              name: "Launch team",
              participants: [
                { jid: OWN_JID, isAdmin: true },
                { jid: MEMBER_JID, isAdmin: false },
              ],
            },
          }),
        );
        const first = await readGroup(companyId);
        const joinedAt = new Map(
          (
            await getTenantConnection(companyId)
              .selectFrom("group_participants")
              .select(["participant_jid", "joined_at"])
              .where("group_id", "=", first?.group.id ?? "")
              .execute()
          ).map((row) => [row.participant_jid, row.joined_at.toISOString()]),
        );

        // A later snapshot promotes one member and adds another.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: {
              jid: GROUP_JID,
              participants: [
                { jid: OWN_JID, isAdmin: true },
                { jid: MEMBER_JID, isAdmin: true },
                { jid: "15550000007@s.whatsapp.net", isAdmin: false },
              ],
            },
          }),
        );

        const after = await getTenantConnection(companyId)
          .selectFrom("group_participants")
          .select(["participant_jid", "is_admin", "joined_at"])
          .where("group_id", "=", first?.group.id ?? "")
          .orderBy("participant_jid", "asc")
          .execute();

        expect(after.map((row) => row.participant_jid)).toEqual([
          OWN_JID,
          MEMBER_JID,
          "15550000007@s.whatsapp.net",
        ]);
        expect(after.map((row) => row.is_admin)).toEqual([true, true, false]);
        // The two original members kept their original joined_at; only the new
        // member has a fresh one. Rewriting every row on every sync would turn
        // "joined at" into "last synced at".
        for (const row of after) {
          const original = joinedAt.get(row.participant_jid);
          if (original) {
            expect(row.joined_at.toISOString()).toBe(original);
          }
        }
      });
    },
  );

  integrationTest(
    "a member reported twice by WhatsApp becomes one row, keeping admin rights",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: {
              jid: GROUP_JID,
              name: "Launch team",
              participants: [
                // Same member three ways: bare, device-suffixed, upper-cased.
                { jid: MEMBER_JID, isAdmin: false },
                { jid: "15550000002:12@s.whatsapp.net", isAdmin: true },
                { jid: MEMBER_JID.toUpperCase(), isAdmin: false },
              ],
            },
          }),
        );

        const stored = await readGroup(companyId);
        expect(stored?.participants).toEqual([
          { participant_jid: MEMBER_JID, is_admin: true },
        ]);
      });
    },
  );

  integrationTest(
    "concurrent first-sight snapshots create exactly one conversation",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        // Creating a group produces the command's own `created` event AND
        // WhatsApp's JoinedGroup snapshot; both can land at once.
        const snapshot = {
          jid: GROUP_JID,
          name: "Launch team",
          participants: [{ jid: OWN_JID, isAdmin: true }],
        };
        await Promise.all([
          handleGroupEvent(
            groupEvent(companyId, connectionId, {
              action: "created",
              jid: GROUP_JID,
              snapshot,
            }),
          ),
          handleGroupEvent(
            groupEvent(companyId, connectionId, {
              action: "snapshot",
              jid: GROUP_JID,
              snapshot,
            }),
          ),
        ]);

        const contacts = await getTenantConnection(companyId)
          .selectFrom("contacts")
          .select(["id"])
          .where("jid", "=", GROUP_JID)
          .execute();
        const groups = await getTenantConnection(companyId)
          .selectFrom("groups")
          .select(["id"])
          .where("jid", "=", GROUP_JID)
          .execute();
        expect(contacts).toHaveLength(1);
        expect(groups).toHaveLength(1);

        const stored = await readGroup(companyId);
        expect(stored?.participants).toEqual([
          { participant_jid: OWN_JID, is_admin: true },
        ]);
      });
    },
  );

  integrationTest(
    "an event naming a connection this workspace does not own is ignored",
    async () => {
      await withTenant(async ({ companyId }) => {
        await handleGroupEvent(
          groupEvent(companyId, crypto.randomUUID(), {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: { jid: GROUP_JID, name: "Planted" },
          }),
        );
        expect(await readGroup(companyId)).toBeNull();
      });
    },
  );
});

describe("group synchronization - address forms and fetch bookkeeping", () => {
  integrationTest(
    "a LID-addressed member is stored under one identity, not two",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        // The worker resolves LID -> phone before publishing, so the API only
        // ever sees one form. This pins that the API does not reintroduce the
        // split by treating the two as different people.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: {
              jid: GROUP_JID,
              name: "Launch team",
              participants: [
                { jid: OWN_JID, isAdmin: true },
                { jid: MEMBER_JID, isAdmin: false },
              ],
            },
          }),
        );

        // A later snapshot reports a member WhatsApp only knows by LID.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: {
              jid: GROUP_JID,
              participants: [
                { jid: OWN_JID, isAdmin: true },
                { jid: MEMBER_JID, isAdmin: false },
                { jid: "88888888888@lid", isAdmin: false },
              ],
            },
          }),
        );

        const stored = await readGroup(companyId);
        // Ordered by JID, which is how readGroup sorts.
        expect(stored?.participants).toEqual([
          { participant_jid: OWN_JID, is_admin: true },
          { participant_jid: MEMBER_JID, is_admin: false },
          { participant_jid: "88888888888@lid", is_admin: false },
        ]);
        // The account's own row keeps its phone address, which is what the
        // admin check resolves against.
        expect(
          stored?.participants.find((p) => p.participant_jid === OWN_JID)
            ?.is_admin,
        ).toBe(true);
      });
    },
  );

  integrationTest(
    "a fetch that finds nobody waiting is recorded as a fetch",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: { jid: GROUP_JID, name: "Launch team" },
          }),
        );
        const before = await readGroup(companyId);
        expect(before?.group.join_requests_synced_at).toBeNull();

        // WhatsApp answered: nobody is pending. That deletes every row, so the
        // timestamp cannot live on the rows.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "join_requests",
            jid: GROUP_JID,
            joinRequests: [],
          }),
        );

        const after = await readGroup(companyId);
        expect(after?.group.join_requests_synced_at).not.toBeNull();

        const rows = await getTenantConnection(companyId)
          .selectFrom("group_join_requests")
          .select(["requester_jid"])
          .execute();
        expect(rows).toEqual([]);
      });
    },
  );

  integrationTest(
    "leaving clears the join-request fetch marker along with the link",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: { jid: GROUP_JID, name: "Launch team" },
          }),
        );
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "join_requests",
            jid: GROUP_JID,
            joinRequests: [{ jid: MEMBER_JID }],
          }),
        );
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "left",
            jid: GROUP_JID,
          }),
        );

        const stored = await readGroup(companyId);
        expect(stored?.group.is_member).toBe(false);
        expect(stored?.group.join_requests_synced_at).toBeNull();
      });
    },
  );
});

describe("group synchronization - connection lifecycle fence", () => {
  const ANOTHER_GROUP_JID = "120363000000000999@g.us";

  /** Fires one of every group event variant, in the order a real account emits. */
  async function fireEveryVariant(
    companyId: string,
    connectionId: string,
  ): Promise<void> {
    await handleGroupEvent(
      groupEvent(companyId, connectionId, {
        action: "snapshot",
        jid: GROUP_JID,
        snapshot: {
          jid: GROUP_JID,
          name: "Renamed after archive",
          participants: [{ jid: "15550000008@s.whatsapp.net", isAdmin: true }],
        },
      }),
    );
    await handleGroupEvent(
      groupEvent(companyId, connectionId, {
        action: "created",
        jid: ANOTHER_GROUP_JID,
        snapshot: { jid: ANOTHER_GROUP_JID, name: "Created after archive" },
      }),
    );
    await handleGroupEvent(
      groupEvent(companyId, connectionId, {
        action: "invite_link",
        jid: GROUP_JID,
        inviteLink: "https://chat.whatsapp.com/AFTER",
      }),
    );
    await handleGroupEvent(
      groupEvent(companyId, connectionId, {
        action: "join_requests",
        jid: GROUP_JID,
        joinRequests: [{ jid: "15550000008@s.whatsapp.net" }],
      }),
    );
    // Last: it is the only variant that would still "succeed" by mutating a
    // group the earlier events failed to change.
    await handleGroupEvent(
      groupEvent(companyId, connectionId, {
        action: "left",
        jid: GROUP_JID,
      }),
    );
  }

  /** The group state every variant above tries, and must fail, to change. */
  async function seedLiveGroup(
    companyId: string,
    connectionId: string,
  ): Promise<void> {
    await handleGroupEvent(
      groupEvent(companyId, connectionId, {
        action: "snapshot",
        jid: GROUP_JID,
        snapshot: {
          jid: GROUP_JID,
          name: "Launch team",
          participants: [{ jid: OWN_JID, isAdmin: true }],
          isMember: true,
        },
      }),
    );
    await handleGroupEvent(
      groupEvent(companyId, connectionId, {
        action: "invite_link",
        jid: GROUP_JID,
        inviteLink: "https://chat.whatsapp.com/BEFORE",
      }),
    );
    await handleGroupEvent(
      groupEvent(companyId, connectionId, {
        action: "join_requests",
        jid: GROUP_JID,
        joinRequests: [{ jid: MEMBER_JID }],
      }),
    );
  }

  integrationTest(
    "every group event variant is ignored once the connection is archived",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        const tenantDb = getTenantConnection(companyId);
        await seedLiveGroup(companyId, connectionId);
        const before = await readGroup(companyId);

        await tenantDb
          .updateTable("whatsapp_connections")
          .set({
            status: "disconnected",
            archived_at: new Date("2026-03-01T10:00:00Z"),
          })
          .where("id", "=", connectionId)
          .execute();

        await fireEveryVariant(companyId, connectionId);

        // Nothing the archived connection reported may land: an archived
        // connection is queued for permanent deletion, so a row written now is
        // a row the purge has already accounted for and would orphan.
        const after = await readGroup(companyId);
        expect(after?.group.name).toBe("Launch team");
        expect(after?.group.is_member).toBe(true);
        expect(after?.group.invite_link).toBe(
          "https://chat.whatsapp.com/BEFORE",
        );
        expect(after?.participants).toEqual(before?.participants ?? []);

        const requests = await tenantDb
          .selectFrom("group_join_requests")
          .select(["requester_jid"])
          .execute();
        expect(requests.map((request) => request.requester_jid)).toEqual([
          MEMBER_JID,
        ]);

        // Nor may a snapshot create a conversation for a group first seen
        // after the archive.
        const created = await tenantDb
          .selectFrom("contacts")
          .select(["id"])
          .where("jid", "=", ANOTHER_GROUP_JID)
          .execute();
        expect(created).toEqual([]);
      });
    },
  );

  integrationTest(
    "a group event that loses the race to archive writes nothing",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        const tenantDb = getTenantConnection(companyId);
        await seedLiveGroup(companyId, connectionId);

        // Archive takes FOR UPDATE on the connection row; the event's fence
        // takes FOR KEY SHARE on the same row, so the event blocks here rather
        // than reading a pre-archive snapshot and committing behind it.
        let archiveHolding!: () => void;
        const holding = new Promise<void>((resolve) => {
          archiveHolding = resolve;
        });
        let releaseArchive!: () => void;
        const release = new Promise<void>((resolve) => {
          releaseArchive = resolve;
        });
        const archive = tenantDb.transaction().execute(async (trx) => {
          await trx
            .selectFrom("whatsapp_connections")
            .select("id")
            .where("id", "=", connectionId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          archiveHolding();
          await release;
          await trx
            .updateTable("whatsapp_connections")
            .set({
              status: "disconnected",
              archived_at: new Date("2026-03-01T11:00:00Z"),
            })
            .where("id", "=", connectionId)
            .execute();
        });
        await holding;

        const event = handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "created",
            jid: ANOTHER_GROUP_JID,
            snapshot: { jid: ANOTHER_GROUP_JID, name: "Raced the archive" },
          }),
        );
        releaseArchive();
        await Promise.all([archive, event]);

        // The event re-read the row after archive committed and failed closed,
        // so no conversation, group or participant row exists for it.
        expect(
          await tenantDb
            .selectFrom("contacts")
            .select("id")
            .where("jid", "=", ANOTHER_GROUP_JID)
            .execute(),
        ).toEqual([]);
        expect(
          await tenantDb
            .selectFrom("groups")
            .select("id")
            .where("jid", "=", ANOTHER_GROUP_JID)
            .execute(),
        ).toEqual([]);
      });
    },
    30_000,
  );
});

describe("group synchronization - created group ownership", () => {
  integrationTest(
    "a created group is assigned to whoever asked for it",
    async () => {
      await withTenant(async ({ companyId, connectionId, sessionId }) => {
        const tenantDb = getTenantConnection(companyId);
        const userId = crypto.randomUUID();
        const commandId = crypto.randomUUID();

        // The create command records who asked; the assignment is what makes
        // the group visible to a creator without `can_view_all_chats`.
        await tenantDb
          .insertInto("nats_outbox")
          .values({
            id: commandId,
            subject: "WHATSAPP.commands.test",
            payload: {
              type: "group_create",
              connection_id: sessionId,
              user_id: userId,
              command_id: commandId,
            },
            status: "published",
          })
          .execute();

        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "created",
            jid: GROUP_JID,
            commandId,
            snapshot: {
              jid: GROUP_JID,
              name: "Launch team",
              participants: [{ jid: OWN_JID, isAdmin: true }],
            },
          }),
        );

        const stored = await readGroup(companyId);
        const assignment = await tenantDb
          .selectFrom("contact_assignments")
          .select(["assigned_to", "unassigned_at"])
          .where("contact_id", "=", stored?.group.contact_id ?? "")
          .execute();
        expect(assignment).toEqual([
          { assigned_to: userId, unassigned_at: null },
        ]);
      });
    },
  );

  integrationTest(
    "an ordinary snapshot never claims a group for anybody",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot: { jid: GROUP_JID, name: "Launch team" },
          }),
        );

        const stored = await readGroup(companyId);
        const assignment = await getTenantConnection(companyId)
          .selectFrom("contact_assignments")
          .select(["assigned_to"])
          .where("contact_id", "=", stored?.group.contact_id ?? "")
          .execute();
        expect(assignment).toEqual([]);
      });
    },
  );
});

describe("group synchronization - creator assignment is correlated, not assumed", () => {
  /** Records a create command so the handler has something to correlate to. */
  async function recordCreateCommand(
    companyId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const commandId = crypto.randomUUID();
    await getTenantConnection(companyId)
      .insertInto("nats_outbox")
      .values({
        id: commandId,
        subject: "WHATSAPP.commands.test",
        payload: { command_id: commandId, ...payload },
        status: "published",
      })
      .execute();
    return commandId;
  }

  async function assigneesFor(companyId: string): Promise<string[]> {
    const stored = await readGroup(companyId);
    const rows = await getTenantConnection(companyId)
      .selectFrom("contact_assignments")
      .select(["assigned_to"])
      .where("contact_id", "=", stored?.group.contact_id ?? "")
      .where("unassigned_at", "is", null)
      .execute();
    return rows.map((row) => row.assigned_to);
  }

  const snapshot = {
    jid: GROUP_JID,
    name: "Launch team",
    participants: [{ jid: OWN_JID, isAdmin: true }],
  };

  integrationTest(
    "a group already assigned to someone is never taken from them",
    async () => {
      await withTenant(async ({ companyId, connectionId, sessionId }) => {
        const existingAssignee = crypto.randomUUID();
        const creator = crypto.randomUUID();

        // The group exists and is already someone's before the create event
        // lands - a duplicate or replayed event must not reassign it.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "snapshot",
            jid: GROUP_JID,
            snapshot,
          }),
        );
        const stored = await readGroup(companyId);
        await getTenantConnection(companyId)
          .insertInto("contact_assignments")
          .values({
            contact_id: stored?.group.contact_id ?? "",
            assigned_to: existingAssignee,
            assigned_by: existingAssignee,
          })
          .execute();

        const commandId = await recordCreateCommand(companyId, {
          type: "group_create",
          connection_id: sessionId,
          user_id: creator,
        });
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "created",
            jid: GROUP_JID,
            commandId,
            snapshot,
          }),
        );

        expect(await assigneesFor(companyId)).toEqual([existingAssignee]);
      });
    },
  );

  integrationTest(
    "a create event naming an unrelated command assigns nobody",
    async () => {
      await withTenant(async ({ companyId, connectionId, sessionId }) => {
        // A real outbox row, but for a different command entirely. Trusting the
        // id alone would hand the new group to that row's user.
        const commandId = await recordCreateCommand(companyId, {
          type: "send",
          connection_id: sessionId,
          user_id: crypto.randomUUID(),
        });

        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "created",
            jid: GROUP_JID,
            commandId,
            snapshot,
          }),
        );

        expect(await assigneesFor(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "a create command belonging to another connection assigns nobody",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        const commandId = await recordCreateCommand(companyId, {
          type: "group_create",
          connection_id: crypto.randomUUID(),
          user_id: crypto.randomUUID(),
        });

        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "created",
            jid: GROUP_JID,
            commandId,
            snapshot,
          }),
        );

        expect(await assigneesFor(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "a create event whose command has vanished still creates the group",
    async () => {
      await withTenant(async ({ companyId, connectionId }) => {
        // The outbox row may have been pruned. The group is still real and must
        // still be recorded; only the assignment is skipped.
        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "created",
            jid: GROUP_JID,
            commandId: crypto.randomUUID(),
            snapshot,
          }),
        );

        const stored = await readGroup(companyId);
        expect(stored?.group.name).toBe("Launch team");
        expect(await assigneesFor(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "a create command without a user id assigns nobody",
    async () => {
      await withTenant(async ({ companyId, connectionId, sessionId }) => {
        const commandId = await recordCreateCommand(companyId, {
          type: "group_create",
          connection_id: sessionId,
        });

        await handleGroupEvent(
          groupEvent(companyId, connectionId, {
            action: "created",
            jid: GROUP_JID,
            commandId,
            snapshot,
          }),
        );

        const stored = await readGroup(companyId);
        expect(stored?.group.name).toBe("Launch team");
        expect(await assigneesFor(companyId)).toEqual([]);
      });
    },
  );
});
