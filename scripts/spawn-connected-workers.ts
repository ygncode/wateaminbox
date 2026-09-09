/**
 * Spawn a WhatsApp worker for every connection that is marked connected but
 * has no running worker.
 *
 * The macOS development orchestrator runs persistence-free (dev-start.sh unsets
 * DATABASE_URL), so it does not recover workers after a restart. This helper
 * enqueues the same spawn commands the API would send when a user reconnects a
 * connection, letting sends work immediately after `./dev-start.sh`.
 *
 * Idempotent: the orchestrator republishes status for an already-running worker
 * instead of starting a duplicate.
 */

import { connect, JSONCodec } from "nats";
import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:4447/wateaminbox?sslmode=disable";
const NATS_URL =
  process.env.NATS_URL ?? "nats://service:service@localhost:4448";

const COMMANDS_PREFIX = "WHATSAPP.commands";
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 1_000;

function schemaNameFor(companyId: string): string {
  return `tenant_${companyId.replace(/-/g, "_")}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNatsServerAuth(input: string): {
  servers: string[];
  user?: string;
  pass?: string;
} {
  const parsed = new URL(input.trim());
  const user = parsed.username
    ? decodeURIComponent(parsed.username)
    : undefined;
  const pass = parsed.password
    ? decodeURIComponent(parsed.password)
    : undefined;
  // nats.js accepts credentials as options, not in its server URL parser.
  return { servers: [`${parsed.protocol}//${parsed.host}`], user, pass };
}

async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      await delay(RETRY_DELAY_MS);
    }
  }
  throw new Error(
    `${label} failed after ${MAX_RETRIES} attempts: ${String(lastError)}`,
  );
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });

  const companies = await retry("list active companies", async () => {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM public.companies WHERE status = 'active' ORDER BY id`,
    );
    return result.rows;
  });

  const targets: Array<{
    companyId: string;
    schemaName: string;
    sessionId: string;
    connectionId: string;
  }> = [];

  for (const { id: companyId } of companies) {
    const schemaName = schemaNameFor(companyId);
    const result = await pool.query<{
      connection_id: string;
      session_id: string;
    }>(
      `SELECT c.id AS connection_id, s.id AS session_id
       FROM "${schemaName}".whatsapp_connections c
       JOIN "${schemaName}".whatsapp_connection_sessions s
         ON s.whatsapp_connection_id = c.id
        AND s.ended_at IS NULL
       WHERE c.status = 'connected'`,
    );
    for (const row of result.rows) {
      targets.push({
        companyId,
        schemaName,
        sessionId: row.session_id,
        connectionId: row.connection_id,
      });
    }
  }

  await pool.end();

  if (targets.length === 0) {
    console.log("No connected connections need a worker spawn");
    return;
  }

  const auth = parseNatsServerAuth(NATS_URL);
  const nc = await retry("connect to NATS", () =>
    connect({
      servers: auth.servers,
      user: auth.user,
      pass: auth.pass,
      timeout: 2_000,
    }),
  );
  try {
    const js = nc.jetstream();
    const codec = JSONCodec<Record<string, string>>();

    for (const target of targets) {
      const subject = `${COMMANDS_PREFIX}.${target.companyId}.${target.sessionId}`;
      const payload = {
        type: "spawn",
        company_id: target.companyId,
        connection_id: target.sessionId,
        tenant_schema: target.schemaName,
      };
      await retry(`publish spawn for ${target.connectionId}`, () =>
        js.publish(subject, codec.encode(payload)),
      );
      console.log(
        `Spawned worker for connection ${target.connectionId} (session ${target.sessionId})`,
      );
    }
  } finally {
    await nc.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
