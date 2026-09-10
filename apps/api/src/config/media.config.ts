/**
 * Media handling policy shared by the request path and the background sweep.
 *
 * Kept out of the route module so services can import it without depending on
 * routes, which would invert the layering.
 */

/**
 * Maximum accepted media file size for `POST /media/upload`, in bytes (50 MiB).
 *
 * The authoritative file-size limit; enforced against `file.size` after the
 * multipart body is parsed. The route's pre-buffer `Content-Length` guard and
 * the server's `maxRequestBodySize` backstop (see MAX_UPLOAD_BODY_SIZE) exist
 * to refuse oversized bodies before they are buffered into memory.
 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Maximum accepted multipart body size for the media upload, in bytes.
 *
 * Hono's `parseBody()` buffers the entire multipart body into memory
 * (`request.arrayBuffer()` then `Response(arrayBuffer).formData()`) before
 * the handler can inspect `file.size`, so the post-buffer file-size check
 * alone cannot bound peak memory. The route therefore refuses any request
 * whose `Content-Length` exceeds this value before calling `parseBody()`,
 * and the server's `maxRequestBodySize` is set to the same value as a
 * backstop for a spoofed or absent Content-Length.
 *
 * The 1 MiB allowance over MAX_FILE_SIZE covers multipart boundaries, the
 * `file` part's Content-Disposition/Content-Type headers, and additional
 * form fields without any risk of false rejection near the 50 MiB file
 * boundary — the framing for a single `file` part is well under 1 KB.
 */
export const MAX_UPLOAD_BODY_SIZE = MAX_FILE_SIZE + 1024 * 1024;

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
