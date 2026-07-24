import { describe, expect, test } from "bun:test";
import { evaluateReadiness, type ReadinessChecks } from "./health.js";

const healthy: ReadinessChecks = {
  postgres: true,
  nats: true,
  eventConsumer: true,
  pusher: { configured: true },
};

describe("readiness policy", () => {
  test("PostgreSQL failure makes the API unready", () => {
    expect(evaluateReadiness({ ...healthy, postgres: false })).toBe("unready");
  });

  test("delivery dependencies report degraded without rejecting REST traffic", () => {
    expect(evaluateReadiness({ ...healthy, nats: false })).toBe("degraded");
    expect(evaluateReadiness({ ...healthy, eventConsumer: false })).toBe(
      "degraded",
    );
    expect(
      evaluateReadiness({ ...healthy, pusher: { configured: false } }),
    ).toBe("degraded");
  });

  test("all required checks report ready", () => {
    expect(evaluateReadiness(healthy)).toBe("ready");
  });
});
