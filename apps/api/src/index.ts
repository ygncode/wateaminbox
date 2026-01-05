import { app } from './app.js'
import { env } from './lib/env.js'
import { closeNatsConnection } from './lib/nats.js'
import { websocket } from './routes/ws.js'
import {
  initializeMessageCleanup,
  shutdownMessageCleanup,
} from './services/message-cleanup.service.js'
import { initializeMessageHandler, shutdownMessageHandler } from './services/message-handler.js'

const port = env.PORT

// Detect if we're running in a test environment
// Don't initialize background services during test runs to avoid side effects
const isTestEnvironment =
  process.env.NODE_ENV === 'test' ||
  process.env.VITEST === 'true' ||
  (typeof Bun !== 'undefined' && Bun.argv.some((arg) => arg.includes('test')))

if (!isTestEnvironment) {
  console.log(`[Startup] Starting server on http://localhost:${port}`)
  console.log('[Startup] Initializing background services...')

  // Initialize services - these run in background and don't block server startup
  initializeMessageHandler()
    .then(() => {
      console.log('[Startup] ✓ Message handler initialized')
    })
    .catch((err) => {
      console.error('[Startup] ✗ Failed to initialize message handler:', err)
      // Continue running even if NATS is not available initially
    })

  initializeMessageCleanup()
    .then(() => {
      console.log('[Startup] ✓ Message cleanup service initialized')
    })
    .catch((err) => {
      console.error('[Startup] ✗ Failed to initialize message cleanup service:', err)
      // Continue running even if cleanup service fails to initialize
    })

  console.log(`[Startup] Server is accepting connections on http://localhost:${port}`)
} else {
  console.log('[Test Mode] Skipping service initialization in test environment')
}

// Graceful shutdown handler
async function shutdown() {
  console.log('[Shutdown] Gracefully shutting down...')
  await shutdownMessageHandler()
  await shutdownMessageCleanup()
  await closeNatsConnection()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export default {
  port,
  fetch: app.fetch,
  websocket, // Bun WebSocket handler
}
