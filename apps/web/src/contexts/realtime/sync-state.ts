export interface SyncState {
  connectionId: string;
  conversations: number;
  messages: number;
  startedAt: Date;
  interrupted?: boolean;
}

export interface ServerSyncConnection {
  id: string;
  updated_at: string | null;
  sync_message_count: number;
  sync_conversation_count: number;
}

export function startSync(
  previous: Map<string, SyncState>,
  connectionId: string,
  now = new Date(),
): Map<string, SyncState> {
  const next = new Map(previous);
  next.set(connectionId, {
    connectionId,
    conversations: 0,
    messages: 0,
    startedAt: now,
    interrupted: false,
  });
  return next;
}

/** Late progress is ignored unless a matching start established the lifecycle. */
export function updateSyncProgress(
  previous: Map<string, SyncState>,
  connectionId: string,
  conversations: number,
  messages: number,
): Map<string, SyncState> {
  const existing = previous.get(connectionId);
  if (!existing) return previous;

  const next = new Map(previous);
  next.set(connectionId, {
    ...existing,
    conversations: Math.max(existing.conversations, conversations),
    messages: Math.max(existing.messages, messages),
  });
  return next;
}

export function endSync(
  previous: Map<string, SyncState>,
  connectionId: string,
): Map<string, SyncState> {
  if (!previous.has(connectionId)) return previous;
  const next = new Map(previous);
  next.delete(connectionId);
  return next;
}

/**
 * PostgreSQL is authoritative. Preserve live counters for server-confirmed
 * entries while removing any local lifecycle that has already ended.
 */
export function reconcileSyncState(
  previous: Map<string, SyncState>,
  connections: ServerSyncConnection[],
  now = new Date(),
): Map<string, SyncState> {
  const next = new Map<string, SyncState>();
  for (const connection of connections) {
    const existing = previous.get(connection.id);
    next.set(connection.id, {
      connectionId: connection.id,
      conversations: Math.max(
        existing?.conversations ?? 0,
        connection.sync_conversation_count,
      ),
      messages: Math.max(
        existing?.messages ?? 0,
        connection.sync_message_count,
      ),
      startedAt:
        existing?.startedAt ??
        (connection.updated_at ? new Date(connection.updated_at) : now),
      interrupted: false,
    });
  }
  return next;
}
