/**
 * Group administration route tests.
 *
 * The invariant these exist to protect is that a group administration request
 * changes NOTHING locally: it enqueues one command and returns. Every mutating
 * test therefore asserts both halves - a command was queued, and the group's
 * stored state is byte-for-byte what it was before.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { sql } from "kysely";
import { app } from "../../app.js";
import { hashPassword } from "../../lib/password.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";
const OWN_JID = "15550000001@s.whatsapp.net";
const MEMBER_JID = "15550000002@s.whatsapp.net";
const OUTSIDER_JID = "15550000003@s.whatsapp.net";

async function loginAndGetHeaders(
  email: string,
  password: string,
  companyId: string,
) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
    "content-type": "application/json",
  };
}

interface TenantContext {
  companyId: string;
  ownerHeaders: Record<string, string>;
  ownerId: string;
  createMember: (
    permissions?: Record<string, boolean>,
  ) => Promise<{ headers: Record<string, string>; userId: string }>;
}

async function withTenantAndUsers(
  run: (ctx: TenantContext) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const ownerEmail = `owner-${ownerId}@example.com`;
  const memberIds: string[] = [];

  try {
    await db
      .insertInto("users")
      .values({
        id: ownerId,
        email: ownerEmail,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Group administration test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: ownerId, role: "owner" })
      .execute();
    await db
      .insertInto("sla_policies")
      .values({
        company_id: companyId,
        target_minutes: 60,
        direct_resolution_target_minutes: 480,
        group_response_target_minutes: 120,
        group_resolution_target_minutes: 960,
        timezone: "UTC",
        weekly_schedule: JSON.stringify(DEFAULT_SLA_WEEKLY_SCHEDULE),
        exceptions: JSON.stringify([]),
        effective_from: new Date("1970-01-01T00:00:00Z"),
        created_by: ownerId,
      })
      .execute();
    await createTenantSchema(companyId);

    const ownerHeaders = await loginAndGetHeaders(
      ownerEmail,
      PASSWORD,
      companyId,
    );

    const createMember = async (permissions?: Record<string, boolean>) => {
      const memberId = crypto.randomUUID();
      const memberEmail = `member-${memberId}@example.com`;
      memberIds.push(memberId);
      await db
        .insertInto("users")
        .values({
          id: memberId,
          email: memberEmail,
          password_hash: await hashPassword(PASSWORD),
          email_verified_at: new Date(),
        })
        .execute();
      await db
        .insertInto("company_members")
        .values({
          company_id: companyId,
          user_id: memberId,
          role: "member",
          ...(permissions ? { permissions } : {}),
        })
        .execute();
      const headers = await loginAndGetHeaders(
        memberEmail,
        PASSWORD,
        companyId,
      );
      return { headers, userId: memberId };
    };

    await run({ companyId, ownerHeaders, ownerId, createMember });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("sla_policies")
      .where("company_id", "=", companyId)
      .execute();
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db.deleteFrom("users").where("id", "=", ownerId).execute();
    for (const memberId of memberIds) {
      await db.deleteFrom("users").where("id", "=", memberId).execute();
    }
  }
}

let groupSequence = 0;

interface GroupFixtureOptions {
  /** Whether the connected account holds admin rights in the group. */
  selfIsAdmin?: boolean;
  connectionStatus?: "connected" | "disconnected";
  isMember?: boolean;
}

