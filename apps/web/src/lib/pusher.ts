/**
 * Pusher Client
 *
 * Handles real-time communication with Pusher.
 * Replaces the custom WebSocket implementation.
 */

import Pusher, { type Channel } from "pusher-js";
import { API_BASE_URL, fetchWithAuth, getCompanyId } from "./api/client";

// The public Pusher key is safe to expose, but it must be supplied per environment.
const PUSHER_KEY = import.meta.env.VITE_PUSHER_KEY;
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER || "ap1";

// Singleton Pusher instance
let pusherInstance: Pusher | null = null;
let currentChannel: Channel | null = null;
let currentUserChannel: Channel | null = null;
let currentCompanyId: string | null = null;
let currentUserId: string | null = null;

/**
 * Event types that can be received from Pusher
 */
export type CompanyPusherEventType =
  | "message:new"
  | "message:status"
  | "message:deleted"
  | "message:reaction"
  | "message:failed"
  | "qr"
  | "connected"
  | "disconnected"
  | "connection:status"
  | "typing:start"
  | "typing:stop"
  | "sync:start"
  | "sync:progress"
  | "sync:complete"
  | "sync:interrupted"
  | "media:downloaded"
  | "media:download_failed"
  | "notification:toast"
  | "status"
  | "contact:updated"
  | "contact:profile_picture"
  | "presence:online"
  | "presence:offline"
  | "conversation:read"
  | "conversation:updated"
  | "labels:updated"
  | "catalogs:updated"
  | "command:failed";

export type UserPusherEventType = "notification:new";
export type PusherEventType = CompanyPusherEventType | UserPusherEventType;

/**
 * Payload wrapper from Pusher events
 */
export interface PusherEventData<T = unknown> {
  payload: T;
  connectionId?: string;
  excludeSocketId?: string;
  timestamp: string;
}

/**
 * Connection status
 */
export type PusherConnectionStatus =
  | "initialized"
  | "connecting"
  | "connected"
  | "unavailable"
  | "failed"
  | "disconnected";

/**
 * Event handler type
 */
export type PusherEventHandler<T = unknown> = (
  data: PusherEventData<T>,
) => void;

/**
 * Initialize Pusher client
 *
 * Creates a singleton Pusher instance with authentication configured.
 */
export function initializePusher(): Pusher {
  if (pusherInstance) {
    return pusherInstance;
  }

  if (!PUSHER_KEY) {
    throw new Error("VITE_PUSHER_KEY is required for realtime communication");
  }

  pusherInstance = new Pusher(PUSHER_KEY, {
    cluster: PUSHER_CLUSTER,
    channelAuthorization: {
      endpoint: `${API_BASE_URL}/pusher/auth`,
      transport: "ajax",
      // Use the shared API client so an expired access token is refreshed via
      // the HttpOnly cookie before a reconnecting channel is authorized.
      customHandler: async (params, callback) => {
        try {
          const body = new URLSearchParams({
            socket_id: params.socketId,
            channel_name: params.channelName,
          });
          const authData = await fetchWithAuth<{
            auth: string;
            channel_data?: string;
          }>("/pusher/auth", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
          });
          callback(null, authData);
        } catch (authorizationError) {
          callback(
            authorizationError instanceof Error
              ? authorizationError
              : new Error("Pusher channel authorization failed"),
            null,
          );
        }
      },
    },
  });

  // Debug logging in development
  if (import.meta.env.DEV) {
    pusherInstance.connection.bind(
      "state_change",
      (states: { previous: string; current: string }) => {
        console.log(
          "[Pusher] Connection state changed:",
          states.previous,
          "->",
          states.current,
        );
      },
    );

    pusherInstance.connection.bind("error", (err: Error) => {
      console.error("[Pusher] Connection error:", err);
    });
  }

  return pusherInstance;
}

/**
 * Get the current Pusher instance
 */
export function getPusher(): Pusher | null {
  return pusherInstance;
}

/**
 * Get the current socket ID (for excluding self from broadcasts)
 */
export function getSocketId(): string | undefined {
  return pusherInstance?.connection?.socket_id;
}

/**
 * Subscribe to a company's private channel
 *
 * @param companyId - The company ID to subscribe to
 * @returns The subscribed channel
 */
