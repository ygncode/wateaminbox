import { describe, expect, test } from "bun:test";
import {
  installChunkLoadRecovery,
  recoverFromStaleModuleError,
} from "./chunk-load-recovery";

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

  test("recovers an evaluated stale React module graph once", () => {
    const storage = memoryStorage();
    let reloads = 0;
    let time = 1_000;
    const error = new TypeError(
      "Cannot read properties of null (reading 'useContext')",
    );

    expect(
      recoverFromStaleModuleError(error, {
        storage,
        reload: () => reloads++,
        now: () => time,
      }),
    ).toBe(true);
    expect(reloads).toBe(1);

    expect(
      recoverFromStaleModuleError(error, {
        storage,
        reload: () => reloads++,
        now: () => time,
      }),
    ).toBe(false);
    expect(reloads).toBe(1);

    time += 60_000;
    expect(
      recoverFromStaleModuleError(new Error("Invalid hook call"), {
        storage,
        reload: () => reloads++,
        now: () => time,
      }),
    ).toBe(true);
    expect(reloads).toBe(2);
  });

  test("recognizes Firefox and Safari null-dispatcher messages", () => {
    const messages = [
      `can't access property "useContext", dispatcher is null`,
      `null is not an object (evaluating 'dispatcher.useContext')`,
    ];

    for (const message of messages) {
      let reloads = 0;
      expect(
        recoverFromStaleModuleError(new TypeError(message), {
          storage: memoryStorage(),
          reload: () => reloads++,
          now: () => 1_000,
        }),
      ).toBe(true);
      expect(reloads).toBe(1);
    }
  });

  test("leaves unrelated application errors to the error boundary", () => {
    let reloads = 0;
    expect(
      recoverFromStaleModuleError(new Error("Request failed"), {
        storage: memoryStorage(),
        reload: () => reloads++,
      }),
    ).toBe(false);
    expect(reloads).toBe(0);
  });

  test("shares the reload-loop guard across preload and evaluated module failures", () => {
    const eventTarget = new EventTarget();
    const storage = memoryStorage();
    let reloads = 0;
    installChunkLoadRecovery({
      eventTarget,
      storage,
      reload: () => reloads++,
      now: () => 1_000,
    });
    eventTarget.dispatchEvent(
      new Event("vite:preloadError", { cancelable: true }),
    );

    expect(
      recoverFromStaleModuleError(
        new TypeError("Cannot read properties of null (reading 'useContext')"),
        { storage, reload: () => reloads++, now: () => 1_001 },
      ),
    ).toBe(false);
    expect(reloads).toBe(1);
  });

  test("does not throw when the browser rejects a reload", () => {
    expect(
      recoverFromStaleModuleError(new Error("Invalid hook call"), {
        storage: memoryStorage(),
        reload: () => {
          throw new Error("reload blocked");
        },
      }),
    ).toBe(false);
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
