import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { resetMembershipCache } from "./company-membership.service.js";
import {
  broadcastToContactViewersByJid,
  resolveContactViewerIds,
  resolveContactViewerIdsForContacts,
} from "./message-broadcast.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface Fixture {
  companyId: string;
  /** can_view_all_chats via the owner preset. */
  ownerId: string;
  /** Plain member, no can_view_all_chats. */
  agentId: string;
  /** Second plain member. */
  otherAgentId: string;
  contactId: string;
  connectionId: string;
  jid: string;
}

/**
 * A workspace with one owner, two plain members, one connection and one
 * contact - the smallest shape that can distinguish "sees everything" from
 * "sees only what is assigned to them".
 */
async function withWorkspace(run: (fixture: Fixture) => Promise<void>) {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const ownerId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const otherAgentId = crypto.randomUUID();
  const contactId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const jid = "15551230000@s.whatsapp.net";

  try {
    for (const [userId, label] of [
      [ownerId, "owner"],
      [agentId, "agent"],
      [otherAgentId, "other"],
    ] as const) {
      await db
        .insertInto("users")
        .values({
          id: userId,
          email: `viewer-${label}-${userId}@example.com`,
          password_hash: "test",
        })
        .execute();
    }
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Viewer resolution test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values([
        { company_id: companyId, user_id: ownerId, role: "owner" },
        { company_id: companyId, user_id: agentId, role: "member" },
        { company_id: companyId, user_id: otherAgentId, role: "member" },
      ])
      .execute();

    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        phone_number: "15550001111",
        status: "connected",
      })
      .execute();
    await tenantDb
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid,
        phone_number: "15551230000",
      })
      .execute();

    resetMembershipCache();
    await run({
      companyId,
      ownerId,
      agentId,
      otherAgentId,
      contactId,
      connectionId,
      jid,
    });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    await db
      .deleteFrom("users")
      .where("id", "in", [ownerId, agentId, otherAgentId])
      .execute();
  }
}

async function assign(
  companyId: string,
  contactId: string,
  userId: string,
): Promise<void> {
  const tenantDb = getTenantConnection(companyId);
  await tenantDb
    .updateTable("contact_assignments")
    .set({ unassigned_at: new Date() })
    .where("contact_id", "=", contactId)
    .where("unassigned_at", "is", null)
    .execute();
  await tenantDb
    .insertInto("contact_assignments")
    .values({ contact_id: contactId, assigned_to: userId, assigned_by: userId })
    .execute();
}

/**
 * The realtime fan-out predicate has to match the HTTP guard exactly, and both
 * halves of it are database state. These exercise the resolver against real
 * rows rather than a hand-built candidate list.
 */
