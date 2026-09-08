import { app } from "./app.js";
import { MAX_UPLOAD_BODY_SIZE } from "./config/media.config.js";
import { setVerifiedRequestIp } from "./lib/client-ip.js";
import { env } from "./lib/env.js";
import { createLogger, formatError } from "./lib/logger.js";
import { natsLifecycle } from "./lib/nats/index.js";
import { rateLimitStore } from "./lib/rate-limit-store.js";
import { runShutdown, type ShutdownStep } from "./lib/shutdown.js";
import {
  initializeCommandOutbox,
  shutdownCommandOutbox,
} from "./services/command-outbox.service.js";
import {
  initializeConnectionEmailAlerts,
  shutdownConnectionEmailAlerts,
} from "./services/connection-email-alerts.service.js";
import {
  initializeConnectionPurgeCleanup,
  shutdownConnectionPurgeCleanup,
} from "./services/connection-purge-cleanup.service.js";
import {
  initializeMessageCleanup,
  shutdownMessageCleanup,
} from "./services/message-cleanup.service.js";
import {
  initializeMessageDelivery,
  shutdownMessageDelivery,
} from "./services/message-delivery-outbox.service.js";
import { initializeMessageHandler } from "./services/message-handler.js";
import {
  initializeMessageSearch,
  shutdownMessageSearch,
} from "./services/message-search-outbox.service.js";
import {
  initializeScheduledMessages,
  shutdownScheduledMessages,
} from "./services/scheduled-message.service.js";
import { shutdownTenantConnections } from "./services/tenant.service.js";

const logger = createLogger("Startup");

const port = env.PORT;

// Detect if we're running in a test environment
// Don't initialize background services during test runs to avoid side effects
const isTestEnvironment =
  process.env.NODE_ENV === "test" ||
  process.env.VITEST === "true" ||
  (typeof Bun !== "undefined" && Bun.argv.some((arg) => arg.includes("test")));

if (!isTestEnvironment) {
  logger.info({ port }, `Starting server on http://localhost:${port}`);
  logger.info("Initializing background services...");

  // The lifecycle supervisor connects to NATS and re-subscribes automatically;
  // it is non-blocking and never throws.
  initializeMessageHandler();

  initializeMessageCleanup()
    .then(() => {
      logger.info("Message cleanup service initialized");
    })
    .catch((err) => {
      logger.error(
        { err: formatError(err) },
        "Failed to initialize message cleanup service",
      );
      // Continue running even if cleanup service fails to initialize
    });

  initializeCommandOutbox();
  initializeMessageSearch();
  initializeMessageDelivery();
  initializeScheduledMessages();
  initializeConnectionPurgeCleanup();
  initializeConnectionEmailAlerts();

  logger.info(
    { port },
    `Server is accepting connections on http://localhost:${port}`,
  );
} else {
  logger.info("Skipping service initialization in test environment");
}

/**
 * Total time the shutdown sequence may take. Must stay below the container's
 * stop_grace_period in compose.production.yml, which is what escalates to
 * SIGKILL; the gap is the headroom for exiting after the sequence finishes.
 */
const SHUTDOWN_DEADLINE_MS = 20_000;

/**
 * Captured from the first request Bun serves. The entrypoint uses the default
 * export form, so Bun owns the server and hands it to `fetch` rather than
 * returning a handle. Without it there is nothing to drain; with it the drain
 * is the first thing shutdown does.
 */
let httpServer: Bun.Server<unknown> | undefined;

/** Set once so repeated signals cannot start overlapping shutdowns. */
let shutdownInFlight: Promise<void> | undefined;

/**
 * Ordered by dependency: stop taking new work, quiesce the things that produce
 * it, then release the connections they were using. Reversing any of these
 * would tear a resource out from under a step that still needs it.
 */
function shutdownSteps(): ShutdownStep[] {
  return [
    // Refuse new connections and let in-flight requests finish first, so
    // draining below is not racing handlers that are still running.
    {
      name: "http-server",
      run: async () => {
        await httpServer?.stop(false);
      },
    },
    { name: "connection-email-alerts", run: shutdownConnectionEmailAlerts },
    { name: "message-cleanup", run: shutdownMessageCleanup },
    { name: "connection-purge-cleanup", run: shutdownConnectionPurgeCleanup },
    { name: "command-outbox", run: shutdownCommandOutbox },
    { name: "scheduled-messages", run: shutdownScheduledMessages },
    // Drains the event supervisor, then the NATS connection itself.
    { name: "nats", run: () => natsLifecycle.shutdown() },
    { name: "message-delivery", run: shutdownMessageDelivery },
    { name: "message-search", run: shutdownMessageSearch },
    // Stops PostgreSQL cleanup (or closes the optional Redis connection)
    // before the database pools used by the store are released.
    { name: "rate-limit-store", run: () => rateLimitStore.close() },
    // Every step above can touch the database, so the pools close last.
    { name: "tenant-connections", run: shutdownTenantConnections },
  ];
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal, deadlineMs: SHUTDOWN_DEADLINE_MS }, "Shutting down");

  const result = await runShutdown({
    steps: shutdownSteps(),
    deadlineMs: SHUTDOWN_DEADLINE_MS,
    onResult: ({ name, status, error }) => {
      if (status === "completed") {
        logger.info({ step: name }, "Shutdown step complete");
        return;
      }
      logger.warn(
        { step: name, status, ...(error ? { err: formatError(error) } : {}) },
        "Shutdown step did not complete",
      );
    },
  });

  if (result.timedOut) {
    logger.warn(
      { deadlineMs: SHUTDOWN_DEADLINE_MS },
      "Shutdown deadline exceeded; exiting with resources unreleased",
    );
  } else {
    logger.info("Shutdown complete");
  }

  // Exit explicitly: abandoned steps may leave pending work that would
  // otherwise keep the process alive past the container's grace period. The
  // code stays 0 even on a timeout, because the container is being stopped
  // either way and a failure code would only risk a restart loop.
  process.exit(0);
}

function handleSignal(signal: NodeJS.Signals): void {
  if (shutdownInFlight) {
    // A second signal is an operator asking to stop waiting.
    logger.warn({ signal }, "Shutdown already running; exiting immediately");
    process.exit(1);
  }
  shutdownInFlight = shutdown(signal);
}

process.on("SIGTERM", handleSignal);
process.on("SIGINT", handleSignal);

export default {
  port,
  // Server-level backstop for the route-level Content-Length guards. Bun
  // refuses a request whose body exceeds this at the header level (an honest
  // Content-Length) or during streaming (chunked encoding, or a Content-Length
  // that understates the actual body), so no route's body-buffering step
  // (parseBody/formData/json) can hold more than this many bytes in memory.
  // Sized to the largest legitimate body — a 50 MiB media upload plus 1 MiB
  // of multipart framing (see config/media.config.ts). No other route
  // buffers a body anywhere near this size; the next largest is the 5 MiB
  // contacts CSV import. The default is 128 MiB, which left the 50 MiB–128 MiB
  // attack window open for the media upload route's post-buffer rejection.
  maxRequestBodySize: MAX_UPLOAD_BODY_SIZE,
  fetch(request: Request, server: Bun.Server<unknown>) {
    httpServer ??= server;
    const address = server.requestIP(request)?.address;
    if (address) setVerifiedRequestIp(request, address);
    return app.fetch(request);
  },
};

// Re-export types for RPC client usage
export type { AppType } from "./routes/index.js";
