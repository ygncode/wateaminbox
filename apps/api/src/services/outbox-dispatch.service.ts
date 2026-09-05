import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { getSchemaName, getTenantConnection } from "./tenant.service.js";

type Claim = { company_id: string; claim_token: string };

export async function claimReadyWorkspace(): Promise<Claim | undefined> {
  const result = await sql<Claim>`WITH candidate AS (
    SELECT r.company_id FROM public.outbox_dispatch_ready r
    JOIN public.companies c ON c.id = r.company_id AND c.status = 'active'
    WHERE r.due_at <= statement_timestamp()
      AND (r.claimed_until IS NULL OR r.claimed_until <= statement_timestamp())
    ORDER BY r.due_at, r.company_id
    FOR UPDATE OF r SKIP LOCKED LIMIT 1
  ) UPDATE public.outbox_dispatch_ready r
    SET claim_token = gen_random_uuid(), claimed_until = statement_timestamp() + interval '2 minutes'
    FROM candidate WHERE r.company_id = candidate.company_id
    RETURNING r.company_id, r.claim_token`.execute(db);
  return result.rows[0];
}

export async function finishWorkspaceDispatch(claim: Claim): Promise<void> {
  // Read generation BEFORE the summary. Any concurrent tenant write increments
  // it transactionally; a failed CAS leaves the workspace ready for another turn.
  const generation = (
    await sql<{ generation: string }>`SELECT generation
    FROM public.outbox_dispatch_ready WHERE company_id = ${claim.company_id}::uuid
      AND claim_token = ${claim.claim_token}::uuid`.execute(db)
  ).rows[0]?.generation;
  if (generation === undefined) return;
  const summary = await getTenantConnection(claim.company_id)
    .selectFrom("nats_outbox")
    .select(({ fn }) => fn.min<Date>("next_attempt_at").as("due"))
    .where("status", "in", ["pending", "claimed"])
    .executeTakeFirst();
  await settleWorkspaceDispatch(claim, generation, summary?.due ?? null);
}

export async function settleWorkspaceDispatch(
  claim: Claim,
  generation: string,
  due: Date | null,
): Promise<void> {
  await sql`UPDATE public.outbox_dispatch_ready SET
    due_at = CASE WHEN generation = ${generation}::bigint THEN CASE WHEN ${due}::timestamptz IS NULL THEN NULL ELSE GREATEST(${due}::timestamptz, statement_timestamp()) END
      ELSE statement_timestamp() END,
    claim_token = NULL, claimed_until = NULL
    WHERE company_id = ${claim.company_id}::uuid AND claim_token = ${claim.claim_token}::uuid`.execute(
    db,
  );
}

export async function releaseWorkspaceDispatch(claim: Claim): Promise<void> {
  await sql`UPDATE public.outbox_dispatch_ready SET
    due_at = statement_timestamp() + interval '5 seconds', claim_token = NULL, claimed_until = NULL
    WHERE company_id = ${claim.company_id}::uuid AND claim_token = ${claim.claim_token}::uuid`.execute(
    db,
  );
}

/** One bounded recovery page per minute globally, independent of replica count. */
export async function recoverOutboxDispatch(): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const state = (
      await sql<{ cursor: string | null }>`SELECT cursor
      FROM public.outbox_dispatch_recovery WHERE id = 1 AND next_run_at <= statement_timestamp()
      FOR UPDATE SKIP LOCKED`.execute(trx)
    ).rows[0];
    if (!state) return;
    const companies = (
      await sql<{ id: string }>`SELECT id FROM public.companies
      WHERE status = 'active' AND (${state.cursor}::uuid IS NULL OR id > ${state.cursor}::uuid)
      ORDER BY id LIMIT 10`.execute(trx)
    ).rows;
    for (const company of companies) {
      // No tenant row locks: INSERT's conflict update cannot deadlock against a
      // writer that holds an outbox row and then updates the readiness marker.
      await sql`INSERT INTO public.outbox_dispatch_ready (company_id, due_at)
        SELECT ${company.id}::uuid, min(next_attempt_at)
        FROM ${sql.table(`${getSchemaName(company.id)}.nats_outbox`)}
        WHERE status IN ('pending','claimed') HAVING count(*) > 0
        ON CONFLICT (company_id) DO UPDATE SET
          due_at = LEAST(public.outbox_dispatch_ready.due_at, EXCLUDED.due_at),
          generation = public.outbox_dispatch_ready.generation + 1`.execute(
        trx,
      );
    }
    await sql`DELETE FROM public.outbox_dispatch_ready r WHERE NOT EXISTS
      (SELECT 1 FROM public.companies c WHERE c.id = r.company_id AND c.status = 'active')`.execute(
      trx,
    );
    await sql`UPDATE public.outbox_dispatch_recovery SET
      cursor = ${companies.length === 10 ? companies[9]!.id : null}::uuid,
      next_run_at = statement_timestamp() + interval '1 minute' WHERE id = 1`.execute(
      trx,
    );
  });
}
