import { z } from "zod";

/**
 * API token route validation schemas
 */

export const apiTokenScopeSchema = z.enum(["read", "write"]);

export const createApiTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Token name is required")
    .max(100, "Token name must be at most 100 characters"),
  scopes: z
    .array(apiTokenScopeSchema)
    .min(1, "At least one scope is required")
    .max(2)
    .refine((scopes) => new Set(scopes).size === scopes.length, {
      message: "Scopes must be unique",
    })
    .refine((scopes) => scopes.includes("read"), {
      message: "All tokens must include the read scope",
    }),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .refine((value) => !value || new Date(value).getTime() > Date.now(), {
      message: "Expiry must be in the future",
    }),
});

export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

export const apiTokenIdParamSchema = z.object({
  id: z.string().uuid("API token id must be a valid UUID"),
});

export const listApiTokensQuerySchema = z.object({
  all: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

export type ListApiTokensQuery = z.infer<typeof listApiTokensQuerySchema>;
