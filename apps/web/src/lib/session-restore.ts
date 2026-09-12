/**
 * Restoring a session when the API is being replaced.
 *
 * A deployment stops the API container before starting its replacement, so for
 * a few seconds a browser that reloads gets no answer at all. That silence says
 * nothing about whether the refresh cookie is still valid, and the refresh
 * cookie survives a deployment - `JWT_SECRET` is file-backed and sessions live
 * in PostgreSQL. Treating the silence as a rejection is what took every
 * connected user to the login screen on every release.
 *
 * The retry schedule is the whole point: it has to outlast a container
 * replacement, and it has to give up rather than spin forever so an operator
 * with a genuinely down API still gets an honest screen.
 */

/** One attempt at restoring the session. */
export type SessionAttemptResult = "loaded" | "rejected" | "unavailable";

/** What the caller should do once the attempts are exhausted. */
export type SessionRestoreVerdict = "loaded" | "rejected" | "unverified";

/**
 * Pauses between attempts, in order.
 *
 * Roughly fifteen seconds in total, which is the scale of the gap this exists
 * to survive: Compose stops the old container, starts its replacement, and
 * waits for the health check. The delay grows so a short blip costs one retry
 * rather than all of them.
 */
export const SESSION_RECOVERY_DELAYS_MS = [
  500, 1_000, 2_000, 3_000, 4_000, 5_000,
];

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempt to restore the session, retrying while the API is unreachable.
 *
 * `unavailable` is the only result that is retried; `rejected` is terminal
 * immediately, because the server answered and refused. Returning `unverified`
 * rather than `rejected` once the schedule runs out is the distinction the
 * whole module exists for: the caller must offer a retry, not a login form.
 */
export async function restoreSession(
  attempt: () => Promise<SessionAttemptResult>,
  {
    delaysMs = SESSION_RECOVERY_DELAYS_MS,
    sleep = defaultSleep,
  }: {
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SessionRestoreVerdict> {
  for (let index = 0; ; index += 1) {
    const result = await attempt();
    if (result === "loaded") return "loaded";
    if (result === "rejected") return "rejected";

    const pause = delaysMs[index];
    if (pause === undefined) return "unverified";
    await sleep(pause);
  }
}
