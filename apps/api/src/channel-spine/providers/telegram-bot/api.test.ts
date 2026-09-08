import { afterEach, describe, expect, test } from "bun:test";
import { downloadTelegramFile } from "./api";

const originalFetch = globalThis.fetch;
const token = `12345:${"a".repeat(30)}`;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Telegram file retrieval", () => {
  test("resolves a provider file and enforces a bounded download", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({
          ok: true,
          result: { file_path: "photos/file_1.jpg", file_size: 3 },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      });
    }) as typeof fetch;
    const file = await downloadTelegramFile(token, "provider-file-id", 3);
    expect([...file.data]).toEqual([1, 2, 3]);
    expect(file.contentType).toBe("image/jpeg");
    expect(calls).toBe(2);
  });

  test("rejects traversal-like provider paths without fetching them", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({
        ok: true,
        result: { file_path: "../secret", file_size: 1 },
      });
    }) as typeof fetch;
    await expect(
      downloadTelegramFile(token, "provider-file-id"),
    ).rejects.toThrow("invalid file path");
    expect(calls).toBe(1);
  });

  test("refuses a declared oversize before reading a response body", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({
          ok: true,
          result: { file_path: "photos/file.jpg", file_size: 100 },
        });
      }
      throw new Error("file endpoint must not be called");
    }) as typeof fetch;
    await expect(
      downloadTelegramFile(token, "provider-file-id", 10),
    ).rejects.toThrow("download limit");
    expect(calls).toBe(1);
  });
});
