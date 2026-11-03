// Broker publication time, not the producer's clock, determines freshness.
// Only disposable presence/typing state expires here. Conversation data and
// historical events always retain their existing persistence/ACK contract.
export function isExpiredEphemeralEvent(
  type: string,
  publishedAtNanos: number | undefined,
  nowMs = Date.now(),
): boolean {
  const maxAgeMs =
    type === "presence" ? 60_000 : type === "typing" ? 10_000 : null;
  if (
    maxAgeMs === null ||
    publishedAtNanos === undefined ||
    !Number.isFinite(publishedAtNanos) ||
    publishedAtNanos <= 0 ||
    !Number.isFinite(nowMs)
  ) {
    return false;
  }
  return nowMs - publishedAtNanos / 1_000_000 > maxAgeMs;
}
