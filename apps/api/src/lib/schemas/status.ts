/**
 * Status validation schemas
 *
 * Schemas for WhatsApp status updates (stories).
 */
import { z } from "zod";
import { urlStringSchema } from "./string-contracts.js";

/**
 * Schema for posting a new status update
 */
export const postStatusSchema = z.object({
  type: z.enum(["text", "image", "video"], {
    error: (issue) =>
      issue.input === undefined
        ? "type is required"
        : "type must be 'text', 'image', or 'video'",
  }),
  content: z.string().optional(),
  mediaUrl: urlStringSchema.optional(),
}).refine(
  (data) => {
    // Text status requires content
    if (data.type === "text") {
      return !!data.content;
    }
    return true;
  },
  {
    message: "content is required for text status",
    path: ["content"],
  }
).refine(
  (data) => {
    // Image/video status requires mediaUrl
    if (data.type === "image" || data.type === "video") {
      return !!data.mediaUrl;
    }
    return true;
  },
  {
    message: "mediaUrl is required for image/video status",
    path: ["mediaUrl"],
  }
);

export type PostStatusInput = z.infer<typeof postStatusSchema>;
