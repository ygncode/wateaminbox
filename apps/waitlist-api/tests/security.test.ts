import { describe, expect, test } from "bun:test";
import {
  derivePbkdf2Sha256,
  hmacSha256,
  randomToken,
  timingSafeStringEqual,
} from "../src/lib/crypto";
import {
  looksAutomated,
  signupSchema,
  validOpaqueToken,
} from "../src/lib/validation";
import {
  createLoginCsrf,
  verifyAdminPassword,
  verifyLoginCsrf,
} from "../src/services/admin";
import { confirmationEmail } from "../src/templates/confirmation-email";

describe("waitlist security primitives", () => {
  test("generates opaque, URL-safe confirmation tokens", () => {
    const token = randomToken();

    expect(validOpaqueToken(token)).toBe(true);
    expect(token).not.toContain("=");
    expect(token).not.toMatch(/[+/]/);
  });

  test("domains HMAC values so token roles cannot be substituted", async () => {
    const secret = "test-secret-that-is-longer-than-thirty-two-characters";
    const token = randomToken();
    const confirmation = await hmacSha256(secret, `confirmation:${token}`);
    const session = await hmacSha256(secret, `session:${token}`);

    expect(confirmation).not.toBe(session);
    expect(timingSafeStringEqual(confirmation, confirmation)).toBe(true);
    expect(timingSafeStringEqual(confirmation, session)).toBe(false);
  });

  test("validates an encoded PBKDF2 administrator password hash", async () => {
    const password = "not-a-production-password";
    const salt = new Uint8Array(16).fill(7);
    const digest = await derivePbkdf2Sha256(password, salt, 100_000, 32);
    const encoded = `pbkdf2_sha256$100000$${Buffer.from(salt).toString("base64url")}$${Buffer.from(digest).toString("base64url")}`;

    expect(await verifyAdminPassword(password, encoded)).toBe(true);
    expect(await verifyAdminPassword("wrong password", encoded)).toBe(false);
  });

  test("binds login CSRF values to a short expiry and secret", async () => {
    const secret = "csrf-secret-that-is-longer-than-thirty-two-characters";
    const now = Date.now();
    const token = await createLoginCsrf(secret, now);

    expect(await verifyLoginCsrf(secret, token, now + 1_000)).toBe(true);
    expect(await verifyLoginCsrf(secret, token, now + 1000 * 60 * 16)).toBe(
      false,
    );
    expect(await verifyLoginCsrf(`${secret}-other`, token, now + 1_000)).toBe(
      false,
    );
  });

  test("normalizes valid emails and identifies bot-like submissions", () => {
    const parsed = signupSchema.parse({ email: "  HELLO@Example.COM " });

    expect(parsed.email).toBe("hello@example.com");
    expect(looksAutomated("https://spam.example", undefined, Date.now())).toBe(
      true,
    );
    expect(looksAutomated("", Date.now(), Date.now() + 200)).toBe(true);
    expect(looksAutomated("", Date.now() - 2_000, Date.now())).toBe(false);
  });

  test("escapes confirmation URLs before placing them in HTML", () => {
    const email = confirmationEmail(
      "https://api.example.com/confirm?next=<script>alert(1)</script>&x=1",
    );

    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.text).toContain("https://api.example.com/confirm");
  });
});
