#!/usr/bin/env bun
/**
 * NATS Consumer Count Verification Script
 *
 * This script checks how many NATS consumers exist for the WhatsApp events stream.
 * After the cleanup, there should be only 1 consumer (the global one from message-handler.ts)
 * regardless of how many WebSocket clients are connected.
 *
 * Usage:
 *   bun check-nats-consumers.js
 */

import { connect } from 'nats'

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222'
const STREAM_NAME = 'WHATSAPP_EVENTS'
const CONSUMER_NAME_PREFIX = 'company_' // Consumers created by old code had this prefix

async function checkConsumers() {
  let nc
  try {
    console.log(`Connecting to NATS at ${NATS_URL}...`)
    nc = await connect({
      servers: NATS_URL,
    })

    // Use jetstreamManager() for management operations
    const jsm = await nc.jetstreamManager()

    // Get stream info
    console.log(`\nChecking stream: ${STREAM_NAME}`)
    const stream = await jsm.streams.info(STREAM_NAME)
    console.log(`Stream state: ${JSON.stringify(stream.state, null, 2)}`)

    // List all consumers
    const consumerList = []
    const consumerInfo = await jsm.consumers.list(STREAM_NAME)

    for await (const info of consumerInfo) {
      consumerList.push(info.name)
      console.log(`\nConsumer: ${info.name}`)
      console.log(`  Config: ${JSON.stringify(info.config, null, 2)}`)
      console.log(`  State: ${JSON.stringify(info.state, null, 2)}`)
    }

    // Summary
    console.log('\n=== Summary ===')
    console.log(`Total consumers: ${consumerList.length}`)

    // Check for old-style consumers (company_ prefix = one per WebSocket connection)
    const oldStyleConsumers = consumerList.filter((name) => name.startsWith(CONSUMER_NAME_PREFIX))
    console.log(`Old-style consumers (per-WebSocket): ${oldStyleConsumers.length}`)

    // Expected: 1 global consumer from message-handler.ts
    // The global consumer should have a consistent name
    const expectedConsumer = 'global_whatsapp_events'
    const hasGlobalConsumer = consumerList.includes(expectedConsumer)
    console.log(`Global consumer (${expectedConsumer}): ${hasGlobalConsumer ? 'YES' : 'NO'}`)

    // List all consumer names for debugging
    if (consumerList.length > 0) {
      console.log(`All consumer names: ${consumerList.join(', ')}`)
    }

    if (oldStyleConsumers.length > 0) {
      console.log('\n⚠️ WARNING: Old-style consumers found!')
      console.log('This indicates WebSocket connections are still creating individual NATS subscriptions.')
      console.log('Old consumers:', oldStyleConsumers)
    } else if (consumerList.length === 1 && hasGlobalConsumer) {
      console.log('\n✓ SUCCESS: Only 1 global consumer exists (as expected after cleanup)')
    } else if (consumerList.length === 0) {
      console.log('\n⚠️ WARNING: No consumers found - WhatsApp services may not be running')
      console.log('This is expected if the API server is not running or if message-handler.ts has not started.')
    } else {
      console.log('\n⚠️ WARNING: Unexpected consumer configuration')
      console.log('All consumers:', consumerList)
    }

    // Cleanup: optionally remove old-style consumers
    if (process.argv.includes('--cleanup') && oldStyleConsumers.length > 0) {
      console.log('\n=== Cleaning up old-style consumers ===')
      for (const name of oldStyleConsumers) {
        try {
          await jsm.consumers.delete(STREAM_NAME, name)
          console.log(`Deleted: ${name}`)
        } catch (error) {
          console.error(`Failed to delete ${name}:`, error)
        }
      }
      console.log('Cleanup complete')
    }
  } catch (error) {
    console.error('Error:', error)
    console.error('\nMake sure:')
    console.error('1. NATS is running (docker-compose up -d)')
    console.error('2. The WhatsApp events stream exists')
  } finally {
    await nc?.close()
  }
}

checkConsumers().catch(console.error)