describe("resolveContactViewerIds against real workspace data", () => {
  beforeEach(() => {
    resetMembershipCache();
  });

  integrationTest(
    "an unassigned contact reaches only members who can view all chats",
    async () => {
      await withWorkspace(async (fixture) => {
        const viewers = await resolveContactViewerIds(
          fixture.companyId,
          fixture.contactId,
        );
        expect(viewers).toEqual([fixture.ownerId]);
      });
    },
  );

  integrationTest("the active assignee is included", async () => {
    await withWorkspace(async (fixture) => {
      await assign(fixture.companyId, fixture.contactId, fixture.agentId);
      const viewers = await resolveContactViewerIds(
        fixture.companyId,
        fixture.contactId,
      );
      expect(viewers.sort()).toEqual([fixture.agentId, fixture.ownerId].sort());
      expect(viewers).not.toContain(fixture.otherAgentId);
    });
  });

  integrationTest(
    "reassignment moves visibility off the previous assignee immediately",
    async () => {
      await withWorkspace(async (fixture) => {
        await assign(fixture.companyId, fixture.contactId, fixture.agentId);
        await assign(
          fixture.companyId,
          fixture.contactId,
          fixture.otherAgentId,
        );

        const viewers = await resolveContactViewerIds(
          fixture.companyId,
          fixture.contactId,
        );
        // Assignments are never cached, so this needs no invalidation.
        expect(viewers).toContain(fixture.otherAgentId);
        expect(viewers).not.toContain(fixture.agentId);
      });
    },
  );

  integrationTest(
    "an unassigned-again contact drops back to all-chats members only",
    async () => {
      await withWorkspace(async (fixture) => {
        await assign(fixture.companyId, fixture.contactId, fixture.agentId);
        const tenantDb = getTenantConnection(fixture.companyId);
        await tenantDb
          .updateTable("contact_assignments")
          .set({ unassigned_at: new Date() })
          .where("contact_id", "=", fixture.contactId)
          .execute();

        expect(
          await resolveContactViewerIds(fixture.companyId, fixture.contactId),
        ).toEqual([fixture.ownerId]);
      });
    },
  );

  integrationTest(
    "granting can_view_all_chats applies on the next event, not after a TTL",
    async () => {
      await withWorkspace(async (fixture) => {
        expect(
          await resolveContactViewerIds(fixture.companyId, fixture.contactId),
        ).toEqual([fixture.ownerId]);

        // Simulate the permission service's write plus its invalidation.
        await db
          .updateTable("company_members")
          .set({ permissions: { can_view_all_chats: true } })
          .where("company_id", "=", fixture.companyId)
          .where("user_id", "=", fixture.agentId)
          .execute();
        const { invalidateCompanyMembership } = await import(
          "./company-membership.service.js"
        );
        invalidateCompanyMembership(fixture.companyId);

        expect(
          (
            await resolveContactViewerIds(fixture.companyId, fixture.contactId)
          ).sort(),
        ).toEqual([fixture.agentId, fixture.ownerId].sort());
      });
    },
  );

  integrationTest(
    "REVOKING can_view_all_chats applies on the next event",
    async () => {
      // The direction that matters for security.
      await withWorkspace(async (fixture) => {
        await db
          .updateTable("company_members")
          .set({ permissions: { can_view_all_chats: true } })
          .where("company_id", "=", fixture.companyId)
          .where("user_id", "=", fixture.agentId)
          .execute();
        const { invalidateCompanyMembership } = await import(
          "./company-membership.service.js"
        );
        invalidateCompanyMembership(fixture.companyId);
        expect(
          await resolveContactViewerIds(fixture.companyId, fixture.contactId),
        ).toHaveLength(2);

        await db
          .updateTable("company_members")
          .set({ permissions: { can_view_all_chats: false } })
          .where("company_id", "=", fixture.companyId)
          .where("user_id", "=", fixture.agentId)
          .execute();
        invalidateCompanyMembership(fixture.companyId);

        expect(
          await resolveContactViewerIds(fixture.companyId, fixture.contactId),
        ).toEqual([fixture.ownerId]);
      });
    },
  );

  integrationTest("a removed member stops being a viewer", async () => {
    await withWorkspace(async (fixture) => {
      await assign(fixture.companyId, fixture.contactId, fixture.agentId);
      expect(
        await resolveContactViewerIds(fixture.companyId, fixture.contactId),
      ).toHaveLength(2);

      await db
        .deleteFrom("company_members")
        .where("company_id", "=", fixture.companyId)
        .where("user_id", "=", fixture.agentId)
        .execute();
      const { invalidateCompanyMembership } = await import(
        "./company-membership.service.js"
      );
      invalidateCompanyMembership(fixture.companyId);

      // The assignment row still exists, but a non-member is not a candidate.
      expect(
        await resolveContactViewerIds(fixture.companyId, fixture.contactId),
      ).toEqual([fixture.ownerId]);
    });
  });
});

describe("JID-keyed resolution against real rows", () => {
  beforeEach(() => {
    resetMembershipCache();
  });

  integrationTest(
    "resolves a direct contact, and a group participant via membership",
    async () => {
      await withWorkspace(async (fixture) => {
        const tenantDb = getTenantConnection(fixture.companyId);
        const groupContactId = crypto.randomUUID();
        const groupId = crypto.randomUUID();
        const participantJid = "15559998888@s.whatsapp.net";

        await tenantDb
          .insertInto("contacts")
          .values({
            id: groupContactId,
            whatsapp_connection_id: fixture.connectionId,
            jid: "120363000000000000@g.us",
            phone_number: "",
            is_group: true,
          })
          .execute();
        await tenantDb
          .insertInto("groups")
          .values({
            id: groupId,
            contact_id: groupContactId,
            jid: "120363000000000000@g.us",
            name: "Test group",
          })
          .execute();
        await tenantDb
          .insertInto("group_participants")
          .values({ group_id: groupId, participant_jid: participantJid })
          .execute();
        await assign(fixture.companyId, groupContactId, fixture.otherAgentId);

        const published: string[][] = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body)) as { channels: string[] };
          published.push(body.channels);
          return new Response(JSON.stringify({ result: { responses: [{}] } }), {
            status: 200,
          });
        }) as typeof fetch;

        try {
          // The participant has no contact row of their own; only the group
          // membership path can find the conversation they appear in.
          await broadcastToContactViewersByJid(
            fixture.companyId,
            participantJid,
            "contact:profile_picture",
            { jid: participantJid, mediaAvailable: true },
            {
              connectionId: fixture.connectionId,
              includeGroupMemberships: true,
            },
          );
        } finally {
          globalThis.fetch = originalFetch;
        }

        expect(published).toHaveLength(1);
        const channels = published[0];
        expect(channels).toContain(
          `user:${fixture.companyId}:${fixture.otherAgentId}`,
        );
        expect(channels).toContain(
          `user:${fixture.companyId}:${fixture.ownerId}`,
        );
        // The unrelated agent is assigned nothing and cannot view all chats.
        expect(channels).not.toContain(
          `user:${fixture.companyId}:${fixture.agentId}`,
        );
      });
    },
  );

  integrationTest(
    "a JID that names no conversation publishes nothing",
    async () => {
      await withWorkspace(async (fixture) => {
        let called = false;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
          called = true;
          return new Response("{}", { status: 200 });
        }) as unknown as typeof fetch;

        try {
          await broadcastToContactViewersByJid(
            fixture.companyId,
            "15550000000@s.whatsapp.net",
            "presence:online",
            {},
            { connectionId: fixture.connectionId },
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
        expect(called).toBe(false);
      });
    },
  );
});

