import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nowMs } from "@wateaminbox/shared";
import { env } from "./env.js";

// S3 client configuration
const s3Client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION || "us-east-1",
  credentials:
    env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? {
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
        }
      : undefined,
  forcePathStyle: true, // Required for MinIO
});

const BUCKET = env.S3_BUCKET;

/**
 * Get file extension from MIME type
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/mpeg": "mpeg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/zip": "zip",
    "application/x-rar-compressed": "rar",
    "text/plain": "txt",
  };

  return mimeMap[mimeType] || "bin";
}

/**
 * Generate unique media key for S3
 */
function generateMediaKey(
  companyId: string,
  extension: string,
  filename?: string,
): string {
  const timestamp = nowMs();
  const random = Math.random().toString(36).substring(2, 15);

  if (filename) {
    // Strict validation: reject path traversal attempts
    if (
      filename.includes("..") ||
      filename.includes("/") ||
      filename.includes("\\") ||
      filename.includes("\0")
    ) {
      throw new Error("Invalid filename: path traversal detected");
    }

    // Sanitize filename
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `media/${companyId}/${timestamp}_${random}_${sanitized}`;
  }

  return `media/${companyId}/${timestamp}_${random}.${extension}`;
}

/**
 * Upload media to the private bucket. The URL is short-lived and intended only
 * for the uploading user's immediate preview; `reference` is the stable,
 * non-downloadable value that may be persisted internally.
 */
export async function uploadMedia(
  data: Buffer | Uint8Array,
  mimeType: string,
  companyId: string,
  filename?: string,
): Promise<{
  key: string;
  reference: string;
  url: string;
  data: Buffer | Uint8Array;
}> {
  const ext = getExtensionFromMimeType(mimeType);
  const key = generateMediaKey(companyId, ext, filename);

  // Sanitize filename for Content-Disposition header
  const safeFilename = filename
    ? filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    : `file.${ext}`;

  const checksum = createHash("sha256").update(data).digest("hex");
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: data,
    ContentType: mimeType,
    ContentLength: data.length,
    ContentDisposition: `inline; filename="${safeFilename}"`,
    Metadata: {
      sha256: checksum,
      original_filename: safeFilename,
      tenant_id: companyId,
    },
  });

  await s3Client.send(command);

  // Generate a short-lived URL for the uploader's local preview. Persist the
  // stable private reference instead whenever the caller controls the schema.
  const presignedUrl = await getPresignedUrl(key, 15 * 60);

  return {
    key,
    reference: getPrivateMediaReference(key),
    url: presignedUrl,
    data,
  };
}

/** Delete an object previously written to the private media bucket. */
export async function deleteMedia(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
}

/** Generate a short-lived URL for private media access. */
export async function getPresignedUrl(
  key: string,
  expiresIn: number = 5 * 60,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

export interface MediaObjectReference {
  key: string;
  mimeType: string;
  filename: string;
  size: number;
  checksum?: string;
}

function encodeObjectKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Stable internal reference. It is deliberately not an HTTP download URL. */
export function getPrivateMediaReference(key: string): string {
  return `s3://${BUCKET}/${encodeObjectKey(key)}`;
}

/**
 * Resolve a private reference or API-issued path-style URL and enforce tenant
 * ownership. URL signatures are not used as object identity because scheduled
 * sends must remain valid after an uploader preview URL expires.
 */
export function resolveMediaKeyForCompany(
  mediaUrl: string,
  companyId: string,
): string {
  const url = new URL(mediaUrl);
  let encodedKey: string;

  if (url.protocol === "s3:") {
    if (url.hostname !== BUCKET || url.username || url.password || url.port) {
      throw new Error("Media reference does not use the configured bucket");
    }
    encodedKey = url.pathname.replace(/^\/+/, "");
  } else {
    const endpoint = new URL(env.S3_ENDPOINT);
    if (url.origin !== endpoint.origin) {
      throw new Error("Media URL is not from configured object storage");
    }
    const endpointPath = endpoint.pathname.replace(/\/$/, "");
    const bucketPrefix = `${endpointPath}/${encodeURIComponent(BUCKET)}/`;
    if (!url.pathname.startsWith(bucketPrefix)) {
      throw new Error("Media URL does not reference the media bucket");
    }
    encodedKey = url.pathname.slice(bucketPrefix.length);
  }

  let key: string;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    throw new Error("Media object key has invalid encoding");
  }
  const tenantPrefix = `media/${companyId}/`;
  if (
    !key.startsWith(tenantPrefix) ||
    key.length <= tenantPrefix.length ||
    key.includes("..") ||
    key.includes("\\") ||
    /[\0-\x1f\x7f]/.test(key)
  ) {
    throw new Error("Media object does not belong to the active tenant");
  }
  return key;
}

/** Resolve and authorize an internally persisted media reference. */
export async function getMediaObjectReference(
  mediaUrl: string,
  companyId: string,
): Promise<MediaObjectReference> {
  const key = resolveMediaKeyForCompany(mediaUrl, companyId);

  const object = await s3Client.send(
    new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
  );
  if (object.Metadata?.tenant_id && object.Metadata.tenant_id !== companyId) {
    throw new Error("Media object metadata belongs to another tenant");
  }
  const size = object.ContentLength ?? 0;
  if (size <= 0 || size > 50 * 1024 * 1024) {
    throw new Error("Media object size is outside the supported limit");
  }
  const dispositionName = object.ContentDisposition?.match(
    /filename="?([^";]+)"?/i,
  )?.[1];
  return {
    key,
    mimeType: object.ContentType || "application/octet-stream",
    filename:
      object.Metadata?.original_filename ||
      dispositionName ||
      key.split("/").pop() ||
      "file",
    size,
    checksum: object.Metadata?.sha256,
  };
}

/** Issue a fresh URL only after the caller has authorized the parent resource. */
export async function getAuthorizedMediaUrl(
  mediaReference: string | null | undefined,
  companyId: string,
  expiresIn: number = 5 * 60,
): Promise<string | null> {
  if (!mediaReference) return null;
  const key = resolveMediaKeyForCompany(mediaReference, companyId);
  return getPresignedUrl(key, expiresIn);
}

/** Never echo an invalid persisted reference into an authorized API response. */
export async function getAuthorizedMediaUrlOrNull(
  mediaReference: string | null | undefined,
  companyId: string,
): Promise<string | null> {
  try {
    return await getAuthorizedMediaUrl(mediaReference, companyId);
  } catch {
    return null;
  }
}

/**
 * Download media from URL
 */
export async function downloadMediaFromUrl(url: string): Promise<{
  data: Buffer;
  mimeType: string;
}> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.statusText}`);
  }

  const mimeType =
    response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const data = Buffer.from(arrayBuffer);

  return { data, mimeType };
}
