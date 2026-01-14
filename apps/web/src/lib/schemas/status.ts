import { z } from "zod";

/**
 * Status type values
 */
export const statusTypeValues = ["text", "image", "video"] as const;

/**
 * Post status form validation schema
 * Uses superRefine for conditional validation based on status type
 */
export const postStatusSchema = z
  .object({
    type: z.enum(statusTypeValues, {
      errorMap: () => ({ message: "Please select a status type" }),
    }),
    content: z
      .string()
      .max(700, "Content must be less than 700 characters")
      .optional(),
    mediaUrl: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // For text status, content is required
    if (data.type === "text") {
      if (!data.content || !data.content.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please enter some text for your status",
          path: ["content"],
        });
      }
    }

    // For image/video status, mediaUrl is required
    if (data.type === "image" || data.type === "video") {
      if (!data.mediaUrl || !data.mediaUrl.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Please provide a URL for your ${data.type}`,
          path: ["mediaUrl"],
        });
      } else {
        // Validate URL format
        try {
          new URL(data.mediaUrl);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Please enter a valid URL",
            path: ["mediaUrl"],
          });
        }
      }
    }
  });

export type PostStatusFormData = z.infer<typeof postStatusSchema>;
export type StatusType = (typeof statusTypeValues)[number];
