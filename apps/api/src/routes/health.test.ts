import { describe, expect, test } from "bun:test";
import { evaluateReadiness, type ReadinessChecks } from "./health.js";

const healthy: ReadinessChecks = {
  postgres: true,
  nats: true,
  eventConsumer: true,
  centrifugo: { configured: true, reachable: true },
};

describe("readiness policy", () => {
  test("PostgreSQL failure makes the API unready", () => {
    expect(evaluateReadiness({ ...healthy, postgres: false })).toBe("unready");
  });

  test("shared rate-limiter failure makes the API unready", () => {
    expect(evaluateReadiness({ ...healthy, rateLimiter: false })).toBe(
      "unready",
    );
  });

  test("NATS or event consumer failure makes the API unready", () => {
    expect(evaluateReadiness({ ...healthy, nats: false })).toBe("unready");
    expect(evaluateReadiness({ ...healthy, eventConsumer: false })).toBe(
      "unready",
    );
  });

  test("Centrifugo issues degrade without rejecting REST traffic", () => {
    expect(
      evaluateReadiness({
        ...healthy,
        centrifugo: { configured: false, reachable: false },
      }),
    ).toBe("degraded");
    expect(
      evaluateReadiness({
        ...healthy,
        centrifugo: { configured: true, reachable: false },
      }),
    ).toBe("degraded");
  });

  test("all required checks report ready", () => {
    expect(evaluateReadiness(healthy)).toBe("ready");
  });
});
