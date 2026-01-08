/**
 * WebSocket Heartbeat Management
 *
 * Handles ping/pong heartbeat to detect stale connections.
 * This module manages the heartbeat interval and pong timeout logic.
 */

import { nowMs } from "@whatsapp-web/shared"
import { wsLogger } from "../websocket-logger"

export interface HeartbeatConfig {
  /** Interval between ping messages in milliseconds */
  heartbeatInterval: number
  /** Timeout waiting for pong response in milliseconds */
  pongTimeout: number
}

export interface HeartbeatCallbacks {
  /** Called to send a ping message. Returns true if sent successfully */
  sendPing: () => boolean
  /** Called when connection appears stale (no pong received) */
  onStaleConnection: () => void
  /** Check if socket is ready for ping */
  isSocketReady: () => boolean
}

/**
 * Heartbeat manager for WebSocket connections
 */
export class HeartbeatManager {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private pongTimeout: ReturnType<typeof setTimeout> | null = null
  private lastPongReceived = 0
  private pingSentAt: number | null = null
  private latency: number | null = null
  private config: HeartbeatConfig
  private callbacks: HeartbeatCallbacks

  constructor(config: HeartbeatConfig, callbacks: HeartbeatCallbacks) {
    this.config = config
    this.callbacks = callbacks
  }

  /**
   * Start the heartbeat interval
   */
  start(): void {
    this.stop()
    this.lastPongReceived = nowMs()

    this.heartbeatInterval = setInterval(() => {
      if (this.callbacks.isSocketReady()) {
        this.pingSentAt = nowMs()
        const sent = this.callbacks.sendPing()
        if (sent) {
          this.setPongTimeout()
        }
      } else {
        this.stop()
      }
    }, this.config.heartbeatInterval)
  }

  /**
   * Stop the heartbeat interval and clear timeouts
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    this.clearPongTimeout()
  }

  /**
   * Handle pong received - calculate latency
   */
  handlePong(): void {
    const now = nowMs()
    this.lastPongReceived = now
    if (this.pingSentAt !== null) {
      this.latency = now - this.pingSentAt
      wsLogger.debug("Latency:", this.latency, "ms")
    }
    this.clearPongTimeout()
  }

  /**
   * Get current latency measurement
   */
  getLatency(): number | null {
    return this.latency
  }

  /**
   * Reset state for new connection
   */
  reset(): void {
    this.latency = null
    this.pingSentAt = null
    this.lastPongReceived = 0
  }

  private setPongTimeout(): void {
    this.clearPongTimeout()
    this.pongTimeout = setTimeout(() => {
      wsLogger.warn("Pong timeout - connection may be stale")

      const timeSinceLastPong = nowMs() - this.lastPongReceived
      if (timeSinceLastPong > this.config.pongTimeout * 2) {
        wsLogger.warn("No recent pong - initiating reconnect")
        this.callbacks.onStaleConnection()
      }
    }, this.config.pongTimeout)
  }

  private clearPongTimeout(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout)
      this.pongTimeout = null
    }
  }
}
