import { afterEach, describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { app } from "../../app.js";
import { generateAccessToken } from "../../lib/jwt.js";
import { resetMembershipCache } from "../../services/company-membership.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../../services/tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

interface Actor {
  userId: string;
  token: string;
}

interface Fixture {
  companyId: string;
  owner: Actor;
  /** Assigned to the contact. */
  assignee: Actor;
  /** A member who can see nothing. */
  outsider: Actor;
  contactId: string;
}

/** Publishes captured from the Centrifugo transport. */
let published: Array<{ channels: string[]; type: string; data: unknown }> = [];
let originalFetch: typeof fetch | null = null;

function captureRealtime(): void {
  published = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      channels?: string[];
      channel?: string;
      data: { type: string; data: unknown };
    };
    published.push({
      channels: body.channels ?? (body.channel ? [body.channel] : []),
      type: body.data.type,
      data: body.data.data,
    });
    return new Response(JSON.stringify({ result: { responses: [{}] } }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

function restoreRealtime(): void {
  if (originalFetch) globalThis.fetch = originalFetch;
  originalFetch = null;
}

async function createActor(
  companyId: string,
  role: "owner" | "member",
  label: string,
): Promise<Actor> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await db
    .insertInto("users")
    .values({
      id: userId,
      email: `read-${label}-${userId}@example.com`,
      password_hash: "test",
      email_verified_at: new Date(),
    })
    .execute();
  await db
    .insertInto("company_members")
    .values({
      company_id: companyId,
      user_id: userId,
      role,
      // The product's member preset can view all chats. These fixtures need a
      // deliberately restricted member to exercise assignment-only access.
      permissions: role === "member" ? { can_view_all_chats: false } : {},
    })
    .execute();
  await db
    .insertInto("user_sessions")
    .values({
      id: sessionId,
      user_id: userId,
      refresh_token: `refresh-${sessionId}`,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    })
    .execute();
  return { userId, token: await generateAccessToken(userId, sessionId) };
}

async function withWorkspace(run: (fixture: Fixture) => Promise<void>) {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const contactId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const userIds: string[] = [];

  try {
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Read action test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    const owner = await createActor(companyId, "owner", "owner");
    const assignee = await createActor(companyId, "member", "assignee");
    const outsider = await createActor(companyId, "member", "outsider");
    userIds.push(owner.userId, assignee.userId, outsider.userId);

    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        phone_number: "15550002222",
        status: "connected",
      })
      .execute();
    await tenantDb
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid: "15551239999@s.whatsapp.net",
        phone_number: "15551239999",
      })
      .execute();
    await tenantDb
      .insertInto("contact_assignments")
      .values({
        contact_id: contactId,
        assigned_to: assignee.userId,
        assigned_by: owner.userId,
      })
      .execute();

    resetMembershipCache();
    await run({ companyId, owner, assignee, outsider, contactId });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db
      .deleteFrom("company_members")
      .where("company_id", "=", companyId)
      .execute();
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
    if (userIds.length > 0) {
      await db
        .deleteFrom("user_sessions")
        .where("user_id", "in", userIds)
        .execute();
      await db.deleteFrom("users").where("id", "in", userIds).execute();
    }
  }
}

function readRequest(
  fixture: Fixture,
  actor: Actor,
  body: Record<string, unknown>,
  clientId?: string,
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${actor.token}`,
    "X-Company-ID": fixture.companyId,
  };
  if (clientId) headers["X-Realtime-Client-Id"] = clientId;
  return new Request("http://localhost/api/actions/messages/read", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * `POST /actions/messages/read` takes its conversation ID from the request
 * BODY, so the path-parameter visibility middleware that guards
 * `/conversations/:id/*` cannot cover it. These pin the semantics that check
 * has to provide.
 */
describe("POST /actions/messages/read", () => {
  afterEach(() => {
    restoreRealtime();
  });

  integrationTest(
    "an authorized member broadcasts to the conversation's viewers",
    async () => {
      await withWorkspace(async (fixture) => {
        captureRealtime();
        const response = await app.request(
          readRequest(fixture, fixture.assignee, {
            conversationId: fixture.contactId,
            messageIds: ["m1", "m2"],
          }),
        );

        expect(response.status).toBe(200);
        expect(published).toHaveLength(1);
        expect(published[0].type).toBe("conversation:read");
        expect(published[0].channels.sort()).toEqual(
          [
            `user:${fixture.companyId}:${fixture.assignee.userId}`,
            `user:${fixture.companyId}:${fixture.owner.userId}`,
          ].sort(),
        );
        // Never the shared company channel.
        expect(published[0].channels).not.toContain(
          `company:${fixture.companyId}`,
        );
      });
    },
  );

  integrationTest(
    "a member who cannot see the conversation is refused and publishes nothing",
    async () => {
      await withWorkspace(async (fixture) => {
        captureRealtime();
        const response = await app.request(
          readRequest(fixture, fixture.outsider, {
            conversationId: fixture.contactId,
          }),
        );

        // 404, not 403: the existence of the contact is itself withheld.
        expect(response.status).toBe(404);
        // The important half - no forged "read by outsider" reached anyone.
        expect(published).toEqual([]);
      });
    },
  );

  integrationTest(
    "a malformed conversation ID is rejected as input",
    async () => {
      await withWorkspace(async (fixture) => {
        captureRealtime();
        const response = await app.request(
          readRequest(fixture, fixture.owner, { conversationId: "not-a-uuid" }),
        );
        expect(response.status).toBe(400);
        expect(published).toEqual([]);
      });
    },
  );

  integrationTest("an unknown conversation ID is refused", async () => {
    await withWorkspace(async (fixture) => {
      captureRealtime();
      const response = await app.request(
        readRequest(fixture, fixture.owner, {
          conversationId: crypto.randomUUID(),
        }),
      );

      // can_view_all_chats short-circuits the visibility check, so without an
      // explicit existence check an admin could publish an event naming a
      // conversation that does not exist.
      expect(response.status).toBe(404);
      expect(published).toEqual([]);
    });
  });

  integrationTest(
    "the originating client is excluded so it does not echo itself",
    async () => {
      await withWorkspace(async (fixture) => {
        captureRealtime();
        const response = await app.request(
          readRequest(
            fixture,
            fixture.assignee,
            { conversationId: fixture.contactId },
            "client-abc",
          ),
        );

        expect(response.status).toBe(200);
        expect(published).toHaveLength(1);
        expect(
          (published[0].data as { excludeClientId?: string }).excludeClientId,
        ).toBe("client-abc");
      });
    },
  );

  integrationTest("the payload names the reader and the messages", async () => {
    await withWorkspace(async (fixture) => {
      captureRealtime();
      await app.request(
        readRequest(fixture, fixture.assignee, {
          conversationId: fixture.contactId,
          messageIds: ["wa-1"],
        }),
      );

      const payload = (
        published[0].data as { payload: Record<string, unknown> }
      ).payload;
      expect(payload.contactId).toBe(fixture.contactId);
      expect(payload.readBy).toBe(fixture.assignee.userId);
      expect(payload.messageIds).toEqual(["wa-1"]);
    });
  });

  integrationTest("an unauthenticated request is rejected", async () => {
    await withWorkspace(async (fixture) => {
      captureRealtime();
      const response = await app.request(
        new Request("http://localhost/api/actions/messages/read", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Company-ID": fixture.companyId,
          },
          body: JSON.stringify({ conversationId: fixture.contactId }),
        }),
      );
      expect(response.status).toBe(401);
      expect(published).toEqual([]);
    });
  });
});
