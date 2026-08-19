import { describe, expect, it } from "bun:test";
import {
  isConsentRequiredFlag,
  isEnabledFlag,
  normalizeMeasurementId,
  resolveProductAnalyticsConfig,
} from "./config";

describe("enable switch", () => {
  it("defaults to disabled and accepts only the exact string 'true'", () => {
    expect(isEnabledFlag(undefined)).toBe(false);
    expect(isEnabledFlag("")).toBe(false);
    expect(isEnabledFlag("false")).toBe(false);
    expect(isEnabledFlag("TRUE")).toBe(false);
    expect(isEnabledFlag("True")).toBe(false);
    expect(isEnabledFlag("1")).toBe(false);
    expect(isEnabledFlag("yes")).toBe(false);
    expect(isEnabledFlag(" true ")).toBe(false);
    expect(isEnabledFlag(true)).toBe(false);
    expect(isEnabledFlag("true")).toBe(true);
  });
});

describe("consent requirement flag", () => {
  it("defaults to required and only the literal 'false' bypasses it", () => {
    expect(isConsentRequiredFlag(undefined)).toBe(true);
    expect(isConsentRequiredFlag("")).toBe(true);
    expect(isConsentRequiredFlag("true")).toBe(true);
    expect(isConsentRequiredFlag("no")).toBe(true);
    expect(isConsentRequiredFlag("FALSE")).toBe(true);
    expect(isConsentRequiredFlag(false)).toBe(true);
    expect(isConsentRequiredFlag("false")).toBe(false);
  });
});

describe("measurement ID validation", () => {
  it("accepts a conservative GA4 web ID format", () => {
    expect(normalizeMeasurementId("G-ABC123XYZ9")).toBe("G-ABC123XYZ9");
    expect(normalizeMeasurementId("  G-ABC123XYZ9  ")).toBe("G-ABC123XYZ9");
    expect(normalizeMeasurementId("G-1234")).toBe("G-1234");
  });

  it("rejects blank, malformed, and non-GA4 identifiers", () => {
    expect(normalizeMeasurementId(undefined)).toBeNull();
    expect(normalizeMeasurementId("")).toBeNull();
    expect(normalizeMeasurementId("   ")).toBeNull();
    expect(normalizeMeasurementId("G-")).toBeNull();
    expect(normalizeMeasurementId("G-abc123")).toBeNull();
    expect(normalizeMeasurementId("UA-12345-1")).toBeNull();
    expect(normalizeMeasurementId("GTM-ABC123")).toBeNull();
    expect(normalizeMeasurementId("AW-123456789")).toBeNull();
    expect(normalizeMeasurementId("G-ABC 123")).toBeNull();
    expect(normalizeMeasurementId("G-ABC123XYZ9ABC123XYZ9ABC")).toBeNull();
    expect(
      normalizeMeasurementId("https://evil.example/?id=G-ABC123"),
    ).toBeNull();
  });
});

describe("configuration truth table", () => {
  const VALID_ID = "G-ABC123XYZ9";

  it("is active only when enabled is 'true' AND the ID validates", () => {
    const active = resolveProductAnalyticsConfig({
      gaEnabled: "true",
      gaMeasurementId: VALID_ID,
    });
    expect(active.enabled).toBe(true);
    expect(active.measurementId).toBe(VALID_ID);
  });

  it("stays disabled for every other combination", () => {
    const combinations = [
      { gaEnabled: undefined, gaMeasurementId: undefined },
      { gaEnabled: undefined, gaMeasurementId: VALID_ID },
      { gaEnabled: "false", gaMeasurementId: VALID_ID },
      { gaEnabled: "1", gaMeasurementId: VALID_ID },
      { gaEnabled: "true", gaMeasurementId: undefined },
      { gaEnabled: "true", gaMeasurementId: "" },
      { gaEnabled: "true", gaMeasurementId: "not-an-id" },
      { gaEnabled: "true", gaMeasurementId: "UA-12345-1" },
    ];
    for (const combination of combinations) {
      const config = resolveProductAnalyticsConfig(combination);
      expect(config.enabled).toBe(false);
      expect(config.measurementId).toBeNull();
    }
  });

  it("keeps the retained ID out of the config when the switch is off", () => {
    const config = resolveProductAnalyticsConfig({
      gaEnabled: "false",
      gaMeasurementId: VALID_ID,
    });
    expect(config.measurementId).toBeNull();
  });

  it("carries the consent requirement independently", () => {
    expect(
      resolveProductAnalyticsConfig({ gaRequireConsent: undefined })
        .requireConsent,
    ).toBe(true);
    expect(
      resolveProductAnalyticsConfig({ gaRequireConsent: "false" })
        .requireConsent,
    ).toBe(false);
  });
});
