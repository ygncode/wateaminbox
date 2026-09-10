import { describe, expect, test } from "bun:test";
import {
  MAX_FILE_SIZE,
  MAX_UPLOAD_BODY_SIZE,
  MEDIA_DOWNLOAD_LEASE_MS,
} from "../config/media.config.js";
import { isUploadBodyTooLarge, mediaRoutes } from "./media.js";

/**
 * Mirrors the SQL predicate used to claim a deferred media download in
 * `POST /media/download/:messageId`. The route issues it as one conditional
 * UPDATE, so PostgreSQL re-checks it under the row lock and exactly one of two
 * concurrent requests can win.
 *
 * Keeping the decision table pinned here is what stops a future edit from
 * quietly reintroducing the stuck-forever state: a row left at "downloading"
 * used to refuse every retry, making the media permanently unreachable.
 */
function isClaimable(
  row: {
    media_download_status: string | null;
    media_downloaded_at: Date | null;
  },
  now: Date,
): boolean {
  const staleCutoff = new Date(now.getTime() - MEDIA_DOWNLOAD_LEASE_MS);
  return (
    row.media_download_status === null ||
    row.media_download_status !== "downloading" ||
    row.media_downloaded_at === null ||
    row.media_downloaded_at.getTime() <= staleCutoff.getTime()
  );
}

const now = new Date("2026-08-05T12:00:00.000Z");
const fresh = new Date(now.getTime() - 30_000);
const expired = new Date(now.getTime() - MEDIA_DOWNLOAD_LEASE_MS - 1_000);

describe("deferred media download claim", () => {
  test("an unclaimed row is claimable", () => {
    expect(
      isClaimable(
        { media_download_status: "pending", media_downloaded_at: null },
        now,
      ),
    ).toBe(true);
    expect(
      isClaimable(
        { media_download_status: null, media_downloaded_at: null },
        now,
      ),
    ).toBe(true);
  });

  test("a previously failed row can be retried", () => {
    expect(
      isClaimable(
        { media_download_status: "failed", media_downloaded_at: null },
        now,
      ),
    ).toBe(true);
  });

  test("a live claim blocks a second concurrent request", () => {
    expect(
      isClaimable(
        { media_download_status: "downloading", media_downloaded_at: fresh },
        now,
      ),
    ).toBe(false);
  });

  test("a claim past the lease is reclaimed instead of stranding the media", () => {
    // The worker died, restarted, or its response event was lost. Without
    // this the row stays "downloading" forever.
    expect(
      isClaimable(
        { media_download_status: "downloading", media_downloaded_at: expired },
        now,
      ),
    ).toBe(true);
  });

  test("a row stuck by the pre-lease code is immediately reclaimable", () => {
    // Rows already stranded in production carry no claim timestamp.
    expect(
      isClaimable(
        { media_download_status: "downloading", media_downloaded_at: null },
        now,
      ),
    ).toBe(true);
  });

  test("the lease boundary is inclusive, so a claim cannot wedge exactly on it", () => {
    const exactly = new Date(now.getTime() - MEDIA_DOWNLOAD_LEASE_MS);
    expect(
      isClaimable(
        { media_download_status: "downloading", media_downloaded_at: exactly },
        now,
      ),
    ).toBe(true);
  });

  test("the lease is bounded and long enough to outlast a normal download", () => {
    expect(MEDIA_DOWNLOAD_LEASE_MS).toBeGreaterThanOrEqual(60_000);
    expect(MEDIA_DOWNLOAD_LEASE_MS).toBeLessThanOrEqual(30 * 60_000);
  });
});

/**
 * The upload route used to enforce its 50 MiB file-size cap only AFTER
 * `c.req.parseBody()` had already buffered the entire multipart body into RAM.
 * Hono's parseBody materializes the body as an ArrayBuffer and then parses it
 * into FormData, so by the time `file.size` could be inspected the oversized
 * request had already consumed its peak memory. The fix rejects oversized
 * bodies at the Content-Length header before buffering, backed by a server-
 * level `maxRequestBodySize`.
 */
