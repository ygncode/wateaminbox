/**
 * Centralized validation schemas
 *
 * This module re-exports all validation schemas for routes.
 * Each domain has its own schema file for organization.
 *
 * Usage:
 * ```ts
 * import { createQuickReplySchema } from '../lib/schemas/index.js'
 * // or import directly:
 * import { createQuickReplySchema } from '../lib/schemas/quick-replies.js'
 * ```
 */

// Quick Replies
export {
  createQuickReplySchema,
  updateQuickReplySchema,
  listQuickRepliesQuerySchema,
  type CreateQuickReplyInput,
  type UpdateQuickReplyInput,
  type ListQuickRepliesQuery,
} from "./quick-replies.js";
