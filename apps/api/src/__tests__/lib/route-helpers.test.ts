/**
 * Unit tests for route-helpers.ts
 *
 * Tests pagination extraction, date range extraction, and entity helpers
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  extractPaginationParams,
  createPaginationMeta,
  requireEntity,
} from "../../lib/route-helpers";
import { NotFoundError } from "../../lib/errors";

// Mock Hono context
function createMockContext(query: Record<string, string | undefined> = {}) {
  return {
    req: {
      query: (key: string) => query[key],
    },
  } as any;
}

describe("Route Helpers", () => {
  describe("extractPaginationParams", () => {
    describe("default behavior", () => {
      it("should return default values when no params provided", () => {
        // Arrange
        const c = createMockContext({});

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.limit).toBe(50);
        expect(result.offset).toBe(0);
      });

      it("should use custom default limit", () => {
        // Arrange
        const c = createMockContext({});

        // Act
        const result = extractPaginationParams(c, 20);

        // Assert
        expect(result.limit).toBe(20);
        expect(result.offset).toBe(0);
      });
    });

    describe("limit parameter", () => {
      it("should parse valid limit from query string", () => {
        // Arrange
        const c = createMockContext({ limit: "25" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.limit).toBe(25);
      });

      it("should cap limit at maxLimit", () => {
        // Arrange
        const c = createMockContext({ limit: "2000" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.limit).toBe(1000); // Default maxLimit
      });

      it("should use custom maxLimit", () => {
        // Arrange
        const c = createMockContext({ limit: "300" });

        // Act
        const result = extractPaginationParams(c, 50, 200);

        // Assert
        expect(result.limit).toBe(200); // Custom maxLimit
      });

      it("should enforce minimum limit of 1", () => {
        // Arrange
        const c = createMockContext({ limit: "0" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.limit).toBe(1);
      });

      it("should enforce minimum limit of 1 for negative values", () => {
        // Arrange
        const c = createMockContext({ limit: "-5" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.limit).toBe(1);
      });

      it("should use default for invalid limit (NaN)", () => {
        // Arrange
        const c = createMockContext({ limit: "abc" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.limit).toBe(50);
      });
    });

    describe("offset parameter", () => {
      it("should parse valid offset from query string", () => {
        // Arrange
        const c = createMockContext({ offset: "100" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.offset).toBe(100);
      });

      it("should enforce minimum offset of 0", () => {
        // Arrange
        const c = createMockContext({ offset: "-10" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.offset).toBe(0);
      });

      it("should use default for invalid offset (NaN)", () => {
        // Arrange
        const c = createMockContext({ offset: "xyz" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.offset).toBe(0);
      });
    });

    describe("combined parameters", () => {
      it("should parse both limit and offset correctly", () => {
        // Arrange
        const c = createMockContext({ limit: "25", offset: "50" });

        // Act
        const result = extractPaginationParams(c);

        // Assert
        expect(result.limit).toBe(25);
        expect(result.offset).toBe(50);
      });
    });
  });

  describe("createPaginationMeta", () => {
    it("should create correct metadata for first page", () => {
      // Arrange
      const total = 100;
      const returnedCount = 20;
      const params = { limit: 20, offset: 0 };

      // Act
      const result = createPaginationMeta(total, returnedCount, params);

      // Assert
      expect(result.total).toBe(100);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(true);
    });

    it("should create correct metadata for middle page", () => {
      // Arrange
      const total = 100;
      const returnedCount = 20;
      const params = { limit: 20, offset: 40 };

      // Act
      const result = createPaginationMeta(total, returnedCount, params);

      // Assert
      expect(result.total).toBe(100);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(40);
      expect(result.hasMore).toBe(true);
    });

    it("should create correct metadata for last page", () => {
      // Arrange
      const total = 100;
      const returnedCount = 20;
      const params = { limit: 20, offset: 80 };

      // Act
      const result = createPaginationMeta(total, returnedCount, params);

      // Assert
      expect(result.total).toBe(100);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(80);
      expect(result.hasMore).toBe(false); // 80 + 20 = 100, not < 100
    });

    it("should handle hasMore when fewer items returned than limit", () => {
      // Arrange
      const total = 45;
      const returnedCount = 5; // Less than limit because it's the last page
      const params = { limit: 20, offset: 40 };

      // Act
      const result = createPaginationMeta(total, returnedCount, params);

      // Assert
      expect(result.total).toBe(45);
      expect(result.hasMore).toBe(false); // 40 + 5 = 45, not < 45
    });

    it("should handle empty results", () => {
      // Arrange
      const total = 0;
      const returnedCount = 0;
      const params = { limit: 20, offset: 0 };

      // Act
      const result = createPaginationMeta(total, returnedCount, params);

      // Assert
      expect(result.total).toBe(0);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("requireEntity", () => {
    it("should return entity when it exists", () => {
      // Arrange
      const entity = { id: "123", name: "Test" };

      // Act
      const result = requireEntity(entity, "Contact");

      // Assert
      expect(result).toBe(entity);
      expect(result.id).toBe("123");
      expect(result.name).toBe("Test");
    });

    it("should throw NotFoundError when entity is null", () => {
      // Arrange
      const entity = null;

      // Act & Assert
      expect(() => requireEntity(entity, "Contact")).toThrow(NotFoundError);
    });

    it("should throw NotFoundError when entity is undefined", () => {
      // Arrange
      const entity = undefined;

      // Act & Assert
      expect(() => requireEntity(entity, "Tag")).toThrow(NotFoundError);
    });

    it("should include resource name in error message", () => {
      // Arrange
      const entity = null;

      // Act & Assert
      try {
        requireEntity(entity, "CustomResource");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).message).toBe("CustomResource not found");
      }
    });

    it("should have correct status code (404)", () => {
      // Arrange
      const entity = null;

      // Act & Assert
      try {
        requireEntity(entity, "Resource");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as NotFoundError).statusCode).toBe(404);
      }
    });

    it("should preserve type narrowing", () => {
      // Arrange
      type User = { id: string; email: string };
      const maybeUser: User | null = { id: "1", email: "test@example.com" };

      // Act
      const user = requireEntity(maybeUser, "User");

      // Assert - TypeScript should know this is User, not User | null
      expect(user.id).toBe("1");
      expect(user.email).toBe("test@example.com");
    });

    it("should work with various entity types", () => {
      // Test with object
      expect(requireEntity({ foo: "bar" }, "Object")).toEqual({ foo: "bar" });

      // Test with array
      expect(requireEntity([1, 2, 3], "Array")).toEqual([1, 2, 3]);

      // Test with string
      expect(requireEntity("test", "String")).toBe("test");

      // Test with number
      expect(requireEntity(42, "Number")).toBe(42);

      // Test with boolean
      expect(requireEntity(false, "Boolean")).toBe(false);

      // Test with zero (falsy but not null/undefined)
      expect(requireEntity(0, "Zero")).toBe(0);

      // Test with empty string (falsy but not null/undefined)
      expect(requireEntity("", "EmptyString")).toBe("");
    });
  });
});
