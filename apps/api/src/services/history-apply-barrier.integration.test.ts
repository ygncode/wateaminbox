import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import type { WhatsAppEvent } from "../lib/nats/types/base.js";
import {
  acknowledgeAppliedHistory,
  canApplyHistoryBarrier,
  drainHistoryBarriers,
} from "./history-apply-barrier.service.js";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("history application barrier", () => {
  integration(
    "completion waits for every earlier history commit across consumers and restarts",
    async () => {
      const company = crypto.randomUUID(),
        session = crypto.randomUUID();
      const event = (
        type: WhatsAppEvent["type"],
        payload: unknown,
      ): WhatsAppEvent => ({
        contractVersion: 1,
        eventId: crypto.randomUUID(),
        companyId: company,
        connectionId: session,
        type,
        payload,
        timestamp: new Date().toISOString(),
      });
      const first = event("message", { isHistorySync: true });
      const second = event("contact", { jid: "contact" });
      const marker = event("sync_status", { status: "completed" });
      const add = async (item: WhatsAppEvent, subject: string) => {
        await sql`INSERT INTO whatsapp_sessions.worker_event_outbox (connection_id, event_id, subject, payload, published_at)
        VALUES (${session}::uuid, ${item.eventId}::uuid, ${`WHATSAPP.events.${company}.${session}.${subject}`},
          ${Buffer.from(JSON.stringify(item))}, now())`.execute(db);
      };
      try {
        await add(first, "history_message");
        await add(second, "history_contact");
        await add(marker, "sync_status");
        expect(await canApplyHistoryBarrier(marker)).toBe(false);
        // A faster replica saves message 2 first; message 1 still blocks completion.
        await acknowledgeAppliedHistory(second);
        expect(await canApplyHistoryBarrier(marker)).toBe(false);
        let completed = 0;
        const apply = async (item: WhatsAppEvent) => {
          if (item.eventId === marker.eventId) completed++;
          await acknowledgeAppliedHistory(item);
        };
        await drainHistoryBarriers(apply);
        expect(completed).toBe(0);
        await acknowledgeAppliedHistory(first);
        expect(await canApplyHistoryBarrier(marker)).toBe(true);
        // No process-local state is required: a new drain can recover the marker.
        await drainHistoryBarriers(apply);
        await drainHistoryBarriers(apply);
        expect(completed).toBe(1);
      } finally {
        await sql`DELETE FROM whatsapp_sessions.worker_event_outbox WHERE connection_id = ${session}::uuid`.execute(
          db,
        );
      }
    },
  );

  integration(
    "on-demand pages wait for history while later history does not block an earlier marker",
    async () => {
      const company = crypto.randomUUID(),
        session = crypto.randomUUID();
      const marker: WhatsAppEvent = {
        contractVersion: 1,
        eventId: crypto.randomUUID(),
        companyId: company,
        connectionId: session,
        type: "history_sync_page",
        payload: {},
        timestamp: new Date().toISOString(),
      };
      try {
        await sql`INSERT INTO whatsapp_sessions.worker_event_outbox (connection_id,event_id,subject,payload,published_at)
        VALUES (${session}::uuid,${marker.eventId}::uuid,${`WHATSAPP.events.${company}.${session}.history_sync_page`},${Buffer.from(JSON.stringify(marker))},now())`.execute(
          db,
        );
        await sql`INSERT INTO whatsapp_sessions.worker_event_outbox (connection_id,event_id,subject,payload,published_at)
        VALUES (${session}::uuid,${crypto.randomUUID()}::uuid,${`WHATSAPP.events.${company}.${session}.history_message`},${Buffer.from("{}")},now())`.execute(
          db,
        );
        expect(await canApplyHistoryBarrier(marker)).toBe(true);
      } finally {
        await sql`DELETE FROM whatsapp_sessions.worker_event_outbox WHERE connection_id = ${session}::uuid`.execute(
          db,
        );
      }
    },
  );
});