async function setupGroup(
  companyId: string,
  options: GroupFixtureOptions = {},
) {
  const {
    selfIsAdmin = true,
    connectionStatus = "connected",
    isMember = true,
  } = options;
  const tenantDb = getTenantConnection(companyId);
  const connectionId = crypto.randomUUID();

  // Unique per fixture so a test can hold two groups at once; a workspace
  // enforces one connection per phone number.
  groupSequence += 1;
  const sequence = groupSequence;

  await tenantDb
    .insertInto("whatsapp_connections")
    .values({
      id: connectionId,
      name: "Group test connection",
      phone_number: `1555${String(sequence).padStart(7, "0")}`,
      jid: OWN_JID,
      status: connectionStatus,
    })
    .execute();
  await tenantDb
    .insertInto("whatsapp_connection_sessions")
    .values({
      whatsapp_connection_id: connectionId,
      status: connectionStatus,
      started_at: new Date(),
      connected_at: new Date(),
    })
    .execute();

  // Unique per group so a test never matches another test's fixture, without
  // depending on randomness for that guarantee.
  const groupJid = `12036300000000${String(sequence).padStart(4, "0")}@g.us`;
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      whatsapp_connection_id: connectionId,
      jid: groupJid,
      push_name: "Ops group",
      is_group: true,
    })
    .returning("id")
    .execute();

  const group = await tenantDb
    .insertInto("groups")
    .values({
      contact_id: contact.id,
      jid: groupJid,
      name: "Ops group",
      description: "Original description",
      participant_count: 2,
      is_member: isMember,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await tenantDb
    .insertInto("group_participants")
    .values([
      { group_id: group.id, participant_jid: OWN_JID, is_admin: selfIsAdmin },
      { group_id: group.id, participant_jid: MEMBER_JID, is_admin: false },
    ])
    .execute();

  return { connectionId, contactId: contact.id, groupId: group.id, groupJid };
}

/** Commands the routes queued, newest last. */
async function queuedCommands(companyId: string) {
  const rows = await getTenantConnection(companyId)
    .selectFrom("nats_outbox")
    .select(["subject", "payload"])
    .orderBy("created_at", "asc")
    .execute();
  return rows.map((row) => row.payload as Record<string, unknown>);
}

/** The stored group state that must not move until WhatsApp confirms. */
async function groupState(companyId: string, groupId: string) {
  const tenantDb = getTenantConnection(companyId);
  const [group, participants] = await Promise.all([
    tenantDb
      .selectFrom("groups")
      .selectAll()
      .where("id", "=", groupId)
      .executeTakeFirstOrThrow(),
    tenantDb
      .selectFrom("group_participants")
      .select(["participant_jid", "is_admin"])
      .where("group_id", "=", groupId)
      .orderBy("participant_jid", "asc")
      .execute(),
  ]);
  return { group, participants };
}

describe("group administration - success paths", () => {
  integrationTest(
    "every member action queues one command and changes nothing locally",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId, groupId, groupJid } = await setupGroup(companyId);
        const before = await groupState(companyId, groupId);

        const calls: Array<[string, string, unknown]> = [
          [
            "POST",
            `/api/groups/${contactId}/participants`,
            { participantJids: [OUTSIDER_JID] },
          ],
          [
            "POST",
            `/api/groups/${contactId}/participants/promote`,
            { participantJids: [MEMBER_JID] },
          ],
          [
            "POST",
            `/api/groups/${contactId}/participants/remove`,
            { participantJids: [MEMBER_JID] },
          ],
        ];

        for (const [method, path, body] of calls) {
          const response = await app.request(path, {
            method,
            headers: ownerHeaders,
            body: JSON.stringify(body),
          });
          expect(await response.json()).toMatchObject({ pending: true });
          expect(response.status).toBe(200);
        }

        const commands = await queuedCommands(companyId);
        expect(commands.map((command) => command.type)).toEqual([
          "group_add_participants",
          "group_promote_admin",
          "group_remove_participants",
        ]);
        for (const command of commands) {
          expect(command.group_jid).toBe(groupJid);
        }

        // The whole point: WhatsApp has not answered yet, so nothing moved.
        expect(await groupState(companyId, groupId)).toEqual(before);
      });
    },
  );

  integrationTest(
    "updating settings queues the permission flags and leaves the group untouched",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId, groupId } = await setupGroup(companyId);
        const before = await groupState(companyId, groupId);

        const response = await app.request(
          `/api/groups/${contactId}/settings`,
          {
            method: "PATCH",
            headers: ownerHeaders,
            body: JSON.stringify({
              name: "Renamed ops",
              isAnnounce: true,
              memberAddMode: "admin_add",
            }),
          },
        );
        expect(response.status).toBe(200);

        const [command] = await queuedCommands(companyId);
        expect(command).toMatchObject({
          type: "group_update_settings",
          name: "Renamed ops",
          is_announce: true,
          member_add_mode: "admin_add",
        });
        // An omitted setting must not be sent as a value.
        expect(command).not.toHaveProperty("is_locked");

        expect(await groupState(companyId, groupId)).toEqual(before);
      });
    },
  );

  integrationTest(
    "leaving queues a leave command and never deletes the group",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId, groupId, groupJid } = await setupGroup(companyId);

        const response = await app.request(`/api/groups/${contactId}/leave`, {
          method: "POST",
          headers: ownerHeaders,
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { semantics: string };
        expect(body.semantics).toContain("no delete or disband");

        const [command] = await queuedCommands(companyId);
        expect(command).toMatchObject({
          type: "group_leave",
          group_jid: groupJid,
        });

        // Leaving is a membership change WhatsApp has yet to confirm; the row
        // must still be present and still marked as a member.
        const { group } = await groupState(companyId, groupId);
        expect(group.is_member).toBe(true);
      });
    },
  );

  integrationTest(
    "creating a group queues the command without inserting a conversation",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { connectionId } = await setupGroup(companyId);
        const tenantDb = getTenantConnection(companyId);
        const groupsBefore = await tenantDb
          .selectFrom("groups")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow();

        const response = await app.request("/api/groups", {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify({
            connectionId,
            name: "Launch team",
            participantJids: [OUTSIDER_JID],
          }),
        });
        expect(response.status).toBe(200);

        const [command] = await queuedCommands(companyId);
        expect(command).toMatchObject({
          type: "group_create",
          name: "Launch team",
          participant_jids: [OUTSIDER_JID],
        });

        const groupsAfter = await tenantDb
          .selectFrom("groups")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow();
        expect(Number(groupsAfter.count)).toBe(Number(groupsBefore.count));
      });
    },
  );

  integrationTest("invite links are requested, never invented", async () => {
    await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
      const { contactId, groupId } = await setupGroup(companyId);

      const response = await app.request(
        `/api/groups/${contactId}/invite-link`,
        {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify({ reset: true }),
        },
      );
      expect(response.status).toBe(200);

      const [command] = await queuedCommands(companyId);
      expect(command).toMatchObject({
        type: "group_invite_link",
        reset: true,
      });

      const { group } = await groupState(companyId, groupId);
      expect(group.invite_link).toBeNull();
    });
  });
});

