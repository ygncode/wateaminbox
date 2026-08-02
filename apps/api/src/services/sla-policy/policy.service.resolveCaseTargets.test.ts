import { describe, expect, test } from "bun:test";
import { resolveCaseTargets } from "./policy.service.js";

const POLICY = {
  targetMinutes: 60,
  directResolutionTargetMinutes: 480,
  groupResponseTargetMinutes: 120,
  groupResolutionTargetMinutes: 960,
};

describe("resolveCaseTargets", () => {
  test("direct cases use the direct response/resolution targets", () => {
    expect(resolveCaseTargets(POLICY, "direct")).toEqual({
      responseTargetMinutes: 60,
      resolutionTargetMinutes: 480,
    });
  });

  test("group cases use the group response/resolution targets", () => {
    expect(resolveCaseTargets(POLICY, "group")).toEqual({
      responseTargetMinutes: 120,
      resolutionTargetMinutes: 960,
    });
  });
});