export function subscribeToCompany(companyId: string): Channel {
  const pusher = initializePusher();

  // If already subscribed to this company, return existing channel
  if (currentChannel && currentCompanyId === companyId) {
    return currentChannel;
  }

  // Unsubscribe both old scopes before changing the company identifier.
  if (currentChannel && currentCompanyId) {
    unsubscribeFromUser();
    pusher.unsubscribe(`private-company-${currentCompanyId}`);
    currentChannel = null;
  }

  const channelName = `private-company-${companyId}`;
  currentChannel = pusher.subscribe(channelName);
  currentCompanyId = companyId;

  if (import.meta.env.DEV) {
    currentChannel.bind("pusher:subscription_succeeded", () => {
      console.log("[Pusher] Subscribed to channel:", channelName);
    });

    currentChannel.bind("pusher:subscription_error", (err: unknown) => {
      console.error("[Pusher] Subscription error:", err);
    });
  }

  return currentChannel;
}

/**
 * Unsubscribe from the current company channel
 */
export function subscribeToUser(companyId: string, userId: string): Channel {
  const pusher = initializePusher();
  if (
    currentUserChannel &&
    currentCompanyId === companyId &&
    currentUserId === userId
  )
    return currentUserChannel;
  unsubscribeFromUser();
  const channelName = `private-company-${companyId}-user-${userId}`;
  currentUserChannel = pusher.subscribe(channelName);
  currentUserId = userId;
  return currentUserChannel;
}

export function unsubscribeFromUser(): void {
  if (
    currentUserChannel &&
    currentCompanyId &&
    currentUserId &&
    pusherInstance
  ) {
    pusherInstance.unsubscribe(
      `private-company-${currentCompanyId}-user-${currentUserId}`,
    );
  }
  currentUserChannel = null;
  currentUserId = null;
}

export function unsubscribeFromCompany(): void {
  unsubscribeFromUser();
  if (currentChannel && currentCompanyId && pusherInstance) {
    pusherInstance.unsubscribe(`private-company-${currentCompanyId}`);
  }
  currentChannel = null;
  currentCompanyId = null;
}

/**
 * Get the current channel
 */
export function getCurrentChannel(): Channel | null {
  return currentChannel;
}

/**
 * Bind an event handler to the current channel
 *
 * @param eventType - The event type to listen for
 * @param handler - The handler function
 * @returns Unsubscribe function
 */
export function bindEvent<T = unknown>(
  eventType: CompanyPusherEventType,
  handler: PusherEventHandler<T>,
): () => void {
  if (!currentChannel) {
    console.warn(
      "[Pusher] No channel subscribed, cannot bind event:",
      eventType,
    );
    return () => {};
  }

  const channel = currentChannel;
  channel.bind(eventType, handler);

  return () => {
    channel.unbind(eventType, handler);
  };
}

/** Bind an event that is authorized for only the current user. */
export function bindUserEvent<T = unknown>(
  eventType: UserPusherEventType,
  handler: PusherEventHandler<T>,
): () => void {
  const channel = currentUserChannel;
  if (!channel) return () => {};
  channel.bind(eventType, handler);
  return () => channel.unbind(eventType, handler);
}

/**
 * Get the current connection state
 */
export function getConnectionState(): PusherConnectionStatus {
  if (!pusherInstance) {
    return "disconnected";
  }
  return pusherInstance.connection.state as PusherConnectionStatus;
}

/**
 * Bind to connection state changes
 *
 * @param handler - Called when connection state changes
 * @returns Unsubscribe function
 */
export function onConnectionStateChange(
  handler: (state: PusherConnectionStatus) => void,
): () => void {
  if (!pusherInstance) {
    initializePusher();
  }

  const wrappedHandler = (states: { current: string }) => {
    handler(states.current as PusherConnectionStatus);
  };

  pusherInstance?.connection.bind("state_change", wrappedHandler);

  return () => {
    pusherInstance?.connection.unbind("state_change", wrappedHandler);
  };
}

/**
 * Disconnect from Pusher
 */
export function disconnectPusher(): void {
  if (pusherInstance) {
    unsubscribeFromCompany();
    pusherInstance.disconnect();
    pusherInstance = null;
  }
}

/**
 * Reconnect to Pusher with fresh credentials
 *
 * Used when the auth token is refreshed or company changes.
 */
export function reconnectPusher(): void {
  disconnectPusher();
  initializePusher();

  const companyId = getCompanyId();
  if (companyId) {
    subscribeToCompany(companyId);
  }
}

/**
 * Update auth headers (call when token refreshes)
 */
export function updateAuthHeaders(): void {
  if (!pusherInstance) return;

  // Re-create the Pusher instance with fresh credentials
  disconnectPusher();
  initializePusher();
}
