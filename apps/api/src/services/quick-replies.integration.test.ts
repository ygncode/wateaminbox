import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { ConflictError } from "../lib/errors.js";
import {
  createQuickReply,
  deleteQuickReply,
  getQuickReplies,
  getQuickReplyById,
  updateQuickReply,
} from "./quick-replies.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function uniqueShortcutIndex(
  schemaName: string,
): Promise<{ name: string; unique: boolean; columns: string[] } | null> {
  const result = await sql<{
    indexname: string;
    is_unique: boolean;
    columns: string[];
  }>`
    SELECT
      i.relname AS indexname,
      ix.indisunique AS is_unique,
      array_agg(a.attname::text ORDER BY k.ord) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE n.nspname = ${schemaName} AND t.relname = 'quick_replies'
    GROUP BY i.relname, ix.indisunique
  `.execute(db);
  const match = result.rows.find(
    (row) =>
      row.columns.length === 1 &&
      row.columns[0] === "shortcut" &&
      row.is_unique,
  );
  return match
    ? {
        name: match.indexname,
        unique: match.is_unique,
        columns: match.columns,
      }
    : null;
}

async function quickReplyCount(
  schemaName: string,
  shortcut: string,
): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT count(*)::int AS count
    FROM ${sql.table(`${schemaName}.quick_replies`)}
    WHERE shortcut = ${shortcut}
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

describe("quick reply shortcut uniqueness", () => {
  integrationTest(
    "a newly created tenant enforces shortcut uniqueness at the DB level",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);

        const index = await uniqueShortcutIndex(schemaName);
        expect(index).not.toBeNull();
        expect(index?.name).toBe(`${schemaName}_qr_shortcut_uidx`);
        expect(index?.unique).toBe(true);

        // The legacy non-unique index the setup function created must not
        // linger alongside the authoritative one.
        const legacyName = `${schemaName}_quick_replies_shortcut_idx`.slice(
          0,
          63,
        );
        const legacy = await sql<{ indexname: string }>`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = ${schemaName} AND indexname = ${legacyName}
        `.execute(db);
        expect(legacy.rows).toHaveLength(0);

        // Reconcile is idempotent: re-running it changes nothing.
        await createTenantSchema(companyId);
        const again = await uniqueShortcutIndex(schemaName);
        expect(again?.name).toBe(`${schemaName}_qr_shortcut_uidx`);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "the database itself rejects a duplicate shortcut (23505)",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const userId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        await tenantDb
          .insertInto("quick_replies")
          .values({
            shortcut: "welcome",
            title: "T",
            content: "Hi",
            created_by: userId,
          })
          .execute();

        await expect(
          tenantDb
            .insertInto("quick_replies")
            .values({
              shortcut: "welcome",
              title: "Other",
              content: "Other",
              created_by: userId,
            })
            .execute(),
        ).rejects.toMatchObject({ code: "23505" });

        expect(await quickReplyCount(schemaName, "welcome")).toBe(1);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "sequential duplicate create raises ConflictError (409 contract)",
    async () => {
      const companyId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);

        const first = await createQuickReply(companyId, userId, {
          shortcut: "hi",
          title: "Hi",
          content: "Hello",
        });
        expect(first.shortcut).toBe("hi");

        await expect(
          createQuickReply(companyId, userId, {
            shortcut: "hi",
            title: "Hi again",
            content: "Hello again",
          }),
        ).rejects.toBeInstanceOf(ConflictError);

        const list = await getQuickReplies(companyId);
        expect(list.quickReplies).toHaveLength(1);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "concurrent creates of the same shortcut yield exactly one row and one 409",
    async () => {
      const companyId = crypto.randomUUID();
      const schemaName = getSchemaName(companyId);
      const userId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);

        const results = await Promise.allSettled([
          createQuickReply(companyId, userId, {
            shortcut: "race",
            title: "A",
            content: "from A",
          }),
          createQuickReply(companyId, userId, {
            shortcut: "race",
            title: "B",
            content: "from B",
          }),
          createQuickReply(companyId, userId, {
            shortcut: "race",
            title: "C",
            content: "from C",
          }),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(2);
        for (const r of rejected) {
          expect(r.reason).toBeInstanceOf(ConflictError);
        }

        // Exactly one row is persisted - the DB constraint is the backstop that
        // the non-atomic pre-check could not provide.
        expect(await quickReplyCount(schemaName, "race")).toBe(1);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "renaming onto a taken shortcut raises ConflictError; renaming to own keeps the row",
    async () => {
      const companyId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);

        await createQuickReply(companyId, userId, {
          shortcut: "keep",
          title: "Keep",
          content: "Keep",
        });
        const rename = await createQuickReply(companyId, userId, {
          shortcut: "rename",
          title: "Rename",
          content: "Rename",
        });

        // Renaming onto a shortcut another row holds is rejected by the DB.
        await expect(
          updateQuickReply(companyId, rename.id, { shortcut: "keep" }),
        ).rejects.toBeInstanceOf(ConflictError);

        // Renaming to the row's own current shortcut is a no-op on the unique
        // key and must not be misread as a collision.
        const self = await updateQuickReply(companyId, rename.id, {
          shortcut: "rename",
        });
        expect(self?.shortcut).toBe("rename");

        // A genuinely new shortcut still works.
        const renamed = await updateQuickReply(companyId, rename.id, {
          shortcut: "renamed",
        });
        expect(renamed?.shortcut).toBe("renamed");

        expect((await getQuickReplies(companyId)).quickReplies).toHaveLength(2);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );

  integrationTest(
    "content edits still sync pending auto-replies after the catch wrapping the transaction",
    async () => {
      const companyId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        const reply = await createQuickReply(companyId, userId, {
          shortcut: "hi",
          title: "Hi",
          content: "Hello",
        });
        const schedule = await tenantDb
          .insertInto("scheduled_messages")
          .values({
            contact_id: crypto.randomUUID(),
            content: "Hello",
            scheduled_at: new Date(Date.now() + 300000),
            next_attempt_at: new Date(Date.now() + 300000),
            created_by: userId,
            auto_reply_quick_reply_id: reply.id,
            status: "scheduled",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        await updateQuickReply(companyId, reply.id, { content: "Welcome" });

        const row = await tenantDb
          .selectFrom("scheduled_messages")
          .select(["content", "status"])
          .where("id", "=", schedule.id)
          .executeTakeFirstOrThrow();
        expect(row.content).toBe("Welcome");
        expect(row.status).toBe("scheduled");

        // Sanity: the reply itself is still reachable and unchanged in shortcut.
        expect((await getQuickReplyById(companyId, reply.id))?.shortcut).toBe(
          "hi",
        );

        await deleteQuickReply(companyId, reply.id);
      } finally {
        await dropTenantSchema(companyId);
      }
    },
  );
});
