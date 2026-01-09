/**
 * WebSocket Reconnection Strategy
 *
 * Implements exponential backoff with jitter for reconnection attempts.
 */

import { nowMs } from "@whatsapp-web/shared";
import { wsLogger } from "../websocket-logger";

export interface ReconnectConfig {
  /** Maximum number of reconnection attempts */
  reconnectAttempts: number;
  /** Base delay between reconnection attempts in milliseconds */
  reconnectBaseDelay: number;
  /** Maximum delay between reconnection attempts in milliseconds */
  reconnectMaxDelay: number;
}

export interface ReconnectCallbacks {
  /** Called when reconnection should be attempted */
  onReconnect: () => void;
  /** Called when max attempts reached */
  onMaxAttemptsReached: () => void;
}

/**
 * Reconnection strategy manager
 */
export class ReconnectManager {
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectCount = 0;
  private config: ReconnectConfig;
  private callbacks: ReconnectCallbacks;
  private isManualDisconnect = false;
  private lastError: { message: string; timestamp: number } | null = null;

  constructor(config: ReconnectConfig, callbacks: ReconnectCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Schedule a reconnection attempt
   */
  schedule(): void {
    if (this.isManualDisconnect) return;
    if (this.reconnectTimeout) return; // Already scheduled

    if (this.reconnectCount >= this.config.reconnectAttempts) {
      wsLogger.error("Max reconnection attempts reached");
      this.lastError = {
        message: "Max reconnection attempts reached",
        timestamp: nowMs(),
      };
      this.callbacks.onMaxAttemptsReached();
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.config.reconnectBaseDelay * 2 ** this.reconnectCount +
        Math.random() * 1000,
      this.config.reconnectMaxDelay,
    );

    wsLogger.info(
      `Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectCount + 1}/${this.config.reconnectAttempts})`,
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.reconnectCount++;
      this.callbacks.onReconnect();
    }, delay);
  }

  /**
   * Cancel any scheduled reconnection
   */
  cancel(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Mark connection as manually disconnected (prevents auto-reconnect)
   */
  setManualDisconnect(value: boolean): void {
    this.isManualDisconnect = value;
  }

  /**
   * Check if manual disconnect is set
   */
  isManuallyDisconnected(): boolean {
    return this.isManualDisconnect;
  }

  /**
   * Reset reconnection counter
   */
  resetCounter(): void {
    this.reconnectCount = 0;
  }

  /**
   * Get current reconnection count
   */
  getReconnectCount(): number {
    return this.reconnectCount;
  }

  /**
   * Get last error
   */
  getLastError(): { message: string; timestamp: number } | null {
    return this.lastError;
  }

  /**
   * Set an error (for external error tracking)
   */
  setError(message: string): void {
    this.lastError = {
      message,
      timestamp: nowMs(),
    };
  }

  /**
   * Clear error state
   */
  clearError(): void {
    this.lastError = null;
  }

  /**
   * Full reset (for destroy)
   */
  reset(): void {
    this.cancel();
    this.reconnectCount = 0;
    this.isManualDisconnect = false;
    this.lastError = null;
  }
}
