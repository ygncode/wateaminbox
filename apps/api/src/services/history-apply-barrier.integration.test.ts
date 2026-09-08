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

  integration(
    "a marker deleted by the critical loop is already applied, not ready to re-apply",
    async () => {
      const company = crypto.randomUUID(),
        session = crypto.randomUUID();
      const build = (
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
      const add = async (item: WhatsAppEvent, subject: string) => {
        await sql`INSERT INTO whatsapp_sessions.worker_event_outbox (connection_id, event_id, subject, payload, published_at)
        VALUES (${session}::uuid, ${item.eventId}::uuid, ${`WHATSAPP.events.${company}.${session}.${subject}`},
          ${Buffer.from(JSON.stringify(item))}, now())`.execute(db);
      };
      try {
        for (const [type, subject, payload] of [
          [
            "history_sync_page",
            "history_sync_page",
            { chatJid: "guest@s.whatsapp.com" },
          ],
          ["sync_status", "sync_status", { status: "completed" }],
        ] as const) {
          const marker = build(type, payload);
          await add(marker, subject);
          // Non-deferred fast path: no earlier history rows remain, so the
          // critical loop applies the marker immediately.
          expect(await canApplyHistoryBarrier(marker)).toBe(true);
          // The critical loop applies + acknowledges (deletes) the marker row.
          await acknowledgeAppliedHistory(marker);
          // Before the fix the JOIN produced no rows once the marker was gone,
          // so `waiting` was false and the gate returned true, letting a second
          // consumer re-apply the deleted marker. Now `exists` is false, so the
          // gate returns false and the drain skips the already-applied marker.
          expect(await canApplyHistoryBarrier(marker)).toBe(false);
        }
      } finally {
        await sql`DELETE FROM whatsapp_sessions.worker_event_outbox WHERE connection_id = ${session}::uuid`.execute(
          db,
        );
      }
    },
  );

  integration(
    "the drain does not re-broadcast a history_sync_page marker the critical loop already applied",
    async () => {
      const company = crypto.randomUUID(),
        session = crypto.randomUUID();
      const marker: WhatsAppEvent = {
        contractVersion: 1,
        eventId: crypto.randomUUID(),
        companyId: company,
        connectionId: session,
        type: "history_sync_page",
        payload: {
          chatJid: "guest@s.whatsapp.com",
          messageCount: 7,
          status: "available",
        },
        timestamp: new Date().toISOString(),
      };
      const add = async (item: WhatsAppEvent, subject: string) => {
        await sql`INSERT INTO whatsapp_sessions.worker_event_outbox (connection_id, event_id, subject, payload, published_at)
        VALUES (${session}::uuid, ${item.eventId}::uuid, ${`WHATSAPP.events.${company}.${session}.${subject}`},
          ${Buffer.from(JSON.stringify(item))}, now())`.execute(db);
      };
      try {
        await add(marker, "history_sync_page");
        // The history loop has already drained every earlier history row before
        // the critical loop receives the marker, so it takes the non-deferred
        // fast path and applies the marker immediately.
        expect(await canApplyHistoryBarrier(marker)).toBe(true);

        // Critical loop: processWhatsAppEvent broadcasts exactly one
        // `history:loaded`, then acknowledgeAppliedHistory deletes the row.
        let broadcasts = 0;
        broadcasts += 1;
        await acknowledgeAppliedHistory(marker);

        // The drain's 1-second SELECT can snapshot the marker payload before
        // that DELETE committed. Replay that stale snapshot through the same
        // gate that handleWhatsAppEvent uses; the fix makes the gate return
        // false for the deleted marker, so the drain skips the duplicate
        // application instead of emitting a second `history:loaded`.
        const drainApply = async (item: WhatsAppEvent) => {
          if (!(await canApplyHistoryBarrier(item))) return;
          broadcasts += 1;
          await acknowledgeAppliedHistory(item);
        };
        await drainApply(marker);
        expect(broadcasts).toBe(1);
        expect(await canApplyHistoryBarrier(marker)).toBe(false);
      } finally {
        await sql`DELETE FROM whatsapp_sessions.worker_event_outbox WHERE connection_id = ${session}::uuid`.execute(
          db,
        );
      }
    },
  );

  integration(
    "the drain through the gate stays idempotent across ticks for a marker it has already applied",
    async () => {
      const company = crypto.randomUUID(),
        session = crypto.randomUUID();
      const marker: WhatsAppEvent = {
        contractVersion: 1,
        eventId: crypto.randomUUID(),
        companyId: company,
        connectionId: session,
        type: "history_sync_page",
        payload: { chatJid: "guest@s.whatsapp.com", messageCount: 1 },
        timestamp: new Date().toISOString(),
      };
      const add = async (item: WhatsAppEvent, subject: string) => {
        await sql`INSERT INTO whatsapp_sessions.worker_event_outbox (connection_id, event_id, subject, payload, published_at)
        VALUES (${session}::uuid, ${item.eventId}::uuid, ${`WHATSAPP.events.${company}.${session}.${subject}`},
          ${Buffer.from(JSON.stringify(item))}, now())`.execute(db);
      };
      try {
        await add(marker, "history_sync_page");
        // Unlike the pre-existing test, the drain routes through the real gate
        // (canApplyHistoryBarrier) -- the same function handleWhatsAppEvent calls
        // -- so a regression that makes a deleted marker look ready again would
        // surface as a double application here.
        let applied = 0;
        const apply = async (item: WhatsAppEvent) => {
          if (!(await canApplyHistoryBarrier(item))) return;
          applied += 1;
          await acknowledgeAppliedHistory(item);
        };
        await drainHistoryBarriers(apply);
        await drainHistoryBarriers(apply);
        await drainHistoryBarriers(apply);
        expect(applied).toBe(1);
        expect(await canApplyHistoryBarrier(marker)).toBe(false);
      } finally {
        await sql`DELETE FROM whatsapp_sessions.worker_event_outbox WHERE connection_id = ${session}::uuid`.execute(
          db,
        );
      }
    },
  );
});
