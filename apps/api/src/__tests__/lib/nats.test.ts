/**
 * Unit tests for NATS publish functions
 *
 * These tests verify that publish functions use the correct NATS subject format.
 * The bug we're preventing: publishing to base subject "WHATSAPP.commands" instead
 * of routed subject "WHATSAPP.commands.{companyId}.{connectionId}".
 */

import { describe, it, expect } from "bun:test";

// Import the buildCommandSubject function directly - this is a pure function
// that doesn't need mocking
import { buildCommandSubject } from "../../lib/nats/index.js";

describe("buildCommandSubject", () => {
  it("should build correct subject with companyId and connectionId", () => {
    const companyId = "company-123";
    const connectionId = "conn-456";

    const subject = buildCommandSubject(companyId, connectionId);

    expect(subject).toBe(`WHATSAPP.commands.${companyId}.${connectionId}`);
  });

  it("should NOT return just the base subject (regression test for bug)", () => {
    const companyId = "company-123";
    const connectionId = "conn-456";

    const subject = buildCommandSubject(companyId, connectionId);

    // This was the bug - subjects were published to just "WHATSAPP.commands"
    // which didn't match the orchestrator's filter "WHATSAPP.commands.>"
    expect(subject).not.toBe("WHATSAPP.commands");
  });

  it("should handle UUIDs with hyphens correctly", () => {
    const companyId = "3b746ba9-98a4-41fa-b54e-18bdb8e30f2d";
    const connectionId = "cfb9a9b4-a3e1-4473-858e-94cab0d40144";

    const subject = buildCommandSubject(companyId, connectionId);

    expect(subject).toBe(`WHATSAPP.commands.${companyId}.${connectionId}`);
  });

  it("should match orchestrator consumer filter pattern WHATSAPP.commands.>", () => {
    // The orchestrator consumer filter is: WHATSAPP.commands.>
    // This requires at least one segment after WHATSAPP.commands.
    const subject = buildCommandSubject("test-company", "test-connection");

    // Must have segments after "WHATSAPP.commands."
    expect(subject.startsWith("WHATSAPP.commands.")).toBe(true);

    // Should have 4 parts: WHATSAPP, commands, companyId, connectionId
    const parts = subject.split(".");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("WHATSAPP");
    expect(parts[1]).toBe("commands");
    expect(parts[2]).toBe("test-company");
    expect(parts[3]).toBe("test-connection");
  });

  it("should use WHATSAPP.commands as base", () => {
    const subject = buildCommandSubject("co", "cn");

    // Should start with the defined base subject
    // Note: We use the literal string here instead of NATS_SUBJECTS.WHATSAPP_COMMANDS
    // to avoid dependency on module loading order when running with other tests
    expect(subject.startsWith("WHATSAPP.commands.")).toBe(true);
  });
});
