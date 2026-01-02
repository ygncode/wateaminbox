import { app } from "./app.js";
import { env } from "./lib/env.js";
import { websocket } from "./routes/ws.js";
import { initializeMessageHandler, shutdownMessageHandler } from "./services/message-handler.js";
import { closeNatsConnection } from "./lib/nats.js";

const port = env.PORT;

// Initialize message handler for NATS event processing
initializeMessageHandler()
  .then(() => {
    console.log("[Startup] Message handler initialized");
  })
  .catch((err) => {
    console.error("[Startup] Failed to initialize message handler:", err);
    // Continue running even if NATS is not available initially
  });

// Graceful shutdown handler
async function shutdown() {
  console.log("[Shutdown] Gracefully shutting down...");
  await shutdownMessageHandler();
  await closeNatsConnection();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`Server is running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  websocket, // Bun WebSocket handler
};
