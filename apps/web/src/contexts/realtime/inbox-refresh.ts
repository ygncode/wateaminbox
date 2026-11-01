import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const INBOX_REFRESH_DELAY_MS = 250;
export const INBOX_REFRESH_MAX_WAIT_MS = 1000;

interface PendingRefresh {
  dirty: boolean;
  running: boolean;
  delay?: ReturnType<typeof setTimeout>;
  deadline?: ReturnType<typeof setTimeout>;
}

const pending = new WeakMap<QueryClient, Map<string, PendingRefresh>>();

/** Includes scheduled work, which QueryClient.isFetching() does not include. */
export function hasPendingInboxRefresh(client: QueryClient): boolean {
  return (pending.get(client)?.size ?? 0) > 0;
}

/**
 * Mark stale immediately, but coalesce realtime bursts into one bounded-window
 * refresh. Keys are captured at the event, never reconstructed after a workspace
 * switch. Do not cancel an existing page load or refetch; a dirty follow-up after
 * it finishes ensures that signals arriving during a request are not lost.
 */
export function scheduleInboxRefresh(
  client: QueryClient,
  keys: QueryKey[],
): void {
  for (const queryKey of keys) {
    void client.invalidateQueries(
      { queryKey, refetchType: "none" },
      { cancelRefetch: false },
    );
  }
  let scopes = pending.get(client);
  if (!scopes) {
    scopes = new Map();
    pending.set(client, scopes);
  }
  const scopeId = JSON.stringify(keys);
  let state = scopes.get(scopeId);
  if (!state) {
    state = { dirty: false, running: false };
    scopes.set(scopeId, state);
  }
  state.dirty = true;
  if (state.running) return;
  const refresh = state;
  const scopeMap = scopes;

  const clearTimers = () => {
    clearTimeout(refresh.delay);
    clearTimeout(refresh.deadline);
    refresh.delay = undefined;
    refresh.deadline = undefined;
  };
  const run = async () => {
    clearTimers();
    refresh.running = true;
    refresh.dirty = false;
    const alreadyFetching = keys.some((queryKey) =>
      client
        .getQueryCache()
        .findAll({ queryKey, type: "active" })
        .some((query) => query.state.fetchStatus === "fetching"),
    );
    try {
      await Promise.all(
        keys.map((queryKey) =>
          client.refetchQueries(
            { queryKey, type: "active" },
            { cancelRefetch: false },
          ),
        ),
      );
    } finally {
      refresh.running = false;
      // An already-running next-page load does not revalidate earlier pages.
      if (alreadyFetching) refresh.dirty = true;
      if (refresh.dirty) {
        refresh.delay = setTimeout(run, INBOX_REFRESH_DELAY_MS);
        refresh.deadline = setTimeout(run, INBOX_REFRESH_MAX_WAIT_MS);
      } else {
        scopeMap.delete(scopeId);
      }
    }
  };
  clearTimeout(refresh.delay);
  refresh.delay = setTimeout(run, INBOX_REFRESH_DELAY_MS);
  // Unlike a pure debounce, continuous message traffic cannot starve refreshes.
  if (!refresh.deadline) {
    refresh.deadline = setTimeout(run, INBOX_REFRESH_MAX_WAIT_MS);
  }
}