/**
 * Every fan-out helper takes a companyId and resolves against that tenant's
 * schema. Nothing in the resolver's signature stops a caller passing a contact
 * or JID that belongs to a different workspace, so these prove the tenant
 * boundary holds rather than assuming it.
 */
describe("resolution never crosses a tenant boundary", () => {
  beforeEach(() => {
    resetMembershipCache();
  });

  integrationTest(
    "a foreign contact ID never resolves anyone from the other workspace",
    async () => {
      // Note what this does NOT claim: an unknown contact still resolves to
      // the *calling* workspace's can_view_all_chats members, because that arm
      // of the predicate does not depend on the contact existing. What matters
      // is that no member of the other tenant is ever returned.
      await withWorkspace(async (tenantA) => {
        await withWorkspace(async (tenantB) => {
          await assign(tenantB.companyId, tenantB.contactId, tenantB.agentId);

          // Tenant B's contact ID, resolved against tenant A's schema.
          const viewers = await resolveContactViewerIds(
            tenantA.companyId,
            tenantB.contactId,
          );

          // Tenant A's own all-chats members are returned - they are A's
          // members - but nobody from B ever appears.
          expect(viewers).not.toContain(tenantB.ownerId);
          expect(viewers).not.toContain(tenantB.agentId);
          expect(viewers).not.toContain(tenantB.otherAgentId);
          for (const viewer of viewers) {
            expect([
              tenantA.ownerId,
              tenantA.agentId,
              tenantA.otherAgentId,
            ]).toContain(viewer);
          }
        });
      });
    },
  );

  integrationTest(
    "an assignment in one workspace does not grant visibility in another",
    async () => {
      await withWorkspace(async (tenantA) => {
        await withWorkspace(async (tenantB) => {
          // Same *user id* assigned in B; A must not treat them as a viewer.
          await assign(tenantB.companyId, tenantB.contactId, tenantB.agentId);

          const viewersA = await resolveContactViewerIds(
            tenantA.companyId,
            tenantA.contactId,
          );
          expect(viewersA).toEqual([tenantA.ownerId]);
        });
      });
    },
  );

  integrationTest(
    "an identical JID in two workspaces fans out only within its own",
    async () => {
      await withWorkspace(async (tenantA) => {
        await withWorkspace(async (tenantB) => {
          // Both fixtures use the same contact JID by construction.
          expect(tenantA.jid).toBe(tenantB.jid);
          await assign(tenantB.companyId, tenantB.contactId, tenantB.agentId);

          const published: string[][] = [];
          const originalFetch = globalThis.fetch;
          globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as {
              channels: string[];
            };
            published.push(body.channels);
            return new Response(
              JSON.stringify({ result: { responses: [{}] } }),
              { status: 200 },
            );
          }) as unknown as typeof fetch;

          try {
            await broadcastToContactViewersByJid(
              tenantA.companyId,
              tenantA.jid,
              "presence:online",
              {},
              { connectionId: tenantA.connectionId },
            );
          } finally {
            globalThis.fetch = originalFetch;
          }

          const channels = published.flat();
          expect(channels).toContain(
            `user:${tenantA.companyId}:${tenantA.ownerId}`,
          );
          // Not one channel belongs to the other workspace.
          for (const channel of channels) {
            expect(channel.startsWith(`user:${tenantA.companyId}:`)).toBe(true);
          }
        });
      });
    },
  );

  integrationTest(
    "a connection ID from another workspace matches no contact",
    async () => {
      await withWorkspace(async (tenantA) => {
        await withWorkspace(async (tenantB) => {
          let called = false;
          const originalFetch = globalThis.fetch;
          globalThis.fetch = (async () => {
            called = true;
            return new Response("{}", { status: 200 });
          }) as unknown as typeof fetch;

          try {
            await broadcastToContactViewersByJid(
              tenantA.companyId,
              tenantA.jid,
              "presence:online",
              {},
              // B's connection, A's schema: the contact lookup is scoped by
              // both, so this must find nothing rather than fall back.
              { connectionId: tenantB.connectionId },
            );
          } finally {
            globalThis.fetch = originalFetch;
          }

          expect(called).toBe(false);
        });
      });
    },
  );
});

