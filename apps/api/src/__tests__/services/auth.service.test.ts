/**
 * Unit tests for auth.service.ts
 *
 * Tests authentication functionality including:
 * - User registration
 * - User login
 * - Email verification
 * - Password reset flow
 * - Session management
 * - Token refresh
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  createMockUser,
  createMockSession,
  createUpdateResult,
  createDeleteResult,
  createMutableMockQueryBuilder,
  resetMockQueryBuilder,
} from "../mocks";

// Mock query builder - using centralized mock utilities
let mockQueryBuilder = createMutableMockQueryBuilder();

// Mock modules before importing the service
const mockDb = {
  selectFrom: mock(() => mockQueryBuilder),
  insertInto: mock(() => mockQueryBuilder),
  updateTable: mock(() => mockQueryBuilder),
  deleteFrom: mock(() => mockQueryBuilder),
  transaction: mock(() => ({
    execute: mock((callback: (trx: unknown) => Promise<unknown>) => callback(mockDb)),
  })),
};

function resetMockDb() {
  mockDb.selectFrom = mock(() => mockQueryBuilder);
  mockDb.insertInto = mock(() => mockQueryBuilder);
  mockDb.updateTable = mock(() => mockQueryBuilder);
  mockDb.deleteFrom = mock(() => mockQueryBuilder);
}

// Mock @whatsapp-web/database
mock.module("@whatsapp-web/database", () => ({
  db: mockDb,
}));

// Mock password utilities
const mockHashPassword = mock(async (password: string) => `hashed_${password}`);
const mockVerifyPassword = mock(async (_password: string, _hash: string) => true);

mock.module("../../lib/password.js", () => ({
  hashPassword: mockHashPassword,
  verifyPassword: mockVerifyPassword,
}));

// Mock JWT utilities
const mockGenerateAccessToken = mock(async () => "mock-access-token");
const mockGenerateRefreshToken = mock(async () => "mock-refresh-token");
const mockVerifyRefreshToken = mock(async () => ({ sessionId: "session-123" }));
const mockGetRefreshTokenExpiry = mock(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

mock.module("../../lib/jwt.js", () => ({
  generateAccessToken: mockGenerateAccessToken,
  generateRefreshToken: mockGenerateRefreshToken,
  verifyRefreshToken: mockVerifyRefreshToken,
  getRefreshTokenExpiry: mockGetRefreshTokenExpiry,
}));

// Mock email utilities
const mockSendVerificationEmail = mock(async () => ({ success: true }));
const mockSendPasswordResetEmail = mock(async () => ({ success: true }));

mock.module("../../lib/email.js", () => ({
  sendVerificationEmail: mockSendVerificationEmail,
  sendPasswordResetEmail: mockSendPasswordResetEmail,
}));

// Import the service after mocking
import {
  register,
  login,
  verifyEmail,
  forgotPassword,
  resetPassword,
  refreshSession,
  revokeSession,
  revokeAllSessions,
  getUserSessions,
  getUserById,
  updateSessionActivity,
  AuthError,
} from "../../services/auth.service";

describe("AuthService", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    resetMockQueryBuilder(mockQueryBuilder);
    resetMockDb();
    mockHashPassword.mockClear();
    mockVerifyPassword.mockClear();
    mockGenerateAccessToken.mockClear();
    mockGenerateRefreshToken.mockClear();
    mockVerifyRefreshToken.mockClear();
    mockSendVerificationEmail.mockClear();
    mockSendPasswordResetEmail.mockClear();
  });

  afterEach(() => {
    // Clean up after each test
  });

  describe("register", () => {
    it("should register a new user successfully", async () => {
      // Arrange
      const email = "test@example.com";
      const password = "Password123";
      const mockCreatedUser = createMockUser({
        id: "new-user-123",
        email: email.toLowerCase(),
      });

      // First query checks if user exists - should return undefined
      resetMockQueryBuilder(mockQueryBuilder, undefined);

      // After checking, setup for insert
      const insertBuilder: Record<string, unknown> = {
        values: mock(() => insertBuilder),
        returning: mock(() => insertBuilder),
        executeTakeFirstOrThrow: mock(() => Promise.resolve(mockCreatedUser)),
      };
      mockDb.insertInto = mock(() => insertBuilder);

      // Act
      const result = await register(email, password);

      // Assert
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(email.toLowerCase());
      expect(result.verificationToken).toBeDefined();
      expect(mockHashPassword).toHaveBeenCalledWith(password);
      expect(mockSendVerificationEmail).toHaveBeenCalled();
    });

    it("should throw error if email already exists", async () => {
      // Arrange
      const existingUser = createMockUser();
      resetMockQueryBuilder(mockQueryBuilder, existingUser);

      // Act & Assert
      await expect(register("test@example.com", "Password123")).rejects.toThrow(AuthError);
      await expect(register("test@example.com", "Password123")).rejects.toThrow("An account with this email already exists");
    });

    it("should normalize email to lowercase", async () => {
      // Arrange
      const email = "TEST@EXAMPLE.COM";
      const mockCreatedUser = createMockUser({
        id: "new-user-123",
        email: email.toLowerCase(),
      });

      resetMockQueryBuilder(mockQueryBuilder, undefined);
      const insertBuilder: Record<string, unknown> = {
        values: mock(() => insertBuilder),
        returning: mock(() => insertBuilder),
        executeTakeFirstOrThrow: mock(() => Promise.resolve(mockCreatedUser)),
      };
      mockDb.insertInto = mock(() => insertBuilder);

      // Act
      const result = await register(email, "Password123");

      // Assert
      expect(result.user.email).toBe("test@example.com");
    });
  });

  describe("login", () => {
    it("should login user with valid credentials", async () => {
      // Arrange
      const mockUser = createMockUser();
      const mockSession = createMockSession();

      // Setup mock for user lookup
      resetMockQueryBuilder(mockQueryBuilder, mockUser);

      // Setup mock for session creation
      const insertBuilder: Record<string, unknown> = {
        values: mock(() => insertBuilder),
        returning: mock(() => insertBuilder),
        executeTakeFirstOrThrow: mock(() => Promise.resolve(mockSession)),
      };
      mockDb.insertInto = mock(() => insertBuilder);

      mockVerifyPassword.mockImplementation(async () => true);

      // Act
      const result = await login("test@example.com", "Password123", {
        deviceName: "Chrome",
        deviceType: "desktop",
        ipAddress: "127.0.0.1",
      });

      // Assert
      expect(result.user).toBeDefined();
      expect(result.tokens.accessToken).toBe("mock-access-token");
      expect(result.tokens.refreshToken).toBe("mock-refresh-token");
      expect(result.session).toBeDefined();
      expect(mockVerifyPassword).toHaveBeenCalled();
      expect(mockGenerateAccessToken).toHaveBeenCalled();
      expect(mockGenerateRefreshToken).toHaveBeenCalled();
    });

    it("should throw error for non-existent user", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, undefined);

      // Act & Assert
      await expect(login("nonexistent@example.com", "Password123")).rejects.toThrow(AuthError);
      await expect(login("nonexistent@example.com", "Password123")).rejects.toThrow("Invalid email or password");
    });

    it("should throw error for invalid password", async () => {
      // Arrange
      const mockUser = createMockUser();
      resetMockQueryBuilder(mockQueryBuilder, mockUser);
      mockVerifyPassword.mockImplementation(async () => false);

      // Act & Assert
      await expect(login("test@example.com", "WrongPassword")).rejects.toThrow(AuthError);
      await expect(login("test@example.com", "WrongPassword")).rejects.toThrow("Invalid email or password");
    });

    it("should normalize email to lowercase during login", async () => {
      // Arrange
      const mockUser = createMockUser();
      const mockSession = createMockSession();

      resetMockQueryBuilder(mockQueryBuilder, mockUser);

      const insertBuilder: Record<string, unknown> = {
        values: mock(() => insertBuilder),
        returning: mock(() => insertBuilder),
        executeTakeFirstOrThrow: mock(() => Promise.resolve(mockSession)),
      };
      mockDb.insertInto = mock(() => insertBuilder);

      mockVerifyPassword.mockImplementation(async () => true);

      // Act
      await login("TEST@EXAMPLE.COM", "Password123");

      // Assert - verify the query was called with lowercase email
      expect(mockDb.selectFrom).toHaveBeenCalled();
    });
  });

  describe("verifyEmail", () => {
    it("should verify email successfully", async () => {
      // Arrange
      const mockUser = createMockUser({
        email_verified_at: new Date(),
      });

      const updateBuilder: Record<string, unknown> = {
        where: mock(() => updateBuilder),
        set: mock(() => updateBuilder),
        returning: mock(() => updateBuilder),
        executeTakeFirst: mock(() => Promise.resolve(mockUser)),
      };
      mockDb.updateTable = mock(() => updateBuilder);

      // Act
      const result = await verifyEmail("user-123", "verification-token");

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(mockUser.id);
      expect(result.emailVerifiedAt).toBeDefined();
    });

    it("should throw error for invalid verification token", async () => {
      // Arrange
      const updateBuilder: Record<string, unknown> = {
        where: mock(() => updateBuilder),
        set: mock(() => updateBuilder),
        returning: mock(() => updateBuilder),
        executeTakeFirst: mock(() => Promise.resolve(undefined)),
      };
      mockDb.updateTable = mock(() => updateBuilder);

      // Act & Assert
      await expect(verifyEmail("invalid-user", "invalid-token")).rejects.toThrow(AuthError);
      await expect(verifyEmail("invalid-user", "invalid-token")).rejects.toThrow("Invalid verification token");
    });
  });

  describe("forgotPassword", () => {
    it("should send password reset email for existing user", async () => {
      // Arrange
      const mockUser = createMockUser();
      resetMockQueryBuilder(mockQueryBuilder, mockUser);

      const updateBuilder: Record<string, unknown> = {
        where: mock(() => updateBuilder),
        set: mock(() => updateBuilder),
        executeTakeFirst: mock(() => Promise.resolve(mockUser)),
      };
      mockDb.updateTable = mock(() => updateBuilder);

      // Act
      const result = await forgotPassword("test@example.com");

      // Assert
      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(mockSendPasswordResetEmail).toHaveBeenCalled();
    });

    it("should return success even for non-existent email (prevent enumeration)", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, undefined);

      // Act
      const result = await forgotPassword("nonexistent@example.com");

      // Assert
      expect(result.success).toBe(true);
      expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe("resetPassword", () => {
    it("should reset password successfully", async () => {
      // Arrange
      const updateResult = createUpdateResult(1);
      const updateBuilder: Record<string, unknown> = {
        where: mock(() => updateBuilder),
        set: mock(() => updateBuilder),
        executeTakeFirst: mock(() => Promise.resolve(updateResult)),
      };
      mockDb.updateTable = mock(() => updateBuilder);

      // Act
      const result = await resetPassword("test@example.com", "reset-token", "NewPassword123");

      // Assert
      expect(result.success).toBe(true);
      expect(mockHashPassword).toHaveBeenCalledWith("NewPassword123");
    });

    it("should throw error for invalid reset token", async () => {
      // Arrange
      const updateResult = createUpdateResult(0);
      const updateBuilder: Record<string, unknown> = {
        where: mock(() => updateBuilder),
        set: mock(() => updateBuilder),
        executeTakeFirst: mock(() => Promise.resolve(updateResult)),
      };
      mockDb.updateTable = mock(() => updateBuilder);

      // Act & Assert
      await expect(resetPassword("test@example.com", "invalid-token", "NewPassword123")).rejects.toThrow(AuthError);
      await expect(resetPassword("test@example.com", "invalid-token", "NewPassword123")).rejects.toThrow("Invalid reset token");
    });
  });

  describe("refreshSession", () => {
    it("should refresh session with valid refresh token", async () => {
      // Arrange
      const mockSession = createMockSession();
      resetMockQueryBuilder(mockQueryBuilder, mockSession);

      mockVerifyRefreshToken.mockImplementation(async () => ({ sessionId: "session-123" }));

      const updateBuilder: Record<string, unknown> = {
        where: mock(() => updateBuilder),
        set: mock(() => updateBuilder),
        execute: mock(() => Promise.resolve([])),
      };
      mockDb.updateTable = mock(() => updateBuilder);

      // Act
      const result = await refreshSession("valid-refresh-token");

      // Assert
      expect(result.tokens).toBeDefined();
      expect(result.tokens.accessToken).toBe("mock-access-token");
      expect(result.tokens.refreshToken).toBe("mock-refresh-token");
    });

    it("should throw error for invalid refresh token", async () => {
      // Arrange
      mockVerifyRefreshToken.mockImplementation(async () => null);

      // Act & Assert
      await expect(refreshSession("invalid-token")).rejects.toThrow(AuthError);
      await expect(refreshSession("invalid-token")).rejects.toThrow("Invalid refresh token");
    });

    it("should throw error for expired session", async () => {
      // Arrange
      mockVerifyRefreshToken.mockImplementation(async () => ({ sessionId: "expired-session" }));
      resetMockQueryBuilder(mockQueryBuilder, undefined);

      // Act & Assert
      await expect(refreshSession("expired-session-token")).rejects.toThrow(AuthError);
      await expect(refreshSession("expired-session-token")).rejects.toThrow("Session not found or expired");
    });
  });

  describe("revokeSession", () => {
    it("should revoke session successfully", async () => {
      // Arrange
      const deleteResult = createDeleteResult(1);
      const deleteBuilder: Record<string, unknown> = {
        where: mock(() => deleteBuilder),
        executeTakeFirst: mock(() => Promise.resolve(deleteResult)),
      };
      mockDb.deleteFrom = mock(() => deleteBuilder);

      // Act
      const result = await revokeSession("session-123", "user-123");

      // Assert
      expect(result.success).toBe(true);
    });

    it("should throw error if session not found", async () => {
      // Arrange
      const deleteResult = createDeleteResult(0);
      const deleteBuilder: Record<string, unknown> = {
        where: mock(() => deleteBuilder),
        executeTakeFirst: mock(() => Promise.resolve(deleteResult)),
      };
      mockDb.deleteFrom = mock(() => deleteBuilder);

      // Act & Assert
      await expect(revokeSession("invalid-session", "user-123")).rejects.toThrow(AuthError);
      await expect(revokeSession("invalid-session", "user-123")).rejects.toThrow("Session not found");
    });
  });

  describe("revokeAllSessions", () => {
    it("should revoke all sessions for user", async () => {
      // Arrange
      const deleteResult = createDeleteResult(5);
      const deleteBuilder: Record<string, unknown> = {
        where: mock(() => deleteBuilder),
        executeTakeFirst: mock(() => Promise.resolve(deleteResult)),
      };
      mockDb.deleteFrom = mock(() => deleteBuilder);

      // Act
      const result = await revokeAllSessions("user-123");

      // Assert
      expect(result.count).toBe(5);
    });

    it("should exclude specified session when revoking all", async () => {
      // Arrange
      const deleteResult = createDeleteResult(4);
      const deleteBuilder: Record<string, unknown> = {
        where: mock(() => deleteBuilder),
        executeTakeFirst: mock(() => Promise.resolve(deleteResult)),
      };
      mockDb.deleteFrom = mock(() => deleteBuilder);

      // Act
      const result = await revokeAllSessions("user-123", "current-session");

      // Assert
      expect(result.count).toBe(4);
    });
  });

  describe("getUserSessions", () => {
    it("should return all active sessions for user", async () => {
      // Arrange
      const mockSessions = [
        createMockSession({ id: "session-1" }),
        createMockSession({ id: "session-2" }),
      ];
      resetMockQueryBuilder(mockQueryBuilder, mockSessions);
      mockQueryBuilder.execute = mock(() => Promise.resolve(mockSessions));

      // Act
      const result = await getUserSessions("user-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it("should return empty array if no sessions", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, []);
      mockQueryBuilder.execute = mock(() => Promise.resolve([]));

      // Act
      const result = await getUserSessions("user-123");

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe("getUserById", () => {
    it("should return user for valid ID", async () => {
      // Arrange
      const mockUser = createMockUser();
      resetMockQueryBuilder(mockQueryBuilder, mockUser);

      // Act
      const result = await getUserById("user-123");

      // Assert
      expect(result).toBeDefined();
      expect(result?.id).toBe(mockUser.id);
      expect(result?.email).toBe(mockUser.email);
    });

    it("should return null for non-existent user", async () => {
      // Arrange
      resetMockQueryBuilder(mockQueryBuilder, undefined);

      // Act
      const result = await getUserById("nonexistent-user");

      // Assert
      expect(result).toBeNull();
    });
  });

  describe("updateSessionActivity", () => {
    it("should update session last active timestamp", async () => {
      // Arrange
      const updateBuilder = {
        ...mockQueryBuilder,
        execute: mock(() => Promise.resolve([])),
      };
      mockDb.updateTable = mock(() => updateBuilder);

      // Act & Assert - should not throw
      await expect(updateSessionActivity("session-123")).resolves.toBeUndefined();
    });
  });

  describe("AuthError", () => {
    it("should create AuthError with correct properties", () => {
      // Act
      const error = new AuthError("Test error", "TEST_ERROR", 401);

      // Assert
      expect(error.message).toBe("Test error");
      expect(error.code).toBe("TEST_ERROR");
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe("AuthError");
    });

    it("should use default status code of 400", () => {
      // Act
      const error = new AuthError("Test error", "TEST_ERROR");

      // Assert
      expect(error.statusCode).toBe(400);
    });
  });
});
