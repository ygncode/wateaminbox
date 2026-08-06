/**
 * Media handling policy shared by the request path and the background sweep.
 *
 * Kept out of the route module so services can import it without depending on
 * routes, which would invert the layering.
 */

/**
 * How long one on-demand media download may stay claimed before another
 * request may retry it.
 *
 * Sized well above a normal worker round-trip so a healthy download is never
 * duplicated, and far below "forever" so a worker that dies mid-download
 * cannot strand the media permanently. The download route reclaims an expired
 * lease on demand; `releaseStrandedMediaDownloads` returns it to "pending" in
 * the background so the client is offered a retry even if nobody asks again.
 */
export const MEDIA_DOWNLOAD_LEASE_MS = 5 * 60_000;
