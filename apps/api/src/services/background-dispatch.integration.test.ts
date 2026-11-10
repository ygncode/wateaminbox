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

beforeAll(async () => {
  if (!enabled) return;
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !["/wati_dispatch_test", "/wateaminbox"].includes(url.pathname)
  )
    throw new Error("This suite requires a local integration database");
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
}, 120_000);

afterAll(async () => {
  if (!enabled) return;
  for (const company of companies) {
    await dropTenantSchema(company);
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
