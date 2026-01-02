import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { ConnectionStatus } from "../lib/websocket";

export interface WebSocketState {
  // Connection state
  status: ConnectionStatus;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  reconnectAttempts: number;
  error: string | null;

  // Actions
  setStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;
  reset: () => void;
}

const initialState = {
  status: "disconnected" as ConnectionStatus,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  reconnectAttempts: 0,
  error: null,
};

export const useWebSocketStore = create<WebSocketState>()(
  devtools(
    (set) => ({
      ...initialState,

      setStatus: (status) =>
        set(
          () => {
            const updates: Partial<WebSocketState> = { status };

            if (status === "connected") {
              updates.lastConnectedAt = new Date();
              updates.error = null;
              updates.reconnectAttempts = 0;
            } else if (status === "disconnected") {
              updates.lastDisconnectedAt = new Date();
            } else if (status === "error") {
              updates.lastDisconnectedAt = new Date();
            }

            return updates;
          },
          false,
          "setStatus",
        ),

      setError: (error) => set({ error }, false, "setError"),

      incrementReconnectAttempts: () =>
        set(
          (state) => ({ reconnectAttempts: state.reconnectAttempts + 1 }),
          false,
          "incrementReconnectAttempts",
        ),

      resetReconnectAttempts: () =>
        set({ reconnectAttempts: 0 }, false, "resetReconnectAttempts"),

      reset: () => set(initialState, false, "reset"),
    }),
    { name: "websocket-store" },
  ),
);

// Selectors
export const selectIsConnected = (state: WebSocketState) =>
  state.status === "connected";
export const selectIsConnecting = (state: WebSocketState) =>
  state.status === "connecting";
export const selectIsDisconnected = (state: WebSocketState) =>
  state.status === "disconnected";
export const selectHasError = (state: WebSocketState) =>
  state.status === "error" || state.error !== null;
