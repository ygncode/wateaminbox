import { describe, expect, test } from "bun:test";
import { canManageMember } from "./members";

describe("company member hierarchy", () => {
  test("owners can manage admins and members, but not owners", () => {
    expect(canManageMember("owner", "admin")).toBe(true);
    expect(canManageMember("owner", "member")).toBe(true);
    expect(canManageMember("owner", "owner")).toBe(false);
  });

  test("admins can manage members only", () => {
    expect(canManageMember("admin", "member")).toBe(true);
    expect(canManageMember("admin", "admin")).toBe(false);
    expect(canManageMember("admin", "owner")).toBe(false);
  });

  test("custom management capability does not bypass role hierarchy", () => {
    expect(canManageMember("member", "member")).toBe(false);
    expect(canManageMember("member", "admin")).toBe(false);
  });
});
