/**
 * WebSocket sync manager
 *
 * Handles sync status tracking and API fetching for WhatsApp connection sync state.
 */

import { api } from "../../lib/api";
import type { SyncState, SyncStatusResponse } from "./types";

/**
 * Fetch sync status from API and populate syncing connections state
 *
 * @param currentCompanyId - Current company ID
 * @param setSyncingConnections - State setter for syncing connections
 * @returns Promise that resolves when fetch is complete
 */
export async function fetchSyncStatus(
  currentCompanyId: string | null,
  setSyncingConnections: React.Dispatch<
    React.SetStateAction<Map<string, SyncState>>
  >,
): Promise<void> {
  if (!currentCompanyId) return;

  try {
    const response = await api.get<SyncStatusResponse>("/whatsapp/sync-status");

    // Populate syncingConnections from API response
    const newMap = new Map<string, SyncState>();
    for (const connection of response.connections) {
      if (connection.sync_status === "syncing") {
        newMap.set(connection.id, {
          connectionId: connection.id,
          conversations: 0, // We don't have progress from DB, start at 0
          // Use updated_at from DB as sync start time, fallback to now
          startedAt: connection.updated_at
            ? new Date(connection.updated_at)
            : new Date(),
        });
      }
    }

    // Always update state, even if empty, to clear stuck syncing states
    console.log(
      "[WebSocket] 🔄 Sync status fetched. Active syncs:",
      newMap.size,
    );
    setSyncingConnections(newMap);
  } catch (error) {
    console.warn("[WebSocket] ⚠️ Failed to fetch sync status:", error);
  }
}

/**
 * Clear all syncing connections state
 * Used by SyncingOverlay's "Continue anyway" button
 *
 * @param setSyncingConnections - State setter for syncing connections
 */
export function clearSyncingConnections(
  setSyncingConnections: React.Dispatch<
    React.SetStateAction<Map<string, SyncState>>
  >,
): void {
  setSyncingConnections(new Map());
}