describe("group administration - validation", () => {
  integrationTest(
    "rejects a group name longer than WhatsApp allows",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { connectionId } = await setupGroup(companyId);
        const response = await app.request("/api/groups", {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify({
            connectionId,
            name: "x".repeat(26),
            participantJids: [OUTSIDER_JID],
          }),
        });
        expect(response.status).toBe(400);
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest("rejects a group JID as a participant", async () => {
    await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
      const { contactId } = await setupGroup(companyId);
      const response = await app.request(
        `/api/groups/${contactId}/participants`,
        {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify({
            participantJids: ["120363000000000000@g.us"],
          }),
        },
      );
      expect(response.status).toBe(400);
      expect(await queuedCommands(companyId)).toEqual([]);
    });
  });

  integrationTest("rejects an empty settings update", async () => {
    await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
      const { contactId } = await setupGroup(companyId);
      const response = await app.request(`/api/groups/${contactId}/settings`, {
        method: "PATCH",
        headers: ownerHeaders,
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      expect(await queuedCommands(companyId)).toEqual([]);
    });
  });

  integrationTest(
    "normalizes device-suffixed participant JIDs before matching membership",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId);
        // `15550000002:7@s.whatsapp.net` is the SAME member; without
        // normalization this would be rejected as "not in the group".
        const response = await app.request(
          `/api/groups/${contactId}/participants/promote`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({
              participantJids: ["15550000002:7@s.whatsapp.net"],
            }),
          },
        );
        expect(response.status).toBe(200);
        const [command] = await queuedCommands(companyId);
        expect(command.participant_jids).toEqual([MEMBER_JID]);
      });
    },
  );

  integrationTest(
    "refuses to act on this account's own membership",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId);
        const response = await app.request(
          `/api/groups/${contactId}/participants/remove`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ participantJids: [OWN_JID] }),
          },
        );
        expect(response.status).toBe(400);
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "refuses to promote someone who is not a member",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId);
        const response = await app.request(
          `/api/groups/${contactId}/participants/promote`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ participantJids: [OUTSIDER_JID] }),
          },
        );
        expect(response.status).toBe(409);
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );
});

