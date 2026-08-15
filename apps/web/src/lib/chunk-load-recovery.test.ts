import { describe, expect, test } from "bun:test";
import { installChunkLoadRecovery } from "./chunk-load-recovery";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("chunk load recovery", () => {
  test("reloads once and lets a repeated failure reach the error boundary", () => {
    const eventTarget = new EventTarget();
    const storage = memoryStorage();
    let reloads = 0;
    let time = 1_000;

    installChunkLoadRecovery({
      eventTarget,
      storage,
      reload: () => reloads++,
      now: () => time,
    });

    const firstFailure = new Event("vite:preloadError", { cancelable: true });
    eventTarget.dispatchEvent(firstFailure);
    expect(firstFailure.defaultPrevented).toBe(true);
    expect(reloads).toBe(1);

    const repeatedFailure = new Event("vite:preloadError", {
      cancelable: true,
    });
    eventTarget.dispatchEvent(repeatedFailure);
    expect(repeatedFailure.defaultPrevented).toBe(false);
    expect(reloads).toBe(1);

    time += 60_000;
    const laterFailure = new Event("vite:preloadError", { cancelable: true });
    eventTarget.dispatchEvent(laterFailure);
    expect(laterFailure.defaultPrevented).toBe(true);
    expect(reloads).toBe(2);
  });

  test("does not reload when session storage is unavailable", () => {
    const eventTarget = new EventTarget();
    let reloads = 0;

    installChunkLoadRecovery({
      eventTarget,
      storage: {
        getItem: () => {
          throw new Error("storage disabled");
        },
        setItem: () => undefined,
      },
      reload: () => reloads++,
    });

    const failure = new Event("vite:preloadError", { cancelable: true });
    eventTarget.dispatchEvent(failure);
    expect(failure.defaultPrevented).toBe(false);
    expect(reloads).toBe(0);
  });
});
