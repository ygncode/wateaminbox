import { z } from "zod";
import {
  emailSchema,
  passwordSchema,
  tokenSchema,
  optionalNameSchema,
} from "../schemas.js";

/**
 * Auth route validation schemas
 * Composes from atomic schemas in lib/schemas.ts for consistency
 */

// =============================================================================
// Registration
// =============================================================================

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: optionalNameSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

// =============================================================================
// Login
// =============================================================================

export const deviceInfoSchema = z.object({
  deviceName: z.string().optional(),
  deviceType: z.string().optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
  deviceInfo: deviceInfoSchema.optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

// =============================================================================
// Email Verification
// =============================================================================

export const verifyEmailSchema = z.object({
  token: tokenSchema,
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

// =============================================================================
// Password Reset
// =============================================================================

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// =============================================================================
// Token Refresh
// =============================================================================

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
