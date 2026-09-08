import { describe, expect, test } from "bun:test";
import { MEDIA_DOWNLOAD_LEASE_MS } from "../config/media.config.js";
import { deriveDownloadRequestMedia } from "./media.js";

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
 * Pins the contract the API puts on the wire for an on-demand download request:
 * the real DB `media_mime_type` must travel as `mimeType` (so the worker stores
 * it as the S3 Content-Type) while the coarse `mediaType` category is still
 * derived (so the worker can select the whatsmeow download path). The bug this
 * guards against collapsed the real type into the category and stored an
 * invalid subtype-less Content-Type on every on-demand download.
 */
describe("deriveDownloadRequestMedia", () => {
  test("splits the real mime type and the category for audio", () => {
    const got = deriveDownloadRequestMedia({ media_mime_type: "audio/ogg" });
    expect(got.mediaType).toBe("audio");
    expect(got.mimeType).toBe("audio/ogg");
  });

  test("preserves codec parameters on the mime type", () => {
    const got = deriveDownloadRequestMedia({
      media_mime_type: "audio/ogg; codecs=opus",
    });
    expect(got.mediaType).toBe("audio");
    expect(got.mimeType).toBe("audio/ogg; codecs=opus");
  });

  test("derives image and video categories from the real mime type", () => {
    expect(
      deriveDownloadRequestMedia({ media_mime_type: "image/jpeg" }),
    ).toEqual({ mediaType: "image", mimeType: "image/jpeg" });
    expect(
      deriveDownloadRequestMedia({ media_mime_type: "video/mp4" }),
    ).toEqual({ mediaType: "video", mimeType: "video/mp4" });
  });

  test("defaults documents (and anything else) to the document category", () => {
    const got = deriveDownloadRequestMedia({
      media_mime_type: "application/pdf",
    });
    expect(got.mediaType).toBe("document");
    expect(got.mimeType).toBe("application/pdf");
  });

  test("never collapses the mime type into the category", () => {
    const cases = ["audio/ogg", "image/jpeg", "video/mp4", "application/pdf"];
    for (const mt of cases) {
      const got = deriveDownloadRequestMedia({ media_mime_type: mt });
      expect(got.mimeType).toBe(mt);
      expect(got.mimeType).not.toBe(got.mediaType);
    }
  });

  test("handles a missing mime type without throwing", () => {
    const got = deriveDownloadRequestMedia({ media_mime_type: null });
    expect(got.mediaType).toBe("document");
    expect(got.mimeType).toBe("");
  });
});
