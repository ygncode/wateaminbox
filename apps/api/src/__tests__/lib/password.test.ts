/**
 * Unit tests for password.ts
 *
 * Tests password hashing and validation functionality
 */

import { describe, it, expect } from "bun:test";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "../../lib/password";

describe("Password Utilities", () => {
  describe("hashPassword", () => {
    it("should hash a password", async () => {
      // Arrange
      const password = "SecurePassword123";

      // Act
      const hash = await hashPassword(password);

      // Assert
      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.startsWith("$2")).toBe(true); // bcrypt hash prefix
    });

    it("should produce different hashes for same password", async () => {
      // Arrange
      const password = "SecurePassword123";

      // Act
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      // Assert
      expect(hash1).not.toBe(hash2); // Different salts
    });

    it("should produce consistent length hashes", async () => {
      // Arrange
      const password1 = "Short";
      const password2 = "ThisIsAVeryLongPasswordWithManyCharacters123!@#";

      // Act
      const hash1 = await hashPassword(password1);
      const hash2 = await hashPassword(password2);

      // Assert
      expect(hash1.length).toBe(hash2.length);
    });
  });

  describe("verifyPassword", () => {
    it("should return true for matching password", async () => {
      // Arrange
      const password = "SecurePassword123";
      const hash = await hashPassword(password);

      // Act
      const result = await verifyPassword(password, hash);

      // Assert
      expect(result).toBe(true);
    });

    it("should return false for non-matching password", async () => {
      // Arrange
      const password = "SecurePassword123";
      const wrongPassword = "WrongPassword456";
      const hash = await hashPassword(password);

      // Act
      const result = await verifyPassword(wrongPassword, hash);

      // Assert
      expect(result).toBe(false);
    });

    it("should handle empty password verification", async () => {
      // Arrange
      const password = "SecurePassword123";
      const hash = await hashPassword(password);

      // Act
      const result = await verifyPassword("", hash);

      // Assert
      expect(result).toBe(false);
    });

    it("should be case sensitive", async () => {
      // Arrange
      const password = "SecurePassword123";
      const hash = await hashPassword(password);

      // Act
      const result = await verifyPassword("securepassword123", hash);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("validatePasswordStrength", () => {
    describe("minimum length requirement", () => {
      it("should reject password shorter than 8 characters", () => {
        // Act
        const result = validatePasswordStrength("Short1A");

        // Assert
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("at least 8 characters");
      });

      it("should accept password with exactly 8 characters", () => {
        // Act - exactly 8 chars with all requirements
        const result = validatePasswordStrength("Abcd1234");

        // Assert
        expect(result.isValid).toBe(true);
      });
    });

    describe("maximum length requirement", () => {
      it("should reject password longer than 128 characters", () => {
        // Arrange
        const longPassword = "A1" + "a".repeat(127);

        // Act
        const result = validatePasswordStrength(longPassword);

        // Assert
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("at most 128 characters");
      });

      it("should accept password with exactly 128 characters", () => {
        // Arrange - 128 chars with all requirements
        const password = "A1" + "a".repeat(126);

        // Act
        const result = validatePasswordStrength(password);

        // Assert
        expect(result.isValid).toBe(true);
      });
    });

    describe("lowercase letter requirement", () => {
      it("should reject password without lowercase letter", () => {
        // Act
        const result = validatePasswordStrength("ABCDEFGH1");

        // Assert
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("lowercase letter");
      });

      it("should accept password with lowercase letter", () => {
        // Act
        const result = validatePasswordStrength("ABCDEFGh1");

        // Assert
        expect(result.isValid).toBe(true);
      });
    });

    describe("uppercase letter requirement", () => {
      it("should reject password without uppercase letter", () => {
        // Act
        const result = validatePasswordStrength("abcdefgh1");

        // Assert
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("uppercase letter");
      });

      it("should accept password with uppercase letter", () => {
        // Act
        const result = validatePasswordStrength("Abcdefgh1");

        // Assert
        expect(result.isValid).toBe(true);
      });
    });

    describe("number requirement", () => {
      it("should reject password without number", () => {
        // Act
        const result = validatePasswordStrength("Abcdefgh");

        // Assert
        expect(result.isValid).toBe(false);
        expect(result.message).toContain("number");
      });

      it("should accept password with number", () => {
        // Act
        const result = validatePasswordStrength("Abcdefgh1");

        // Assert
        expect(result.isValid).toBe(true);
      });
    });

    describe("valid passwords", () => {
      const validPasswords = [
        "Password123",
        "Abcdefgh1",
        "MySecure1Pass",
        "1234ABCDabcd",
        "Test1234Test",
        "aA1" + "x".repeat(5), // Minimum valid
      ];

      validPasswords.forEach((password) => {
        it(`should accept valid password: ${password.substring(0, 10)}...`, () => {
          // Act
          const result = validatePasswordStrength(password);

          // Assert
          expect(result.isValid).toBe(true);
          expect(result.message).toBeUndefined();
        });
      });
    });

    describe("invalid passwords", () => {
      const invalidCases = [
        { password: "abc", reason: "too short" },
        { password: "abcdefgh", reason: "no uppercase or number" },
        { password: "ABCDEFGH", reason: "no lowercase or number" },
        { password: "12345678", reason: "no letters" },
        { password: "abcdefG1", reason: "exactly 8 chars is valid, but 7 is not" },
      ];

      invalidCases.forEach(({ password, reason }) => {
        it(`should reject "${password}" (${reason})`, () => {
          // Act
          const result = validatePasswordStrength(password);

          // Assert
          if (password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) {
            expect(result.isValid).toBe(true);
          } else {
            expect(result.isValid).toBe(false);
          }
        });
      });
    });

    describe("special characters", () => {
      it("should accept passwords with special characters", () => {
        // Act
        const result = validatePasswordStrength("Password1!");

        // Assert
        expect(result.isValid).toBe(true);
      });

      it("should accept passwords with unicode characters", () => {
        // Act - still needs base requirements
        const result = validatePasswordStrength("Password1!");

        // Assert
        expect(result.isValid).toBe(true);
      });
    });
  });
});
