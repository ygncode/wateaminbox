// Generic per-process diagnostics only. No request context, endpoints, identifiers,
// heap snapshots, histograms, or retained samples. One unref'd timer and O(1) state.
const TICK_MS = 1_000;
const REPORT_MS = 60_000;

type CpuSample = { user: number; system: number };
type MemorySample = {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers?: number;
};

export type RuntimeMetrics = {
  interval_ms: number;
  rss_bytes: number;
  heap_used_bytes: number;
  heap_total_bytes: number;
  external_bytes: number;
  array_buffers_bytes: number;
  cpu_user_percent: number;
  cpu_system_percent: number;
  cpu_process_percent: number;
  event_loop_delay_mean_ms: number;
  event_loop_delay_max_ms: number;
  event_loop_samples: number;
  sampling_errors: number;
};

export type RuntimeDiagnosticsDependencies = {
  now: () => number;
  cpu: () => CpuSample;
  memory: () => MemorySample;
  // Returns cancellation; production timers must not keep a process alive.
  schedule: (callback: () => void, delayMs: number) => () => void;
};

const runtime: RuntimeDiagnosticsDependencies = {
  now: () => performance.now(),
  cpu: () => process.cpuUsage(),
  memory: () => process.memoryUsage(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

function nonnegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Emits at most once a minute (no catch-up bursts). CPU is percentage of one
 * core, not host utilization, and may exceed 100. Delay is sampled timer drift,
 * not a latency percentile. Memory fields are runtime estimates; external and
 * array-buffer bytes may overlap and must not be added to RSS.
 * Call the idempotent returned function at the beginning of shutdown.
 */
export function startRuntimeDiagnostics(
  emit: (metrics: RuntimeMetrics) => void,
  deps: RuntimeDiagnosticsDependencies = runtime,
): () => void {
  let stopped = false;
  let lastReport = deps.now();
  let expectedTick = lastReport + TICK_MS;
  let previousCpu: CpuSample | undefined;
  let samplingErrors = 0;
  try {
    previousCpu = deps.cpu();
  } catch {
    samplingErrors++;
  }
  let delaySum = 0;
  let delayMax = 0;
  let samples = 0;
  let cancel: () => void = () => {};

  function tick() {
    if (stopped) return;
    const now = deps.now();
    const delay = nonnegative(now - expectedTick);
    delaySum += delay;
    delayMax = Math.max(delayMax, delay);
    samples++;
    const elapsed = now - lastReport;
    if (elapsed >= REPORT_MS) {
      try {
        const cpu = deps.cpu();
        const memory = deps.memory();
        const user = previousCpu
          ? nonnegative(cpu.user - previousCpu.user) / (elapsed * 10)
          : 0;
        const system = previousCpu
          ? nonnegative(cpu.system - previousCpu.system) / (elapsed * 10)
          : 0;
        // Explicit allowlist: never spread a runtime/dependency object into logs.
        emit({
          interval_ms: elapsed,
          rss_bytes: nonnegative(memory.rss),
          heap_used_bytes: nonnegative(memory.heapUsed),
          heap_total_bytes: nonnegative(memory.heapTotal),
          external_bytes: nonnegative(memory.external),
          array_buffers_bytes: nonnegative(memory.arrayBuffers),
          cpu_user_percent: user,
          cpu_system_percent: system,
          cpu_process_percent: user + system,
          event_loop_delay_mean_ms: delaySum / samples,
          event_loop_delay_max_ms: delayMax,
          event_loop_samples: samples,
          sampling_errors: samplingErrors,
        });
        previousCpu = cpu;
        samplingErrors = 0;
      } catch {
        // Diagnostics must not crash the service or log exception payloads.
        previousCpu = undefined;
        samplingErrors++;
      }
      lastReport = now;
      delaySum = 0;
      delayMax = 0;
      samples = 0;
    }
    if (!stopped) {
      expectedTick = deps.now() + TICK_MS;
      cancel = deps.schedule(tick, TICK_MS);
    }
  }

  cancel = deps.schedule(tick, TICK_MS);
  return () => {
    if (stopped) return;
    stopped = true;
    cancel();
  };
}
