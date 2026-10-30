const MAX_ENTRIES = 1_024;
const MAX_REUSE_MS = 60_000;
const EXPIRY_MARGIN_SECONDS = 30;

/**
 * Reuse avatar signatures, not authorization decisions or contact responses.
 * The owning storage client/bucket and requested lifetime must remain fixed for
 * this signer. Callers must authorize the resource and tenant key on EVERY use.
 */
export function createAvatarUrlSigner(
  sign: (key: string) => Promise<string>,
  expiresInSeconds: number,
  now: () => number = () => performance.now(),
): (key: string) => Promise<string> {
  // SigV4 signing dates have second precision. Leave ample validity for that
  // rounding and the browser's subsequent image fetch; never extend a signature.
  const reuseMs = Math.max(
    0,
    Math.min(MAX_REUSE_MS, (expiresInSeconds - EXPIRY_MARGIN_SECONDS) * 1_000),
  );
  const entries = new Map<
    string,
    { promise: Promise<string>; reuseUntil: number }
  >();

  return (key) => {
    if (reuseMs === 0) return sign(key);
    const startedAt = now();
    const existing = entries.get(key);
    entries.delete(key);
    if (existing && startedAt < existing.reuseUntil) {
      // LRU promotion must not slide the expiry forward.
      entries.set(key, existing);
      return existing.promise;
    }

    const promise = Promise.resolve()
      .then(() => sign(key))
      .catch((error) => {
        // A slow, evicted/expired request must not erase its replacement.
        if (entries.get(key)?.promise === promise) entries.delete(key);
        throw error;
      });
    entries.set(key, { promise, reuseUntil: startedAt + reuseMs });
    if (entries.size > MAX_ENTRIES) {
      entries.delete(entries.keys().next().value!);
    }
    return promise;
  };
}
