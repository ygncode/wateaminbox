import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env.js";

// S3 client configuration
const s3Client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION || "us-east-1",
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
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
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "xlsx",
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
  const timestamp = Date.now();
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
 * Upload media to S3 and return S3 key and presigned URL
 */
export async function uploadMedia(
  data: Buffer | Uint8Array,
  mimeType: string,
  companyId: string,
  filename?: string,
): Promise<{ key: string; url: string; data: Buffer | Uint8Array }> {
  const ext = getExtensionFromMimeType(mimeType);
  const key = generateMediaKey(companyId, ext, filename);

  // Sanitize filename for Content-Disposition header
  const safeFilename = filename
    ? filename.replace(/[^a-zA-Z0-9._-]/g, "_")
    : `file.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: data,
    ContentType: mimeType,
    ContentLength: data.length,
    ContentDisposition: `inline; filename="${safeFilename}"`,
  });

  await s3Client.send(command);

  // Generate presigned URL (1 hour expiry for frontend display)
  const presignedUrl = await getPresignedUrl(key, 3600);

  // Return key, presigned URL, and original data (for NATS sending optimization)
  return { key, url: presignedUrl, data };
}

/**
 * Generate presigned URL for private media access (optional, for future use)
 */
export async function getPresignedUrl(
  key: string,
  expiresIn: number = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
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

  const mimeType = response.headers.get("content-type") || "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();
  const data = Buffer.from(arrayBuffer);

  return { data, mimeType };
}
