import { describe, expect, it } from "bun:test";
import { buildBillingUrl } from "./billing-url";

describe("billing URL", () => {
  it("adds workspace context to a same-origin billing route", () => {
    expect(
      buildBillingUrl("/billing", "a-company", {
        origin: "https://app.example.com",
      }),
    ).toBe("/billing?companyId=a-company");
  });

  it("adds onboarding mode without discarding configured query parameters", () => {
    expect(
      buildBillingUrl("/billing?source=app", "company/id", {
        onboarding: true,
        origin: "https://app.example.com",
      }),
    ).toBe("/billing?source=app&companyId=company%2Fid&mode=onboarding");
  });

  it("supports a secure external account application", () => {
    expect(
      buildBillingUrl("https://account.example.com/billing", "company-1", {
        origin: "https://app.example.com",
      }),
    ).toBe("https://account.example.com/billing?companyId=company-1");
  });

  it("rejects unsafe and credential-bearing URLs", () => {
    expect(
      buildBillingUrl("javascript:alert(1)", "company-1", {
        origin: "https://app.example.com",
      }),
    ).toBeNull();
    expect(
      buildBillingUrl("https://user:pass@example.com", "company-1", {
        origin: "https://app.example.com",
      }),
    ).toBeNull();
  });

  it("returns null when billing is not configured", () => {
    expect(
      buildBillingUrl(" ", "company-1", {
        origin: "https://app.example.com",
      }),
    ).toBeNull();
  });
});
