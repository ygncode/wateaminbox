import { Hono } from "hono";
import {
  badRequest,
  notFound,
  serverError,
  serviceUnavailable,
} from "../lib/errors.js";
import { createLogger, formatError } from "../lib/logger.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { successData } from "../lib/response.js";
import { uploadMedia } from "../lib/storage.js";
import { authMiddleware } from "../middleware/auth.js";
import { getRouteContext } from "../middleware/context.js";
import { createConditionalRateLimiter } from "../middleware/rate-limit.js";
import { tenantMiddleware } from "../middleware/tenant.js";

const logger = createLogger("MediaRoutes");

export const mediaRoutes = new Hono();

// All media routes require authentication and tenant context
mediaRoutes.use("/*", authMiddleware);
mediaRoutes.use("/*", tenantMiddleware());

// Upload rate limiter: 30 uploads per minute per user
const uploadRateLimiter = createConditionalRateLimiter(
  {
    store: rateLimitStore,
    tier: rateLimitConfig.tiers.resource.import, // Reuse import tier config
    keyStrategy: "user",
    keyPrefix: "media-upload",
  },
  rateLimitConfig.enabled,
);

/**
 * POST /media/upload - Upload media file
 * Multipart form upload with file field
 */
/**
 * POST /media/download/:messageId - Request on-demand media download
 * Triggers download for deferred media from history sync
 */
mediaRoutes.post("/download/:messageId", async (c) => {
  const { companyId, tenantDb } = getRouteContext(c);
  const { messageId } = c.req.param();

  try {
    const { getJetStreamClient } = await import("../lib/nats/index.js");
    const { JSONCodec } = await import("nats");

    // Get the message with media reference data
    const message = await tenantDb
      .selectFrom("messages")
      .select([
        "id",
        "contact_id",
        "whatsapp_connection_id",
        "media_url",
        "media_direct_path",
        "media_key",
        "media_file_sha256",
        "media_file_enc_sha256",
        "media_download_status",
        "media_mime_type",
      ])
      .where("id", "=", messageId)
      .executeTakeFirst();

    if (!message) {
      return notFound(c, "Message");
    }

    // If already downloaded, return existing URL
    if (message.media_url && message.media_download_status === "completed") {
      return successData(c, {
        status: "completed",
        mediaUrl: message.media_url,
      });
    }

    // If no media reference data, cannot download
    if (!message.media_direct_path || !message.media_key) {
      return badRequest(c, "No media reference available for this message");
    }

    // If already downloading, return status
    if (message.media_download_status === "downloading") {
      return successData(c, { status: "downloading" });
    }

    // Get the WhatsApp connection for this message
    const connection = await tenantDb
      .selectFrom("whatsapp_connections")
      .select(["id", "status"])
      .where("id", "=", message.whatsapp_connection_id)
      .executeTakeFirst();

    if (!connection || connection.status !== "connected") {
      return serviceUnavailable(c, "WhatsApp connection not available");
    }

    // Mark as downloading
    await tenantDb
      .updateTable("messages")
      .set({ media_download_status: "downloading" })
      .where("id", "=", messageId)
      .execute();

    // Determine media type from mime type
    const mimeType = message.media_mime_type || "";
    let mediaType = "document";
    if (mimeType.startsWith("image/")) mediaType = "image";
    else if (mimeType.startsWith("video/")) mediaType = "video";
    else if (mimeType.startsWith("audio/")) mediaType = "audio";

    // Publish download request to NATS JetStream
    const js = await getJetStreamClient();
    const jc = JSONCodec();

    const downloadRequest = {
      messageId: messageId,
      directPath: message.media_direct_path,
      mediaKey: message.media_key.toString("base64"),
      fileSha256: message.media_file_sha256?.toString("base64") || "",
      fileEncSha256: message.media_file_enc_sha256?.toString("base64") || "",
      mediaType: mediaType,
    };

    const subject = `WHATSAPP.download.${companyId}.${connection.id}.request`;
    await js.publish(subject, jc.encode(downloadRequest));

    logger.info(
      { messageId, companyId, connectionId: connection.id },
      "Published download request",
    );

    return successData(c, { status: "downloading" });
  } catch (error) {
    logger.error(
      { err: formatError(error) },
      "Failed to request media download",
    );
    return serverError(c, "Failed to request media download");
  }
});

mediaRoutes.post("/upload", uploadRateLimiter, async (c) => {
  const { companyId } = getRouteContext(c);

  // Parse multipart form data
  const body = await c.req.parseBody();
  const file = body.file;

  if (!file || !(file instanceof File)) {
    return badRequest(c, "No file provided");
  }

  // Validate file size (max 50MB)
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_FILE_SIZE) {
    return badRequest(c, "File too large. Maximum size is 50MB");
  }

  // Validate file type
  const allowedTypes = [
    // Images
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    // Videos
    "video/mp4",
    "video/quicktime",
    "video/mpeg",
    // Audio
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    // Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
    "application/x-rar-compressed",
    "text/plain",
  ];

  if (!allowedTypes.includes(file.type)) {
    return badRequest(
      c,
      `Unsupported file type: ${file.type}. Allowed types: images, videos, audio, PDF, Office documents, ZIP, TXT`,
    );
  }

  try {
    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to S3 (returns presigned URL + key + data)
    const uploadResult = await uploadMedia(
      buffer,
      file.type,
      companyId,
      file.name,
    );

    return successData(c, {
      mediaUrl: uploadResult.url, // Presigned URL for frontend
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      key: uploadResult.key, // S3 key for backend reference
    });
  } catch (error) {
    logger.error({ err: formatError(error) }, "Failed to upload media");

    // Check for specific error types
    if (error instanceof Error) {
      if (error.message.includes("path traversal")) {
        return badRequest(c, "Invalid filename");
      }
    }

    return serverError(c, "Failed to upload media");
  }
});
