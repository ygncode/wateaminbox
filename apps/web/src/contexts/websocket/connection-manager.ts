/**
 * WebSocket connection manager
 *
 * Handles WebSocket client lifecycle: initialization, connection, disconnection,
 * and reconnection with fresh credentials.
 */

import { getAccessToken, getCompanyId } from "../../lib/api";
import {
  getWebSocketClient,
  resetWebSocketClient,
  type WebSocketClient,
} from "../../lib/websocket";
import { wsLogger } from "../../lib/websocket-logger";

/**
 * Initialize WebSocket client with current credentials
 *
 * @param wsClientRef - Ref to store the WebSocket client
 * @param setStatus - Status setter callback
 * @param setError - Error setter callback
 * @returns The initialized WebSocket client
 */
export function initializeClient(
  wsClientRef: React.MutableRefObject<WebSocketClient | null>,
  setStatus: (status: any) => void,
  setError: (error: string) => void,
): WebSocketClient {
  if (!wsClientRef.current) {
    const token = getAccessToken();
    const companyId = getCompanyId();

    // Build WebSocket URL with token and company ID
    const baseUrl = import.meta.env.VITE_WS_URL || "ws://localhost:4445/api/ws";
    const wsUrl = new URL(baseUrl);
    if (token) {
      wsUrl.searchParams.set("token", token);
    }
    if (companyId) {
      wsUrl.searchParams.set("company", companyId);
    }

    wsClientRef.current = getWebSocketClient({
      url: wsUrl.toString(),
      token: token ?? undefined,
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
      },
      onError: (err) => {
        setError(err.message);
      },
    });
  }
  return wsClientRef.current;
}

/**
 * Connect to WebSocket with current token
 *
 * @param initializeFn - Function to initialize client if needed
 */
export function connect(initializeFn: () => WebSocketClient): void {
  const client = initializeFn();
  const token = getAccessToken();

  if (token) {
    client.setToken(token);
  }

  client.connect();
}

/**
 * Disconnect from WebSocket
 *
 * @param wsClientRef - Ref to the WebSocket client
 */
export function disconnect(
  wsClientRef: React.MutableRefObject<WebSocketClient | null>,
): void {
  wsClientRef.current?.disconnect();
}

/**
 * Reconnect (disconnect then connect)
 *
 * @param wsClientRef - Ref to the WebSocket client
 * @param connectFn - Connect function to call after disconnect
 */
export function reconnect(
  wsClientRef: React.MutableRefObject<WebSocketClient | null>,
  connectFn: () => void,
): void {
  disconnect(wsClientRef);
  // Small delay before reconnecting
  setTimeout(() => {
    connectFn();
  }, 100);
}

/**
 * Force reconnect with fresh credentials
 *
 * Unlike regular reconnect, this completely destroys the existing WebSocket client
 * and creates a new one. This is necessary when credentials change (e.g., company ID)
 * because the WebSocket URL includes the company ID for server-side event routing.
 *
 * @param wsClientRef - Ref to the WebSocket client
 * @param initializeFn - Function to initialize a new client
 * @param registerHandlersFn - Function to register event handlers on the new client
 */
export function forceReconnectWithFreshCredentials(
  wsClientRef: React.MutableRefObject<WebSocketClient | null>,
  initializeFn: () => WebSocketClient,
  registerHandlersFn: (client: WebSocketClient) => void,
): void {
  wsLogger.info("Force reconnecting with fresh credentials...");
  wsClientRef.current?.disconnect();
  resetWebSocketClient();
  wsClientRef.current = null;
  // Don't reset isInitializedRef here - we'll manually re-register handlers

  // Small delay before reconnecting to allow cleanup
  setTimeout(() => {
    const token = getAccessToken();
    if (token) {
      const client = initializeFn();
      // Re-register handlers on the new client
      registerHandlersFn(client);
      wsLogger.debug("Handlers re-registered after reconnect");
      client.connect();
    }
  }, 100);
}

/**
 * Send a message through WebSocket
 *
 * @param wsClientRef - Ref to the WebSocket client
 * @param type - Message type
 * @param payload - Message payload
 * @returns true if sent successfully, false otherwise
 */
export function send<T>(
  wsClientRef: React.MutableRefObject<WebSocketClient | null>,
  type: string,
  payload: T,
): boolean {
  return wsClientRef.current?.send(type, payload) ?? false;
}
