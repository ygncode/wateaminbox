import {
  type ConnectionOptions,
  connect,
  type JetStreamClient,
  type JetStreamSubscription,
  JSONCodec,
  type JsMsg,
  type NatsConnection,
} from "nats";
import { env } from "../env.js";
import { createLogger, formatError } from "../logger.js";
import {
  API_CRITICAL_EVENT_FILTER_SUBJECTS,
  API_CRITICAL_EVENTS_IDENTITY,
  API_CRITICAL_EVENTS_TUNING,
  API_HISTORY_EVENT_FILTER_SUBJECTS,
  API_HISTORY_EVENTS_IDENTITY,
  API_HISTORY_EVENTS_TUNING,
  API_TRANSIENT_EVENT_FILTER_SUBJECTS,
  API_TRANSIENT_EVENTS_IDENTITY,
  API_TRANSIENT_EVENTS_TUNING,
  buildEventConsumerOptions,
  type EventConsumerIdentity,
  type EventConsumerTuning,
  PermanentEventError,
  parseWhatsAppEvent,
} from "./client.js";
import type { WhatsAppEvent } from "./types/index.js";

const logger = createLogger("NatsLifecycle");

const API_EVENTS_DEAD_LETTER_SUBJECT = "WHATSAPP.dead_letter.api_events";

const HISTORY_MESSAGE_EVENT_SUFFIX = ".history_message";
const HISTORY_CONTACT_EVENT_SUFFIX = ".history_contact";

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;
const BACKOFF_FACTOR = 2;

type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed"
  | "shutting_down";

/**
 * Three independent event consumer loops - see APICriticalEventsConsumer /
 * APITransientEventsConsumer in services/shared/nats/consumers.go for the
 * full rationale. "critical" carries message/receipt/send_confirmation/...;
 * "history" carries reconnect imports; "transient" carries presence/typing.
 * Splitting them means either burst cannot delay the critical live loop.
 */
type EventLoopName = "critical" | "history" | "transient";
const EVENT_LOOP_NAMES: EventLoopName[] = ["critical", "history", "transient"];

interface EventLoopReadiness {
  active: boolean;
  generation: number | null;
  lastExitAt: string | null;
  lastError: string | null;
}

export interface NatsReadinessState {
  nats: { connected: boolean; state: ConnectionState; generation: number };
  // The critical loop's own readiness, kept under this name for backward
  // compatibility with existing readers (apps/api/src/routes/health.ts).
  // Deliberately NOT merged with the transient loop: presence/typing are
  // loss-tolerant, so a transient-loop outage must not fail readiness and
  // pull an otherwise-healthy replica out of rotation. See eventConsumers
  // below for the transient loop's own detail.
  eventConsumer: EventLoopReadiness;
  eventConsumers: Record<EventLoopName, EventLoopReadiness>;
}

const jc = JSONCodec<unknown>();

export type ConnectFn = (opts?: ConnectionOptions) => Promise<NatsConnection>;

export function parseNatsServerAuth(input: string): {
  servers: string[];
  user?: string;
  pass?: string;
} {
  let user: string | undefined;
  let pass: string | undefined;
  let authenticated: boolean | undefined;
  const servers = input.split(",").map((value) => {
    const parsed = new URL(value.trim());
    const parsedUser = decodeURIComponent(parsed.username);
    const parsedPass = decodeURIComponent(parsed.password);
    if (parsedUser || parsedPass) {
      if (authenticated === false) {
        throw new Error("NATS_URL servers must use consistent authentication");
      }
      authenticated = true;
      if (!parsedUser || !parsedPass) {
        throw new Error(
          "NATS_URL credentials require both username and password",
        );
      }
      if (user !== undefined && (user !== parsedUser || pass !== parsedPass)) {
        throw new Error("NATS_URL servers must use the same credentials");
      }
      user = parsedUser;
      pass = parsedPass;
    } else {
      if (authenticated === true) {
        throw new Error("NATS_URL servers must use consistent authentication");
      }
      authenticated = false;
    }
    // nats.js accepts credentials as options, not in its server URL parser.
    return `${parsed.protocol}//${parsed.host}`;
  });
  return { servers, user, pass };
}

interface EventLoopConfig {
  identity: EventConsumerIdentity;
  filterSubjects: string[];
  tuning: EventConsumerTuning;
}

interface EventLoopState {
  subscription: JetStreamSubscription | null;
  subscriptionGeneration: number | null;
  active: boolean;
  lastExitAt: Date | null;
  lastError: string | null;
  supervisorPromise: Promise<void> | null;
}

function newEventLoopState(): EventLoopState {
  return {
    subscription: null,
    subscriptionGeneration: null,
    active: false,
    lastExitAt: null,
    lastError: null,
    supervisorPromise: null,
  };
}

