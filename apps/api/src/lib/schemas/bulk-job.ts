import { z } from "zod";
import { paginationSchema, uuidSchema } from "../schemas.js";
import { SCHEDULABLE_MEDIA_TYPES } from "./message.js";

/**
 * Bulk broadcast job validation schemas.
 *
 * The audience is a definition (tags/contacts/optional connection filter),
 * not a recipient list — resolution happens server-side so the client can
 * never smuggle recipients past eligibility checks. Cross-field rules that
 * must match the single-message endpoints (content/media pairing, lead time)
 * live in the route, mirroring scheduleMessageSchema's split.
 */

/** Bounded well below the HTTP body limit; the effective cap is bulkConfig. */
const MAX_AUDIENCE_TAGS = 50;
const MAX_AUDIENCE_CONTACTS = 500;

export const bulkAudienceSchema = z
  .object({
    tagIds: z.array(uuidSchema).max(MAX_AUDIENCE_TAGS).default([]),
    contactIds: z.array(uuidSchema).max(MAX_AUDIENCE_CONTACTS).default([]),
    connectionId: uuidSchema.optional(),
  })
  .refine((a) => a.tagIds.length > 0 || a.contactIds.length > 0, {
    message: "Audience requires at least one tag or contact",
  });

export const previewBulkJobSchema = z.object({
  audience: bulkAudienceSchema,
  content: z.string().max(65_536).optional(),
});

export const createBulkJobSchema = z.object({
  name: z.string().trim().min(1).max(200),
  audience: bulkAudienceSchema,
  content: z.string().max(65_536).optional(),
  messageType: z.enum(["text", ...SCHEDULABLE_MEDIA_TYPES]).default("text"),
  mediaUrl: z.string().url().optional(),
  scheduledAt: z.string().datetime({ offset: true }),
  /** From the preview; creation re-resolves and rejects on drift. */
  audienceHash: z.string().min(1).max(128),
  /** Client-generated key making create retries return the original job. */
  idempotencyKey: z.string().min(8).max(128),
});

export const listBulkJobsQuerySchema = paginationSchema;

export const listBulkJobRecipientsQuerySchema = paginationSchema.extend({
  status: z
    .enum(["scheduled", "processing", "sent", "failed", "canceled", "skipped"])
    .optional(),
});

export type BulkAudienceInput = z.infer<typeof bulkAudienceSchema>;
export type PreviewBulkJobInput = z.infer<typeof previewBulkJobSchema>;
export type CreateBulkJobInput = z.infer<typeof createBulkJobSchema>;
export type ListBulkJobsQuery = z.infer<typeof listBulkJobsQuerySchema>;
export type ListBulkJobRecipientsQuery = z.infer<
  typeof listBulkJobRecipientsQuerySchema
>;
