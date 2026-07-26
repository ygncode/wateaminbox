import { describe, expect, test } from "bun:test";
import type { AuditLog } from "@/hooks/useAudit";
import { formatAuditSummary } from "./AuditLog";

function auditLog(overrides: Partial<AuditLog>): AuditLog {
  return {
    id: "audit-1",
    userId: "user-1",
    actor: { id: "user-1", name: "Maya Chen", email: "maya@example.com" },
    action: "company.updated",
    entityType: "company",
    entityId: "company-1",
    details: null,
    ipAddress: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("audit summaries", () => {
  test("describes role changes with actor and target metadata", () => {
    expect(
      formatAuditSummary(
        auditLog({
          action: "member.role_changed",
          entityType: "member",
          details: {
            memberName: "John Doe",
            oldRole: "member",
            newRole: "admin",
          },
        }),
      ),
    ).toBe("Maya Chen changed John Doe's role from Member to Admin.");
  });

  test("uses a safe system fallback when no actor is available", () => {
    expect(
      formatAuditSummary(
        auditLog({
          actor: null,
          userId: null,
          action: "conversation.resolved",
          entityType: "conversation",
          entityId: "conversation-123",
        }),
      ),
    ).toBe("System resolved Conversation conversa.");
  });
});