describe("group administration - authorization", () => {
  integrationTest("requires authentication", async () => {
    await withTenantAndUsers(async ({ companyId }) => {
      const { contactId } = await setupGroup(companyId);
      const response = await app.request(`/api/groups/${contactId}/leave`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(401);
      expect(await queuedCommands(companyId)).toEqual([]);
    });
  });

  integrationTest(
    "refuses every WhatsApp-facing action when the account is not a group admin",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId, {
          selfIsAdmin: false,
        });

        for (const [path, body] of [
          [
            `/api/groups/${contactId}/participants`,
            { participantJids: [OUTSIDER_JID] },
          ],
          [
            `/api/groups/${contactId}/participants/promote`,
            { participantJids: [MEMBER_JID] },
          ],
          [`/api/groups/${contactId}/invite-link`, { reset: false }],
        ] as const) {
          const response = await app.request(path, {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(403);
        }

        const settings = await app.request(
          `/api/groups/${contactId}/settings`,
          {
            method: "PATCH",
            headers: ownerHeaders,
            body: JSON.stringify({ name: "Nope" }),
          },
        );
        expect(settings.status).toBe(403);

        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest("a non-admin member may still leave the group", async () => {
    await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
      const { contactId } = await setupGroup(companyId, {
        selfIsAdmin: false,
      });
      const response = await app.request(`/api/groups/${contactId}/leave`, {
        method: "POST",
        headers: ownerHeaders,
      });
      expect(response.status).toBe(200);
    });
  });

  integrationTest("denies a member without can_send_messages", async () => {
    await withTenantAndUsers(async ({ companyId, createMember }) => {
      const { contactId } = await setupGroup(companyId);
      const { headers } = await createMember({
        can_view_all_chats: true,
        can_send_messages: false,
      });

      const response = await app.request(`/api/groups/${contactId}/leave`, {
        method: "POST",
        headers,
      });
      expect(response.status).toBe(403);
      expect(await queuedCommands(companyId)).toEqual([]);
    });
  });

  integrationTest(
    "hides a group the member cannot see rather than admitting it exists",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember }) => {
        const { contactId } = await setupGroup(companyId);
        const { headers } = await createMember({
          can_view_all_chats: false,
          can_send_messages: true,
        });

        const response = await app.request(`/api/groups/${contactId}`, {
          headers,
        });
        expect(response.status).toBe(404);
      });
    },
  );
});

