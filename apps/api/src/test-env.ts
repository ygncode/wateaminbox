/**
 * Test-only environment bootstrap, loaded via `preload` in apps/api/bunfig.toml
 * before any test module is imported.
 *
 * The signing secrets deliberately have no built-in default (see lib/env.ts):
 * a server that forgot NODE_ENV must fail to start rather than run with a key
 * published in this repository. Tests therefore have to inject their own.
 * These values exist only inside the test process and are never a fallback for
 * a running server.
 *
 * Existing values win, so CI or a developer can point the suite at different
 * credentials without editing this file.
 */
const TEST_ENV: Record<string, string> = {
  JWT_SECRET: "test-only-jwt-signing-secret-with-enough-entropy-1",
  CENTRIFUGO_TOKEN_HMAC_SECRET:
    "test-only-centrifugo-signing-secret-with-entropy-2",
  // A fake Google OAuth client so the sign-in flow is exercised. It never
  // reaches Google: tests inject their own key set and token endpoint.
  GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-only-google-client-secret",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (!process.env[key]?.trim()) {
    process.env[key] = value;
  }
}