/**
 * Counts statements issued against a tenant table, by intercepting the query
 * builder rather than reading PostgreSQL's asynchronously-collected stats.
 * Deterministic, so the assertion can be exact.
 */
type TenantExecutor = ReturnType<typeof getTenantConnection>;

function countingExecutor(
  real: TenantExecutor,
  counts: Record<string, number>,
): TenantExecutor {
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === "selectFrom") {
        return (table: string) => {
          counts[table] = (counts[table] ?? 0) + 1;
          return (target.selectFrom as unknown as (t: string) => unknown)(
            table,
          );
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * A group participant appears in many conversations, and presence/typing are
 * the highest-frequency events in the system. Resolving them must not cost a
 * round trip per conversation.
 */
describe("viewer resolution query cost", () => {
  beforeEach(() => {
    resetMembershipCache();
  });

  integrationTest(
    "resolving many contacts issues exactly one assignment query",
    async () => {
      await withWorkspace(async (fixture) => {
        const tenantDb = getTenantConnection(fixture.companyId);
        const contactIds = [fixture.contactId];

        // 12 more conversations, one assigned so the result is not trivial.
        for (let i = 0; i < 12; i++) {
          const id = crypto.randomUUID();
          await tenantDb
            .insertInto("contacts")
            .values({
              id,
              whatsapp_connection_id: fixture.connectionId,
              jid: `1555000${1000 + i}@s.whatsapp.net`,
              phone_number: `1555000${1000 + i}`,
            })
            .execute();
          contactIds.push(id);
        }
        await assign(fixture.companyId, contactIds[3], fixture.agentId);

        const counts: Record<string, number> = {};
        const viewers = await resolveContactViewerIdsForContacts(
          fixture.companyId,
          contactIds,
          countingExecutor(tenantDb, counts),
        );

        // One statement for 13 contacts - not 13.
        expect(counts.contact_assignments).toBe(1);
        expect(viewers.sort()).toEqual(
          [fixture.ownerId, fixture.agentId].sort(),
        );
      });
    },
  );

  integrationTest(
    "the batched resolver agrees with the per-contact one",
    async () => {
      await withWorkspace(async (fixture) => {
        const tenantDb = getTenantConnection(fixture.companyId);
        const second = crypto.randomUUID();
        await tenantDb
          .insertInto("contacts")
          .values({
            id: second,
            whatsapp_connection_id: fixture.connectionId,
            jid: "15550009999@s.whatsapp.net",
            phone_number: "15550009999",
          })
          .execute();
        await assign(fixture.companyId, second, fixture.otherAgentId);

        const batched = await resolveContactViewerIdsForContacts(
          fixture.companyId,
          [fixture.contactId, second],
        );
        const union = new Set([
          ...(await resolveContactViewerIds(
            fixture.companyId,
            fixture.contactId,
          )),
          ...(await resolveContactViewerIds(fixture.companyId, second)),
        ]);

        expect(batched.sort()).toEqual([...union].sort());
      });
    },
  );

  integrationTest("an empty contact list issues no query at all", async () => {
    await withWorkspace(async (fixture) => {
      const counts: Record<string, number> = {};
      const viewers = await resolveContactViewerIdsForContacts(
        fixture.companyId,
        [],
        countingExecutor(getTenantConnection(fixture.companyId), counts),
      );
      expect(viewers).toEqual([]);
      expect(counts.contact_assignments).toBeUndefined();
    });
  });
});
