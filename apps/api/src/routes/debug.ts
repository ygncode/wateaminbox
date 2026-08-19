/**
 * Debug Routes
 * Development-only endpoints for debugging NATS message flows
 */

import { Hono } from "hono";
import { env } from "../lib/env.js";
import { createLogger, formatError } from "../lib/logger.js";
import { natsLifecycle } from "../lib/nats/lifecycle.js";

const logger = createLogger("debug");

export const debugRoutes = new Hono();

// Only enable in development
const isDev = env.NODE_ENV === "development";

/**
 * GET /debug/nats/status
 * Get NATS connection status and stream info
 */
debugRoutes.get("/nats/status", async (c) => {
  if (!isDev) {
    return c.json({ error: "Debug endpoints disabled in production" }, 403);
  }

  try {
    const connected = natsLifecycle.isConnected();

    if (!connected) {
      return c.json({
        connected: false,
        streams: [],
        message: "NATS not connected",
      });
    }

    const jsm = await (await natsLifecycle.getConnection()).jetstreamManager();

    // Get stream info
    const streams: Array<{
      name: string;
      messages: number;
      bytes: number;
      firstSeq: number;
      lastSeq: number;
      consumerCount: number;
    }> = [];

    const streamNames = [
      "WHATSAPP_COMMANDS",
      "WHATSAPP_EVENTS",
      "WHATSAPP_DOWNLOADS",
    ];

    for (const name of streamNames) {
      try {
        const info = await jsm.streams.info(name);
        streams.push({
          name: info.config.name,
          messages: info.state.messages,
          bytes: info.state.bytes,
          firstSeq: info.state.first_seq,
          lastSeq: info.state.last_seq,
          consumerCount: info.state.consumer_count,
        });
      } catch {
        // Stream might not exist
        streams.push({
          name,
          messages: 0,
          bytes: 0,
          firstSeq: 0,
          lastSeq: 0,
          consumerCount: 0,
        });
      }
    }

    return c.json({
      connected,
      streams,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(formatError(error), "Failed to get NATS status");
    return c.json({ error: "Failed to get NATS status" }, 500);
  }
});

/**
 * GET /debug/nats/consumers/:stream
 * Get consumer info for a stream
 */
debugRoutes.get("/nats/consumers/:stream", async (c) => {
  if (!isDev) {
    return c.json({ error: "Debug endpoints disabled in production" }, 403);
  }

  const streamName = c.req.param("stream");

  try {
    const jsm = await (await natsLifecycle.getConnection()).jetstreamManager();

    const consumers: Array<{
      name: string;
      numPending: number;
      numWaiting: number;
      numAckPending: number;
      delivered: { streamSeq: number; consumerSeq: number };
    }> = [];

    const consumerList = await jsm.consumers.list(streamName);

    for await (const consumer of consumerList) {
      consumers.push({
        name: consumer.name,
        numPending: consumer.num_pending,
        numWaiting: consumer.num_waiting,
        numAckPending: consumer.num_ack_pending,
        delivered: {
          streamSeq: consumer.delivered.stream_seq,
          consumerSeq: consumer.delivered.consumer_seq,
        },
      });
    }

    return c.json({
      stream: streamName,
      consumers,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(formatError(error), "Failed to get consumers");
    return c.json({ error: "Failed to get consumers" }, 500);
  }
});

/**
 * GET /debug/nats/messages/:stream
 * Get recent messages from a stream (for debugging)
 * Note: Use ./scripts/debug-nats.sh for more detailed message inspection
 */
debugRoutes.get("/nats/messages/:stream", async (c) => {
  if (!isDev) {
    return c.json({ error: "Debug endpoints disabled in production" }, 403);
  }

  const streamName = c.req.param("stream");

  try {
    const jsm = await (await natsLifecycle.getConnection()).jetstreamManager();

    // Get stream info
    const streamInfo = await jsm.streams.info(streamName);

    return c.json({
      stream: streamName,
      info: {
        messages: streamInfo.state.messages,
        bytes: streamInfo.state.bytes,
        firstSeq: streamInfo.state.first_seq,
        lastSeq: streamInfo.state.last_seq,
        consumerCount: streamInfo.state.consumer_count,
      },
      note: "Use ./scripts/debug-nats.sh commands to view actual message content",
      commands: {
        viewMessages: `./scripts/debug-nats.sh commands`,
        subscribeEvents: `./scripts/debug-nats.sh events`,
        streamInfo: `./scripts/debug-nats.sh stream-info ${streamName}`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(formatError(error), "Failed to get messages");
    return c.json({ error: "Failed to get messages" }, 500);
  }
});

/**
 * GET /debug/nats/trace/:correlationId
 * Provides instructions for tracing a correlation ID
 * Note: Use ./scripts/debug-nats.sh trace for actual message lookup
 */
debugRoutes.get("/nats/trace/:correlationId", async (c) => {
  if (!isDev) {
    return c.json({ error: "Debug endpoints disabled in production" }, 403);
  }

  const correlationId = c.req.param("correlationId");

  return c.json({
    correlationId,
    note: "Use the debug-nats.sh script to trace messages with this correlation ID",
    commands: {
      traceCommand: `./scripts/debug-nats.sh trace ${correlationId}`,
      subscribeAndFilter: `./scripts/debug-nats.sh events | grep ${correlationId}`,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /debug/nats/help
 * Shows available debugging commands and endpoints
 */
debugRoutes.get("/nats/help", async (c) => {
  if (!isDev) {
    return c.json({ error: "Debug endpoints disabled in production" }, 403);
  }

  return c.json({
    endpoints: {
      "/debug/nats/status": "Get NATS connection status and stream info",
      "/debug/nats/consumers/:stream": "Get consumer info for a stream",
      "/debug/nats/messages/:stream": "Get stream info (use CLI for content)",
      "/debug/nats/trace/:correlationId": "Get trace instructions",
      "/debug/nats/help": "This help message",
    },
    cliCommands: {
      start: "docker compose --profile debug up -d",
      streams: "./scripts/debug-nats.sh streams",
      events: "./scripts/debug-nats.sh events",
      eventsFiltered: "./scripts/debug-nats.sh events-company <companyId>",
      commands: "./scripts/debug-nats.sh commands",
      consumers: "./scripts/debug-nats.sh consumers WHATSAPP_COMMANDS",
      lag: "./scripts/debug-nats.sh lag",
      trace: "./scripts/debug-nats.sh trace <correlationId>",
      health: "./scripts/debug-nats.sh health",
      stats: "./scripts/debug-nats.sh stats",
    },
    httpEndpoints: {
      serverHealth: "http://localhost:8222/healthz",
      jetStreamStats: "http://localhost:8222/jsz",
      connections: "http://localhost:8222/connz",
    },
    timestamp: new Date().toISOString(),
  });
});
