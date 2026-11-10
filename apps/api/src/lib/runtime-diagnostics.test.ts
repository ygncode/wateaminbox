import { describe, expect, test } from "bun:test";
import {
  type RuntimeDiagnosticsDependencies,
  type RuntimeMetrics,
  startRuntimeDiagnostics,
} from "./runtime-diagnostics.js";

function fixture() {
  let now = 0;
  let cpu = { user: 10_000, system: 20_000 };
  let callback: (() => void) | undefined;
  let cancellations = 0;
  let schedules = 0;
  const logs: RuntimeMetrics[] = [];
  const deps: RuntimeDiagnosticsDependencies = {
    now: () => now,
    cpu: () => cpu,
    memory: () => ({
      rss: 1000,
      heapUsed: 200,
      heapTotal: 400,
      external: 50,
      arrayBuffers: 10,
      secret: "must-not-appear",
    }),
    schedule(fn, delay) {
      expect(delay).toBe(1000);
      expect(callback).toBeUndefined();
      schedules++;
      callback = fn;
      return () => {
        callback = undefined;
        cancellations++;
      };
    },
  };
  return {
    deps,
    logs,
    setCpu(value: typeof cpu) {
      cpu = value;
    },
    advance(ms: number) {
      now += ms;
      const fn = callback;
      callback = undefined;
      fn?.();
    },
    get pending() {
      return callback;
    },
    get cancellations() {
      return cancellations;
    },
    get schedules() {
      return schedules;
    },
  };
}

describe("bounded per-process runtime diagnostics", () => {
  test("one numeric allowlisted report per minute with interval CPU deltas", () => {
    const f = fixture();
    const stop = startRuntimeDiagnostics(
      (metrics) => f.logs.push(metrics),
      f.deps,
    );
    for (let i = 0; i < 59; i++) f.advance(1000);
    expect(f.logs).toHaveLength(0);
    f.setCpu({ user: 90_010_000, system: 30_020_000 });
    f.advance(1000);
    expect(f.logs).toEqual([
      {
        interval_ms: 60_000,
        rss_bytes: 1000,
        heap_used_bytes: 200,
        heap_total_bytes: 400,
        external_bytes: 50,
        array_buffers_bytes: 10,
        cpu_user_percent: 150,
        cpu_system_percent: 50,
        cpu_process_percent: 200,
        event_loop_delay_mean_ms: 0,
        event_loop_delay_max_ms: 0,
        event_loop_samples: 60,
        sampling_errors: 0,
      },
    ]);
    for (const value of Object.values(f.logs[0]!))
      expect(Number.isFinite(value)).toBe(true);
    for (let i = 0; i < 60; i++) f.advance(1000);
    expect(f.logs[1]?.cpu_process_percent).toBe(0);
    stop();
  });

  test("long stalls emit once, report drift, then reset without catch-up", () => {
    const f = fixture();
    const stop = startRuntimeDiagnostics(
      (metrics) => f.logs.push(metrics),
      f.deps,
    );
    f.advance(180_000);
    expect(f.logs).toHaveLength(1);
    expect(f.logs[0]?.event_loop_delay_max_ms).toBe(179_000);
    expect(f.logs[0]?.event_loop_samples).toBe(1);
    expect(f.schedules).toBe(2);
    for (let i = 0; i < 60; i++) f.advance(1000);
    expect(f.logs[1]?.event_loop_delay_max_ms).toBe(0);
    expect(f.logs[1]?.event_loop_samples).toBe(60);
    stop();
  });

  test("idempotent shutdown cancels timer and suppresses already queued callbacks", () => {
    const f = fixture();
    const stop = startRuntimeDiagnostics(
      (metrics) => f.logs.push(metrics),
      f.deps,
    );
    const queued = f.pending;
    stop();
    stop();
    queued?.();
    f.advance(120_000);
    expect(f.cancellations).toBe(1);
    expect(f.pending).toBeUndefined();
    expect(f.logs).toEqual([]);
    expect(f.schedules).toBe(1);
  });

  test("shutdown inside the emitter cannot rearm", () => {
    const f = fixture();
    const stop = startRuntimeDiagnostics(() => stop(), f.deps);
    f.advance(60_000);
    expect(f.pending).toBeUndefined();
    expect(f.schedules).toBe(1);
  });

  test("sampler/logger failures do not crash or leak exception content", () => {
    const f = fixture();
    let fail = true;
    f.deps.memory = () => {
      if (fail) throw new Error("private payload");
      return { rss: 100, heapUsed: NaN, heapTotal: Infinity, external: -1 };
    };
    const stop = startRuntimeDiagnostics(
      (metrics) => f.logs.push(metrics),
      f.deps,
    );
    f.advance(60_000);
    expect(f.logs).toEqual([]);
    fail = false;
    f.advance(60_000);
    expect(f.logs[0]?.sampling_errors).toBe(1);
    expect(f.logs[0]?.cpu_process_percent).toBe(0);
    expect(f.logs[0]?.array_buffers_bytes).toBe(0);
    expect(f.logs[0]?.heap_used_bytes).toBe(0);
    expect(JSON.stringify(f.logs)).not.toContain("private payload");
    stop();
    const failing = fixture();
    const stopFailing = startRuntimeDiagnostics(() => {
      throw new Error("private payload");
    }, failing.deps);
    expect(() => failing.advance(60_000)).not.toThrow();
    expect(failing.pending).toBeDefined();
    stopFailing();
  });

  test("real Bun timer is unref'd and stop allows a natural process exit", async () => {
    const modulePath = new URL("./runtime-diagnostics.ts", import.meta.url)
      .pathname;
    for (const mode of ["unref", "stop", "signal"]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `
        import { startRuntimeDiagnostics } from ${JSON.stringify(modulePath)};
        const stop = startRuntimeDiagnostics(() => { throw new Error('unexpected report'); });
        if (${JSON.stringify(mode)} === 'stop') { stop(); stop(); }
        if (${JSON.stringify(mode)} === 'signal') {
          process.exitCode = 1;
          const keepAlive = setInterval(() => {}, 1000);
          process.once('SIGTERM', () => {
            stop(); stop(); clearInterval(keepAlive); process.exitCode = 0;
          });
          setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);
        }
      `,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const watchdog = setTimeout(() => child.kill(), 3000);
      try {
        expect(await child.exited).toBe(0);
        expect(await new Response(child.stdout).text()).toBe("");
        expect(await new Response(child.stderr).text()).toBe("");
      } finally {
        clearTimeout(watchdog);
        child.kill();
      }
    }
  });
});
