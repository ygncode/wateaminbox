import { beforeAll, describe, expect, test } from "bun:test";
import * as jose from "jose";
import { AuthError } from "../lib/errors.js";

import {
  beginGoogleFlow,
  exchangeGoogleCode,
  openGoogleFlow,
  safeRedirectPath,
  sameSecret,
  verifyGoogleIdToken,
} from "./google-auth.service.js";

// Injected by src/test-env.ts (bunfig preload) before lib/env.ts loads.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID as string;
let privateKey: CryptoKey;
let keys: jose.JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await jose.generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = {
    ...(await jose.exportJWK(pair.publicKey)),
    kid: "k1",
    alg: "RS256",
  };
  keys = jose.createLocalJWKSet({ keys: [jwk] });
});

async function idToken(
  claims: Record<string, unknown>,
  options: { audience?: string; issuer?: string; expires?: string } = {},
) {
  return new jose.SignJWT({
    sub: "google-subject-1",
    email: "Person@Example.com",
    email_verified: true,
    name: "Person Example",
    nonce: "expected-nonce",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(options.issuer ?? "https://accounts.google.com")
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(options.expires ?? "5m")
    .sign(privateKey);
}

async function rejection(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    return error as AuthError;
  }
  throw new Error("expected rejection");
}

describe("verifyGoogleIdToken", () => {
  test("accepts a valid token and normalizes the email", async () => {
    const profile = await verifyGoogleIdToken(
      await idToken({}),
      "expected-nonce",
      keys,
    );
    expect(profile).toEqual({
      subject: "google-subject-1",
      email: "person@example.com",
      name: "Person Example",
    });
  });

  test("rejects another client's audience", async () => {
    const error = await rejection(
      verifyGoogleIdToken(
        await idToken({}, { audience: "someone-else" }),
        "expected-nonce",
        keys,
      ),
    );
    expect(error.code).toBe("GOOGLE_TOKEN_INVALID");
  });

  test("rejects a foreign issuer", async () => {
    const error = await rejection(
      verifyGoogleIdToken(
        await idToken({}, { issuer: "https://evil.example" }),
        "expected-nonce",
        keys,
      ),
    );
    expect(error.code).toBe("GOOGLE_TOKEN_INVALID");
  });

  test("rejects an expired token", async () => {
    const error = await rejection(
      verifyGoogleIdToken(
        await idToken({}, { expires: "-10m" }),
        "expected-nonce",
        keys,
      ),
    );
    expect(error.code).toBe("GOOGLE_TOKEN_INVALID");
  });

  test("rejects a replayed token with a different nonce", async () => {
    const error = await rejection(
      verifyGoogleIdToken(await idToken({}), "other-nonce", keys),
    );
    expect(error.code).toBe("GOOGLE_TOKEN_INVALID");
  });

  test("rejects a token signed by an unknown key", async () => {
    const stranger = await jose.generateKeyPair("RS256");
    const forged = await new jose.SignJWT({
      sub: "x",
      email: "a@b.co",
      email_verified: true,
      nonce: "expected-nonce",
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(CLIENT_ID)
      .setExpirationTime("5m")
      .sign(stranger.privateKey);
    const error = await rejection(
      verifyGoogleIdToken(forged, "expected-nonce", keys),
    );
    expect(error.code).toBe("GOOGLE_TOKEN_INVALID");
  });

  test("refuses an unverified Google email", async () => {
    const error = await rejection(
      verifyGoogleIdToken(
        await idToken({ email_verified: false }),
        "expected-nonce",
        keys,
      ),
    );
    expect(error.code).toBe("GOOGLE_EMAIL_UNVERIFIED");
  });
});

describe("flow cookie", () => {
  test("round-trips state, PKCE verifier, nonce and a safe redirect", async () => {
    const { url, cookie } = await beginGoogleFlow("/invite/abc");
    const flow = await openGoogleFlow(cookie);
    expect(flow?.redirect).toBe("/invite/abc");

    const params = new URL(url).searchParams;
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("state")).toBe(flow?.state ?? "missing");
    expect(params.get("nonce")).toBe(flow?.nonce ?? "missing");
    expect(params.get("code_challenge_method")).toBe("S256");
    const expected = Buffer.from(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(flow?.verifier ?? ""),
      ),
    ).toString("base64url");
    expect(params.get("code_challenge")).toBe(expected);
    // The verifier must never travel through the browser URL.
    expect(url).not.toContain(flow?.verifier ?? "missing");
  });

  test("drops an off-site redirect", async () => {
    const { cookie } = await beginGoogleFlow("https://evil.example/");
    expect((await openGoogleFlow(cookie))?.redirect).toBeNull();
  });

  test("rejects a tampered or missing cookie", async () => {
    const { cookie } = await beginGoogleFlow(null);
    const tampered = `${cookie.slice(0, -2)}${cookie.endsWith("A") ? "B" : "A"}`;
    expect(await openGoogleFlow(tampered)).toBeNull();
    expect(await openGoogleFlow(undefined)).toBeNull();
  });
});

describe("exchangeGoogleCode", () => {
  test("sends the PKCE verifier and fails closed on a provider error", async () => {
    const { cookie } = await beginGoogleFlow(null);
    const flow = await openGoogleFlow(cookie);
    if (!flow) throw new Error("flow");
    let sent: URLSearchParams | null = null;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return new Response("{}", { status: 400 });
    }) as unknown as typeof fetch;

    const error = await rejection(
      exchangeGoogleCode("the-code", flow, fetcher),
    );
    expect(error.code).toBe("GOOGLE_EXCHANGE_FAILED");
    const body = sent as unknown as URLSearchParams;
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe(flow.verifier);
    expect(body.get("grant_type")).toBe("authorization_code");
  });
});

describe("helpers", () => {
  test("safeRedirectPath allows only same-origin paths", () => {
    expect(safeRedirectPath("/chat")).toBe("/chat");
    expect(safeRedirectPath("//evil.example")).toBeNull();
    expect(safeRedirectPath("/\\evil.example")).toBeNull();
    expect(safeRedirectPath("https://evil.example")).toBeNull();
    expect(safeRedirectPath(null)).toBeNull();
  });

  test("sameSecret compares exactly", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abd")).toBe(false);
    expect(sameSecret("abc", "abcd")).toBe(false);
  });
});