// A function rather than a module-level object: client.ts and lifecycle.ts
// import from each other (client.ts needs natsLifecycle; lifecycle.ts needs
// these consumer identities), and a top-level object literal evaluated
// during that circular load can observe the other module's const exports
// before they are initialized. Evaluating this lazily, only once the class's
// methods actually run, sidesteps the ordering entirely.
function eventLoopConfig(name: EventLoopName): EventLoopConfig {
  switch (name) {
    case "critical":
      return {
        identity: API_CRITICAL_EVENTS_IDENTITY,
        filterSubjects: API_CRITICAL_EVENT_FILTER_SUBJECTS,
        tuning: API_CRITICAL_EVENTS_TUNING,
      };
    case "history":
      return {
        identity: API_HISTORY_EVENTS_IDENTITY,
        filterSubjects: API_HISTORY_EVENT_FILTER_SUBJECTS,
        tuning: API_HISTORY_EVENTS_TUNING,
      };
    case "transient":
      return {
        identity: API_TRANSIENT_EVENTS_IDENTITY,
        filterSubjects: API_TRANSIENT_EVENT_FILTER_SUBJECTS,
        tuning: API_TRANSIENT_EVENTS_TUNING,
      };
  }
}

export class NatsLifecycleManager {
  private connection: NatsConnection | null = null;
  private jsClient: JetStreamClient | null = null;
  private jsGeneration = 0;
  private generation = 0;
  private state: ConnectionState = "disconnected";

  private loops: Record<EventLoopName, EventLoopState> = {
    critical: newEventLoopState(),
    history: newEventLoopState(),
    transient: newEventLoopState(),
  };

  private shutdownController = new AbortController();
  private connectPromise: Promise<NatsConnection> | null = null;

  private connectFn: ConnectFn;

  constructor(connectFn?: ConnectFn) {
    this.connectFn = connectFn ?? connect;
  }

  async getConnection(): Promise<NatsConnection> {
    if (this.connection && !this.connection.isClosed()) {
      return this.connection;
    }
    return this.connect();
  }