describe("group administration - tenant and connection isolation", () => {
  integrationTest(
    "a group id from another workspace is not found",
    async () => {
      await withTenantAndUsers(async (first) => {
        const { contactId } = await setupGroup(first.companyId);
        await withTenantAndUsers(async (second) => {
          // Same id, different tenant schema: it must not resolve.
          const response = await app.request(`/api/groups/${contactId}`, {
            headers: second.ownerHeaders,
          });
          expect(response.status).toBe(404);
          expect(await queuedCommands(second.companyId)).toEqual([]);
        });
      });
    },
  );

  integrationTest(
    "admin rights are read from the group's own connection, not any connected one",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        // The group's account is only a member. A second, unrelated connection
        // is online and shares the group's own JID - if admin status were
        // resolved by "whichever connection is connected", this would wrongly
        // authorize the action.
        const { contactId } = await setupGroup(companyId, {
          selfIsAdmin: false,
        });
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .insertInto("whatsapp_connections")
          .values({
            id: crypto.randomUUID(),
            name: "Unrelated account",
            phone_number: "15559999999",
            jid: "15559999999@s.whatsapp.net",
            status: "connected",
          })
          .execute();

        const response = await app.request(
          `/api/groups/${contactId}/participants/promote`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ participantJids: [MEMBER_JID] }),
          },
        );
        expect(response.status).toBe(403);
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "refuses to queue a command for an offline connection",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId, {
          connectionStatus: "disconnected",
        });

        const response = await app.request(
          `/api/groups/${contactId}/participants/promote`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ participantJids: [MEMBER_JID] }),
          },
        );
        expect(response.status).toBe(409);
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "refuses administration once the account has left the group",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId, { isMember: false });

        const promote = await app.request(
          `/api/groups/${contactId}/participants/promote`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({ participantJids: [MEMBER_JID] }),
          },
        );
        expect(promote.status).toBe(409);

        const leave = await app.request(`/api/groups/${contactId}/leave`, {
          method: "POST",
          headers: ownerHeaders,
        });
        expect(leave.status).toBe(409);

        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "reports permissions and leave semantics on the detail endpoint",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId);
        const response = await app.request(`/api/groups/${contactId}`, {
          headers: ownerHeaders,
        });
        expect(response.status).toBe(200);
        const { data: body } = (await response.json()) as {
          data: {
            isAdmin: boolean;
            isMember: boolean;
            canAdminister: boolean;
            inviteLink: string | null;
            leaveSemantics: string;
            settings: { isAnnounce: boolean };
          };
        };
        expect(body.isAdmin).toBe(true);
        expect(body.isMember).toBe(true);
        expect(body.canAdminister).toBe(true);
        expect(body.inviteLink).toBeNull();
        expect(body.settings.isAnnounce).toBe(false);
        expect(body.leaveSemantics).toContain("no delete or disband");
      });
    },
  );

  integrationTest("never returns the invite link to a non-admin", async () => {
    await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
      const { contactId, groupId } = await setupGroup(companyId, {
        selfIsAdmin: false,
      });
      await getTenantConnection(companyId)
        .updateTable("groups")
        .set({ invite_link: "https://chat.whatsapp.com/SECRET" })
        .where("id", "=", groupId)
        .execute();

      const response = await app.request(`/api/groups/${contactId}`, {
        headers: ownerHeaders,
      });
      const { data: body } = (await response.json()) as {
        data: { inviteLink: string | null };
      };
      expect(body.inviteLink).toBeNull();
    });
  });
});

/**
 * Every mutating group route reached through a nested path.
 *
 * The router guards these with `POST /:id/*`, so a wildcard that only matched
 * one trailing segment would silently leave the deepest routes - approving a
 * join request, removing a member - unauthenticated and unscoped. These assert
 * the guards on the two-segment paths specifically.
 */
const NESTED_MUTATIONS: ReadonlyArray<{
  name: string;
  path: (contactId: string) => string;
  body: unknown;
}> = [
  {
    name: "remove members",
    path: (id) => `/api/groups/${id}/participants/remove`,
    body: { participantJids: [MEMBER_JID] },
  },
  {
    name: "promote members",
    path: (id) => `/api/groups/${id}/participants/promote`,
    body: { participantJids: [MEMBER_JID] },
  },
  {
    name: "demote admins",
    path: (id) => `/api/groups/${id}/participants/demote`,
    body: { participantJids: [MEMBER_JID] },
  },
  {
    name: "refresh join requests",
    path: (id) => `/api/groups/${id}/join-requests/refresh`,
    body: undefined,
  },
  {
    name: "decide join requests",
    path: (id) => `/api/groups/${id}/join-requests/decision`,
    body: { requesterJids: [OUTSIDER_JID], decision: "approve" },
  },
];

