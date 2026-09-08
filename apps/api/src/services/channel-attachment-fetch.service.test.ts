import { describe, expect, test } from "bun:test";
import { storedContentType } from "./channel-attachment-fetch.service";

describe("stored attachment content type", () => {
  test("prefers the downloaded type over a provider-declared type", () => {
    expect(storedContentType("image/jpeg", "text/html")).toBe("image/jpeg");
  });

  test("rejects active or scriptable types", () => {
    expect(storedContentType("text/html", "image/svg+xml")).toBe(
      "application/octet-stream",
    );
    expect(storedContentType("application/javascript")).toBe(
      "application/octet-stream",
    );
  });

  test("keeps ordinary media types", () => {
    expect(storedContentType("video/mp4; codecs=avc1")).toBe("video/mp4");
    expect(storedContentType("application/pdf")).toBe("application/pdf");
  });
});
