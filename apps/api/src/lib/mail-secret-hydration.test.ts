import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Production containers receive credentials through Docker secret files, not
 * Compose environment values. These behavioural tests run the shared
 * entrypoint so both provider isolation and generic secret hydration remain
 * observable deployment properties.
 */
const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const entrypoint = join(repoRoot, "infrastructure/docker/secret-entrypoint.sh");
const secretsDir = mkdtempSync(join(tmpdir(), "mail-secrets-"));

function secretFile(name: string, value: string): string {
  const path = join(secretsDir, name);
  writeFileSync(path, value);
  return path;
}

async function runEntrypoint(env: Record<string, string>): Promise<{
  exitCode: number;
  stderr: string;
  variables: Map<string, string>;
}> {
  const child = Bun.spawn(["sh", entrypoint, "env"], {
    // A bare environment keeps the assertions about what the script itself
    // exports, not about what the test runner happened to inherit.
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  const variables = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      variables.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  return { exitCode, stderr, variables };
}

describe("production secret hydration", () => {
  test("hydrates the Cloudflare token and account ID from secret files", async () => {
    const { exitCode, variables } = await runEntrypoint({
      MAIL_DRIVER: "cloudflare",
      CLOUDFLARE_EMAIL_API_TOKEN_FILE: secretFile(
        "cloudflare_email_api_token",
        "cf-live-email-sending-token",
      ),
      CLOUDFLARE_ACCOUNT_ID_FILE: secretFile(
        "cloudflare_account_id",
        "0123456789abcdef0123456789abcdef",
      ),
    });

    expect(exitCode).toBe(0);
    expect(variables.get("CLOUDFLARE_EMAIL_API_TOKEN")).toBe(
      "cf-live-email-sending-token",
    );
    expect(variables.get("CLOUDFLARE_ACCOUNT_ID")).toBe(
      "0123456789abcdef0123456789abcdef",
    );
    // The path variables are cleared so a later process cannot re-read them.
    expect(variables.has("CLOUDFLARE_EMAIL_API_TOKEN_FILE")).toBe(false);
    expect(variables.has("CLOUDFLARE_ACCOUNT_ID_FILE")).toBe(false);
  });

  test("a Cloudflare deployment needs no Resend secret", async () => {
    const { exitCode, variables } = await runEntrypoint({
      MAIL_DRIVER: "cloudflare",
      CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
      CLOUDFLARE_EMAIL_API_TOKEN_FILE: secretFile(
        "cloudflare_only_token",
        "cf-live-email-sending-token",
      ),
      // Compose leaves the unused provider's path empty rather than pointing it
      // at a placeholder file.
      RESEND_API_KEY_FILE: "",
    });

    expect(exitCode).toBe(0);
    expect(variables.get("CLOUDFLARE_EMAIL_API_TOKEN")).toBe(
      "cf-live-email-sending-token",
    );
    expect(variables.has("RESEND_API_KEY")).toBe(false);
  });

  test("an existing Resend deployment keeps hydrating unchanged", async () => {
    const { exitCode, variables } = await runEntrypoint({
      MAIL_DRIVER: "resend",
      RESEND_API_KEY_FILE: secretFile("resend_api_key", "re_live_key"),
      CLOUDFLARE_EMAIL_API_TOKEN_FILE: "",
    });

    expect(exitCode).toBe(0);
    expect(variables.get("RESEND_API_KEY")).toBe("re_live_key");
    expect(variables.has("CLOUDFLARE_EMAIL_API_TOKEN")).toBe(false);
  });

  test("refuses to start when both providers name the one mail mount", async () => {
    // Compose mounts the configured key once, as /run/secrets/mail_api_key.
    // Two providers naming it - the shape a half-finished provider switch
    // leaves behind - would present one provider's key to the other.
    const mount = secretFile("shared_mail_key", "re_live_key");
    const { exitCode, stderr, variables } = await runEntrypoint({
      MAIL_DRIVER: "cloudflare",
      RESEND_API_KEY_FILE: mount,
      CLOUDFLARE_EMAIL_API_TOKEN_FILE: mount,
    });

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(
      /configure only the mail provider named by MAIL_DRIVER/,
    );
    // Nothing was hydrated before the refusal.
    expect(variables.has("CLOUDFLARE_EMAIL_API_TOKEN")).toBe(false);
    expect(variables.has("RESEND_API_KEY")).toBe(false);
  });

  test("allows a reviewed override that mounts two distinct provider files", async () => {
    // Separate files are unambiguous: each variable holds its own provider's
    // key, so only the ambiguous single-mount case is refused.
    const { exitCode, variables } = await runEntrypoint({
      MAIL_DRIVER: "cloudflare",
      RESEND_API_KEY_FILE: secretFile("override_resend_key", "re_live_key"),
      CLOUDFLARE_EMAIL_API_TOKEN_FILE: secretFile(
        "override_cloudflare_token",
        "cf-live-email-sending-token",
      ),
    });

    expect(exitCode).toBe(0);
    expect(variables.get("RESEND_API_KEY")).toBe("re_live_key");
    expect(variables.get("CLOUDFLARE_EMAIL_API_TOKEN")).toBe(
      "cf-live-email-sending-token",
    );
  });

  test("keeps HTTP bearer authority file-only for the orchestrator", async () => {
    const tokenFile = secretFile(
      "orchestrator_http_bearer_token",
      "file-only-control-authority-at-least-32-characters",
    );
    const { exitCode, variables } = await runEntrypoint({
      HTTP_BEARER_TOKEN_FILE: tokenFile,
    });

    expect(exitCode).toBe(0);
    expect(variables.has("HTTP_BEARER_TOKEN")).toBe(false);
    expect(variables.get("HTTP_BEARER_TOKEN_FILE")).toBe(tokenFile);
  });

  test("an empty or unreadable provider secret stops the container", async () => {
    const empty = await runEntrypoint({
      CLOUDFLARE_EMAIL_API_TOKEN_FILE: secretFile("empty_token", ""),
    });
    expect(empty.exitCode).not.toBe(0);
    expect(empty.stderr).toMatch(/is empty/);

    const missing = await runEntrypoint({
      CLOUDFLARE_EMAIL_API_TOKEN_FILE: join(secretsDir, "absent_token"),
    });
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toMatch(/cannot read/);
  });
});
