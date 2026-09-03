/**
 * Naming and typing for media downloads.
 *
 * WhatsApp documents reach us with their original filename, but the object in
 * storage is keyed by a UUID and, when the sender's client omits a MIME type,
 * stored as `application/octet-stream` under a `.bin` key. Handing that object
 * straight to the browser makes it save `<uuid>.bin`, which Excel and Word then
 * refuse to open ("the file format or extension is not valid") even though the
 * bytes are intact. These helpers rebuild the name and type at signing time.
 */

/** Extension -> MIME, for the types whose extension the OS actually keys off. */
const EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  rtf: "application/rtf",
  zip: "application/zip",
  rar: "application/vnd.rar",
  json: "application/json",
  xml: "application/xml",
};

/** Stored types that tell us nothing and should defer to the extension. */
const UNINFORMATIVE_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/unknown",
]);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * The MIME type to serve a download as.
 *
 * The sender's declared type wins when it says something; an
 * `application/octet-stream` document is upgraded from its extension so the
 * browser and the OS agree on what was downloaded.
 */
export function resolveDownloadContentType(
  fileName: string | null | undefined,
  storedMimeType: string | null | undefined,
): string {
  const stored = (storedMimeType ?? "").trim().toLowerCase();
  if (!UNINFORMATIVE_MIME_TYPES.has(stored)) return stored;

  const fromExtension = EXTENSION_MIME_TYPES[extensionOf(fileName ?? "")];
  return fromExtension ?? "application/octet-stream";
}

/**
 * The extension a download should carry, given the name we have and the type
 * the sender declared. Returns "" when nothing reliable is known.
 */
function extensionForDownload(
  fileName: string | null | undefined,
  storedMimeType: string | null | undefined,
): string {
  const fromName = extensionOf(fileName ?? "");
  if (fromName) return fromName;

  const stored = (storedMimeType ?? "").trim().toLowerCase();
  for (const [extension, mimeType] of Object.entries(EXTENSION_MIME_TYPES)) {
    if (mimeType === stored) return extension;
  }
  return "";
}

/**
 * The filename to offer, always carrying an extension when one can be
 * determined. `fallbackStem` is used when the sender supplied no name at all.
 */
export function resolveDownloadFileName(
  fileName: string | null | undefined,
  storedMimeType: string | null | undefined,
  fallbackStem = "document",
): string {
  // A name can arrive with path separators or control characters from a
  // foreign filesystem; only the final component is ever meaningful to us.
  const raw = (fileName ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[/\\]/)
    .pop()
    ?.trim();

  const extension = extensionForDownload(raw, storedMimeType);

  if (!raw || raw === "." || raw === "..") {
    return extension ? `${fallbackStem}.${extension}` : fallbackStem;
  }
  if (extension && extensionOf(raw) !== extension) {
    return `${raw}.${extension}`;
  }
  return raw;
}

/**
 * Build a `Content-Disposition` value that survives non-Latin names.
 *
 * Both forms are emitted per RFC 6266: a quoted ASCII `filename` that older
 * clients understand, and the percent-encoded `filename*` that carries the real
 * name. Without the ASCII fallback, a Thai or Burmese filename would leave some
 * clients with no usable name - and therefore no extension - at all.
 */
export function buildContentDisposition(
  fileName: string,
  type: "attachment" | "inline" = "attachment",
): string {
  const ascii =
    fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  const encoded = encodeURIComponent(fileName);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Last-resort filename recovered from the storage key.
 *
 * Messages received before the filename was persisted have nothing else left,
 * but both upload paths embed a sanitized copy of the original name in the key
 * behind a uniquifying prefix - `<8-hex>-name.xlsx` from the worker, and
 * `<epoch-ms>_<random>_name.xlsx` from the API. Stripping the prefix gives the
 * operator back a recognizable name instead of `document.xlsx`.
 */
export function fileNameFromMediaKey(
  mediaReference: string | null | undefined,
): string | null {
  const rawSegment = (mediaReference ?? "").split("?")[0]?.split("/").pop();
  if (!rawSegment) return null;

  // The same key reaches us both as a raw `s3://` reference and as the path of
  // an already-signed URL, where it is percent-encoded.
  let segment = rawSegment;
  try {
    segment = decodeURIComponent(rawSegment);
  } catch {
    // Malformed escapes: keep the literal segment rather than losing the name.
  }

  const stripped = segment
    .replace(/^[0-9a-f]{8}-/i, "")
    .replace(/^\d{10,}_[a-z0-9]+_/i, "");

  // A key with no embedded name is just a UUID; that is not worth offering.
  if (!stripped || !stripped.includes(".")) return null;
  if (/^[0-9a-f-]{16,}\.[a-z0-9]+$/i.test(stripped)) return null;
  return stripped;
}
