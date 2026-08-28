import { describe, expect, test } from "bun:test";
import { connect, type JetStreamSubscription, JSONCodec } from "nats";
import { buildEventConsumerOptions } from "./client.js";
import { parseNatsServerAuth } from "./lifecycle.js";

const integrationTest =
  process.env.RUN_DB_INTEGRATION === "1" ? test : test.skip;

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for events");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function consume(
  subscription: JetStreamSubscription,
  received: string[],
): Promise<void> {
  return (async () => {
    for await (const message of subscription) {
      received.push(message.string());
      message.ack();
    }
  })();
}

describe("JetStream API replicas", () => {
  integrationTest(
    "share one durable queue and continue after a replica leaves",
    async () => {
      const server = parseNatsServerAuth(
        process.env.NATS_URL || "nats://localhost:4448",
      );
      const firstConnection = await connect(server);
      const secondConnection = await connect(server);
      const manager = await firstConnection.jetstreamManager();
      const stream = `API_REPLICA_${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
      const suffix = crypto.randomUUID().replaceAll("-", "");
      const subject = `TEST.api.replicas.${suffix}`;
      const identity = {
        durable: `api-replicas-${suffix}`,
        deliverSubject: `TEST.api.replicas.delivery.${suffix}`,
        queue: `api-replicas-${suffix}`,
      };
      const firstReceived: string[] = [];
      const secondReceived: string[] = [];
      let firstSubscription: JetStreamSubscription | undefined;
      let secondSubscription: JetStreamSubscription | undefined;

      try {
        await manager.streams.add({ name: stream, subjects: [subject] });
        firstSubscription = await firstConnection
          .jetstream()
          .subscribe(subject, buildEventConsumerOptions(subject, identity));
        secondSubscription = await secondConnection
          .jetstream()
          .subscribe(subject, buildEventConsumerOptions(subject, identity));
        const firstConsumer = consume(firstSubscription, firstReceived);
        const secondConsumer = consume(secondSubscription, secondReceived);
        const codec = JSONCodec<Record<string, number>>();
        const publisher = firstConnection.jetstream();

        for (let index = 0; index < 20; index++) {
          await publisher.publish(subject, codec.encode({ index }));
        }
        await waitFor(
          () => firstReceived.length + secondReceived.length === 20,
        );
        expect(new Set([...firstReceived, ...secondReceived]).size).toBe(20);
        expect(firstReceived.length).toBeGreaterThan(0);
        expect(secondReceived.length).toBeGreaterThan(0);

        firstSubscription.unsubscribe();
        await firstConsumer;
        const beforeFailover = secondReceived.length;
        for (let index = 20; index < 25; index++) {
          await publisher.publish(subject, codec.encode({ index }));
        }
        await waitFor(() => secondReceived.length === beforeFailover + 5);
        expect(firstReceived.length + secondReceived.length).toBe(25);

        secondSubscription.unsubscribe();
        await secondConsumer;
        const consumer = await manager.consumers.info(stream, identity.durable);
        expect(consumer.num_ack_pending).toBe(0);
      } finally {
        firstSubscription?.unsubscribe();
        secondSubscription?.unsubscribe();
        await manager.streams.delete(stream).catch(() => undefined);
        await Promise.all([
          firstConnection.drain().catch(() => undefined),
          secondConnection.drain().catch(() => undefined),
        ]);
      }
    },
    30_000,
  );
});