describe("group administration - nested route guards", () => {
  integrationTest("every nested mutation requires authentication", async () => {
    await withTenantAndUsers(async ({ companyId }) => {
      const { contactId } = await setupGroup(companyId);
      for (const mutation of NESTED_MUTATIONS) {
        const response = await app.request(mutation.path(contactId), {
          method: "POST",
          headers: { "content-type": "application/json" },
          ...(mutation.body ? { body: JSON.stringify(mutation.body) } : {}),
        });
        expect(response.status, mutation.name).toBe(401);
      }
      expect(await queuedCommands(companyId)).toEqual([]);
    });
  });

  integrationTest(
    "every nested mutation requires the outbound-send permission",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember }) => {
        const { contactId } = await setupGroup(companyId);
        const { headers } = await createMember({
          can_view_all_chats: true,
          can_send_messages: false,
        });
        for (const mutation of NESTED_MUTATIONS) {
          const response = await app.request(mutation.path(contactId), {
            method: "POST",
            headers,
            ...(mutation.body ? { body: JSON.stringify(mutation.body) } : {}),
          });
          expect(response.status, mutation.name).toBe(403);
        }
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "every nested mutation hides a group the member cannot see",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember }) => {
        const { contactId } = await setupGroup(companyId);
        const { headers } = await createMember({
          can_view_all_chats: false,
          can_send_messages: true,
        });
        for (const mutation of NESTED_MUTATIONS) {
          const response = await app.request(mutation.path(contactId), {
            method: "POST",
            headers,
            ...(mutation.body ? { body: JSON.stringify(mutation.body) } : {}),
          });
          // 404, not 403: admitting the group exists is itself a disclosure.
          expect(response.status, mutation.name).toBe(404);
        }
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "every nested mutation refuses a non-admin account",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId, {
          selfIsAdmin: false,
        });
        for (const mutation of NESTED_MUTATIONS) {
          const response = await app.request(mutation.path(contactId), {
            method: "POST",
            headers: ownerHeaders,
            ...(mutation.body ? { body: JSON.stringify(mutation.body) } : {}),
          });
          expect(response.status, mutation.name).toBe(403);
        }
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "every nested mutation refuses an offline connection",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId, {
          connectionStatus: "disconnected",
        });
        for (const mutation of NESTED_MUTATIONS) {
          const response = await app.request(mutation.path(contactId), {
            method: "POST",
            headers: ownerHeaders,
            ...(mutation.body ? { body: JSON.stringify(mutation.body) } : {}),
          });
          expect(response.status, mutation.name).toBe(409);
        }
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );
});

