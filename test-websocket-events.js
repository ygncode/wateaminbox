#!/usr/bin/env bun
/**
 * WebSocket Event Duplication Test Script
 *
 * This script tests that WebSocket events are received exactly once
 * after removing duplicate NATS subscriptions from ws.ts
 *
 * Prerequisites:
 * 1. Dev server running: bun run dev
 * 2. A valid JWT token for a user
 * 3. A valid company ID
 *
 * Usage:
 *   bun test-websocket-events.js <token> <companyId>
 */

import { WebSocket } from 'bun'

const TEST_DURATION = 30000 // 30 seconds
const RECONNECT_DELAY = 2000 // 2 seconds

// Track all events across all clients
const allEventLogs = new Map<string, Array<{ clientId: string; timestamp: number; data: unknown }>>()

function createTestClient(clientId: string, token: string, companyId: string): WebSocket {
  const url = `ws://localhost:3001/api/ws?token=${token}&company=${companyId}`
  console.log(`[${clientId}] Connecting to ${url}`)

  const ws = new WebSocket(url)

  ws.onopen = () => {
    console.log(`[${clientId}] Connected`)
  }

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data.toString())
      const eventType = message.type

      if (!allEventLogs.has(eventType)) {
        allEventLogs.set(eventType, [])
      }

      allEventLogs.get(eventType)!.push({
        clientId,
        timestamp: Date.now(),
        data: message.payload,
      })

      console.log(`[${clientId}] Event: ${eventType} (total ${eventType} events: ${allEventLogs.get(eventType)!.length})`)
    } catch (error) {
      console.error(`[${clientId}] Failed to parse message:`, error)
    }
  }

  ws.onerror = (error) => {
    console.error(`[${clientId}] Error:`, error)
  }

  ws.onclose = () => {
    console.log(`[${clientId}] Disconnected`)
  }

  return ws
}

function analyzeDuplicates() {
  console.log('\n=== Event Analysis ===')
  console.log('Event Type        | Total | Unique Clients | Duplicates?')
  console.log('------------------|-------|----------------|-------------')

  const eventsByClient = new Map<string, Set<string>>()

  for (const [eventType, logs] of allEventLogs) {
    const clients = new Set(logs.map((l) => l.clientId))
    eventsByClient.set(eventType, clients)

    // Check for duplicates - same event type multiple times from same NATS source
    // would indicate duplicate subscriptions
    const hasDuplicates = logs.length > clients.size
    const duplicateIndicator = hasDuplicates ? '⚠️ YES' : '✓ No'

    console.log(`${eventType.padEnd(16)} | ${String(logs.length).padStart(5)} | ${String(clients.size).padStart(14)} | ${duplicateIndicator}`)

    // Show detailed timing for events with potential duplicates
    if (logs.length > 1 && (eventType === 'qr' || eventType === 'connected' || eventType === 'disconnected')) {
      console.log(`  Detailed timing for ${eventType}:`)
      for (const log of logs) {
        const timeDiff = log.timestamp - logs[0].timestamp
        console.log(`    [${log.clientId}] +${timeDiff}ms`)
      }
    }
  }

  // Check for events that should only appear once per company
  console.log('\n=== Single-Occurrence Event Check ===')
  const singleEvents = ['auth_success', 'auth_error']

  for (const eventType of singleEvents) {
    const logs = allEventLogs.get(eventType) || []
    const clients = new Set(logs.map((l) => l.clientId))

    // Each client should receive auth_success exactly once
    let passed = true
    const clientCounts = new Map<string, number>()

    for (const log of logs) {
      clientCounts.set(log.clientId, (clientCounts.get(log.clientId) || 0) + 1)
    }

    for (const [clientId, count] of clientCounts) {
      if (count > 1) {
        console.log(`⚠️ ${eventType}: Client ${clientId} received ${count} times (expected 1)`)
        passed = false
      }
    }

    if (passed) {
      console.log(`✓ ${eventType}: Each client received exactly once`)
    }
  }

  // Check for QR/connected/disconnected event patterns
  // These should be broadcast to all connected clients
  console.log('\n=== Broadcast Event Check (should be same count per client) ===')
  const broadcastEvents = ['qr', 'connected', 'disconnected']

  for (const eventType of broadcastEvents) {
    const logs = allEventLogs.get(eventType) || []
    if (logs.length === 0) {
      console.log(`- ${eventType}: No events received (WhatsApp may not be active)`)
      continue
    }

    const clientCounts = new Map<string, number>()
    for (const log of logs) {
      clientCounts.set(log.clientId, (clientCounts.get(log.clientId) || 0) + 1)
    }

    // All clients should have the same count for broadcast events
    const counts = Array.from(clientCounts.values())
    const allSame = counts.every((c) => c === counts[0])

    if (allSame) {
      console.log(`✓ ${eventType}: All ${counts.length} client(s) received ${counts[0]} event(s)`)
    } else {
      console.log(`⚠️ ${eventType}: Clients received different counts - ${JSON.stringify(Object.fromEntries(clientCounts))}`)
    }
  }
}

async function main() {
  const token = process.argv[2]
  const companyId = process.argv[3]
  const numClients = parseInt(process.argv[4] || '2', 10)

  if (!token || !companyId) {
    console.error('Usage: bun test-websocket-events.js <token> <companyId> [numClients]')
    console.error('\nExample:')
    console.error('  bun test-websocket-events.js eyJhbG... abc-123-def 3')
    process.exit(1)
  }

  console.log(`Starting WebSocket test with ${numClients} client(s) for ${TEST_DURATION / 1000}s...`)
  console.log('This will test that events are received correctly without duplication.\n')

  const clients: WebSocket[] = []

  // Create first client
  clients.push(createTestClient('Client-1', token, companyId))

  // Wait a bit, then create more clients
  await new Promise((resolve) => setTimeout(resolve, 2000))

  for (let i = 2; i <= numClients; i++) {
    clients.push(createTestClient(`Client-${i}`, token, companyId))
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY))
  }

  // Let it run for the test duration
  console.log(`\nWaiting for events... (will auto-close after ${TEST_DURATION / 1000}s)`)
  console.log('Trigger WhatsApp events now (link device, send message, etc.)\n')

  await new Promise((resolve) => setTimeout(resolve, TEST_DURATION))

  // Close all connections
  console.log('\nClosing connections...')
  for (const ws of clients) {
    ws.close()
  }

  // Wait a bit for final events
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Analyze results
  analyzeDuplicates()

  console.log('\n=== Test Complete ===')
}

main().catch(console.error)
