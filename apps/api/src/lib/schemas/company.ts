import { z } from "zod";

const MAX_PROCESSED_LOGO_BYTES = 512 * 1024;
const MAX_LOGO_DATA_URL_LENGTH =
  Math.ceil((MAX_PROCESSED_LOGO_BYTES * 4) / 3) + 64;
const logoDataUrlPattern =
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const optionalDescription = z
  .string()
  .trim()
  .max(280, "Description must be less than 280 characters")
  .optional();

const workspaceLogoDataUrl = z
  .string()
  .max(MAX_LOGO_DATA_URL_LENGTH, "Processed logo must be smaller than 512 KB")
  .refine(
    (value) => logoDataUrlPattern.test(value),
    "Logo must be a valid PNG, JPEG, or WebP image",
  )
  .refine((value) => {
    const base64 = value.split(",", 2)[1];
    return (
      Boolean(base64) &&
      Buffer.byteLength(base64, "base64") <= MAX_PROCESSED_LOGO_BYTES
    );
  }, "Processed logo must be smaller than 512 KB");

/**
 * Schema for creating a new company
 */
export const createCompanySchema = z.object({
  name: z
    .string()
    .min(1, "Company name is required")
    .max(255, "Company name must be less than 255 characters")
    .trim(),
  description: optionalDescription,
  logoDataUrl: workspaceLogoDataUrl.optional(),
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
  description: optionalDescription,
  logoDataUrl: workspaceLogoDataUrl.nullable().optional(),
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
  can_manage_connections: z.boolean().optional(),
  can_view_dashboard: z.boolean().optional(),
  can_view_audit: z.boolean().optional(),
  can_export: z.boolean().optional(),
  can_delete: z.boolean().optional(),
});

export type UpdateMemberPermissionsInput = z.infer<
  typeof updateMemberPermissionsSchema
>;
