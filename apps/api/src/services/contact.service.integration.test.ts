import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { DEFAULT_SLA_WEEKLY_SCHEDULE } from "@wateaminbox/shared";
import { CompiledQuery, sql } from "kysely";
import { app } from "../app.js";
import { hashPassword } from "../lib/password.js";
import { getPrivateMediaReference } from "../lib/storage.js";
import { invalidateCompanyMembership } from "./company-membership.service.js";
import { getContactsWithLastMessage } from "./contact.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const PASSWORD = "Correct-Horse-123!";

async function loginAndGetHeaders(email: string, companyId: string) {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return {
    authorization: `Bearer ${body.tokens.accessToken}`,
    "x-company-id": companyId,
    "content-type": "application/json",
  };
}

async function withTenantFixture(
  run: (ctx: {
    companyId: string;
    userId: string;
    headers: Record<string, string>;
    tenantDb: ReturnType<typeof getTenantConnection>;
  }) => Promise<void>,
): Promise<void> {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const userId = crypto.randomUUID();
  const email = `inbox-lateral-${userId}@example.com`;

  try {
    await db
      .insertInto("users")
      .values({
        id: userId,
        email,
        password_hash: await hashPassword(PASSWORD),
        email_verified_at: new Date(),
      })
      .execute();
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Inbox lateral test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await db
      .insertInto("company_members")
      .values({ company_id: companyId, user_id: userId, role: "owner" })
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
        created_by: userId,
      })
      .execute();
    await createTenantSchema(companyId);

    const headers = await loginAndGetHeaders(email, companyId);
    const tenantDb = getTenantConnection(companyId);

    await run({ companyId, userId, headers, tenantDb });
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
    await db.deleteFrom("users").where("id", "=", userId).execute();
  }
}

async function insertContact(
  tenantDb: ReturnType<typeof getTenantConnection>,
  overrides: Record<string, unknown> = {},
) {
  const id = crypto.randomUUID();
  const [contact] = await tenantDb
    .insertInto("contacts")
    .values({
      id,
      jid: `${Date.now()}-${id.slice(0, 8)}@s.whatsapp.net`,
      push_name: `Contact ${id.slice(0, 6)}`,
      ...overrides,
    })
    .returning("id")
    .execute();
  return contact.id;
}

async function insertMessage(
  tenantDb: ReturnType<typeof getTenantConnection>,
  contactId: string,
  timestamp: Date,
  overrides: Record<string, unknown> = {},
) {
  const id = crypto.randomUUID();
  await tenantDb
    .insertInto("messages")
    .values({
      id,
      contact_id: contactId,
      message_id: `wa_${id}`,
      from_me: false,
      message_type: "text",
      content: `Message ${id.slice(0, 8)}`,
      status: "delivered",
      timestamp,
      created_at: new Date(),
      ...overrides,
    })
    .execute();
  return id;
}

interface ContactResponse {
  id: string;
  lastMessage: {
    id: string;
    messageId: string | null;
    fromMe: boolean;
    sentByUserId: string | null;
    sentByUserName: string | null;
    messageType: string;
    content: string | null;
    status: string;
    timestamp: string;
  } | null;
  lastMessageAt: string | null;
  pushName: string | null;
  isGroup: boolean;
  connection: { id: string } | null;
}

function getContacts(
  headers: Record<string, string>,
  params: Record<string, string> = {},
) {
  const qs = new URLSearchParams(params);
  return app.request(`/api/contacts?${qs.toString()}`, { headers });
}

