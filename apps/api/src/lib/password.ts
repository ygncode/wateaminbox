import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

/**
 * Hash a plain text password using bcrypt
 * @param password - The plain text password to hash
 * @returns The hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a plain text password against a hash
 * @param password - The plain text password to verify
 * @param hash - The hash to verify against
 * @returns True if the password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Validate password strength
 * @param password - The password to validate
 * @returns Object with isValid boolean and optional error message
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  message?: string;
} {
  if (password.length < 8) {
    return {
      isValid: false,
      message: "Password must be at least 8 characters long",
    };
  }

  if (password.length > 128) {
    return {
      isValid: false,
      message: "Password must be at most 128 characters long",
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      message: "Password must contain at least one lowercase letter",
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      message: "Password must contain at least one uppercase letter",
    };
  }

  if (!/\d/.test(password)) {
    return {
      isValid: false,
      message: "Password must contain at least one number",
    };
  }

  return { isValid: true };
}
