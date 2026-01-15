/**
 * Group validation schemas
 *
 * Schemas for group-related API endpoints.
 */
import { z } from "zod";

/**
 * Query params for listing groups
 */
export const listGroupsQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;

/**
 * Update group custom name
 */
export const updateGroupSchema = z.object({
  customName: z.string().min(1).max(200).optional(),
});

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

/**
 * Update group settings (name, description)
 */
export const updateGroupSettingsSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2048).optional(),
});

export type UpdateGroupSettingsInput = z.infer<
  typeof updateGroupSettingsSchema
>;