describe("Inbox lateral-join query", () => {
  integrationTest(
    "avatar reuse never caches contact data or authorization",
    async () => {
      await withTenantFixture(
        async ({ headers, tenantDb, companyId, userId }) => {
          const contactId = await insertContact(tenantDb, {
            push_name: "Before rename",
            profile_picture_url: getPrivateMediaReference(
              `media/${companyId}/avatar.jpg`,
            ),
          });
          const first = await getContacts(headers, { limit: "100" });
          expect(first.status).toBe(200);
          const timing = first.headers.get("server-timing")!;
          expect(timing).toMatch(
            /^contacts_db;dur=\d+\.\d, avatars;dur=\d+\.\d, contacts_api;dur=\d+\.\d$/,
          );
          const firstBody = (await first.json()) as {
            data: { profilePictureUrl: string }[];
          };
          expect(
            new URL(firstBody.data[0].profilePictureUrl).searchParams.get(
              "X-Amz-Expires",
            ),
          ).toBe("300");

          await tenantDb
            .updateTable("contacts")
            .set({ push_name: "After rename" })
            .where("id", "=", contactId)
            .execute();
          const second = await getContacts(headers, { limit: "100" });
          const secondBody = (await second.json()) as {
            data: { pushName: string; profilePictureUrl: string }[];
          };
          expect(secondBody.data[0].pushName).toBe("After rename");
          expect(secondBody.data[0].profilePictureUrl).toBe(
            firstBody.data[0].profilePictureUrl,
          );

          // A warm signature must not make a revoked workspace membership usable.
          await db
            .deleteFrom("company_members")
            .where("company_id", "=", companyId)
            .where("user_id", "=", userId)
            .execute();
          const denied = await getContacts(headers, { limit: "100" });
          expect(denied.status).toBe(403);
          expect(await denied.text()).not.toContain("X-Amz-Signature");
        },
      );
    },
  );

  integrationTest(
    "broadcast feeds never consume page slots or inflate filtered totals",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const visible = await insertContact(tenantDb, {
          jid: null,
          push_name: "Feed regression",
        });
        const status = await insertContact(tenantDb, {
          jid: "status@broadcast",
          is_group: true,
          push_name: "Feed regression",
        });
        const broadcast = await insertContact(tenantDb, {
          jid: "123@broadcast",
          push_name: "Feed regression",
        });
        await tenantDb
          .insertInto("conversation_states")
          .values(
            [visible, status, broadcast].map((contact_id) => ({
              contact_id,
              unread_count: 1,
              status: "open" as const,
            })),
          )
          .execute();
        await insertMessage(tenantDb, visible, new Date("2026-01-01"));
        await insertMessage(tenantDb, status, new Date("2026-01-03"));
        await insertMessage(tenantDb, broadcast, new Date("2026-01-02"));
        for (const includeGroups of ["true", "false"]) {
          for (const unreadOnly of ["true", "false"]) {
            for (const offset of ["0", "1"]) {
              const response = await getContacts(headers, {
                includeGroups,
                unreadOnly,
                offset,
                limit: "1",
                search: "Feed regression",
                conversationStatus: "open",
              });
              expect(response.status).toBe(200);
              const body = (await response.json()) as {
                data: ContactResponse[];
                pagination: { total: number; hasMore: boolean };
              };
              expect(body.data.map((row) => row.id)).toEqual(
                offset === "0" ? [visible] : [],
              );
              expect(body.pagination).toMatchObject({
                total: 1,
                hasMore: false,
              });
            }
          }
        }
      });
    },
    30_000,
  );

  integrationTest(
    "unread contacts paginate merged customers with matching counts and assignment visibility",
    async () => {
      await withTenantFixture(
        async ({ companyId, userId, headers, tenantDb }) => {
          const connectionId = crypto.randomUUID();
          await tenantDb
            .insertInto("whatsapp_connections")
            .values({ id: connectionId, name: "Merged account" })
            .execute();
          const survivor = await insertContact(tenantDb, {
            push_name: "Merged customer",
          });
          const alias = await insertContact(tenantDb, {
            merged_into_contact_id: survivor,
            whatsapp_connection_id: connectionId,
          });
          const olderUnread = await insertContact(tenantDb);
          const newestRead = await insertContact(tenantDb);
          const noState = await insertContact(tenantDb);
          await insertMessage(tenantDb, survivor, new Date("2026-01-01"));
          await insertMessage(tenantDb, olderUnread, new Date("2026-01-02"));
          await insertMessage(tenantDb, newestRead, new Date("2026-01-04"));
          await tenantDb
            .insertInto("conversation_states")
            .values([
              {
                contact_id: alias,
                unread_count: 3,
                last_message_at: new Date("2026-01-03"),
              },
              { contact_id: olderUnread, unread_count: 2 },
              { contact_id: newestRead, unread_count: 0 },
            ])
            .execute();
          await tenantDb
            .insertInto("contact_assignments")
            .values({
              contact_id: alias,
              assigned_to: userId,
              assigned_by: userId,
            })
            .execute();
          const tagId = crypto.randomUUID();
          await tenantDb
            .insertInto("tags")
            .values({ id: tagId, name: "Merged" })
            .execute();
          await tenantDb
            .insertInto("contact_tags")
            .values({ contact_id: survivor, tag_id: tagId })
            .execute();

          const list = async (params: Record<string, string>) => {
            const response = await getContacts(headers, params);
            expect(response.status).toBe(200);
            return (await response.json()) as {
              data: (ContactResponse & {
                unreadCount: number;
                chatCount: number;
              })[];
              pagination: { total: number; offset: number; hasMore: boolean };
            };
          };
          for (const offset of [0, 1, 2]) {
            const body = await list({
              unreadOnly: "true",
              limit: "1",
              offset: String(offset),
            });
            expect(body.data.map((row) => row.id)).toEqual(
              [survivor, olderUnread].slice(offset, offset + 1),
            );
            expect(body.pagination).toMatchObject({
              total: 2,
              offset,
              hasMore: offset === 0,
            });
            if (offset === 0) {
              expect(body.data[0].unreadCount).toBe(3);
              expect(body.data[0].chatCount).toBe(2);
              expect(body.data[0].lastMessageAt).toBe(
                "2026-01-03T00:00:00.000Z",
              );
              // Merged activity orders the customer; preview remains the survivor's thread.
              expect(body.data[0].lastMessage?.timestamp).toBe(
                "2026-01-01T00:00:00.000Z",
              );
            }
          }
          for (const filter of [
            { assignedToMe: "true" },
            { connectionId },
            { tagIds: tagId },
            { search: "Merged customer" },
          ] as Record<string, string>[]) {
            const body = await list({
              ...filter,
              unreadOnly: "true",
              limit: "1",
            });
            expect(body.data.map((row) => row.id)).toEqual([survivor]);
            expect(body.pagination.total).toBe(1);
          }
          const unassigned = await list({
            unreadOnly: "true",
            unassigned: "true",
          });
          expect(unassigned.data.map((row) => row.id)).toEqual([olderUnread]);
          expect(unassigned.pagination.total).toBe(1);
          const all = await list({ unreadOnly: "false" });
          expect(all.data.map((row) => row.id)).toEqual([
            newestRead,
            survivor,
            olderUnread,
            noState,
          ]);
          expect(all.pagination.total).toBe(4);
          for (const unreadOnly of ["yes", "1", "TRUE", ""]) {
            expect((await getContacts(headers, { unreadOnly })).status).toBe(
              400,
            );
          }

          // Client filters cannot broaden the assignment-only member's visibility.
          await db
            .updateTable("company_members")
            .set({ role: "member", permissions: { can_view_all_chats: false } })
            .where("company_id", "=", companyId)
            .where("user_id", "=", userId)
            .execute();
          invalidateCompanyMembership(companyId);
          for (const params of [
            { unreadOnly: "true" },
            { unreadOnly: "true", unassigned: "true" },
            { unreadOnly: "false", assignedToMe: "false" },
          ] as Record<string, string>[]) {
            const body = await list(params);
            expect(body.data.map((row) => row.id)).toEqual([survivor]);
            expect(body.pagination.total).toBe(1);
          }
          const pastEnd = await list({
            unreadOnly: "true",
            limit: "1",
            offset: "1",
          });
          expect(pastEnd.data).toEqual([]);
          expect(pastEnd.pagination).toMatchObject({
            total: 1,
            hasMore: false,
          });
        },
      );
    },
    30_000,
  );

  integrationTest(
    "page candidates use authoritative messages, conversation precedence and deterministic ties",
    async () => {
      await withTenantFixture(async ({ companyId, userId, tenantDb }) => {
        const account = crypto.randomUUID();
        await tenantDb
          .insertInto("channel_accounts")
          .values({
            id: account,
            channel: "telegram",
            provider: "telegram_bot",
            status: "connected",
          })
          .execute();
        const bridged = await insertContact(tenantDb);
        const fallback = await insertContact(tenantDb);
        const empty = await insertContact(tenantDb);
        const conversationId = crypto.randomUUID();
        await tenantDb
          .insertInto("conversations")
          .values({
            id: conversationId,
            channel_account_id: account,
            legacy_contact_id: bridged,
            external_thread_id: "bridged",
            client_thread_key: "bridged",
            kind: "direct",
            last_message_at: new Date("2020-01-01"),
          })
          .execute();
        await tenantDb
          .insertInto("conversation_states")
          .values({
            conversation_id: conversationId,
            contact_id: null,
            unread_count: 7,
            status: "pending",
            last_message_at: new Date("2020-01-01"),
          })
          .execute();
        const timestamp = new Date("2026-01-03");
        const ids = await Promise.all(
          [1, 2].map(() =>
            insertMessage(tenantDb, bridged, timestamp, {
              conversation_id: conversationId,
              content: "Authoritative preview",
              sent_by_user_id: userId,
            }),
          ),
        );
        // Newer legacy-only data must NOT override a bridged thread's message.
        await insertMessage(tenantDb, bridged, new Date("2030-01-01"));
        await insertMessage(tenantDb, fallback, new Date("2026-01-02"));
        for (const [offset, expected] of [bridged, fallback, empty].entries()) {
          const page = await getContactsWithLastMessage(tenantDb, companyId, {
            limit: 1,
            offset,
          });
          expect(page.total).toBe(3);
          expect(page.contacts.map((row) => row.id)).toEqual([expected]);
          if (offset === 0) {
            expect(page.contacts[0]).toMatchObject({
              last_message_at: timestamp,
              conversation_id: conversationId,
              conversation_status: "pending",
              unread_count: 7n,
            });
            expect(page.contacts[0].last_message).toMatchObject({
              id: ids.sort().at(-1),
              content: "Authoritative preview",
              timestamp,
              sentByUserId: userId,
            });
          }
        }
        const filtered = await getContactsWithLastMessage(tenantDb, companyId, {
          unreadOnly: true,
          conversationStatus: "pending",
          limit: 1,
        });
        expect(filtered.total).toBe(1);
        expect(filtered.contacts[0].id).toBe(bridged);

        // Pin the connection so this checks the actual backend session, not a
        // different pool member. SET LOCAL must be gone after success AND error.
        await tenantDb.connection().execute(async (connection) => {
          const before = (
            await sql<{ jit: string }>`SHOW jit`.execute(connection)
          ).rows[0].jit;
          const jitDuringRead: string[] = [];
          const backend = await connection
            .getExecutor()
            .provideConnection(async (driverConnection) => driverConnection);
          const observedConnection = connection.withPlugin({
            transformQuery({ node }) {
              return node;
            },
            async transformResult({ result }) {
              // Observe the pinned driver only after its query completes. Do
              // not reacquire Kysely's connection lock from inside a plugin.
              jitDuringRead.push(
                (
                  await backend.executeQuery<{ jit: string }>(
                    CompiledQuery.raw("SHOW jit"),
                  )
                ).rows[0].jit,
              );
              return result;
            },
          });
          await getContactsWithLastMessage(observedConnection, companyId, {
            unreadOnly: true,
            conversationStatus: "pending",
          });
          // SET LOCAL, row SQL, and filtered count SQL all run with JIT off.
          expect(jitDuringRead).toEqual(["off", "off", "off"]);
          expect(
            (await sql<{ jit: string }>`SHOW jit`.execute(connection)).rows[0]
              .jit,
          ).toBe(before);
          await expect(
            getContactsWithLastMessage(connection, companyId, { limit: -1 }),
          ).rejects.toThrow();
          expect(
            (await sql<{ jit: string }>`SHOW jit`.execute(connection)).rows[0]
              .jit,
          ).toBe(before);

          for (const jit of ["on", "off"]) {
            const rollback = new Error(
              "rollback caller-owned transaction fixture",
            );
            let insertedId = "";
            await expect(
              connection.transaction().execute(async (trx) => {
                await sql`SELECT set_config('jit', ${jit}, true)`.execute(trx);
                insertedId = await insertContact(trx, {
                  push_name: "Uncommitted contact",
                });
                const page = await getContactsWithLastMessage(trx, companyId, {
                  search: "Uncommitted contact",
                });
                // Reuses the caller's transaction and sees its uncommitted writes.
                expect(page.contacts.map((row) => row.id)).toEqual([
                  insertedId,
                ]);
                expect(page.total).toBe(1);
                expect(
                  (await sql<{ jit: string }>`SHOW jit`.execute(trx)).rows[0]
                    .jit,
                ).toBe(jit);
                throw rollback;
              }),
            ).rejects.toBe(rollback);
            expect(
              await connection
                .selectFrom("contacts")
                .select("id")
                .where("id", "=", insertedId)
                .executeTakeFirst(),
            ).toBeUndefined();
            expect(
              (await sql<{ jit: string }>`SHOW jit`.execute(connection)).rows[0]
                .jit,
            ).toBe(before);
          }
        });
      });
    },
    30_000,
  );

  integrationTest(
    "channel unread is filtered before paging without bypassing tags, mirrors or assignment permissions",
    async () => {
      await withTenantFixture(
        async ({ companyId, userId, headers, tenantDb }) => {
          await db
            .insertInto("channel_spine_workspace_flags")
            .values({
              company_id: companyId,
              neutral_reads_enabled: true,
              neutral_read_revision: "unread-test",
              revision: "1",
              created_by: userId,
              updated_by: userId,
            })
            .execute();
          const account = crypto.randomUUID();
          const mirrorAccount = crypto.randomUUID();
          await tenantDb
            .insertInto("whatsapp_connections")
            .values({ id: mirrorAccount, name: "Mirror" })
            .execute();
          await tenantDb
            .insertInto("channel_accounts")
            .values([
              {
                id: account,
                channel: "telegram",
                provider: "telegram_bot",
                status: "connected",
              },
              {
                id: mirrorAccount,
                channel: "whatsapp",
                provider: "whatsapp_linked_device",
                status: "connected",
                legacy_whatsapp_connection_id: mirrorAccount,
              },
            ])
            .execute();
          const survivor = await insertContact(tenantDb);
          const merged = await insertContact(tenantDb, {
            merged_into_contact_id: survivor,
          });
          const legacyAssigned = await insertContact(tenantDb);
          const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
          await tenantDb
            .insertInto("conversations")
            .values(
              ids.map((id, index) => ({
                id,
                channel_account_id: index === 5 ? mirrorAccount : account,
                external_thread_id: id,
                client_thread_key: id,
                kind: "direct" as const,
                last_message_at: new Date(Date.UTC(2026, 0, 10 - index)),
                legacy_contact_id:
                  index === 6 ? merged : index === 4 ? legacyAssigned : null,
                archived_at: index === 7 ? new Date() : null,
              })),
            )
            .execute();
          // Newest is read, second has no state, so neither may consume a page slot.
          await tenantDb
            .insertInto("conversation_states")
            .values(
              ids
                .filter((_, i) => i !== 1)
                .map((id) => ({
                  conversation_id: id,
                  unread_count: id === ids[0] ? 0 : 2,
                })),
            )
            .execute();
          await tenantDb
            .insertInto("contact_assignments")
            .values([
              {
                conversation_id: ids[3],
                assigned_to: userId,
                assigned_by: userId,
              },
              {
                contact_id: legacyAssigned,
                assigned_to: userId,
                assigned_by: userId,
              },
              {
                conversation_id: ids[2],
                assigned_to: userId,
                assigned_by: userId,
                unassigned_at: new Date(),
              },
            ])
            .execute();
          const tag = crypto.randomUUID();
          await tenantDb
            .insertInto("tags")
            .values({ id: tag, name: "Unread" })
            .execute();
          await tenantDb
            .insertInto("conversation_tags")
            .values({ conversation_id: ids[4], tag_id: tag })
            .execute();
          const list = async (query: string) => {
            const response = await app.request(`/api/conversations?${query}`, {
              headers,
            });
            expect(response.status).toBe(200);
            return (
              (await response.json()) as {
                data: { id: string; unreadCount: number }[];
              }
            ).data;
          };
          for (const offset of [0, 1, 2, 3]) {
            const rows = await list(`unreadOnly=true&limit=1&offset=${offset}`);
            expect(rows.map((row) => row.id)).toEqual(
              ids.slice(2, 5).slice(offset, offset + 1),
            );
            rows.forEach((row) => expect(row.unreadCount).toBe(2));
          }
          expect((await list("unreadOnly=false")).map((row) => row.id)).toEqual(
            ids.slice(0, 5),
          );
          expect(
            (await list(`unreadOnly=true&tagIds=${tag}`)).map((row) => row.id),
          ).toEqual([ids[4]]);
          for (const value of ["1", "yes", "TRUE", ""]) {
            expect(
              (
                await app.request(`/api/conversations?unreadOnly=${value}`, {
                  headers,
                })
              ).status,
            ).toBe(400);
          }
          await db
            .updateTable("company_members")
            .set({ role: "member", permissions: { can_view_all_chats: false } })
            .where("company_id", "=", companyId)
            .where("user_id", "=", userId)
            .execute();
          invalidateCompanyMembership(companyId);
          for (const offset of [0, 1, 2]) {
            const rows = await list(`unreadOnly=true&limit=1&offset=${offset}`);
            expect(rows.map((row) => row.id)).toEqual(
              ids.slice(3, 5).slice(offset, offset + 1),
            );
          }
          expect(
            (await list(`unreadOnly=true&tagIds=${tag}`)).map((row) => row.id),
          ).toEqual([ids[4]]);
          // An authenticated user still cannot select a workspace they do not belong to.
          expect(
            (
              await app.request("/api/conversations?unreadOnly=true", {
                headers: { ...headers, "x-company-id": crypto.randomUUID() },
              })
            ).status,
          ).toBe(403);
        },
      );
    },
    30_000,
  );

  integrationTest(
    "offset pages have stable ordering for tied and null activity",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const ids = await Promise.all(
          Array.from({ length: 5 }, () => insertContact(tenantDb)),
        );
        // No-message contacts all have a null activity timestamp. The UUID
        // tiebreaker must still make each page disjoint and repeatable.
        const expected = [...ids].sort().reverse();
        for (const offset of [0, 2, 4, 5]) {
          const response = await getContacts(headers, {
            limit: "2",
            offset: String(offset),
          });
          expect(response.status).toBe(200);
          const body = (await response.json()) as {
            data: ContactResponse[];
            pagination: { offset: number; hasMore: boolean };
          };
          expect(body.data.map((row) => row.id)).toEqual(
            expected.slice(offset, offset + 2),
          );
          expect(body.pagination.offset).toBe(offset);
          expect(body.pagination.hasMore).toBe(offset + 2 < ids.length);
        }
        const sameTime = new Date("2026-01-01T00:00:00Z");
        await Promise.all(
          ids.map((id) => insertMessage(tenantDb, id, sameTime)),
        );
        const first = (await (
          await getContacts(headers, { limit: "2" })
        ).json()) as { data: ContactResponse[] };
        const second = (await (
          await getContacts(headers, { limit: "2", offset: "2" })
        ).json()) as { data: ContactResponse[] };
        expect(first.data.map((row) => row.id)).toEqual(expected.slice(0, 2));
        expect(second.data.map((row) => row.id)).toEqual(expected.slice(2, 4));
      });
    },
    30_000,
  );

  integrationTest(
    "channel inbox pages advance with tags and reject invalid offsets",
    async () => {
      await withTenantFixture(
        async ({ companyId, userId, headers, tenantDb }) => {
          await db
            .insertInto("channel_spine_workspace_flags")
            .values({
              company_id: companyId,
              neutral_reads_enabled: true,
              neutral_read_revision: "pagination-test",
              revision: "1",
              created_by: userId,
              updated_by: userId,
            })
            .execute();
          const accountId = crypto.randomUUID();
          const tagId = crypto.randomUUID();
          await tenantDb
            .insertInto("channel_accounts")
            .values({
              id: accountId,
              channel: "telegram",
              provider: "telegram_bot",
              external_account_id: "pagination-bot",
              external_scope_id: "telegram-bot",
              status: "connected",
            })
            .execute();
          await tenantDb
            .insertInto("tags")
            .values({ id: tagId, name: "Paged" })
            .execute();
          const ids = Array.from({ length: 5 }, () => crypto.randomUUID())
            .sort()
            .reverse();
          await tenantDb
            .insertInto("conversations")
            .values(
              ids.map((id) => ({
                id,
                channel_account_id: accountId,
                external_thread_id: id,
                client_thread_key: `telegram:${id}:root`,
                kind: "direct" as const,
                last_message_at: new Date("2026-01-01T00:00:00Z"),
              })),
            )
            .execute();
          const taggedIds = [ids[0], ids[2], ids[4]];
          await tenantDb
            .insertInto("conversation_tags")
            .values(
              taggedIds.map((id) => ({
                conversation_id: id,
                tag_id: tagId,
              })),
            )
            .execute();

          for (const [filter, expected] of [
            ["", ids],
            [`&tagIds=${tagId}`, taggedIds],
          ] as const) {
            for (const offset of [0, 2, 4, 6]) {
              const response = await app.request(
                `/api/conversations?limit=2&offset=${offset}${filter}`,
                { headers },
              );
              expect(response.status).toBe(200);
              const body = (await response.json()) as {
                data: { id: string }[];
              };
              expect(body.data.map((row) => row.id)).toEqual(
                expected.slice(offset, offset + 2),
              );
            }
          }
          for (const offset of [
            "-1",
            "1.5",
            "nope",
            "Infinity",
            "9007199254740992",
          ]) {
            const response = await app.request(
              `/api/conversations?offset=${offset}`,
              { headers },
            );
            expect(response.status).toBe(400);
          }
        },
      );
    },
    30_000,
  );

  integrationTest(
    "tied latest timestamps return deterministic last message per contact",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const sameTs = new Date("2025-06-01T12:00:00Z");

        const contactA = await insertContact(tenantDb);
        const contactB = await insertContact(tenantDb);

        const msgA1 = await insertMessage(tenantDb, contactA, sameTs);
        const msgA2 = await insertMessage(tenantDb, contactA, sameTs);
        const msgB1 = await insertMessage(tenantDb, contactB, sameTs);
        const msgB2 = await insertMessage(tenantDb, contactB, sameTs);

        const res = await getContacts(headers, { limit: "10" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          data: ContactResponse[];
        };

        const contactARow = body.data.find((c) => c.id === contactA);
        const contactBRow = body.data.find((c) => c.id === contactB);
        expect(contactARow).toBeDefined();
        expect(contactBRow).toBeDefined();

        // Lateral uses ORDER BY timestamp DESC, id DESC — highest UUID wins
        const expectedA = msgA1 > msgA2 ? msgA1 : msgA2;
        const expectedB = msgB1 > msgB2 ? msgB1 : msgB2;
        expect(contactARow!.lastMessage!.id).toBe(expectedA);
        expect(contactBRow!.lastMessage!.id).toBe(expectedB);

        // Both calls must return the same result (deterministic)
        const res2 = await getContacts(headers, { limit: "10" });
        const body2 = (await res2.json()) as { data: ContactResponse[] };
        const contactARow2 = body2.data.find((c) => c.id === contactA);
        expect(contactARow2!.lastMessage!.id).toBe(expectedA);
      });
    },
  );

  integrationTest(
    "returned last-message includes all expected fields",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const contactId = await insertContact(tenantDb);
        const ts = new Date("2025-06-01T12:00:00Z");
        const msgId = await insertMessage(tenantDb, contactId, ts, {
          from_me: true,
          message_type: "image",
          content: "photo.jpg",
          status: "read",
        });

        const res = await getContacts(headers, { limit: "10" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };
        const row = body.data.find((c) => c.id === contactId);
        expect(row).toBeDefined();
        expect(row!.lastMessage).not.toBeNull();

        const lm = row!.lastMessage!;
        expect(lm.id).toBe(msgId);
        expect(lm.messageId).toBe(`wa_${msgId}`);
        expect(lm.fromMe).toBe(true);
        expect(lm.messageType).toBe("image");
        expect(lm.content).toBe("photo.jpg");
        expect(lm.status).toBe("read");
        expect(lm.timestamp).toBeTruthy();
        // sentByUserId is null because we didn't set it
        expect(lm.sentByUserId).toBeNull();
        expect(lm.sentByUserName).toBeNull();
      });
    },
  );

  integrationTest(
    "contact with zero messages appears with null lastMessage and lastMessageAt",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        await insertContact(tenantDb);

        const res = await getContacts(headers, { limit: "10" });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };

        expect(body.data.length).toBe(1);
        expect(body.data[0].lastMessage).toBeNull();
        expect(body.data[0].lastMessageAt).toBeNull();
      });
    },
  );

  integrationTest(
    "search filter excludes contacts even with recent messages",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const contactMatch = await insertContact(tenantDb, {
          push_name: "Alice Wonderland",
        });
        const contactNoMatch = await insertContact(tenantDb, {
          push_name: "Bob Builder",
        });

        const ts = new Date("2025-06-01T12:00:00Z");
        // Give Bob a more recent message
        await insertMessage(tenantDb, contactMatch, ts);
        await insertMessage(
          tenantDb,
          contactNoMatch,
          new Date("2025-06-02T12:00:00Z"),
        );

        const res = await getContacts(headers, {
          limit: "10",
          search: "Alice",
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };

        expect(body.data.length).toBe(1);
        expect(body.data[0].id).toBe(contactMatch);
      });
    },
  );

  integrationTest(
    "connectionId filter scopes results to one WhatsApp account",
    async () => {
      await withTenantFixture(async ({ headers, tenantDb }) => {
        const connA = crypto.randomUUID();
        const connB = crypto.randomUUID();
        await tenantDb
          .insertInto("whatsapp_connections")
          .values([
            { id: connA, name: "Phone A" },
            { id: connB, name: "Phone B" },
          ])
          .execute();

        const contactA = await insertContact(tenantDb, {
          whatsapp_connection_id: connA,
        });
        const contactB = await insertContact(tenantDb, {
          whatsapp_connection_id: connB,
        });

        const ts = new Date("2025-06-01T12:00:00Z");
        await insertMessage(tenantDb, contactA, ts);
        await insertMessage(tenantDb, contactB, ts);

        const res = await getContacts(headers, {
          limit: "10",
          connectionId: connA,
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: ContactResponse[] };

        expect(body.data.length).toBe(1);
        expect(body.data[0].id).toBe(contactA);
      });
    },
  );

  integrationTest("includeGroups=false excludes group contacts", async () => {
    await withTenantFixture(async ({ headers, tenantDb }) => {
      const directContact = await insertContact(tenantDb);
      const groupContact = await insertContact(tenantDb, {
        is_group: true,
        jid: `${Date.now()}@g.us`,
      });

      const ts = new Date("2025-06-01T12:00:00Z");
      await insertMessage(tenantDb, directContact, ts);
      await insertMessage(tenantDb, groupContact, ts);

      // Default is includeGroups=false
      const res = await getContacts(headers, { limit: "10" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: ContactResponse[] };

      const ids = body.data.map((c) => c.id);
      expect(ids).toContain(directContact);
      expect(ids).not.toContain(groupContact);

      // With includeGroups=true
      const res2 = await getContacts(headers, {
        limit: "10",
        includeGroups: "true",
      });
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { data: ContactResponse[] };
      const ids2 = body2.data.map((c) => c.id);
      expect(ids2).toContain(directContact);
      expect(ids2).toContain(groupContact);
    });
  });
});
