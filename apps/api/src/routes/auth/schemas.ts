import { z } from "zod";
import {
  emailSchema,
  passwordSchema,
  tokenSchema,
  optionalNameSchema,
} from "../../lib/schemas.js";

/**
 * Auth route validation schemas
 * Composes from atomic schemas in lib/schemas.ts for consistency
 */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: optionalNameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
  deviceInfo: z
    .object({
      deviceName: z.string().optional(),
      deviceType: z.string().optional(),
    })
    .optional(),
});

export const verifyEmailSchema = z.object({
  token: tokenSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  token: tokenSchema,
  password: passwordSchema,
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});
