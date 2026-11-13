import { expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  getInboxPage,
  getInboxUnreadTotal,
  type InboxItem,
  type InboxQuery,
} from "./inbox.service.js";
import { decodeInboxCursor } from "./inbox-cursor.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const label = (item: InboxItem) =>
  item.kind === "contact"
    ? (item.contact.push_name ?? item.contact.id)
    : (item.thread.subject ?? item.thread.id);

/** Walk every page with the cursor and return labels in order. */
async function walk(
  tenantDb: ReturnType<typeof getTenantConnection>,
  companyId: string,
  query: InboxQuery,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: InboxQuery["cursor"] = query.cursor;
  for (let guard = 0; guard < 50; guard++) {
    const page = await getInboxPage(tenantDb, companyId, { ...query, cursor });
    seen.push(...page.items.map(label));
    if (!page.nextCursor) return seen;
    cursor = decodeInboxCursor(page.nextCursor) ?? undefined;
    expect(cursor).toBeDefined();
  }
  throw new Error("cursor never ended");
}

integration(
  "orders customers and channel threads together and pages them by cursor",
  async () => {
    const companyId = crypto.randomUUID();
    const schemaName = getSchemaName(companyId);
    const owner = crypto.randomUUID();
    const member = crypto.randomUUID();
    const telegram = crypto.randomUUID();
    const base = Date.parse("2026-11-01T00:00:00Z");
    // Activity at a whole minute plus a sub-millisecond offset, so ties and
    // microsecond precision are both exercised.
    const at = (minutes: number) => new Date(base - minutes * 60_000);
    try {
      await db
        .insertInto("companies")
        .values({
          id: companyId,
          name: "Unified inbox",
          schema_name: schemaName,
          status: "active",
        })
        .execute();
      await createTenantSchema(companyId);
      const tenantDb = getTenantConnection(companyId);

      await tenantDb
        .insertInto("channel_accounts")
        .values({
          id: telegram,
          channel: "telegram",
          provider: "telegram_bot",
          display_name: "Support bot",
          status: "connected",
        })
        .execute();

      // Customers WA 1..6 at minutes 1,3,5,7,9,11; threads TG 1..4 at 2,4,6,8.
      const contacts = Array.from({ length: 6 }, (_, index) => ({
        id: crypto.randomUUID(),
        push_name: `WA ${index + 1}`,
        minute: index * 2 + 1,
      }));
      await tenantDb
        .insertInto("contacts")
        .values(contacts.map(({ id, push_name }) => ({ id, push_name })))
        .execute();
      await tenantDb
        .insertInto("messages")
        .values(
          contacts.map((contact, index) => ({
            contact_id: contact.id,
            message_id: `m-${index}`,
            content: `hello ${index}`,
            from_me: false,
            message_type: "text",
            timestamp: at(contact.minute),
          })),
        )
        .execute();
      const threads = Array.from({ length: 4 }, (_, index) => ({
        id: crypto.randomUUID(),
        subject: `TG ${index + 1}`,
        minute: index * 2 + 2,
      }));
      await tenantDb
        .insertInto("conversations")
        .values(
          threads.map((thread) => ({
            id: thread.id,
            channel_account_id: telegram,
            client_thread_key: `tg:${thread.id}`,
            kind: "direct",
            subject: thread.subject,
            first_message_at: at(thread.minute),
            last_message_at: at(thread.minute),
          })),
        )
        .execute();
      await tenantDb
        .insertInto("conversation_states")
        .values([
          { conversation_id: threads[0].id, unread_count: 2, status: "open" },
          {
            conversation_id: threads[1].id,
            unread_count: 0,
            status: "resolved",
          },
        ])
        .execute();
      await tenantDb
        .insertInto("conversation_states")
        .values({ contact_id: contacts[0].id, unread_count: 3, status: "open" })
        .execute();
      // A tie: TG 4 shares WA 4's exact activity. Customers sort first.
      await tenantDb
        .updateTable("conversations")
        .set({ last_message_at: at(contacts[3].minute) })
        .where("id", "=", threads[3].id)
        .execute();
      // Member sees only what is assigned to them: WA 2 and TG 3.
      await tenantDb
        .insertInto("contact_assignments")
        .values([
          {
            contact_id: contacts[1].id,
            assigned_to: member,
            assigned_by: owner,
          },
          {
            conversation_id: threads[2].id,
            assigned_to: member,
            assigned_by: owner,
          },
        ])
        .execute();

      const everything: InboxQuery = {
        limit: 3,
        includeGroups: true,
        conversationStatus: "all",
        userId: owner,
        restrictToAssigned: false,
        includeThreads: true,
      };
      const expected = [
        "WA 1",
        "TG 1",
        "WA 2",
        "TG 2",
        "WA 3",
        "TG 3",
        "WA 4",
        "TG 4",
        "WA 5",
        "WA 6",
      ];
      // Every page size walks the same single order, with no gaps or repeats.
      for (const limit of [1, 2, 3, 4, 10, 100]) {
        expect(
          await walk(tenantDb, companyId, { ...everything, limit }),
        ).toEqual(expected);
      }

      // Paging back up with prevCursor returns the rows just above, in order.
      const third = await getInboxPage(tenantDb, companyId, {
        ...everything,
        limit: 3,
        cursor:
          decodeInboxCursor(
            (
              await getInboxPage(tenantDb, companyId, {
                ...everything,
                limit: 6,
              })
            ).nextCursor ?? "",
          ) ?? undefined,
      });
      expect(third.items.map(label)).toEqual(["WA 4", "TG 4", "WA 5"]);
      const back = await getInboxPage(tenantDb, companyId, {
        ...everything,
        limit: 3,
        direction: "before",
        cursor: decodeInboxCursor(third.prevCursor ?? "") ?? undefined,
      });
      expect(back.items.map(label)).toEqual(["TG 2", "WA 3", "TG 3"]);
      expect(back.nextCursor).not.toBeNull();
      const top = await getInboxPage(tenantDb, companyId, {
        ...everything,
        limit: 5,
        direction: "before",
        cursor: decodeInboxCursor(back.prevCursor ?? "") ?? undefined,
      });
      expect(top.items.map(label)).toEqual(["WA 1", "TG 1", "WA 2"]);
      expect(top.prevCursor).toBeNull();

      // Workspaces without spine reads list customers only, as before.
      expect(
        await walk(tenantDb, companyId, {
          ...everything,
          includeThreads: false,
        }),
      ).toEqual(["WA 1", "WA 2", "WA 3", "WA 4", "WA 5", "WA 6"]);

      // Filters apply to both kinds in SQL.
      expect(
        await walk(tenantDb, companyId, { ...everything, unreadOnly: true }),
      ).toEqual(["WA 1", "TG 1"]);
      expect(
        await walk(tenantDb, companyId, {
          ...everything,
          conversationStatus: "resolved",
        }),
      ).toEqual(
        // Customers with no state read as resolved; TG 2 is resolved.
        ["WA 2", "TG 2", "WA 3", "WA 4", "WA 5", "WA 6"],
      );
      expect(
        await walk(tenantDb, companyId, { ...everything, accountId: telegram }),
      ).toEqual(["TG 1", "TG 2", "TG 3", "TG 4"]);
      expect(
        await walk(tenantDb, companyId, { ...everything, search: "tg 3" }),
      ).toEqual(["TG 3"]);
      expect(
        await walk(tenantDb, companyId, {
          ...everything,
          userId: member,
          assignedToMe: true,
        }),
      ).toEqual(["WA 2", "TG 3"]);

      // Visibility: a member without view-all sees only their assignments.
      expect(
        await walk(tenantDb, companyId, {
          ...everything,
          userId: member,
          restrictToAssigned: true,
        }),
      ).toEqual(["WA 2", "TG 3"]);

      // The badge counts open unread across both kinds, with visibility.
      expect(
        await getInboxUnreadTotal(tenantDb, companyId, {
          userId: owner,
          restrictToAssigned: false,
          includeThreads: true,
        }),
      ).toBe(5);
      expect(
        await getInboxUnreadTotal(tenantDb, companyId, {
          userId: owner,
          restrictToAssigned: false,
          includeThreads: false,
        }),
      ).toBe(3);
      expect(
        await getInboxUnreadTotal(tenantDb, companyId, {
          userId: member,
          restrictToAssigned: true,
          includeThreads: true,
        }),
      ).toBe(0);

      // New activity while paging moves a row to the top; the cursor neither
      // repeats nor skips the rows that were already behind it.
      const first = await getInboxPage(tenantDb, companyId, {
        ...everything,
        limit: 4,
      });
      expect(first.items.map(label)).toEqual(["WA 1", "TG 1", "WA 2", "TG 2"]);
      await tenantDb
        .updateTable("conversations")
        .set({ last_message_at: new Date(base + 60_000) })
        .where("id", "=", threads[3].id)
        .execute();
      const rest = await walk(tenantDb, companyId, {
        ...everything,
        limit: 4,
        cursor: decodeInboxCursor(first.nextCursor ?? "") ?? undefined,
      });
      expect(rest).toEqual(["WA 3", "TG 3", "WA 4", "WA 5", "WA 6"]);
    } finally {
      await clearTenantConnection(companyId);
      await sql`DROP SCHEMA IF EXISTS ${sql.ref(schemaName)} CASCADE`.execute(
        db,
      );
      await db.deleteFrom("companies").where("id", "=", companyId).execute();
    }
  },
  60_000,
);
