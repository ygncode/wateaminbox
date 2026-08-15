const RELOAD_ATTEMPT_KEY = "wateaminbox:chunk-load-reload";
const DEFAULT_RETRY_WINDOW_MS = 60_000;

type RecoveryOptions = {
  eventTarget?: EventTarget;
  storage?: Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  now?: () => number;
  retryWindowMs?: number;
};

/**
 * Reload once when an open tab still references chunks from an older deploy.
 * Vite emits this event before surfacing a failed dynamic import to React.
 */
export function installChunkLoadRecovery({
  eventTarget = window,
  storage = window.sessionStorage,
  reload = () => window.location.reload(),
  now = Date.now,
  retryWindowMs = DEFAULT_RETRY_WINDOW_MS,
}: RecoveryOptions = {}): () => void {
  const handlePreloadError = (event: Event) => {
    const attemptedAt = now();
    let previousAttempt: number;

    try {
      previousAttempt = Number(storage.getItem(RELOAD_ATTEMPT_KEY));
    } catch {
      // If storage is unavailable, retain the normal error boundary instead of
      // risking an automatic reload loop.
      return;
    }

    if (
      Number.isFinite(previousAttempt) &&
      previousAttempt > 0 &&
      attemptedAt >= previousAttempt &&
      attemptedAt - previousAttempt < retryWindowMs
    ) {
      return;
    }

    try {
      storage.setItem(RELOAD_ATTEMPT_KEY, String(attemptedAt));
    } catch {
      return;
    }

    event.preventDefault();
    reload();
  };

  eventTarget.addEventListener("vite:preloadError", handlePreloadError);
  return () =>
    eventTarget.removeEventListener("vite:preloadError", handlePreloadError);
}
