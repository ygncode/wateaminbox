import { describe, expect, test } from "bun:test";
import { deviceInfoSchema, loginSchema } from "./auth";

describe("deviceInfoSchema", () => {
  test("accepts a device name at the 255-character column limit", () => {
    expect(
      deviceInfoSchema.safeParse({ deviceName: "x".repeat(255) }).success,
    ).toBe(true);
  });

  test("rejects a device name exceeding the 255-character column limit", () => {
    const result = deviceInfoSchema.safeParse({ deviceName: "x".repeat(256) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Device name must be at most 255 characters",
      );
    }
  });

  test("accepts a device type at the 50-character column limit", () => {
    expect(
      deviceInfoSchema.safeParse({ deviceType: "y".repeat(50) }).success,
    ).toBe(true);
  });

  test("rejects a device type exceeding the 50-character column limit", () => {
    const result = deviceInfoSchema.safeParse({ deviceType: "y".repeat(51) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "Device type must be at most 50 characters",
      );
    }
  });

  test("accepts empty device strings without a minimum-length bound", () => {
    expect(
      deviceInfoSchema.safeParse({ deviceName: "", deviceType: "" }).success,
    ).toBe(true);
  });

  test("accepts omitted device fields as optional", () => {
    expect(deviceInfoSchema.safeParse({}).success).toBe(true);
  });
});

describe("loginSchema", () => {
  const validCredentials = {
    email: "user@example.com",
    password: "password123",
  };

  test("rejects an overlength device name at the route boundary", () => {
    expect(
      loginSchema.safeParse({
        ...validCredentials,
        deviceInfo: { deviceName: "x".repeat(256) },
      }).success,
    ).toBe(false);
  });

  test("rejects an overlength device type at the route boundary", () => {
    expect(
      loginSchema.safeParse({
        ...validCredentials,
        deviceInfo: { deviceType: "y".repeat(51) },
      }).success,
    ).toBe(false);
  });

  test("accepts a login request with bounded device info", () => {
    expect(
      loginSchema.safeParse({
        ...validCredentials,
        deviceInfo: {
          deviceName: "Macintosh",
          deviceType: "web",
        },
      }).success,
    ).toBe(true);
  });

  test("accepts a login request without device info", () => {
    expect(loginSchema.safeParse(validCredentials).success).toBe(true);
  });
});
