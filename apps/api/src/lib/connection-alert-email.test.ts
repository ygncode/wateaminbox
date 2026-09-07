import { describe, expect, test } from "bun:test";
import { renderConnectionAlertEmail } from "./connection-alert-email.js";

const sample = {
  workspaceId: "12345678-1234-1234-1234-123456789012",
  workspaceName: "Acme Support",
  connectionName: "Customer support",
  occurredAt: new Date("2026-09-07T01:30:03Z"),
};

describe("connection alert email", () => {
  test("logout uses the existing branded shell, plain text and workspace connections URL", () => {
    const mail = renderConnectionAlertEmail({ ...sample, kind: "logged_out" });
    expect(mail.subject).toBe("WhatsApp logged out — Acme Support");
    expect(mail.html).toContain("Shared WhatsApp inbox for teams");
    expect(mail.html).toContain("Reconnect WhatsApp");
    expect(mail.html).toContain(
      `/w/${sample.workspaceId}/settings/connections`,
    );
    expect(mail.text).toContain("Linked devices → Link a device");
    expect(mail.text).toContain("Logged out at (UTC): 2026-09-07 01:30:03");
    expect(mail.html).not.toContain("401");
  });
  test("sustained disconnect asks the recipient to check current status", () => {
    const mail = renderConnectionAlertEmail({
      ...sample,
      kind: "disconnected",
    });
    expect(mail.text).toContain("at least five minutes");
    expect(mail.text).toContain("Check connection:");
    expect(mail.text).not.toContain("Scan a new QR");
    expect(mail.text).toContain("workspace owner or admin");
  });
  test("escapes workspace and connection names and protects the subject header", () => {
    const mail = renderConnectionAlertEmail({
      ...sample,
      kind: "logged_out",
      workspaceName: "Acme\r\nBcc: nobody@example.test",
      connectionName: '<img src=x onerror="alert(1)">',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).not.toContain("<img src=x");
  });
});