describe("group administration - remaining read and write paths", () => {
  integrationTest(
    "creating a group refuses a connection from another workspace",
    async () => {
      await withTenantAndUsers(async (first) => {
        const foreign = await setupGroup(first.companyId);
        await withTenantAndUsers(async (second) => {
          // The connection id is real, just not this workspace's. The tenant
          // schema is the isolation boundary, so it must not resolve.
          const response = await app.request("/api/groups", {
            method: "POST",
            headers: second.ownerHeaders,
            body: JSON.stringify({
              connectionId: foreign.connectionId,
              name: "Cross tenant",
              participantJids: [OUTSIDER_JID],
            }),
          });
          expect(response.status).toBe(404);
          expect(await queuedCommands(second.companyId)).toEqual([]);
        });
      });
    },
  );

  integrationTest("creating a group refuses an offline account", async () => {
    await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
      const { connectionId } = await setupGroup(companyId, {
        connectionStatus: "disconnected",
      });
      const response = await app.request("/api/groups", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({
          connectionId,
          name: "Offline",
          participantJids: [OUTSIDER_JID],
        }),
      });
      expect(response.status).toBe(409);
      expect(await queuedCommands(companyId)).toEqual([]);
    });
  });

  integrationTest(
    "creating a group rejects a participant list that is empty or duplicated away",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { connectionId } = await setupGroup(companyId);
        const response = await app.request("/api/groups", {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify({
            connectionId,
            name: "Nobody",
            participantJids: [],
          }),
        });
        expect(response.status).toBe(400);
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest("join requests are admin-only to read", async () => {
    await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
      const { contactId } = await setupGroup(companyId, { selfIsAdmin: false });
      const response = await app.request(
        `/api/groups/${contactId}/join-requests`,
        { headers: ownerHeaders },
      );
      expect(response.status).toBe(403);
    });
  });

  integrationTest(
    "join requests report never-fetched separately from empty",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId);
        const response = await app.request(
          `/api/groups/${contactId}/join-requests`,
          { headers: ownerHeaders },
        );
        expect(response.status).toBe(200);
        const { data } = (await response.json()) as {
          data: { requests: unknown[]; syncedAt: string | null };
        };
        expect(data.requests).toEqual([]);
        expect(data.syncedAt).toBeNull();
      });
    },
  );

  integrationTest(
    "deciding on a request nobody made is refused before it reaches WhatsApp",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId);
        const response = await app.request(
          `/api/groups/${contactId}/join-requests/decision`,
          {
            method: "POST",
            headers: ownerHeaders,
            body: JSON.stringify({
              requesterJids: [OUTSIDER_JID],
              decision: "approve",
            }),
          },
        );
        expect(response.status).toBe(409);
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );

  integrationTest(
    "a manual re-sync is available to any member but needs a live connection",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const online = await setupGroup(companyId, { selfIsAdmin: false });
        const okResponse = await app.request(
          `/api/groups/${online.contactId}/sync`,
          { method: "POST", headers: ownerHeaders },
        );
        expect(okResponse.status).toBe(200);
        const [command] = await queuedCommands(companyId);
        expect(command).toMatchObject({
          type: "group_sync",
          group_jid: online.groupJid,
        });

        const offline = await setupGroup(companyId, {
          connectionStatus: "disconnected",
        });
        const offlineResponse = await app.request(
          `/api/groups/${offline.contactId}/sync`,
          { method: "POST", headers: ownerHeaders },
        );
        expect(offlineResponse.status).toBe(409);
      });
    },
  );

  integrationTest(
    "admin status is reported against the group's own account",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId, connectionId } = await setupGroup(companyId, {
          selfIsAdmin: false,
        });
        // An unrelated, connected account must not influence the answer.
        await getTenantConnection(companyId)
          .insertInto("whatsapp_connections")
          .values({
            id: crypto.randomUUID(),
            name: "Unrelated account",
            phone_number: "15558888888",
            jid: "15558888888@s.whatsapp.net",
            status: "connected",
          })
          .execute();

        const response = await app.request(
          `/api/groups/${contactId}/admin-status`,
          { headers: ownerHeaders },
        );
        expect(response.status).toBe(200);
        const { data } = (await response.json()) as {
          data: {
            isAdmin: boolean;
            isMember: boolean;
            connectionId: string;
            connectionJid: string | null;
          };
        };
        expect(data.isAdmin).toBe(false);
        expect(data.isMember).toBe(true);
        expect(data.connectionId).toBe(connectionId);
        expect(data.connectionJid).toBe(OWN_JID);
      });
    },
  );
});

