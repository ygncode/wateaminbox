const RELOAD_ATTEMPT_KEY = "wateaminbox:chunk-load-reload";
const DEFAULT_RETRY_WINDOW_MS = 60_000;

const STALE_MODULE_ERROR_PATTERNS = [
  /Cannot read propert(?:y|ies) of null \(reading ['"]useContext['"]\)/i,
  /can't access property ['"]useContext['"], .* is null/i,
  /null is not an object \(evaluating ['"][^'"]*\.useContext['"]\)/i,
  /Invalid hook call/i,
];

type ReloadRecoveryOptions = {
  storage?: Pick<Storage, "getItem" | "setItem">;
  reload?: () => void;
  now?: () => number;
  retryWindowMs?: number;
};

type RecoveryOptions = ReloadRecoveryOptions & {
  eventTarget?: EventTarget;
};

function attemptReload({
  storage,
  reload,
  now = Date.now,
  retryWindowMs = DEFAULT_RETRY_WINDOW_MS,
}: ReloadRecoveryOptions = {}): boolean {
  const attemptedAt = now();
  let selectedStorage: Pick<Storage, "getItem" | "setItem">;
  let previousAttempt: number;

  try {
    selectedStorage = storage ?? window.sessionStorage;
    previousAttempt = Number(selectedStorage.getItem(RELOAD_ATTEMPT_KEY));
  } catch {
    // If storage is unavailable, retain the normal error boundary instead of
    // risking an automatic reload loop.
    return false;
  }

  if (
    Number.isFinite(previousAttempt) &&
    previousAttempt > 0 &&
    attemptedAt >= previousAttempt &&
    attemptedAt - previousAttempt < retryWindowMs
  ) {
    return false;
  }

  try {
    selectedStorage.setItem(RELOAD_ATTEMPT_KEY, String(attemptedAt));
    if (reload) reload();
    else window.location.reload();
    return true;
  } catch {
    // Browser policy can also reject reloads in embedded contexts. Let the
    // error boundary remain usable instead of throwing from componentDidCatch.
    return false;
  }
}

/**
 * Reload once when an open tab still references chunks from an older deploy.
 * Vite emits this event before surfacing a failed dynamic import to React.
 */
export function installChunkLoadRecovery({
  eventTarget = window,
  ...recoveryOptions
}: RecoveryOptions = {}): () => void {
  const handlePreloadError = (event: Event) => {
    if (!attemptReload(recoveryOptions)) return;
    event.preventDefault();
  };

  eventTarget.addEventListener("vite:preloadError", handlePreloadError);
  return () =>
    eventTarget.removeEventListener("vite:preloadError", handlePreloadError);
}

/**
 * A stale evaluated module graph can fail after a lazy import succeeds, so
 * Vite has no preload error to emit. React then reports a null hook dispatcher
 * (or its standard invalid-hook diagnostic). Reload once to make the document
 * and every dependency chunk come from the same build; a repeat within the
 * retry window is left to the error boundary as a genuine application error.
 */
export function recoverFromStaleModuleError(
  error: unknown,
  recoveryOptions: ReloadRecoveryOptions = {},
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (!STALE_MODULE_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }
  return attemptReload(recoveryOptions);
}
