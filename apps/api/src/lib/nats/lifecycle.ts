import {
  type ConnectionOptions,
  type JetStreamClient,
  type JetStreamSubscription,
  JSONCodec,
  type JsMsg,
  type NatsConnection,
  connect,
} from "nats";
import { env } from "../env.js";
import { createLogger, formatError } from "../logger.js";
import {
  PermanentEventError,
  buildEventConsumerOptions,
  parseWhatsAppEvent,
} from "./client.js";
import type { WhatsAppEvent } from "./types/index.js";

const logger = createLogger("NatsLifecycle");

const API_EVENTS_SUBJECT = "WHATSAPP.events.>";
const API_EVENTS_DEAD_LETTER_SUBJECT = "WHATSAPP.dead_letter.api_events";

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

export interface NatsReadinessState {
  nats: { connected: boolean; state: ConnectionState; generation: number };
  eventConsumer: {
    active: boolean;
    generation: number | null;
    lastExitAt: string | null;
    lastError: string | null;
  };
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
        throw new Error("NATS_URL credentials require both username and password");
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

export class NatsLifecycleManager {
  private connection: NatsConnection | null = null;
  private jsClient: JetStreamClient | null = null;
  private jsGeneration = 0;
  private generation = 0;
  private state: ConnectionState = "disconnected";

  private eventSubscription: JetStreamSubscription | null = null;
  private eventSubscriptionGeneration: number | null = null;
  private consumerActive = false;
  private lastConsumerExitAt: Date | null = null;
  private lastConsumerError: string | null = null;

  private shutdownController = new AbortController();
  private supervisorPromise: Promise<void> | null = null;
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

  startEventSupervisor(
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): void {
    if (this.supervisorPromise) return;
    this.supervisorPromise = this.runSupervisor(callback);
  }

  private async runSupervisor(
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): Promise<void> {
    let retryMs = INITIAL_RETRY_MS;

    while (!this.shutdownController.signal.aborted) {
      try {
        const js = await this.getJetStreamClient();
        const gen = this.generation;

        const subscription = await js.subscribe(
          API_EVENTS_SUBJECT,
          buildEventConsumerOptions(API_EVENTS_SUBJECT),
        );
        this.eventSubscription = subscription;
        this.eventSubscriptionGeneration = gen;
        this.consumerActive = true;
        retryMs = INITIAL_RETRY_MS;

        logger.info(
          { generation: gen },
          "Event consumer subscribed and active",
        );

        await this.processMessages(subscription, js, callback);
      } catch (err) {
        if (this.shutdownController.signal.aborted) break;

        this.lastConsumerError =
          err instanceof Error ? err.message : String(err);

        logger.error(
          { ...formatError(err), retryMs },
          "Event consumer exited; retrying",
        );
      }

      this.consumerActive = false;
      this.lastConsumerExitAt = new Date();
      this.eventSubscription = null;
      this.eventSubscriptionGeneration = null;

      if (this.shutdownController.signal.aborted) break;

      const jitter = Math.random() * retryMs * 0.3;
      await this.abortableSleep(retryMs + jitter);
      retryMs = Math.min(retryMs * BACKOFF_FACTOR, MAX_RETRY_MS);
    }

    this.consumerActive = false;
  }

  private async processMessages(
    subscription: JetStreamSubscription,
    js: JetStreamClient,
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): Promise<void> {
    for await (const msg of subscription) {
      if (this.shutdownController.signal.aborted) break;
      await this.handleMessage(msg, js, callback);
    }
  }

  private async handleMessage(
    msg: JsMsg,
    js: JetStreamClient,
    callback: (event: WhatsAppEvent) => void | Promise<void>,
  ): Promise<void> {
    try {
      let event: WhatsAppEvent;
      try {
        event = parseWhatsAppEvent(jc.decode(msg.data));
      } catch (error) {
        logger.error(formatError(error), "Terminating invalid NATS event");
        try {
          await this.publishDeadLetter(js, msg, error, 1);
          msg.term();
        } catch (deadLetterError) {
          logger.error(
            formatError(deadLetterError),
            "Failed to persist invalid event to dead-letter stream",
          );
          msg.nak(1_000);
        }
        return;
      }
      await callback(event);
      msg.ack();
    } catch (error) {
      const deliveries = msg.info?.redeliveryCount ?? 0;
      logger.error(
        { ...formatError(error), deliveries },
        "Error processing message; scheduling redelivery",
      );
      if (error instanceof PermanentEventError || deliveries >= 9) {
        try {
          await this.publishDeadLetter(js, msg, error, deliveries + 1);
          msg.term();
        } catch (deadLetterError) {
          logger.error(
            formatError(deadLetterError),
            "Failed to persist event to dead-letter stream",
          );
          msg.nak(1_000);
        }
      } else {
        msg.nak(1_000);
      }
    }
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

    if (this.eventSubscription) {
      try {
        this.eventSubscription.unsubscribe();
      } catch {
        // already unsubscribed
      }
      this.eventSubscription = null;
    }
    this.consumerActive = false;

    if (this.supervisorPromise) {
      try {
        await Promise.race([
          this.supervisorPromise,
          new Promise((r) => setTimeout(r, 5_000)),
        ]);
      } catch {
        // supervisor exited
      }
      this.supervisorPromise = null;
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

  isConsumerActive(): boolean {
    return this.consumerActive;
  }

  getLastConsumerExitAt(): Date | null {
    return this.lastConsumerExitAt;
  }

  getLastConsumerError(): string | null {
    return this.lastConsumerError;
  }

  getReadinessState(): NatsReadinessState {
    return {
      nats: {
        connected: this.isConnected(),
        state: this.state,
        generation: this.generation,
      },
      eventConsumer: {
        active: this.consumerActive,
        generation: this.eventSubscriptionGeneration,
        lastExitAt: this.lastConsumerExitAt?.toISOString() ?? null,
        lastError: this.lastConsumerError,
      },
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
