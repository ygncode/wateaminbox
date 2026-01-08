import { z } from "zod";

/**
 * Shared validation schemas for common data types
 * Centralizes validation logic to ensure consistency across routes and services
 */

// =============================================================================
// Common Field Schemas
// =============================================================================

/**
 * Email validation schema
 * Uses standard email format validation
 */
export const emailSchema = z.string().email("Invalid email address");

/**
 * Password validation schema
 * Minimum 8 characters, maximum 128 characters
 * Note: Additional strength validation is done via validatePasswordStrength()
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

/**
 * Token validation schema (for verification, reset tokens, etc.)
 */
export const tokenSchema = z.string().min(1, "Token is required");

/**
 * UUID validation schema
 */
export const uuidSchema = z.string().uuid("Invalid UUID format");

/**
 * Name validation schema (optional, max 255 characters)
 */
export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(255, "Name must be at most 255 characters");

/**
 * Optional name schema
 */
export const optionalNameSchema = nameSchema.optional();

// =============================================================================
// Phone Number Utilities
// =============================================================================

/**
 * Phone number validation result
 */
export interface PhoneValidationResult {
  /** Whether the phone number is valid */
  isValid: boolean;
  /** Cleaned phone number (digits only) */
  cleanedPhone: string;
  /** WhatsApp JID format */
  jid: string;
  /** Error message if invalid */
  error?: string;
}

/**
 * Normalize and validate a phone number
 *
 * This function:
 * 1. Strips all non-digit characters (except +)
 * 2. Removes leading + or 00
 * 3. Validates length (6-15 digits)
 * 4. Returns the normalized phone number and JID
 *
 * @param phone - Phone number in any format
 * @returns Validation result with cleaned phone number and JID
 *
 * @example
 * ```ts
 * normalizePhoneNumber('+1 (234) 567-8900')
 * // => { isValid: true, cleanedPhone: '12345678900', jid: '12345678900@s.whatsapp.net' }
 *
 * normalizePhoneNumber('123')
 * // => { isValid: false, cleanedPhone: '123', jid: '', error: 'Invalid phone number...' }
 * ```
 */
export function normalizePhoneNumber(phone: string): PhoneValidationResult {
  // Remove all non-digit characters except +
  let cleaned = phone.replace(/[^\d+]/g, "");

  // Remove leading + if present
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.substring(1);
  }

  // Remove leading zeros (some formats use 00 for international)
  if (cleaned.startsWith("00")) {
    cleaned = cleaned.substring(2);
  }

  // Validate length
  if (cleaned.length < 6 || cleaned.length > 15) {
    return {
      isValid: false,
      cleanedPhone: cleaned,
      jid: "",
      error: "Invalid phone number. Must be between 6 and 15 digits.",
    };
  }

  return {
    isValid: true,
    cleanedPhone: cleaned,
    jid: `${cleaned}@s.whatsapp.net`,
  };
}

/**
 * Zod schema for phone number with normalization
 * Transforms and validates phone numbers in a single step
 *
 * @example
 * ```ts
 * const result = phoneNumberSchema.safeParse('+1 (234) 567-8900')
 * // => { success: true, data: { cleanedPhone: '12345678900', jid: '12345678900@s.whatsapp.net' } }
 * ```
 */
export const phoneNumberSchema = z.string().transform((val, ctx) => {
  const result = normalizePhoneNumber(val);
  if (!result.isValid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.error || "Invalid phone number",
    });
    return z.NEVER;
  }
  return result;
});

// =============================================================================
// Message Content Schemas
// =============================================================================

/**
 * Message content schema for text messages
 */
export const messageContentSchema = z
  .string()
  .min(1, "Message content is required");

/**
 * Message type schema
 */
export const messageTypeSchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "document",
  "sticker",
  "location",
  "contact",
  "reaction",
]);

// =============================================================================
// Pagination Schemas
// =============================================================================

/**
 * Common pagination query parameters
 */
export const paginationSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50))
    .pipe(z.number().min(1).max(100)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .pipe(z.number().min(0)),
});

// =============================================================================
// Re-export types for convenience
// =============================================================================

export type Email = z.infer<typeof emailSchema>;
export type Password = z.infer<typeof passwordSchema>;
export type MessageType = z.infer<typeof messageTypeSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
