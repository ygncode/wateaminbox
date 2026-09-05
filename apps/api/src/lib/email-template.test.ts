import { describe, expect, test } from "bun:test";
import {
  emailHeaderText,
  renderBrandedEmail,
  renderPlainTextEmail,
  type BrandedEmailContent,
} from "./email-template.js";

const content: BrandedEmailContent = {
  preheader: "A concise inbox preview",
  eyebrow: "Account security",
  title: "Confirm your email",
  paragraphs: ["Use the secure link below to continue."],
  details: [{ label: "Workspace", value: "Acme & Partners" }],
  action: {
    label: "Confirm email",
    url: "https://app.example.test/verify?token=a&next=b",
  },
  note: "This link expires in 24 hours.",
};

describe("emailHeaderText", () => {
  test("removes controls, collapses whitespace, and bounds header values", () => {
    const value = `Acme\r\nBcc: victim@example.com\t${"x".repeat(100)}`;
    const sanitized = emailHeaderText(value);

    expect(sanitized).not.toMatch(/[\r\n\t]/);
    expect(sanitized.startsWith("Acme Bcc: victim@example.com ")).toBe(true);
    expect(sanitized.length).toBeLessThanOrEqual(80);
  });

  test("uses a fallback for an all-control value", () => {
    expect(emailHeaderText("\r\n\t")).toBe("workspace");
  });
});

describe("renderBrandedEmail", () => {
  test("renders the shared brand, preheader, accessible tables, CTA, fallback URL, and support footer", () => {
    const html = renderBrandedEmail(content);

    expect(html).toContain("WATeamInbox");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain("A concise inbox preview");
    expect(html).toContain('role="presentation"');
    expect(html).toContain("Confirm email");
    expect(html).toContain("If the button does not work");
    expect(html).toContain("hello@wateaminbox.com");
  });

  test("escapes dynamic text and attribute values", () => {
    const html = renderBrandedEmail({
      ...content,
      title: '<script>alert("title")</script>',
      paragraphs: ["<img src=x onerror=alert(1)>"],
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("token=a&amp;next=b");
    expect(html).toContain("Acme &amp; Partners");
  });
});

describe("renderPlainTextEmail", () => {
  test("keeps the action, details, expiry note, brand, and support address", () => {
    const text = renderPlainTextEmail(content);

    expect(text).toContain("Workspace: Acme & Partners");
    expect(text).toContain(
      "Confirm email: https://app.example.test/verify?token=a&next=b",
    );
    expect(text).toContain("This link expires in 24 hours.");
    expect(text).toContain("WATeamInbox");
    expect(text).toContain("Support: hello@wateaminbox.com");
  });
});
