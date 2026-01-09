/**
 * WebSocket Message Queue
 *
 * Manages queued messages while connection is being established.
 */

import type { QueuedMessage } from "./types";

/**
 * Message queue for WebSocket
 */
export class MessageQueue {
  private queue: QueuedMessage[] = [];

  /**
   * Add a message to the queue
   */
  enqueue(type: string, payload: unknown): Promise<boolean> {
    return new Promise((resolve) => {
      this.queue.push({ type, payload, resolve });
    });
  }

  /**
   * Process all queued messages using the provided send function
   * @param sendFn Function to send a message, returns true if successful
   */
  processAll(sendFn: (type: string, payload: unknown) => boolean): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        const success = sendFn(item.type, item.payload);
        item.resolve(success);
      }
    }
  }

  /**
   * Clear all queued messages, resolving them with false
   */
  clearAll(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        item.resolve(false);
      }
    }
  }

  /**
   * Get number of queued messages
   */
  get length(): number {
    return this.queue.length;
  }
}
