import { afterAll, beforeAll, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import {
  dispatchCompany,
  enqueueCommand,
  getCommandOutboxBacklog,
  resetCommandOutboxBacklogCache,
} from "./command-outbox.service.js";
import {
  getMeilisearchClient,
  getMessagesIndexName,
} from "./meilisearch.service.js";
import {
  dispatchMessageSearch,
  enqueueMessageSearch,
} from "./message-search-outbox.service.js";
import {
  claimReadyWorkspace,
  finishWorkspaceDispatch,
  recoverOutboxDispatch,
  settleWorkspaceDispatch,
} from "./outbox-dispatch.service.js";
import {
  createTenantSchema,
  dropTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1";
const integration = enabled ? test : test.skip;
const companies = [
  crypto.randomUUID(),
  crypto.randomUUID(),
  crypto.randomUUID(),
];
const [companyA, companyB, companyC] = companies as [string, string, string];
const tenant = getTenantConnection(companyA);
let connectionId: string;
let contactId: string;

beforeAll(async () => {
  if (!enabled) return;
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !["/wati_dispatch_test", "/wateaminbox"].includes(url.pathname)
  )
    throw new Error("This suite requires a local integration database");
  await sql`DELETE FROM public.message_search_outbox WHERE company_id NOT IN (SELECT id FROM public.companies)`.execute(
    db,
  );
  for (const company of companies) {
    await db
      .insertInto("companies")
      .values({
        id: company,
        name: "Dispatch fixture",
        schema_name: getSchemaName(company),
        status: "active",
      })
      .execute();
    await createTenantSchema(company);
  }
  connectionId = (
    await tenant
      .insertInto("whatsapp_connections")
      .values({ name: "Fixture", status: "connected" })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
  contactId = (
    await tenant
      .insertInto("contacts")
      .values({
        whatsapp_connection_id: connectionId,
        jid: "15550000001@s.whatsapp.net",
        push_name: "Fixture",
      })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  if (process.env.RUN_SEARCH_INTEGRATION === "1") {
    await getMeilisearchClient()
      .deleteIndex(getMessagesIndexName(companyA))
      .waitTask();
  }
  for (const company of companies) {
    await dropTenantSchema(company);
    await sql`DELETE FROM public.message_search_outbox WHERE company_id = ${company}::uuid`.execute(
      db,
    );
    await sql`DELETE FROM public.outbox_dispatch_ready WHERE company_id = ${company}::uuid`.execute(
      db,
    );
    await db.deleteFrom("companies").where("id", "=", company).execute();
  }
}, 120_000);

async function reset() {
  for (const company of companies) {
    await getTenantConnection(company).deleteFrom("nats_outbox").execute();
    await sql`DELETE FROM public.outbox_dispatch_ready WHERE company_id = ${company}::uuid`.execute(
      db,
    );
  }
}
async function enqueue(company: string) {
  return enqueueCommand(getTenantConnection(company), "TEST.dispatch", {
    type: "kill",
  });
}
async function marker(company: string) {
  return (
    await sql<{
      due_at: Date | null;
      generation: string;
      claim_token: string | null;
    }>`SELECT * FROM public.outbox_dispatch_ready WHERE company_id = ${company}::uuid`.execute(
      db,
    )
  ).rows[0];
}

integration(
  "rollback removes both command and ready marker; legacy inserts also wake dispatch",
  async () => {
    await reset();
    await expect(
      tenant.transaction().execute(async (trx) => {
        await enqueueCommand(trx, "TEST.dispatch", { type: "kill" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await marker(companyA)).toBeUndefined();
    expect(
      await tenant.selectFrom("nats_outbox").select("id").execute(),
    ).toHaveLength(0);
    await tenant
      .insertInto("nats_outbox")
      .values({ subject: "TEST.old-api", payload: { type: "kill" } })
      .execute();
    expect((await marker(companyA))?.due_at).toBeInstanceOf(Date);
  },
);

integration(
  "replicas claim distinct workspaces; busy workspace yields; empty workspace costs no claim",
  async () => {
    await reset();
    for (let i = 0; i < 30; i++) await enqueue(companyA);
    await enqueue(companyB);
    const [a, b] = await Promise.all([
      claimReadyWorkspace(),
      claimReadyWorkspace(),
    ]);
    expect(new Set([a?.company_id, b?.company_id])).toEqual(
      new Set([companyA, companyB]),
    );
    expect(await claimReadyWorkspace()).toBeUndefined();
    const busy = a!.company_id === companyA ? a! : b!;
    expect(await dispatchCompany(companyA, async () => {})).toBe(25);
    await finishWorkspaceDispatch(busy);
    const next = await claimReadyWorkspace();
    expect(next?.company_id).toBe(companyA);
    expect(await dispatchCompany(companyA, async () => {})).toBe(5);
    await finishWorkspaceDispatch(next!);
    expect((await marker(companyA))?.due_at).toBeNull();
    expect(await marker(companyC)).toBeUndefined();
  },
);

integration(
  "enqueue racing a stale empty summary cannot lose the ready marker",
  async () => {
    await reset();
    await enqueue(companyA);
    const claim = (await claimReadyWorkspace())!;
    await dispatchCompany(companyA, async () => {});
    const generation = (await marker(companyA))!.generation;
    await enqueue(companyA);
    await settleWorkspaceDispatch(claim, generation, null);
    expect((await marker(companyA))?.due_at).not.toBeNull();
    expect((await claimReadyWorkspace())?.company_id).toBe(companyA);
  },
);

integration(
  "expired workspace claims recover and stale owners cannot clear new claims",
  async () => {
    await reset();
    await enqueue(companyA);
    const stale = (await claimReadyWorkspace())!;
    await sql`UPDATE public.outbox_dispatch_ready SET claimed_until = now() - interval '1 second' WHERE company_id = ${companyA}::uuid`.execute(
      db,
    );
    const current = (await claimReadyWorkspace())!;
    expect(current.claim_token).not.toBe(stale.claim_token);
    await settleWorkspaceDispatch(
      stale,
      (await marker(companyA))!.generation,
      null,
    );
    expect((await marker(companyA))?.claim_token).toBe(current.claim_token);
  },
);

integration(
  "failed publication respects delayed retry and recovery repairs a missing marker",
  async () => {
    await reset();
    await enqueue(companyA);
    const claim = (await claimReadyWorkspace())!;
    await dispatchCompany(companyA, async () => {
      throw new Error("offline");
    });
    await finishWorkspaceDispatch(claim);
    expect((await marker(companyA))!.due_at!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(await claimReadyWorkspace()).toBeUndefined();
    await sql`DELETE FROM public.outbox_dispatch_ready WHERE company_id = ${companyA}::uuid`.execute(
      db,
    );
    await sql`UPDATE public.outbox_dispatch_recovery SET cursor = NULL, next_run_at = now() WHERE id = 1`.execute(
      db,
    );
    await recoverOutboxDispatch();
    expect((await marker(companyA))?.due_at).toBeInstanceOf(Date);
    resetCommandOutboxBacklogCache();
    expect((await getCommandOutboxBacklog()).pending).toBe(1);
  },
);

async function message() {
  return tenant.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto("messages")
      .values({
        whatsapp_connection_id: connectionId,
        contact_id: contactId,
        message_id: crypto.randomUUID(),
        from_me: false,
        message_type: "text",
        content: "Fixture message",
        timestamp: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await enqueueMessageSearch(trx, companyA, connectionId, row.id);
    return row.id;
  });
}

integration(
  "indexing failures retain durable jobs and successful retries batch current messages",
  async () => {
    const ids = [await message(), await message()];
    await expect(
      dispatchMessageSearch(async () => {
        throw new Error("search offline");
      }),
    ).rejects.toThrow("search offline");
    expect(
      (
        await sql`SELECT * FROM public.message_search_outbox WHERE company_id = ${companyA}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(2);
    await sql`UPDATE public.message_search_outbox SET next_attempt_at = now() WHERE company_id = ${companyA}::uuid`.execute(
      db,
    );
    const indexed: string[] = [];
    expect(
      await dispatchMessageSearch(async (_company, docs) => {
        indexed.push(...docs.map((doc) => doc.id));
      }),
    ).toBe(2);
    expect(indexed.sort()).toEqual(ids.sort());
  },
);

integration(
  "slow background indexing does not block message inserts; purge waits for ordered submission",
  async () => {
    await message();
    let unblock!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const indexing = dispatchMessageSearch(async () => {
      started();
      await hold;
    });
    await ready;
    try {
      // A new message and its durable search work commit while Meilisearch stalls.
      await message();
      let locked!: () => void;
      const acquired = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const purge = tenant.transaction().execute(async (trx) => {
        await trx
          .selectFrom("whatsapp_connections")
          .select("id")
          .where("id", "=", connectionId)
          .forUpdate()
          .execute();
        locked();
        await trx
          .updateTable("whatsapp_connections")
          .set({ archived_at: new Date() })
          .where("id", "=", connectionId)
          .execute();
      });
      const premature = await Promise.race([
        acquired.then(() => true),
        Bun.sleep(50).then(() => false),
      ]);
      expect(premature).toBe(false);
      unblock();
      await indexing;
      await purge;
      let submitted = false;
      await dispatchMessageSearch(async () => {
        submitted = true;
      });
      expect(submitted).toBe(false);
    } finally {
      unblock();
      await indexing;
    }
  },
  10_000,
);

(enabled && process.env.RUN_SEARCH_INTEGRATION === "1" ? test : test.skip)(
  "real Meilisearch task completion indexes the durable job before removing it",
  async () => {
    await tenant
      .updateTable("whatsapp_connections")
      .set({ archived_at: null })
      .where("id", "=", connectionId)
      .execute();
    const id = await message();
    expect(await dispatchMessageSearch()).toBe(1);
    const document = await getMeilisearchClient()
      .index(getMessagesIndexName(companyA))
      .getDocument(id);
    expect(document.content).toBe("Fixture message");
    expect(document.companyId).toBe(companyA);
    expect(
      (
        await sql`SELECT * FROM public.message_search_outbox WHERE company_id = ${companyA}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
  },
  30_000,
);
