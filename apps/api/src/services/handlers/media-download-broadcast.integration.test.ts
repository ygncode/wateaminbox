/**
 * Broadcast gating for the download-response failure branch.
 *
 * The `media:download_failed` realtime event must fire only when the
 * failure-branch UPDATE actually settles a row. A late `success:false` that
 * arrives after an earlier `success:true` already completed the row must
 * neither corrupt the DB nor send a spurious broadcast. The DB state is
 * covered by `media-lease-recovery.integration.test.ts`; here we observe the
 * broadcast itself by stubbing `broadcastToContactViewers`, exactly like
 * `command-outcome.test.ts` does for the command-result handler.
 *
 * `mock.module` swaps the module for every test in this file's process, so
 * this suite is isolated in its own file (the recursive integration runner
 * spawns one `bun test` process per file) and uses a dynamic import after the
 * mock is registered.
 */

import { describe, expect, mock, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import type { DownloadResponseEvent } from "../../lib/nats/index.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "../tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

const contactBroadcasts: Array<{
  contactId: string;
  event: string;
  payload: Record<string, unknown>;
}> = [];

mock.module("../message-broadcast.service.js", () => ({
  broadcastToContactViewers: (
    _companyId: string,
    contactId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => {
    contactBroadcasts.push({ contactId, event, payload });
    return Promise.resolve();
  },
}));

const { handleDownloadResponseEvent } = await import("./status-handlers.js");

interface Fixture {
  companyId: string;
  connectionId: string;
  contactId: string;
}

async function withTenant(run: (fixture: Fixture) => Promise<void>) {
  const companyId = crypto.randomUUID();
  const schemaName = getSchemaName(companyId);
  const connectionId = crypto.randomUUID();
  const contactId = crypto.randomUUID();

  try {
    await db
      .insertInto("companies")
      .values({
        id: companyId,
        name: "Media broadcast test",
        schema_name: schemaName,
        status: "active",
      })
      .execute();
    await createTenantSchema(companyId);
    const tenantDb = getTenantConnection(companyId);
    await tenantDb
      .insertInto("whatsapp_connections")
      .values({
        id: connectionId,
        name: "Primary",
        phone_number: "15550003333",
        status: "connected",
      })
      .execute();
    await tenantDb
      .insertInto("contacts")
      .values({
        id: contactId,
        whatsapp_connection_id: connectionId,
        jid: "15551234444@s.whatsapp.net",
        phone_number: "15551234444",
      })
      .execute();
    await run({ companyId, connectionId, contactId });
  } finally {
    await clearTenantConnection(companyId);
    await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
    await db.deleteFrom("companies").where("id", "=", companyId).execute();
  }
}

async function insertDownloading(fixture: Fixture): Promise<string> {
  const id = crypto.randomUUID();
  await getTenantConnection(fixture.companyId)
    .insertInto("messages")
    .values({
      id,
      whatsapp_connection_id: fixture.connectionId,
      contact_id: fixture.contactId,
      message_id: `wa-${id}`,
      from_me: false,
      message_type: "image",
      media_direct_path: "/v/t62.x",
      media_download_status: "downloading",
      media_downloaded_at: new Date(),
      timestamp: new Date(),
    })
    .execute();
  return id;
}

function downloadResponse(
  fixture: Fixture,
  messageId: string,
  mediaUrl: string,
): DownloadResponseEvent {
  return {
    contractVersion: 1,
    type: "download_response" as const,
    companyId: fixture.companyId,
    connectionId: fixture.connectionId,
    sessionId: fixture.connectionId,
    timestamp: new Date().toISOString(),
    payload: { messageId, success: true, mediaUrl, mediaSize: 1234 },
  };
}

function downloadFailedResponse(
  fixture: Fixture,
  messageId: string,
  error: string,
): DownloadResponseEvent {
  return {
    contractVersion: 1,
    type: "download_response" as const,
    companyId: fixture.companyId,
    connectionId: fixture.connectionId,
    sessionId: fixture.connectionId,
    timestamp: new Date().toISOString(),
    payload: { messageId, success: false, error },
  };
}

describe("download response broadcast gating", () => {
  integrationTest(
    "a real failure broadcasts media:download_failed exactly once",
    async () => {
      await withTenant(async (fixture) => {
        const id = await insertDownloading(fixture);
        contactBroadcasts.length = 0;

        await handleDownloadResponseEvent(
          downloadFailedResponse(fixture, id, "context deadline exceeded"),
        );

        expect(contactBroadcasts).toHaveLength(1);
        expect(contactBroadcasts[0].event).toBe("media:download_failed");
        expect(contactBroadcasts[0].payload.error).toBe(
          "context deadline exceeded",
        );
      });
    },
  );

  integrationTest(
    "a late failure after success sends no media:download_failed",
    async () => {
      await withTenant(async (fixture) => {
        const id = await insertDownloading(fixture);
        contactBroadcasts.length = 0;

        await handleDownloadResponseEvent(
          downloadResponse(fixture, id, "s3://whatsapp-media/first.jpg"),
        );
        // The success broadcasts media:downloaded exactly once.
        expect(contactBroadcasts).toHaveLength(1);
        expect(contactBroadcasts[0].event).toBe("media:downloaded");

        await handleDownloadResponseEvent(
          downloadFailedResponse(fixture, id, "late failure"),
        );

        // No spurious media:download_failed: the broadcast count is still
        // exactly the one media:downloaded from the success.
        expect(contactBroadcasts).toHaveLength(1);
        expect(
          contactBroadcasts.some((b) => b.event === "media:download_failed"),
        ).toBe(false);
      });
    },
  );
});
