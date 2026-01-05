/**
 * WebSocket Manual Testing Helper
 *
 * This script helps verify that WebSocket events are received exactly once
 * (no duplicates) after the NATS subscription cleanup.
 *
 * Usage:
 * 1. Start the dev server: bun run dev
 * 2. In a browser console or Node.js environment, run this script
 * 3. Verify events are received exactly once
 */

type EventListener = (data: unknown) => void

interface WebSocketTestClient {
  ws: WebSocket
  eventCounts: Map<string, number>
  eventLog: Array<{ type: string; timestamp: string; data: unknown }>
  eventListeners: Map<string, Set<EventListener>>
}

/**
 * Creates a test WebSocket client that tracks all events
 */
export function createTestWebSocketClient(url: string, token: string, companyId: string): WebSocketTestClient {
  const client: WebSocketTestClient = {
    ws: new WebSocket(`${url}?token=${token}&company=${companyId}`),
    eventCounts: new Map(),
    eventLog: [],
    eventListeners: new Map(),
  }

  // Initialize counters for all expected event types
  const expectedEventTypes = [
    'auth_success',
    'auth_error',
    'qr',
    'connected',
    'disconnected',
    'message',
    'message:new',
    'message:status',
    'receipt',
    'status',
    'contact',
    'assignment',
    'conversation',
    'error',
    'pong',
    'send_ack',
  ]

  for (const type of expectedEventTypes) {
    client.eventCounts.set(type, 0)
  }

  client.ws.onopen = () => {
    console.log('[Test Client] WebSocket connected')
  }

  client.ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data)
      const type = message.type

      // Track event count
      const currentCount = client.eventCounts.get(type) || 0
      client.eventCounts.set(type, currentCount + 1)

      // Log event
      client.eventLog.push({
        type,
        timestamp: message.timestamp || new Date().toISOString(),
        data: message.payload,
      })

      // Notify listeners
      const listeners = client.eventListeners.get(type)
      if (listeners) {
        for (const listener of listeners) {
          listener(message.payload)
        }
      }

      console.log(`[Test Client] Event received: ${type} (count: ${currentCount + 1})`)
    } catch (error) {
      console.error('[Test Client] Failed to parse message:', error)
    }
  }

  client.ws.onerror = (error) => {
    console.error('[Test Client] WebSocket error:', error)
  }

  client.ws.onclose = () => {
    console.log('[Test Client] WebSocket disconnected')
  }

  return client
}

/**
 * Adds an event listener for a specific event type
 */
export function onEvent(client: WebSocketTestClient, eventType: string, listener: EventListener): void {
  if (!client.eventListeners.has(eventType)) {
    client.eventListeners.set(eventType, new Set())
  }
  client.eventListeners.get(eventType)!.add(listener)
}

/**
 * Gets the count of events received for a specific type
 */
export function getEventCount(client: WebSocketTestClient, eventType: string): number {
  return client.eventCounts.get(eventType) || 0
}

/**
 * Prints a summary of all received events
 */
export function printEventSummary(client: WebSocketTestClient): void {
  console.log('\n=== WebSocket Event Summary ===')
  console.log('Event Type | Count')
  console.log('-----------|------')

  for (const [type, count] of client.eventCounts) {
    if (count > 0) {
      console.log(`${type.padEnd(10)} | ${count}`)
    }
  }

  console.log('\n=== Detailed Event Log ===')
  for (const log of client.eventLog) {
    console.log(`[${log.timestamp}] ${log.type}:`, JSON.stringify(log.data).substring(0, 100))
  }
}

/**
 * Checks for duplicate events (same type received multiple times when only expected once)
 */
export function checkForDuplicates(client: WebSocketTestClient): {
  hasDuplicates: boolean
  duplicates: Array<{ type: string; count: number }>
} {
  const onceExpectedEvents = ['auth_success', 'auth_error', 'connected', 'disconnected']
  const duplicates: Array<{ type: string; count: number }> = []

  for (const eventType of onceExpectedEvents) {
    const count = getEventCount(client, eventType)
    if (count > 1) {
      duplicates.push({ type: eventType, count })
    }
  }

  return {
    hasDuplicates: duplicates.length > 0,
    duplicates,
  }
}

/**
 * Waits for a specific event type to be received
 */
export function waitForEvent(
  client: WebSocketTestClient,
  eventType: string,
  timeout = 30000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      onEvent(client, eventType, (data) => {
        clearTimeout(timeoutId)
        resolve(data)
      })
    }, timeout)

    onEvent(client, eventType, (data) => {
      clearTimeout(timeoutId)
      resolve(data)
    })
  })
}

/**
 * Runs a test suite to verify WebSocket functionality
 */
export async function runWebSocketTest(
  wsUrl: string,
  token: string,
  companyId: string
): Promise<{
  passed: boolean
  results: Array<{ test: string; passed: boolean; message: string }>
}> {
  const results: Array<{ test: string; passed: boolean; message: string }> = []
  const client = createTestWebSocketClient(wsUrl, token, companyId)

  // Test 1: Connection established
  await new Promise((resolve) => setTimeout(resolve, 1000))
  results.push({
    test: 'Connection established',
    passed: client.ws.readyState === WebSocket.OPEN,
    message: client.ws.readyState === WebSocket.OPEN ? 'Connected' : 'Not connected',
  })

  // Test 2: Auth success received
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const authCount = getEventCount(client, 'auth_success')
  results.push({
    test: 'Auth success received',
    passed: authCount === 1,
    message: authCount === 1 ? 'Auth success received once' : `Auth count: ${authCount}`,
  })

  // Test 3: No duplicate auth events
  results.push({
    test: 'No duplicate auth events',
    passed: authCount <= 1,
    message: authCount <= 1 ? 'No duplicates' : `Duplicate auth events: ${authCount}`,
  })

  // Test 4: Check for any duplicates
  await new Promise((resolve) => setTimeout(resolve, 5000)) // Wait for potential events
  const duplicateCheck = checkForDuplicates(client)
  results.push({
    test: 'No duplicate connection events',
    passed: !duplicateCheck.hasDuplicates,
    message: duplicateCheck.hasDuplicates
      ? `Duplicates found: ${JSON.stringify(duplicateCheck.duplicates)}`
      : 'No duplicates',
  })

  // Print summary
  printEventSummary(client)

  // Close connection
  client.ws.close()

  return {
    passed: results.every((r) => r.passed),
    results,
  }
}

/**
 * Example usage in browser console:
 *
 * ```javascript
 * // Connect to WebSocket
 * const client = createTestWebSocketClient('ws://localhost:3001/api/ws', 'your-jwt-token', 'your-company-id');
 *
 * // After 30 seconds, check the summary
 * setTimeout(() => {
 *   printEventSummary(client);
 *   const duplicates = checkForDuplicates(client);
 *   console.log('Has duplicates:', duplicates);
 * }, 30000);
 * ```
 */
