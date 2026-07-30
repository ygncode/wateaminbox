import { app } from "./app.js";
import { setVerifiedRequestIp } from "./lib/client-ip.js";
import { env } from "./lib/env.js";
import { createLogger, formatError } from "./lib/logger.js";
import { closeNatsConnection } from "./lib/nats/index.js";
import {
  initializeCommandOutbox,
  shutdownCommandOutbox,
} from "./services/command-outbox.service.js";
import {
  initializeMessageCleanup,
  shutdownMessageCleanup,
} from "./services/message-cleanup.service.js";
import {
  initializeMessageHandler,
  shutdownMessageHandler,
} from "./services/message-handler.js";
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

  // Initialize services - these run in background and don't block server startup
  initializeMessageHandler()
    .then(() => {
      logger.info("Message handler initialized");
    })
    .catch((err) => {
      logger.error(
        { err: formatError(err) },
        "Failed to initialize message handler",
      );
      // Continue running even if NATS is not available initially
    });

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
  initializeScheduledMessages();

  logger.info(
    { port },
    `Server is accepting connections on http://localhost:${port}`,
  );
} else {
  logger.info("Skipping service initialization in test environment");
}

// Graceful shutdown handler
async function shutdown() {
  logger.info("Gracefully shutting down...");
  await shutdownMessageHandler();
  await shutdownMessageCleanup();
  await shutdownCommandOutbox();
  await shutdownScheduledMessages();
  await closeNatsConnection();
  await shutdownTenantConnections();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default {
  port,
  fetch(request: Request, server: Bun.Server<unknown>) {
    const address = server.requestIP(request)?.address;
    if (address) setVerifiedRequestIp(request, address);
    return app.fetch(request);
  },
};

// Re-export types for RPC client usage
export type { AppType } from "./routes/index.js";
