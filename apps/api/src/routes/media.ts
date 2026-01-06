import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { uploadMedia } from "../lib/storage.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { rateLimitConfig, rateLimitStore } from "../lib/rate-limit-store.js";
import { createLogger, formatError } from "../lib/logger.js";

const logger = createLogger("MediaRoutes");

export const mediaRoutes = new Hono();

// All media routes require authentication and tenant context
mediaRoutes.use("/*", authMiddleware);
mediaRoutes.use("/*", tenantMiddleware());

// Upload rate limiter: 30 uploads per minute per user
const uploadRateLimiter: MiddlewareHandler = rateLimitConfig.enabled
  ? createRateLimitMiddleware({
      store: rateLimitStore,
      tier: rateLimitConfig.tiers.resource.import, // Reuse import tier config
      keyStrategy: "user",
      keyPrefix: "media-upload",
    })
  : async (_c, next) => await next();

/**
 * POST /media/upload - Upload media file
 * Multipart form upload with file field
 */
mediaRoutes.post("/upload", uploadRateLimiter, async (c) => {
  const companyId = c.get("companyId");

  // Parse multipart form data
  const body = await c.req.parseBody();
  const file = body.file;

  if (!file || !(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }

  // Validate file size (max 50MB)
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: "File too large. Maximum size is 50MB" }, 400);
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
    return c.json(
      {
        error: `Unsupported file type: ${file.type}. Allowed types: images, videos, audio, PDF, Office documents, ZIP, TXT`,
      },
      400,
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

    return c.json({
      success: true,
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
        return c.json({ error: "Invalid filename" }, 400);
      }
    }

    return c.json({ error: "Failed to upload media" }, 500);
  }
});
