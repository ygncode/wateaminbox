import { z } from "zod";

/**
 * Add WhatsApp connection form validation schema
 * Connection name is optional but has length limits
 */
export const addConnectionSchema = z.object({
  name: z
    .string()
    .max(100, "Connection name must be less than 100 characters")
    .optional()
    .transform((val) => val?.trim() || undefined),
});

export type AddConnectionFormData = z.infer<typeof addConnectionSchema>;