describe("POST /media/upload - pre-buffer size guard", () => {
  test("MAX_FILE_SIZE is 50 MiB and the body cap adds a 1 MiB overhead", () => {
    expect(MAX_FILE_SIZE).toBe(50 * 1024 * 1024);
    expect(MAX_UPLOAD_BODY_SIZE).toBe(MAX_FILE_SIZE + 1024 * 1024);
    // The overhead must be positive so a file at the boundary (50 MiB plus
    // multipart framing, which is well under 1 KB) is never falsely rejected.
    expect(MAX_UPLOAD_BODY_SIZE).toBeGreaterThan(MAX_FILE_SIZE);
    expect(Number.isFinite(MAX_UPLOAD_BODY_SIZE)).toBe(true);
  });

  test("isUploadBodyTooLarge rejects a declared body over the cap", () => {
    expect(
      isUploadBodyTooLarge(
        String(MAX_UPLOAD_BODY_SIZE + 1),
        MAX_UPLOAD_BODY_SIZE,
      ),
    ).toBe(true);
    expect(isUploadBodyTooLarge("999999999999", MAX_UPLOAD_BODY_SIZE)).toBe(
      true,
    );
  });

  test("isUploadBodyTooLarge accepts a body at or below the cap", () => {
    // The cap is exclusive (`>`), so exactly the cap is accepted.
    expect(
      isUploadBodyTooLarge(String(MAX_UPLOAD_BODY_SIZE), MAX_UPLOAD_BODY_SIZE),
    ).toBe(false);
    expect(
      isUploadBodyTooLarge(String(MAX_FILE_SIZE), MAX_UPLOAD_BODY_SIZE),
    ).toBe(false);
    expect(isUploadBodyTooLarge("0", MAX_UPLOAD_BODY_SIZE)).toBe(false);
  });

  test("isUploadBodyTooLarge treats a missing or unparseable header as unknown", () => {
    // A missing Content-Length (chunked encoding) and a malformed or negative
    // value are left for the server maxRequestBodySize backstop and the
    // post-buffer file.size check, instead of falsely rejecting on a number
    // the route cannot trust.
    expect(isUploadBodyTooLarge(undefined, MAX_UPLOAD_BODY_SIZE)).toBe(false);
    expect(isUploadBodyTooLarge("", MAX_UPLOAD_BODY_SIZE)).toBe(false);
    expect(isUploadBodyTooLarge("not-a-number", MAX_UPLOAD_BODY_SIZE)).toBe(
      false,
    );
    expect(isUploadBodyTooLarge("-1", MAX_UPLOAD_BODY_SIZE)).toBe(false);
  });
});

describe("POST /media/upload - authentication gate", () => {
  // The route mounts authMiddleware before the upload handler, so a request
  // without a bearer token is refused before any body is read or size check
  // runs — the same unauthenticated-rejection contract exercised for the
  // contacts import template route in contacts/import.test.ts.
  test("rejects a request without an Authorization header with 401", async () => {
    const response = await mediaRoutes.request("/upload", { method: "POST" });

    expect(response.status).toBe(401);
  });
});

/**
 * The route's pre-buffer Content-Length guard is only effective because Bun
 * refuses a body over `maxRequestBodySize` at the server level (set in
 * src/index.ts). This pins the Bun behavior the backstop relies on, so a Bun
 * upgrade that changes the cap semantics is caught here rather than silently
 * reopening the buffer-before-reject window.
 */
describe("Bun maxRequestBodySize backstop", () => {
  test("rejects a body over the cap with 413 and accepts one at the cap", async () => {
    const server = Bun.serve({
      port: 0,
      maxRequestBodySize: 10,
      fetch: () => new Response("ok"),
    });
    try {
      const url = `http://localhost:${server.port}/`;
      const over = await fetch(url, { method: "POST", body: "x".repeat(11) });
      expect(over.status).toBe(413);

      const atCap = await fetch(url, { method: "POST", body: "x".repeat(10) });
      expect(atCap.status).toBe(200);
      expect(await atCap.text()).toBe("ok");
    } finally {
      server.stop(true);
    }
  });
});