describe("group administration - review follow-ups", () => {
  integrationTest(
    "the detail payload carries the raw WhatsApp subject next to the alias",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId);
        await getTenantConnection(companyId)
          .updateTable("contacts")
          .set({ custom_name: "ACME - tier 2" })
          .where("id", "=", contactId)
          .execute();

        const response = await app.request(`/api/groups/${contactId}`, {
          headers: ownerHeaders,
        });
        const { data } = (await response.json()) as {
          data: { name: string; customName: string; whatsappName: string };
        };
        // `name` is the alias-first display label, `whatsappName` is what the
        // group is actually called on WhatsApp. A settings form that seeded
        // from `name` would rename the group to the private alias.
        expect(data.name).toBe("ACME - tier 2");
        expect(data.customName).toBe("ACME - tier 2");
        expect(data.whatsappName).toBe("Ops group");
      });
    },
  );

  integrationTest(
    "participant contact IDs follow the same visibility rule as contact details",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember }) => {
        const { contactId, connectionId } = await setupGroup(companyId);
        const tenantDb = getTenantConnection(companyId);
        const restricted = await createMember({ can_view_all_chats: false });
        const participant = await tenantDb
          .insertInto("contacts")
          .values({
            whatsapp_connection_id: connectionId,
            jid: MEMBER_JID,
            phone_number: "15550000002",
            push_name: "Visible group member",
            is_group: false,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await tenantDb
          .insertInto("contact_assignments")
          .values({
            contact_id: contactId,
            assigned_to: restricted.userId,
            assigned_by: restricted.userId,
          })
          .execute();

        const hidden = await app.request(`/api/groups/${contactId}`, {
          headers: restricted.headers,
        });
        expect(hidden.status).toBe(200);
        const hiddenBody = (await hidden.json()) as {
          data: {
            participants: Array<{ jid: string; contactId: string | null }>;
          };
        };
        expect(
          hiddenBody.data.participants.find(
            (candidate) => candidate.jid === MEMBER_JID,
          )?.contactId,
        ).toBeNull();

        await tenantDb
          .insertInto("contact_assignments")
          .values({
            contact_id: participant.id,
            assigned_to: restricted.userId,
            assigned_by: restricted.userId,
          })
          .execute();
        const visible = await app.request(`/api/groups/${contactId}`, {
          headers: restricted.headers,
        });
        const visibleBody = (await visible.json()) as {
          data: {
            participants: Array<{ jid: string; contactId: string | null }>;
          };
        };
        expect(
          visibleBody.data.participants.find(
            (candidate) => candidate.jid === MEMBER_JID,
          )?.contactId,
        ).toBe(participant.id);
      });
    },
  );

  integrationTest(
    "the invite link needs the caller's outbound permission, not just an admin account",
    async () => {
      await withTenantAndUsers(async ({ companyId, createMember, ownerId }) => {
        const { contactId, groupId } = await setupGroup(companyId);
        const tenantDb = getTenantConnection(companyId);
        await tenantDb
          .updateTable("groups")
          .set({ invite_link: "https://chat.whatsapp.com/SECRET" })
          .where("id", "=", groupId)
          .execute();

        const readOnly = await createMember({
          can_view_all_chats: true,
          can_send_messages: false,
        });
        const sender = await createMember({
          can_view_all_chats: true,
          can_send_messages: true,
        });
        void ownerId;

        const hidden = await app.request(`/api/groups/${contactId}`, {
          headers: readOnly.headers,
        });
        const hiddenBody = (await hidden.json()) as {
          data: { inviteLink: string | null; isAdmin: boolean };
        };
        expect(hiddenBody.data.isAdmin).toBe(true);
        expect(hiddenBody.data.inviteLink).toBeNull();

        const visible = await app.request(`/api/groups/${contactId}`, {
          headers: sender.headers,
        });
        const visibleBody = (await visible.json()) as {
          data: { inviteLink: string | null };
        };
        expect(visibleBody.data.inviteLink).toBe(
          "https://chat.whatsapp.com/SECRET",
        );
      });
    },
  );

  integrationTest(
    "removed single-participant routes return 404 without queuing commands",
    async () => {
      await withTenantAndUsers(async ({ companyId, ownerHeaders }) => {
        const { contactId } = await setupGroup(companyId);
        const encoded = encodeURIComponent(MEMBER_JID);
        const removedRoutes = [
          {
            method: "POST",
            path: `/api/groups/${contactId}/participants/${encoded}/promote`,
          },
          {
            method: "POST",
            path: `/api/groups/${contactId}/participants/${encoded}/demote`,
          },
          {
            method: "DELETE",
            path: `/api/groups/${contactId}/participants/${encoded}`,
          },
        ];

        for (const route of removedRoutes) {
          const response = await app.request(route.path, {
            method: route.method,
            headers: ownerHeaders,
          });
          expect(response.status, `${route.method} ${route.path}`).toBe(404);
        }
        expect(await queuedCommands(companyId)).toEqual([]);
      });
    },
  );
});