  async connect(): Promise<NatsConnection> {
    if (this.state === "shutting_down") {
      throw new Error("NATS lifecycle is shutting down");
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connectInternal();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connectInternal(): Promise<NatsConnection> {
    this.state = "connecting";
    const gen = ++this.generation;

    let nc: NatsConnection;
    try {
      const auth = parseNatsServerAuth(env.NATS_URL);
      nc = await this.connectFn({
        servers: auth.servers,
        user: auth.user,
        pass: auth.pass,
        token: auth.user ? undefined : env.NATS_TOKEN || undefined,
        name: "whatsapp-api",
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: INITIAL_RETRY_MS,
        reconnectJitter: 500,
        reconnectJitterTLS: 1_000,
        pingInterval: 30_000,
        maxPingOut: 3,
      });
    } catch (err) {
      this.state = "disconnected";
      throw err;
    }

    this.connection = nc;
    this.jsClient = null;
    this.jsGeneration = 0;
    this.state = "connected";

    logger.info({ generation: gen }, "Connected to NATS");

    this.watchStatus(nc, gen);
    this.watchClosed(nc, gen);

    return nc;
  }

  private watchStatus(nc: NatsConnection, gen: number): void {
    (async () => {
      for await (const status of nc.status()) {
        if (this.generation !== gen) return;
        switch (status.type) {
          case "disconnect":
            this.state = "reconnecting";
            logger.warn({ generation: gen }, "Disconnected from NATS");
            break;
          case "reconnect":
            this.state = "connected";
            logger.info({ generation: gen }, "Reconnected to NATS");
            break;
          case "reconnecting":
            logger.debug({ generation: gen }, "Reconnecting to NATS");
            break;
          case "error":
            logger.error(
              { generation: gen, error: status.data },
              "NATS connection error",
            );
            break;
        }
      }
    })().catch((err) => {
      if (this.generation !== gen) return;
      logger.error(formatError(err), "NATS status monitoring error");
    });
  }

  private watchClosed(nc: NatsConnection, gen: number): void {
    nc.closed().then(
      (err) => {
        if (this.generation !== gen) return;
        if (this.state === "shutting_down") return;

        if (this.connection === nc) {
          this.connection = null;
          this.jsClient = null;
          this.jsGeneration = 0;
          this.state = "closed";
        }

        logger.warn(
          { generation: gen, ...(err ? formatError(err) : {}) },
          "NATS connection closed unexpectedly; supervisor will reconnect",
        );
      },
      () => {},
    );
  }

  async getJetStreamClient(): Promise<JetStreamClient> {
    const nc = await this.getConnection();
    if (this.jsClient && this.jsGeneration === this.generation) {
      return this.jsClient;
    }
    this.jsClient = nc.jetstream();
    this.jsGeneration = this.generation;
    return this.jsClient;
  }

  /**
   * Starts all event consumer loops. Idempotent per loop: calling this
   * again while a loop's supervisor is already running does not start a
   * second one for that loop.
   */
  startEventSupervisor(
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): void {
    for (const name of EVENT_LOOP_NAMES) {
      this.startLoop(name, callback);
    }
  }

  private startLoop(
    name: EventLoopName,
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): void {
    const loop = this.loops[name];
    if (loop.supervisorPromise) return;
    loop.supervisorPromise = this.runSupervisor(name, callback);
  }

  private async runSupervisor(
    name: EventLoopName,
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): Promise<void> {
    const loop = this.loops[name];
    const config = eventLoopConfig(name);
    let retryMs = INITIAL_RETRY_MS;

    while (!this.shutdownController.signal.aborted) {
      try {
        const js = await this.getJetStreamClient();
        const gen = this.generation;

        const subscription = await js.subscribe(
          config.filterSubjects[0],
          buildEventConsumerOptions(
            config.filterSubjects,
            config.identity,
            config.tuning,
          ),
        );
        loop.subscription = subscription;
        loop.subscriptionGeneration = gen;
        loop.active = true;
        retryMs = INITIAL_RETRY_MS;

        logger.info(
          { generation: gen, loop: name, durable: config.identity.durable },
          "Event consumer subscribed and active",
        );

        await this.processMessages(name, subscription, js, callback);
      } catch (err) {
        if (this.shutdownController.signal.aborted) break;

        loop.lastError = err instanceof Error ? err.message : String(err);

        logger.error(
          { ...formatError(err), retryMs, loop: name },
          "Event consumer exited; retrying",
        );
      }

      loop.active = false;
      loop.lastExitAt = new Date();
      loop.subscription = null;
      loop.subscriptionGeneration = null;

      if (this.shutdownController.signal.aborted) break;

      const jitter = Math.random() * retryMs * 0.3;
      await this.abortableSleep(retryMs + jitter);
      retryMs = Math.min(retryMs * BACKOFF_FACTOR, MAX_RETRY_MS);
    }

    loop.active = false;
  }

  private async processMessages(
    name: EventLoopName,
    subscription: JetStreamSubscription,
    js: JetStreamClient,
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): Promise<void> {
    for await (const msg of subscription) {
      if (this.shutdownController.signal.aborted) break;
      await this.handleMessage(name, msg, js, callback);
    }
  }

  private async handleMessage(
    name: EventLoopName,
    msg: JsMsg,
    js: JetStreamClient,
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): Promise<void> {
    try {
      let event: WhatsAppEvent;
      try {
        event = parseWhatsAppEvent(jc.decode(msg.data));
      } catch (error) {
        logger.error(
          { ...formatError(error), loop: name },
          "Terminating invalid NATS event",
        );
        try {
          await this.publishDeadLetter(js, msg, error, 1);
          msg.term();
        } catch (deadLetterError) {
          logger.error(
            { ...formatError(deadLetterError), loop: name },
            "Failed to persist invalid event to dead-letter stream",
          );
          msg.nak(1_000);
        }
        return;
      }

      // Workers that were already running when the history lanes shipped can
      // still have durable outbox records addressed to the legacy `.message`
      // and `.contact` subjects. Move those records to the bounded history
      // consumer before invoking the database handler so an upgrade-time
      // replay cannot continue blocking receipts and send confirmations.
      //
      // Publish-before-ack makes the move lossless. The source stream sequence
      // is stable across redelivery and therefore gives JetStream a
      // deterministic de-duplication key if this API dies between the two.
      const historySubject = this.legacyHistorySubject(name, event);
      if (historySubject) {
        const streamSequence = msg.info?.streamSequence;
        await js.publish(
          historySubject,
          msg.data,
          streamSequence
            ? { msgID: `legacy-history-${streamSequence}` }
            : undefined,
        );
        msg.ack();
        return;
      }

      await callback(event);
      msg.ack();
    } catch (error) {
      const deliveries = msg.info?.redeliveryCount ?? 0;
      // nats.js exposes the one-based JetStream delivery count under the
      // redeliveryCount property. Terminate only after the configured final
      // attempt has actually run.
      const maxDeliver = eventLoopConfig(name).tuning.maxDeliver;
      logger.error(
        { ...formatError(error), deliveries, loop: name, maxDeliver },
        "Error processing message; scheduling redelivery",
      );
      if (error instanceof PermanentEventError || deliveries >= maxDeliver) {
        try {
          await this.publishDeadLetter(js, msg, error, deliveries);
          msg.term();
        } catch (deadLetterError) {
          logger.error(
            { ...formatError(deadLetterError), loop: name },
            "Failed to persist event to dead-letter stream",
          );
          msg.nak(1_000);
        }
      } else {
        msg.nak(1_000);
      }
    }
  }

  private legacyHistorySubject(
    name: EventLoopName,
    event: WhatsAppEvent,
  ): string | null {
    if (name !== "critical") return null;

    const base = `WHATSAPP.events.${event.companyId}.${event.connectionId}`;
    if (event.type === "contact") {
      return `${base}${HISTORY_CONTACT_EVENT_SUFFIX}`;
    }
    if (
      event.type === "message" &&
      (event.payload as { isHistorySync?: unknown }).isHistorySync === true
    ) {
      return `${base}${HISTORY_MESSAGE_EVENT_SUFFIX}`;
    }
    return null;
  }

  private async publishDeadLetter(
    js: JetStreamClient,
    msg: JsMsg,
    error: unknown,
    deliveries: number,
  ): Promise<void> {
    await js.publish(
      API_EVENTS_DEAD_LETTER_SUBJECT,
      jc.encode({
        sourceSubject: msg.subject,
        deliveries,
        error: error instanceof Error ? error.message : String(error),
        payloadBase64: Buffer.from(msg.data).toString("base64"),
        failedAt: new Date().toISOString(),
      }),
    );
  }

  async shutdown(): Promise<void> {
    if (this.state === "shutting_down") return;
    this.state = "shutting_down";
    this.shutdownController.abort();

    for (const name of EVENT_LOOP_NAMES) {
      const loop = this.loops[name];
      if (loop.subscription) {
        try {
          loop.subscription.unsubscribe();
        } catch {
          // already unsubscribed
        }
        loop.subscription = null;
      }
      loop.active = false;
    }

    const pendingSupervisors = EVENT_LOOP_NAMES.map(
      (name) => this.loops[name].supervisorPromise,
    ).filter((p): p is Promise<void> => p !== null);
    if (pendingSupervisors.length > 0) {
      try {
        await Promise.race([
          Promise.all(pendingSupervisors),
          new Promise((r) => setTimeout(r, 5_000)),
        ]);
      } catch {
        // supervisor exited
      }
      for (const name of EVENT_LOOP_NAMES) {
        this.loops[name].supervisorPromise = null;
      }
    }

    if (this.connection && !this.connection.isClosed()) {
      try {
        await this.connection.drain();
        await this.connection.close();
      } catch {
        // best-effort
      }
    }

    this.connection = null;
    this.jsClient = null;
    this.jsGeneration = 0;
    logger.info("NATS lifecycle shutdown complete");
  }

  isConnected(): boolean {
    return (
      this.connection !== null &&
      !this.connection.isClosed() &&
      this.state === "connected"
    );
  }

  /**
   * The critical loop's own active state - message/receipt/send_confirmation/
   * etc. processing. The transient (presence/typing) loop is deliberately
   * excluded from this and from the rest of the aggregate readiness surface
   * below: presence/typing are loss-tolerant, so a transient-loop outage
   * must not take a healthy-for-critical-work API replica out of rotation
   * (Kubernetes/Docker would otherwise kill or stop routing to a replica
   * that is still correctly processing every message). See
   * eventConsumers.history/transient on getReadinessState() for their detail.
   */
  isConsumerActive(): boolean {
    return this.loops.critical.active;
  }

  /** The critical loop's own last exit time. */
  getLastConsumerExitAt(): Date | null {
    return this.loops.critical.lastExitAt;
  }

  /** The critical loop's own last error. */
  getLastConsumerError(): string | null {
    return this.loops.critical.lastError;
  }

  private loopReadiness(name: EventLoopName): EventLoopReadiness {
    const loop = this.loops[name];
    return {
      active: loop.active,
      generation: loop.subscriptionGeneration,
      lastExitAt: loop.lastExitAt?.toISOString() ?? null,
      lastError: loop.lastError,
    };
  }

  getReadinessState(): NatsReadinessState {
    const critical = this.loopReadiness("critical");
    const history = this.loopReadiness("history");
    const transient = this.loopReadiness("transient");
    return {
      nats: {
        connected: this.isConnected(),
        state: this.state,
        generation: this.generation,
      },
      // Deliberately just the critical loop's own readiness, not merged with
      // the non-live lanes - see isConsumerActive's comment. eventConsumers
      // carries their detail for observability without them gating readiness.
      eventConsumer: critical,
      eventConsumers: { critical, history, transient },
    };
  }

  private abortableSleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.shutdownController.signal.aborted) {
        resolve();
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.shutdownController.signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      this.shutdownController.signal.addEventListener("abort", onAbort, {
        once: true,
      });
    });
  }
}

export const natsLifecycle = new NatsLifecycleManager();
