/**
 * Bounded, ordered shutdown sequencing.
 *
 * The API owns several resources that must be released in dependency order, and
 * several of the release paths can block indefinitely: the HTTP server waits on
 * in-flight requests, the outbox dispatchers poll until their current cycle
 * finishes, and a NATS drain waits on the broker. Awaiting them in sequence with
 * no bound means a single stuck dependency holds the process open until Docker
 * escalates to SIGKILL, which is not a graceful shutdown -- it is an ungraceful
 * one that took longer.
 *
 * This runs the steps in order under one overall budget, so the caller can
 * always exit within a known time.
 */

/** A single release action, named so its outcome can be reported. */
export interface ShutdownStep {
  readonly name: string;
  readonly run: () => Promise<void> | void;
}

export type ShutdownStepStatus =
  | "completed"
  | "failed"
  | "timed-out"
  | "skipped";

export interface ShutdownStepResult {
  readonly name: string;
  readonly status: ShutdownStepStatus;
  readonly error?: unknown;
}

export interface ShutdownResult {
  /** True when the budget ran out before every step had run. */
  readonly timedOut: boolean;
  readonly steps: readonly ShutdownStepResult[];
}

export interface RunShutdownOptions {
  readonly steps: readonly ShutdownStep[];
  /** Total time all steps share. Must be below the container's stop grace. */
  readonly deadlineMs: number;
  readonly onResult?: (result: ShutdownStepResult) => void;
}

const TIMED_OUT = Symbol("shutdown-step-timed-out");

/**
 * Races a step against the time left in the budget.
 *
 * A step that loses the race is abandoned rather than cancelled: there is no
 * cancellation protocol for these resources, and the process is about to exit.
 * The deadline timer is unref'd so waiting for it can never itself be the reason
 * the process stays alive.
 */
async function withDeadline(
  run: () => Promise<void> | void,
  ms: number,
): Promise<typeof TIMED_OUT | void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
    timer.unref?.();
  });

  try {
    // Wrapping in a resolved promise turns a synchronous throw into a
    // rejection, so a step that fails immediately is reported, not propagated.
    return await Promise.race([Promise.resolve().then(run), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs `steps` in order within `deadlineMs`.
 *
 * A step that throws is recorded and the sequence continues: one broken
 * dependency must not stop the others from being released. A step that exhausts
 * the budget ends the sequence, because there is no time left to spend on the
 * remaining ones; they are reported as skipped so the log says what was not
 * released rather than implying a clean shutdown.
 */
export async function runShutdown({
  steps,
  deadlineMs,
  onResult,
}: RunShutdownOptions): Promise<ShutdownResult> {
  const startedAt = Date.now();
  const results: ShutdownStepResult[] = [];
  let timedOut = false;

  const record = (result: ShutdownStepResult): void => {
    results.push(result);
    onResult?.(result);
  };

  for (const step of steps) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (timedOut || remaining <= 0) {
      timedOut = true;
      record({ name: step.name, status: "skipped" });
      continue;
    }

    try {
      const outcome = await withDeadline(step.run, remaining);
      if (outcome === TIMED_OUT) {
        timedOut = true;
        record({ name: step.name, status: "timed-out" });
        continue;
      }
      record({ name: step.name, status: "completed" });
    } catch (error) {
      record({ name: step.name, status: "failed", error });
    }
  }

  return { timedOut, steps: results };
}
