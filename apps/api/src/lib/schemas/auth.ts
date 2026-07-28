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
// Account settings
// =============================================================================

const MAX_PROCESSED_AVATAR_BYTES = 512 * 1024;
const MAX_AVATAR_DATA_URL_LENGTH =
  Math.ceil((MAX_PROCESSED_AVATAR_BYTES * 4) / 3) + 64;
const avatarDataUrlPattern =
  /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const avatarDataUrlSchema = z
  .string()
  .max(
    MAX_AVATAR_DATA_URL_LENGTH,
    "Processed profile image must be smaller than 512 KB",
  )
  .refine(
    (value) => avatarDataUrlPattern.test(value),
    "Profile image must be a valid PNG, JPEG, or WebP image",
  )
  .refine((value) => {
    const base64 = value.split(",", 2)[1];
    return (
      Boolean(base64) &&
      Buffer.byteLength(base64, "base64") <= MAX_PROCESSED_AVATAR_BYTES
    );
  }, "Processed profile image must be smaller than 512 KB");

export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name must be less than 100 characters")
      .optional(),
    email: z
      .string()
      .trim()
      .email("Invalid email address")
      .transform((value) => value.toLowerCase())
      .optional(),
    currentPassword: z.string().min(1).max(128).optional(),
    avatarDataUrl: avatarDataUrlSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.email !== undefined ||
      value.avatarDataUrl !== undefined,
    "No profile changes were provided",
  );

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "New password must be different from your current password",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// =============================================================================
// Token Refresh
// =============================================================================

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
