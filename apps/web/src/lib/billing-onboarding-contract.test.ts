import { describe, expect, it } from "bun:test";

const workspaceCreationSurfaces = [
  "../pages/CompanySetupPage.tsx",
  "../components/workspace/WorkspaceSwitcher.tsx",
] as const;

describe("post-setup billing handoff", () => {
  for (const relativePath of workspaceCreationSurfaces) {
    it(`opens configured onboarding after workspace creation in ${relativePath}`, async () => {
      const source = await Bun.file(
        new URL(relativePath, import.meta.url),
      ).text();

      expect(source).toContain("getWorkspaceBillingUrl");
      expect(source).toContain("onboarding: true");
      expect(source).toContain("window.location.assign(billingUrl)");
    });
  }
});
