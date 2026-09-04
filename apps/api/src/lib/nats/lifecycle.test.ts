import { afterEach, describe, expect, test } from "bun:test";
import {
  API_CRITICAL_EVENTS_CONSUMER,
  API_HISTORY_EVENTS_CONSUMER,
  API_TRANSIENT_EVENTS_CONSUMER,
} from "./client.js";
import {
  type ConnectFn,
  NatsLifecycleManager,
  parseNatsServerAuth,
} from "./lifecycle.js";

/** Reads the durable name off the ConsumerOptsBuilder passed to js.subscribe. */
function subscribeDurable(optsArg: unknown): string {
  const opts = optsArg as {
    getOpts: () => { config: { durable_name?: string } };
  };
  return opts.getOpts().config.durable_name ?? "";
}

/**
 * An open subscription with no messages queued yet: its async iterator never
 * settles until unsubscribe() is called. makeMockSubscription([]) is the
 * wrong shape for "healthy and idle" - an empty array iterator completes
 * immediately, so the supervisor loop would flip back to inactive and sleep
 * for a retry backoff, which is not what a live, message-less subscription
 * does.
 */
function makeIdleSubscription(): {
  [Symbol.asyncIterator](): AsyncIterableIterator<unknown>;
  unsubscribe: () => void;
  _unsubscribed: () => boolean;
} {
  let unsubscribed = false;
  return {
    [Symbol.asyncIterator]() {
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(): Promise<IteratorResult<unknown>> {
          if (unsubscribed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise(() => {
            // Never resolves while subscribed - simulates an idle consumer.
          });
        },
      };
    },
    unsubscribe() {
      unsubscribed = true;
    },
    _unsubscribed: () => unsubscribed,
  };
}

