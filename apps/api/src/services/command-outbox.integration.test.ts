import { describe, expect, test } from "bun:test";
import { db } from "@wateaminbox/database";
import { sql } from "kysely";
import { connect, JSONCodec, type NatsConnection } from "nats";
import { parseNatsServerAuth } from "../lib/nats/lifecycle.js";
import { dispatchCompany, enqueueCommand } from "./command-outbox.service.js";
import {
  clearTenantConnection,
  createTenantSchema,
  getSchemaName,
  getTenantConnection,
} from "./tenant.service.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

describe("command outbox PostgreSQL integration", () => {
  integrationTest(
    "uses leases across dispatchers and safely replays crash-after-publish",
    async () => {
      const companyId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      const stream = `TEST_OUTBOX_${companyId.replaceAll("-", "").toUpperCase()}`;
      const subject = `TEST.outbox.${companyId}`;
      let nc: NatsConnection | undefined;
      try {
        nc = await connect(
          parseNatsServerAuth(process.env.NATS_URL || "nats://localhost:4448"),
        );
        const js = nc.jetstream();
        const jsm = await nc.jetstreamManager();
        await jsm.streams.add({ name: stream, subjects: [subject] });
        const codec = JSONCodec<unknown>();

        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);
        const first = await enqueueCommand(tenantDb, subject, {
          type: "kill",
        });
        const second = await enqueueCommand(tenantDb, subject, {
          type: "spawn",
        });
        const published: string[] = [];
        const publish = async (
          publishSubject: string,
          payload: unknown,
          id: string,
        ) => {
          await Bun.sleep(10);
          await js.publish(publishSubject, codec.encode(payload), {
            msgID: id,
          });
          published.push(id);
        };

        await Promise.all([
          dispatchCompany(companyId, publish),
          dispatchCompany(companyId, publish),
        ]);
        expect(published.sort()).toEqual([first, second].sort());
        expect(new Set(published).size).toBe(2);

        const crashId = await enqueueCommand(tenantDb, subject, {
          type: "kill",
        });
        const crashPublications: string[] = [];
        await dispatchCompany(
          companyId,
          async (publishSubject, payload, id) => {
            await js.publish(publishSubject, codec.encode(payload), {
              msgID: id,
            });
            crashPublications.push(id);
            throw new Error("simulated crash after broker accepted publish");
          },
        );
        const pending = await tenantDb
          .selectFrom("nats_outbox")
          .select(["status", "attempts"])
          .where("id", "=", crashId)
          .executeTakeFirstOrThrow();
        expect(pending).toEqual({ status: "pending", attempts: 1 });

        await tenantDb
          .updateTable("nats_outbox")
          .set({ next_attempt_at: new Date(0) })
          .where("id", "=", crashId)
          .execute();
        await dispatchCompany(
          companyId,
          async (publishSubject, payload, id) => {
            await js.publish(publishSubject, codec.encode(payload), {
              msgID: id,
            });
            crashPublications.push(id);
          },
        );
        expect(crashPublications).toEqual([crashId, crashId]);
        // JetStream de-duplicates both publications because dispatch always uses
        // the stable outbox row ID as Nats-Msg-Id.
        expect(new Set(crashPublications)).toEqual(new Set([crashId]));
        expect((await jsm.streams.info(stream)).state.messages).toBe(3);
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
        if (nc) {
          const jsm = await nc.jetstreamManager();
          await jsm.streams.delete(stream).catch(() => false);
          await nc.drain();
        }
      }
    },
    30_000,
  );

  integrationTest(
    "fences stale success and failure outcomes while a newer claimer is running",
    async () => {
      const companyId = crypto.randomUUID();
      const schema = getSchemaName(companyId);
      try {
        await createTenantSchema(companyId);
        const tenantDb = getTenantConnection(companyId);

        const runRace = async (
          staleOutcome: "success" | "failure",
          currentOutcome: "success" | "failure",
        ) => {
          const id = await enqueueCommand(tenantDb, "TEST.outbox.fence", {
            type: "kill",
          });
          let signalStaleStarted!: () => void;
          let releaseStale!: () => void;
          const staleStarted = new Promise<void>((resolve) => {
            signalStaleStarted = resolve;
          });
          const staleGate = new Promise<void>((resolve) => {
            releaseStale = resolve;
          });
          const staleRunner = dispatchCompany(companyId, async () => {
            signalStaleStarted();
            await staleGate;
            if (staleOutcome === "failure") throw new Error("stale failure");
          });
          await staleStarted;

          // Simulate the first runner outliving its lease so another replica
          // can claim the same row while the first publish is still in flight.
          await tenantDb
            .updateTable("nats_outbox")
            .set({ next_attempt_at: new Date(0) })
            .where("id", "=", id)
            .execute();

          let signalCurrentStarted!: () => void;
          let releaseCurrent!: () => void;
          const currentStarted = new Promise<void>((resolve) => {
            signalCurrentStarted = resolve;
          });
          const currentGate = new Promise<void>((resolve) => {
            releaseCurrent = resolve;
          });
          const currentRunner = dispatchCompany(companyId, async () => {
            signalCurrentStarted();
            await currentGate;
            if (currentOutcome === "failure")
              throw new Error("current failure");
          });
          await currentStarted;

          releaseStale();
          await staleRunner;
          expect(
            await tenantDb
              .selectFrom("nats_outbox")
              .select(["status", "attempts"])
              .where("id", "=", id)
              .executeTakeFirstOrThrow(),
          ).toEqual({ status: "claimed", attempts: 0 });

          releaseCurrent();
          await currentRunner;
          return tenantDb
            .selectFrom("nats_outbox")
            .select(["status", "attempts", "last_error"])
            .where("id", "=", id)
            .executeTakeFirstOrThrow();
        };

        expect(await runRace("success", "failure")).toEqual({
          status: "pending",
          attempts: 1,
          last_error: "current failure",
        });
        expect(await runRace("failure", "success")).toEqual({
          status: "published",
          attempts: 1,
          last_error: null,
        });
      } finally {
        await clearTenantConnection(companyId);
        await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
      }
    },
    30_000,
  );
});
