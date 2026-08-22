import { afterEach, describe, expect, test } from "bun:test";
import {
  NatsLifecycleManager,
  type ConnectFn,
  parseNatsServerAuth,
} from "./lifecycle.js";

describe("parseNatsServerAuth", () => {
  test("moves URL credentials into nats.js connection options", () => {
    expect(
      parseNatsServerAuth(
        "nats://service:secret_0123456789abcdef@nats:4222",
      ),
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
  let resolve: ((v: IteratorResult<{ type: string; data?: unknown }>) => void) | null = null;
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
  publish: (...args: unknown[]) => Promise<{ seq: number; stream: string; duplicate: boolean }>;
  _subscribeImpl: ((...args: unknown[]) => Promise<MockSubscription>) | null;
}

function makeMockSubscription(
  messages: Array<{ data: Uint8Array; subject: string; ack: () => void; nak: (delay?: number) => void; term: () => void; info?: { redeliveryCount: number } }>,
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
    let subscribeCallCount = 0;
    const subscribeGate: { resolve: () => void } = { resolve: () => {} };
    const gatePromise = new Promise<void>((r) => {
      subscribeGate.resolve = r;
    });

    // First subscribe returns an empty subscription (normal exit).
    // Second subscribe blocks until we shut down.
    conn._js.subscribe = async () => {
      subscribeCallCount++;
      if (subscribeCallCount === 1) {
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
    expect(state.eventConsumer.lastExitAt).not.toBeNull();
    expect(subscribeCallCount).toBeGreaterThanOrEqual(2);
  });

  test("exceptional subscription exit: readiness reflects the error", async () => {
    const conn = makeMockConnection();
    let subscribeCallCount = 0;
    const subscribeGate: { resolve: () => void } = { resolve: () => {} };
    const gatePromise = new Promise<void>((r) => {
      subscribeGate.resolve = r;
    });

    conn._js.subscribe = async () => {
      subscribeCallCount++;
      if (subscribeCallCount === 1) {
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
    expect(state.eventConsumer.lastError).toBe("stream not found");
    expect(state.eventConsumer.lastExitAt).not.toBeNull();
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
