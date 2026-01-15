/**
 * Unit tests for quick-replies.ts schemas
 *
 * Tests Zod validation schemas for quick reply CRUD operations
 */

import { describe, it, expect } from "bun:test";
import {
  createQuickReplySchema,
  updateQuickReplySchema,
  listQuickRepliesQuerySchema,
} from "../../../lib/schemas/quick-replies";

describe("Quick Replies Schemas", () => {
  describe("createQuickReplySchema", () => {
    describe("valid inputs", () => {
      it("should accept valid quick reply data", () => {
        // Arrange
        const input = {
          shortcut: "greeting",
          title: "Greeting Message",
          content: "Hello! How can I help you today?",
        };

        // Act
        const result = createQuickReplySchema.safeParse(input);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.shortcut).toBe("greeting");
          expect(result.data.title).toBe("Greeting Message");
          expect(result.data.content).toBe("Hello! How can I help you today?");
        }
      });

      it("should accept shortcut with letters only", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "hello",
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(true);
      });

      it("should accept shortcut with numbers", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "greeting123",
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(true);
      });

      it("should accept shortcut with underscores", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "hello_world",
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(true);
      });

      it("should accept shortcut with hyphens", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "hello-world",
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(true);
      });

      it("should accept shortcut with mixed valid characters", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "Hello_World-123",
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(true);
      });

      it("should accept single character shortcut", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "a",
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(true);
      });

      it("should accept 50 character shortcut (max)", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "a".repeat(50),
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(true);
      });

      it("should accept 255 character title (max)", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "test",
          title: "a".repeat(255),
          content: "Content",
        });
        expect(result.success).toBe(true);
      });
    });

    describe("shortcut validation", () => {
      it("should reject empty shortcut", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "",
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("required");
        }
      });

      it("should reject shortcut over 50 characters", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "a".repeat(51),
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("50 characters");
        }
      });

      it("should reject shortcut with spaces", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "hello world",
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain(
            "letters, numbers, underscores, and hyphens",
          );
        }
      });

      it("should reject shortcut with special characters", () => {
        const specialChars = ["!", "@", "#", "$", "%", ".", "/", "\\", "*"];

        for (const char of specialChars) {
          const result = createQuickReplySchema.safeParse({
            shortcut: `hello${char}world`,
            title: "Title",
            content: "Content",
          });
          expect(result.success).toBe(false);
        }
      });

      it("should reject missing shortcut", () => {
        const result = createQuickReplySchema.safeParse({
          title: "Title",
          content: "Content",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("title validation", () => {
      it("should reject empty title", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "test",
          title: "",
          content: "Content",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("required");
        }
      });

      it("should reject title over 255 characters", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "test",
          title: "a".repeat(256),
          content: "Content",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("255 characters");
        }
      });

      it("should reject missing title", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "test",
          content: "Content",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("content validation", () => {
      it("should reject empty content", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "test",
          title: "Title",
          content: "",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("required");
        }
      });

      it("should reject missing content", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "test",
          title: "Title",
        });
        expect(result.success).toBe(false);
      });

      it("should accept very long content", () => {
        const result = createQuickReplySchema.safeParse({
          shortcut: "test",
          title: "Title",
          content: "a".repeat(10000), // No max limit on content
        });
        expect(result.success).toBe(true);
      });
    });
  });

  describe("updateQuickReplySchema", () => {
    describe("valid inputs", () => {
      it("should accept empty object (no updates)", () => {
        const result = updateQuickReplySchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it("should accept only shortcut update", () => {
        const result = updateQuickReplySchema.safeParse({
          shortcut: "new-shortcut",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.shortcut).toBe("new-shortcut");
          expect(result.data.title).toBeUndefined();
          expect(result.data.content).toBeUndefined();
        }
      });

      it("should accept only title update", () => {
        const result = updateQuickReplySchema.safeParse({
          title: "New Title",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.title).toBe("New Title");
        }
      });

      it("should accept only content update", () => {
        const result = updateQuickReplySchema.safeParse({
          content: "New content here",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.content).toBe("New content here");
        }
      });

      it("should accept all fields update", () => {
        const result = updateQuickReplySchema.safeParse({
          shortcut: "updated",
          title: "Updated Title",
          content: "Updated content",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.shortcut).toBe("updated");
          expect(result.data.title).toBe("Updated Title");
          expect(result.data.content).toBe("Updated content");
        }
      });
    });

    describe("shortcut validation", () => {
      it("should reject invalid shortcut pattern when provided", () => {
        const result = updateQuickReplySchema.safeParse({
          shortcut: "invalid shortcut!",
        });
        expect(result.success).toBe(false);
      });

      it("should reject shortcut over 50 chars when provided", () => {
        const result = updateQuickReplySchema.safeParse({
          shortcut: "a".repeat(51),
        });
        expect(result.success).toBe(false);
      });

      it("should reject empty shortcut when provided", () => {
        const result = updateQuickReplySchema.safeParse({
          shortcut: "",
        });
        expect(result.success).toBe(false);
      });
    });

    describe("title validation", () => {
      it("should reject empty title when provided", () => {
        const result = updateQuickReplySchema.safeParse({
          title: "",
        });
        expect(result.success).toBe(false);
      });

      it("should reject title over 255 chars when provided", () => {
        const result = updateQuickReplySchema.safeParse({
          title: "a".repeat(256),
        });
        expect(result.success).toBe(false);
      });
    });

    describe("content validation", () => {
      it("should reject empty content when provided", () => {
        const result = updateQuickReplySchema.safeParse({
          content: "",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("listQuickRepliesQuerySchema", () => {
    describe("valid inputs", () => {
      it("should accept empty query (use defaults)", () => {
        const result = listQuickRepliesQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(50);
          expect(result.data.offset).toBe(0);
          expect(result.data.search).toBeUndefined();
        }
      });

      it("should accept search parameter", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          search: "greeting",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.search).toBe("greeting");
        }
      });

      it("should accept custom limit", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          limit: 25,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(25);
        }
      });

      it("should accept custom offset", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          offset: 100,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.offset).toBe(100);
        }
      });

      it("should coerce string limit to number", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          limit: "30",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(30);
        }
      });

      it("should coerce string offset to number", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          offset: "50",
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.offset).toBe(50);
        }
      });
    });

    describe("limit validation", () => {
      it("should reject limit less than 1", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          limit: 0,
        });
        expect(result.success).toBe(false);
      });

      it("should reject limit greater than 100", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          limit: 101,
        });
        expect(result.success).toBe(false);
      });

      it("should accept limit of 1 (min)", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          limit: 1,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(1);
        }
      });

      it("should accept limit of 100 (max)", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          limit: 100,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(100);
        }
      });

      it("should reject non-integer limit", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          limit: 25.5,
        });
        expect(result.success).toBe(false);
      });
    });

    describe("offset validation", () => {
      it("should reject negative offset", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          offset: -1,
        });
        expect(result.success).toBe(false);
      });

      it("should accept offset of 0", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          offset: 0,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.offset).toBe(0);
        }
      });

      it("should accept large offset", () => {
        const result = listQuickRepliesQuerySchema.safeParse({
          offset: 10000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.offset).toBe(10000);
        }
      });
    });
  });
});
