import { describe, expect, test } from "bun:test";
import {
  validateWorkspaceLogo,
  WORKSPACE_LOGO_INPUT_BYTES,
} from "./workspace-logo";

describe("workspace logo validation", () => {
  test("accepts supported images within the upload limit", () => {
    const logo = new File(["logo"], "logo.png", { type: "image/png" });
    expect(validateWorkspaceLogo(logo)).toBeNull();

    const gif = new File(["logo"], "logo.gif", { type: "image/gif" });
    expect(validateWorkspaceLogo(gif)).toBeNull();

    const logoWithoutMimeMetadata = new File(["logo"], "logo.webp");
    expect(validateWorkspaceLogo(logoWithoutMimeMetadata)).toBeNull();
  });

  test("rejects unsupported formats and oversized images", () => {
    const svg = new File(["<svg />"], "logo.svg", {
      type: "image/svg+xml",
    });
    expect(validateWorkspaceLogo(svg)).toBe(
      "Choose a PNG, JPEG, WebP, GIF, or AVIF image.",
    );

    const oversized = new File(
      [new Uint8Array(WORKSPACE_LOGO_INPUT_BYTES + 1)],
      "logo.webp",
      { type: "image/webp" },
    );
    expect(validateWorkspaceLogo(oversized)).toBe(
      "Logo must be 5 MB or smaller.",
    );
  });
});