async function pollUntil(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`pollUntil: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("parseNatsServerAuth", () => {
  test("moves URL credentials into nats.js connection options", () => {
    expect(
      parseNatsServerAuth("nats://service:secret_0123456789abcdef@nats:4222"),
    ).toEqual({
      servers: ["nats://nats:4222"],
      user: "service",
      pass: "secret_0123456789abcdef",
    });
  });

  test("preserves unauthenticated development URLs", () => {
    expect(parseNatsServerAuth("nats://localhost:4448")).toEqual({
      servers: ["nats://localhost:4448"],
      user: undefined,
      pass: undefined,
    });
  });

  test("rejects incomplete, mixed, or mismatched URL credentials", () => {
    expect(() => parseNatsServerAuth("nats://service@nats:4222")).toThrow();
    expect(() =>
      parseNatsServerAuth(
        "nats://nats-a:4222,nats://service:secret@nats-b:4222",
      ),
    ).toThrow();
    expect(() =>
      parseNatsServerAuth(
        "nats://service:first@nats-a:4222,nats://service:second@nats-b:4222",
      ),
    ).toThrow();
  });
});

function makeStatusIterator() {
  let resolve:
    | ((v: IteratorResult<{ type: string; data?: unknown }>) => void)
    | null = null;
  const iterator: AsyncIterableIterator<{ type: string; data?: unknown }> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      return new Promise((r) => {
        resolve = r;
      });
    },
  };
  return {
    iterator,
    push(event: { type: string; data?: unknown }) {
      resolve?.({ value: event, done: false });
    },
    end() {
      resolve?.({ value: undefined as never, done: true });
    },
  };
}

function makeMockConnection(overrides?: Partial<MockConnection>) {
  const status = makeStatusIterator();
  let closedResolve: (err?: Error) => void;
  const closedPromise = new Promise<Error | undefined>((r) => {
    closedResolve = r;
  });
  const conn: MockConnection = {
    _closed: false,
    isClosed: () => conn._closed,
    jetstream: () => conn._js,
    status: () => status.iterator,
    closed: () => closedPromise,
    drain: async () => {},
    close: async () => {
      conn._closed = true;
      closedResolve!(undefined);
    },
    _statusCtrl: status,
    _closedResolve: closedResolve!,
    _js: makeMockJetStream(),
    ...overrides,
  };
  return conn;
}

interface MockConnection {
  _closed: boolean;
  isClosed: () => boolean;
  jetstream: () => MockJetStream;
  status: () => AsyncIterableIterator<{ type: string; data?: unknown }>;
  closed: () => Promise<Error | undefined>;
  drain: () => Promise<void>;
  close: () => Promise<void>;
  _statusCtrl: ReturnType<typeof makeStatusIterator>;
  _closedResolve: (err?: Error) => void;
  _js: MockJetStream;
}

function makeMockJetStream(): MockJetStream {
  return {
    subscribe: async () => makeMockSubscription([]),
    publish: async () => ({ seq: 1, stream: "test", duplicate: false }),
    _subscribeImpl: null,
  };
}

interface MockJetStream {
  subscribe: (...args: unknown[]) => Promise<MockSubscription>;
  publish: (
    ...args: unknown[]
  ) => Promise<{ seq: number; stream: string; duplicate: boolean }>;
  _subscribeImpl: ((...args: unknown[]) => Promise<MockSubscription>) | null;
}

function makeMockSubscription(
  messages: Array<{
    data: Uint8Array;
    subject: string;
    ack: () => void;
    nak: (delay?: number) => void;
    term: () => void;
    info?: { redeliveryCount: number };
  }>,
): MockSubscription {
  let unsubscribed = false;
  const sub: MockSubscription = {
    [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
      let idx = 0;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          if (unsubscribed || idx >= messages.length) {
            return { value: undefined, done: true as const };
          }
          return { value: messages[idx++], done: false as const };
        },
      };
    },
    unsubscribe() {
      unsubscribed = true;
    },
    _unsubscribed: () => unsubscribed,
  };
  return sub;
}

interface MockSubscription {
  [Symbol.asyncIterator](): AsyncIterableIterator<unknown>;
  unsubscribe: () => void;
  _unsubscribed: () => boolean;
}

let managers: NatsLifecycleManager[] = [];
function tracked(mgr: NatsLifecycleManager) {
  managers.push(mgr);
  return mgr;
}

afterEach(async () => {
  for (const mgr of managers) {
    try {
      await mgr.shutdown();
    } catch {
      // best-effort cleanup
    }
  }
  managers = [];
});

function makeConnectFn(connFactory: () => MockConnection): ConnectFn {
  return (async () => connFactory()) as unknown as ConnectFn;
}

describe("NatsLifecycleManager", () => {
  test("serialized connects: concurrent connect() calls reuse the same promise", async () => {
    let connectCount = 0;
    const conn = makeMockConnection();
    const mgr = tracked(
      new NatsLifecycleManager(
        makeConnectFn(() => {
          connectCount++;
          return conn;
        }),
      ),
    );

    const [c1, c2] = await Promise.all([mgr.connect(), mgr.connect()]);
    expect(connectCount).toBe(1);
    expect(c1).toBe(c2);
  });

  test("stale-generation closure: gen=1 close does not affect gen=2", async () => {
    let callCount = 0;
    const conn1 = makeMockConnection();
    const conn2 = makeMockConnection();
    const mgr = tracked(
      new NatsLifecycleManager(
        makeConnectFn(() => {
          callCount++;
          return callCount === 1 ? conn1 : conn2;
        }),
      ),
    );

    const nc1 = await mgr.connect();
    expect(nc1 === (conn1 as unknown)).toBe(true);
    expect(mgr.isConnected()).toBe(true);

    // Simulate gen=1 closing
    conn1._closed = true;
    conn1._closedResolve(undefined);
    conn1._statusCtrl.end();

    // Connect again — should get gen=2
    const nc2 = await mgr.connect();
    expect(nc2 === (conn2 as unknown)).toBe(true);
    expect(mgr.isConnected()).toBe(true);

    // gen=1 closing should not affect gen=2's state
    expect(mgr.getReadinessState().nats.generation).toBe(2);
    expect(mgr.getReadinessState().nats.connected).toBe(true);
  });

  test("JS client invalidation: reconnect invalidates cached JetStream client", async () => {
    let callCount = 0;
    const conn1 = makeMockConnection();
    const conn2 = makeMockConnection();
    const js1 = makeMockJetStream();
    const js2 = makeMockJetStream();
    conn1._js = js1;
    conn2._js = js2;
    conn1.jetstream = () => js1;
    conn2.jetstream = () => js2;

    const mgr = tracked(
      new NatsLifecycleManager(
        makeConnectFn(() => {
          callCount++;
          return callCount === 1 ? conn1 : conn2;
        }),
      ),
    );

    await mgr.connect();
    const jsClient1 = await mgr.getJetStreamClient();

    // Simulate disconnect + reconnect
    conn1._closed = true;
    conn1._closedResolve(undefined);
    conn1._statusCtrl.end();
    await mgr.connect();

    const jsClient2 = await mgr.getJetStreamClient();
    expect(jsClient1).not.toBe(jsClient2);
  });

  test("normal subscription exit: consumerActive becomes false and lastConsumerExitAt is set", async () => {
    const conn = makeMockConnection();
    let criticalSubscribeCallCount = 0;
    const subscribeGate: { resolve: () => void } = { resolve: () => {} };
    const gatePromise = new Promise<void>((r) => {
      subscribeGate.resolve = r;
    });

    // Both loops call subscribe independently; only the critical loop's
    // calls are gated here (first returns empty/normal-exit, second blocks
    // the test until observed) - the transient loop just idles quietly.
    conn._js.subscribe = async (...args: unknown[]) => {
      if (subscribeDurable(args[1]) !== API_CRITICAL_EVENTS_CONSUMER) {
        return makeMockSubscription([]);
      }
      criticalSubscribeCallCount++;
      if (criticalSubscribeCallCount === 1) {
        return makeMockSubscription([]);
      }
      // Signal that the second subscribe was called
      subscribeGate.resolve();
      // Block until shutdown
      return makeMockSubscription([]);
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();

    mgr.startEventSupervisor(() => {});

    // Wait for the second subscribe (supervisor retried after normal exit)
    await gatePromise;

    const state = mgr.getReadinessState();
    expect(state.eventConsumers.critical.lastExitAt).not.toBeNull();
    expect(criticalSubscribeCallCount).toBeGreaterThanOrEqual(2);
  });

  test("exceptional subscription exit: readiness reflects the error", async () => {
    const conn = makeMockConnection();
    let criticalSubscribeCallCount = 0;
    const subscribeGate: { resolve: () => void } = { resolve: () => {} };
    const gatePromise = new Promise<void>((r) => {
      subscribeGate.resolve = r;
    });

    conn._js.subscribe = async (...args: unknown[]) => {
      if (subscribeDurable(args[1]) !== API_CRITICAL_EVENTS_CONSUMER) {
        return makeMockSubscription([]);
      }
      criticalSubscribeCallCount++;
      if (criticalSubscribeCallCount === 1) {
        throw new Error("stream not found");
      }
      subscribeGate.resolve();
      return makeMockSubscription([]);
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();

    mgr.startEventSupervisor(() => {});

    await gatePromise;

    const state = mgr.getReadinessState();
    expect(state.eventConsumers.critical.lastError).toBe("stream not found");
    expect(state.eventConsumers.critical.lastExitAt).not.toBeNull();
  });

  test("critical loop becomes active independently of a stalled transient loop, and alone drives aggregate readiness", async () => {
    const conn = makeMockConnection();

    conn._js.subscribe = async (...args: unknown[]) => {
      if (subscribeDurable(args[1]) === API_TRANSIENT_EVENTS_CONSUMER) {
        // Simulates a transient subscribe that never settles (e.g. the
        // consumer is backlogged). If the two loops were not independent,
        // this would also block the critical loop from ever subscribing.
        return new Promise<never>(() => {});
      }
      return makeIdleSubscription();
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();

    mgr.startEventSupervisor(() => {});

    await pollUntil(
      () => mgr.getReadinessState().eventConsumers.critical.active,
    );

    const state = mgr.getReadinessState();
    expect(state.eventConsumers.critical.active).toBe(true);
    expect(state.eventConsumers.transient.active).toBe(false);
    // The aggregate field mirrors the critical loop alone, so a stalled
    // transient loop must not drag a healthy-for-critical-work replica out
    // of readiness/rotation.
    expect(state.eventConsumer.active).toBe(true);
    expect(mgr.isConsumerActive()).toBe(true);
  });

  test("a stalled critical loop makes aggregate readiness and isConsumerActive false even with a healthy transient loop", async () => {
    const conn = makeMockConnection();

    conn._js.subscribe = async (...args: unknown[]) => {
      if (subscribeDurable(args[1]) === API_CRITICAL_EVENTS_CONSUMER) {
        // Simulates a stuck/backlogged critical subscribe.
        return new Promise<never>(() => {});
      }
      return makeIdleSubscription();
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();

    mgr.startEventSupervisor(() => {});

    await pollUntil(
      () => mgr.getReadinessState().eventConsumers.transient.active,
    );

    const state = mgr.getReadinessState();
    expect(state.eventConsumers.transient.active).toBe(true);
    expect(state.eventConsumers.critical.active).toBe(false);
    expect(state.eventConsumer.active).toBe(false);
    expect(mgr.isConsumerActive()).toBe(false);
  });

  test("a slow transient event handler does not delay critical event processing", async () => {
    const conn = makeMockConnection();
    const handled: string[] = [];

    const baseEnvelope = {
      contractVersion: 1,
      companyId: "00000000-0000-0000-0000-000000000000",
      connectionId: "00000000-0000-0000-0000-000000000001",
      payload: {},
      timestamp: new Date(0).toISOString(),
    };
    const criticalMsg = {
      data: new TextEncoder().encode(
        JSON.stringify({ ...baseEnvelope, type: "send_confirmation" }),
      ),
      subject: "WHATSAPP.events.c.k.send_confirmation",
      ack: () => {},
      nak: () => {},
      term: () => {},
    };
    const transientMsg = {
      data: new TextEncoder().encode(
        JSON.stringify({ ...baseEnvelope, type: "presence" }),
      ),
      subject: "WHATSAPP.events.c.k.presence",
      ack: () => {},
      nak: () => {},
      term: () => {},
    };

    let releaseTransient: () => void = () => {};
    const transientGate = new Promise<void>((r) => {
      releaseTransient = r;
    });

    conn._js.subscribe = async (...args: unknown[]) => {
      if (subscribeDurable(args[1]) === API_TRANSIENT_EVENTS_CONSUMER) {
        return makeMockSubscription([transientMsg]);
      }
      if (subscribeDurable(args[1]) === API_HISTORY_EVENTS_CONSUMER) {
        return makeIdleSubscription();
      }
      return makeMockSubscription([criticalMsg]);
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();

    mgr.startEventSupervisor(async (event) => {
      if (event.type === "presence") {
        await transientGate;
      }
      handled.push(event.type);
    });

    // The critical event must be handled promptly even though the
    // transient event's handler is stalled indefinitely.
    await pollUntil(() => handled.includes("send_confirmation"));
    expect(handled).not.toContain("presence");

    releaseTransient();
    await pollUntil(() => handled.includes("presence"));
  });

  test("a slow history handler does not delay live critical event processing", async () => {
    const conn = makeMockConnection();
    const handled: string[] = [];
    const baseEnvelope = {
      contractVersion: 1,
      companyId: "00000000-0000-0000-0000-000000000000",
      connectionId: "00000000-0000-0000-0000-000000000001",
      timestamp: new Date(0).toISOString(),
    };
    const criticalMsg = {
      data: new TextEncoder().encode(
        JSON.stringify({
          ...baseEnvelope,
          type: "send_confirmation",
          payload: { messageId: "live" },
        }),
      ),
      subject: "WHATSAPP.events.c.k.send_confirmation",
      ack: () => {},
      nak: () => {},
      term: () => {},
    };
    const historyMsg = {
      data: new TextEncoder().encode(
        JSON.stringify({
          ...baseEnvelope,
          type: "message",
          payload: { messageId: "history", isHistorySync: true },
        }),
      ),
      subject: "WHATSAPP.events.c.k.history_message",
      ack: () => {},
      nak: () => {},
      term: () => {},
    };
    let releaseHistory: () => void = () => {};
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });

    conn._js.subscribe = async (...args: unknown[]) => {
      const durable = subscribeDurable(args[1]);
      if (durable === API_HISTORY_EVENTS_CONSUMER) {
        return makeMockSubscription([historyMsg]);
      }
      if (durable === API_TRANSIENT_EVENTS_CONSUMER) {
        return makeIdleSubscription();
      }
      return makeMockSubscription([criticalMsg]);
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();
    mgr.startEventSupervisor(async (event) => {
      const messageId = (event.payload as { messageId?: string }).messageId;
      if (messageId === "history") await historyGate;
      handled.push(messageId ?? event.type);
    });

    await pollUntil(() => handled.includes("live"));
    expect(handled).not.toContain("history");
    releaseHistory();
    await pollUntil(() => handled.includes("history"));
  });

  test("legacy history events are moved off the critical lane before handling", async () => {
    const conn = makeMockConnection();
    const handled: string[] = [];
    const published: Array<{
      subject: string;
      event: { type: string; payload: Record<string, unknown> };
      msgID?: string;
    }> = [];
    const acked: string[] = [];
    const baseEnvelope = {
      contractVersion: 1,
      companyId: "00000000-0000-0000-0000-000000000000",
      connectionId: "00000000-0000-0000-0000-000000000001",
      timestamp: new Date(0).toISOString(),
    };
    const messages = [
      {
        data: new TextEncoder().encode(
          JSON.stringify({
            ...baseEnvelope,
            type: "message",
            payload: { messageId: "history", isHistorySync: true },
          }),
        ),
        subject: "WHATSAPP.events.legacy.connection.message",
        ack: () => acked.push("history"),
        nak: () => {},
        term: () => {},
        info: { redeliveryCount: 1, streamSequence: 41 },
      },
      {
        data: new TextEncoder().encode(
          JSON.stringify({
            ...baseEnvelope,
            type: "contact",
            payload: { jid: "15550000000@s.whatsapp.net" },
          }),
        ),
        subject: "WHATSAPP.events.legacy.connection.contact",
        ack: () => acked.push("contact"),
        nak: () => {},
        term: () => {},
        info: { redeliveryCount: 1, streamSequence: 42 },
      },
      {
        data: new TextEncoder().encode(
          JSON.stringify({
            ...baseEnvelope,
            type: "message",
            payload: { messageId: "live", isHistorySync: false },
          }),
        ),
        subject: "WHATSAPP.events.legacy.connection.message",
        ack: () => acked.push("live"),
        nak: () => {},
        term: () => {},
        info: { redeliveryCount: 1, streamSequence: 43 },
      },
    ];

    conn._js.publish = async (...args: unknown[]) => {
      const [subject, data, options] = args as [
        string,
        Uint8Array,
        { msgID?: string } | undefined,
      ];
      published.push({
        subject,
        event: JSON.parse(new TextDecoder().decode(data)),
        msgID: options?.msgID,
      });
      return { seq: 1, stream: "test", duplicate: false };
    };
    conn._js.subscribe = async (...args: unknown[]) => {
      const durable = subscribeDurable(args[1]);
      if (durable === API_CRITICAL_EVENTS_CONSUMER) {
        return makeMockSubscription(messages);
      }
      return makeIdleSubscription();
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();
    mgr.startEventSupervisor(async (event) => {
      handled.push(
        (event.payload as { messageId?: string }).messageId ?? event.type,
      );
    });

    await pollUntil(() => acked.length === 3);
    expect(handled).toEqual(["live"]);
    expect(published).toEqual([
      {
        subject:
          "WHATSAPP.events.00000000-0000-0000-0000-000000000000.00000000-0000-0000-0000-000000000001.history_message",
        event: expect.objectContaining({
          type: "message",
          payload: expect.objectContaining({ isHistorySync: true }),
        }),
        msgID: "legacy-history-41",
      },
      {
        subject:
          "WHATSAPP.events.00000000-0000-0000-0000-000000000000.00000000-0000-0000-0000-000000000001.history_contact",
        event: expect.objectContaining({ type: "contact" }),
        msgID: "legacy-history-42",
      },
    ]);
  });

  test("dead-letter threshold uses each loop's own tuning.maxDeliver rather than a shared hardcoded value", async () => {
    const conn = makeMockConnection();
    const deadLetterSubjects: string[] = [];
    conn._js.publish = async (...args: unknown[]) => {
      const data = args[1] as Uint8Array;
      const payload = JSON.parse(new TextDecoder().decode(data)) as {
        sourceSubject: string;
      };
      deadLetterSubjects.push(payload.sourceSubject);
      return { seq: 1, stream: "test", duplicate: false };
    };

    const baseEnvelope = {
      contractVersion: 1,
      companyId: "00000000-0000-0000-0000-000000000000",
      connectionId: "00000000-0000-0000-0000-000000000001",
      payload: {},
      timestamp: new Date(0).toISOString(),
    };

    const critical = { termCalled: false, nakCalled: false };
    const criticalMsg = {
      data: new TextEncoder().encode(
        JSON.stringify({ ...baseEnvelope, type: "message" }),
      ),
      subject: "critical-subject-redelivery-4",
      ack: () => {},
      nak: () => {
        critical.nakCalled = true;
      },
      term: () => {
        critical.termCalled = true;
      },
      info: { redeliveryCount: 4 },
    };

    const transient = { termCalled: false, nakCalled: false };
    const transientMsg = {
      data: new TextEncoder().encode(
        JSON.stringify({ ...baseEnvelope, type: "presence" }),
      ),
      subject: "transient-subject-delivery-5",
      ack: () => {},
      nak: () => {
        transient.nakCalled = true;
      },
      term: () => {
        transient.termCalled = true;
      },
      info: { redeliveryCount: 5 },
    };

    conn._js.subscribe = async (...args: unknown[]) => {
      if (subscribeDurable(args[1]) === API_TRANSIENT_EVENTS_CONSUMER) {
        return makeMockSubscription([transientMsg]);
      }
      if (subscribeDurable(args[1]) === API_HISTORY_EVENTS_CONSUMER) {
        return makeIdleSubscription();
      }
      return makeMockSubscription([criticalMsg]);
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();

    mgr.startEventSupervisor(() => {
      throw new Error("handler failure");
    });

    await pollUntil(() => transient.termCalled && critical.nakCalled);

    // The critical consumer allows 10 one-based delivery attempts, so attempt
    // 4 must still be retried rather than dead-lettered.
    expect(critical.nakCalled).toBe(true);
    expect(critical.termCalled).toBe(false);
    expect(deadLetterSubjects).not.toContain("critical-subject-redelivery-4");

    // The transient consumer allows 5 one-based delivery attempts, so attempt
    // 5 is processed and then dead-lettered if it fails.
    expect(transient.termCalled).toBe(true);
    expect(transient.nakCalled).toBe(false);
    expect(deadLetterSubjects).toContain("transient-subject-delivery-5");
  });

  test("shutdown: aborts supervisor, drains connection, isConnected returns false", async () => {
    const conn = makeMockConnection();
    let drained = false;
    conn.drain = async () => {
      drained = true;
    };

    const mgr = tracked(new NatsLifecycleManager(makeConnectFn(() => conn)));
    await mgr.connect();

    mgr.startEventSupervisor(() => {});
    expect(mgr.isConnected()).toBe(true);

    await mgr.shutdown();

    expect(mgr.isConnected()).toBe(false);
    expect(drained).toBe(true);
  });

  test("connect failure resets state to disconnected", async () => {
    const mgr = tracked(
      new NatsLifecycleManager(async () => {
        throw new Error("connection refused");
      }),
    );

    try {
      await mgr.connect();
    } catch {
      // expected
    }

    const state = mgr.getReadinessState();
    expect(state.nats.state).toBe("disconnected");
    expect(state.nats.connected).toBe(false);
  });
});
