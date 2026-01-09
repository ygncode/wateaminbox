import { z } from "zod";

/**
 * Schema for creating a new company
 */
export const createCompanySchema = z.object({
  name: z
    .string()
    .min(1, "Company name is required")
    .max(255, "Company name must be less than 255 characters")
    .trim(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/**
 * Schema for updating a company
 */
export const updateCompanySchema = z.object({
  name: z
    .string()
    .min(1, "Company name is required")
    .max(255, "Company name must be less than 255 characters")
    .trim()
    .optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

/**
 * Schema for updating member role
 */
export const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Schema for inviting a member
 */
export const inviteMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "member"]).default("member"),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/**
 * Schema for updating member permissions
 */
export const updateMemberPermissionsSchema = z.object({
  can_view_all_chats: z.boolean().optional(),
  can_send_messages: z.boolean().optional(),
  can_assign_contacts: z.boolean().optional(),
  can_manage_team: z.boolean().optional(),
  can_invite: z.boolean().optional(),
  can_export: z.boolean().optional(),
  can_delete: z.boolean().optional(),
});

export type UpdateMemberPermissionsInput = z.infer<typeof updateMemberPermissionsSchema>;
