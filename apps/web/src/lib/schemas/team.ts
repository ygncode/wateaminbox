import { z } from "zod";

/**
 * Invite team member form validation schema
 */
export const inviteTeamMemberSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  role: z.enum(["admin", "member"], {
    errorMap: () => ({ message: "Please select a valid role" }),
  }),
});

export type InviteTeamMemberFormData = z.infer<typeof inviteTeamMemberSchema>;
