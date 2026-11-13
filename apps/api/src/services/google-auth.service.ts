/**
 * "Sign in with Google" (OpenID Connect authorization-code flow with PKCE).
 *
 * The browser is sent to Google with a random `state`, a PKCE challenge and a
 * `nonce`. The three secrets live only in a short-lived, HttpOnly, signed
 * cookie scoped to the callback path, so nothing has to be stored server-side
 * and any API replica can finish the flow. On return the callback exchanges
 * the code server-to-server, verifies the ID token signature against Google's
 * published keys, and checks issuer, audience, expiry, nonce and
 * `email_verified` before trusting any claim.
 *
 * Account resolution, in order:
 *   1. A linked identity (provider subject) signs in its user.
 *   2. Otherwise an existing user with the same verified email is linked and
 *      signed in. Google has proven control of that address, which is the same
 *      proof our own verification email provides.
 *   3. Otherwise a new user is created, already verified, with an unusable
 *      random password (they can set one later through "Forgot password").
 */
import crypto from "node:crypto";
import { db } from "@wateaminbox/database";
import * as jose from "jose";
import { env } from "../lib/env.js";
import { AuthError, isUniqueViolation } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";
import { hashPassword } from "../lib/password.js";
import {
  type AuthTokens,
  type AuthUser,
  type DeviceInfo,
  issueSessionForVerifiedUser,
  type UserSession,
} from "./auth.service.js";

const logger = createLogger("GoogleAuth");

export const GOOGLE_PROVIDER = "google";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** The browser has this long to complete the round trip through Google. */
export const FLOW_TTL_SECONDS = 10 * 60;
const FLOW_AUDIENCE = "wateaminbox-google-flow";

const googleKeys = jose.createRemoteJWKSet(JWKS_URL, {
  timeoutDuration: 5_000,
  cooldownDuration: 30_000,
});

export function isGoogleSignInEnabled(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Public callback URL registered with Google. */
export function googleRedirectUri(): string {
  return (
    env.GOOGLE_REDIRECT_URI ||
    new URL("/api/auth/google/callback", env.APP_URL).toString()
  );
}

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function randomSecret(): string {
  return base64url(crypto.randomBytes(32));
}

function flowKey(): Uint8Array {
  // Derive a purpose-bound key so a flow cookie can never be confused with an
  // access or refresh token signed by the same JWT secret.
  return new Uint8Array(
    crypto
      .createHmac("sha256", env.JWT_SECRET)
      .update("google-sign-in-flow/v1")
      .digest(),
  );
}

export interface GoogleFlow {
  state: string;
  verifier: string;
  nonce: string;
  /** Same-origin path to return to after sign-in (already sanitized). */
  redirect: string | null;
}

/** Only same-origin application paths are acceptable post-auth targets. */
export function safeRedirectPath(
  value: string | null | undefined,
): string | null {
  if (!value || value.length > 512) return null;
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return null;
  }
  return value;
}

/** Start a flow: returns the Google URL and the sealed cookie value. */
export async function beginGoogleFlow(
  redirect: string | null,
): Promise<{ url: string; cookie: string }> {
  const flow: GoogleFlow = {
    state: randomSecret(),
    verifier: randomSecret(),
    nonce: randomSecret(),
    redirect: safeRedirectPath(redirect),
  };
  const challenge = base64url(
    crypto.createHash("sha256").update(flow.verifier).digest(),
  );

  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  const cookie = await new jose.SignJWT({ ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(FLOW_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${FLOW_TTL_SECONDS}s`)
    .sign(flowKey());

  return { url: url.toString(), cookie };
}

/** Open the flow cookie, or null when it is missing, forged or expired. */
export async function openGoogleFlow(
  cookie: string | undefined,
): Promise<GoogleFlow | null> {
  if (!cookie) return null;
  try {
    const { payload } = await jose.jwtVerify(cookie, flowKey(), {
      audience: FLOW_AUDIENCE,
      algorithms: ["HS256"],
    });
    const { state, verifier, nonce, redirect } = payload as Record<
      string,
      unknown
    >;
    if (
      typeof state !== "string" ||
      typeof verifier !== "string" ||
      typeof nonce !== "string"
    ) {
      return null;
    }
    return {
      state,
      verifier,
      nonce,
      redirect: safeRedirectPath(
        typeof redirect === "string" ? redirect : null,
      ),
    };
  } catch {
    return null;
  }
}

/** Constant-time string comparison for the returned `state`. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export interface GoogleProfile {
  subject: string;
  email: string;
  name: string | null;
}

/** Exchange the authorization code and return the verified identity. */
export async function exchangeGoogleCode(
  code: string,
  flow: GoogleFlow,
  fetcher: typeof fetch = fetch,
): Promise<GoogleProfile> {
  const response = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: flow.verifier,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Never log the body: it can echo the code or client details.
    logger.warn({ status: response.status }, "Google token exchange failed");
    throw new AuthError("Google sign-in failed", "GOOGLE_EXCHANGE_FAILED", 502);
  }
  const body = (await response.json().catch(() => null)) as {
    id_token?: unknown;
  } | null;
  if (typeof body?.id_token !== "string") {
    throw new AuthError("Google sign-in failed", "GOOGLE_EXCHANGE_FAILED", 502);
  }
  return verifyGoogleIdToken(body.id_token, flow.nonce);
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedNonce: string,
  keys: jose.JWTVerifyGetKey = googleKeys,
): Promise<GoogleProfile> {
  let claims: jose.JWTPayload;
  try {
    ({ payload: claims } = await jose.jwtVerify(idToken, keys, {
      issuer: ISSUERS,
      audience: env.GOOGLE_CLIENT_ID,
      algorithms: ["RS256"],
      clockTolerance: 60,
    }));
  } catch {
    throw new AuthError("Google sign-in failed", "GOOGLE_TOKEN_INVALID", 401);
  }

  if (
    typeof claims.nonce !== "string" ||
    !sameSecret(claims.nonce, expectedNonce)
  ) {
    throw new AuthError("Google sign-in failed", "GOOGLE_TOKEN_INVALID", 401);
  }
  const email = typeof claims.email === "string" ? claims.email : "";
  if (!claims.sub || !email || claims.email_verified !== true) {
    throw new AuthError(
      "Your Google account email is not verified",
      "GOOGLE_EMAIL_UNVERIFIED",
      403,
    );
  }
  const name = typeof claims.name === "string" ? claims.name.slice(0, 255) : "";
  return {
    subject: claims.sub,
    email: email.trim().toLowerCase(),
    name: name.trim() || null,
  };
}

/**
 * Find, link or create the user for a verified Google identity and start a
 * session. Returns `created` so the caller can distinguish sign-up from login.
 */
export async function signInWithGoogle(
  profile: GoogleProfile,
  deviceInfo?: DeviceInfo,
): Promise<{
  user: AuthUser;
  tokens: AuthTokens;
  session: UserSession;
  created: boolean;
}> {
  const { userId, created } = await resolveGoogleUser(profile);
  const result = await issueSessionForVerifiedUser(userId, deviceInfo);
  if (!result) {
    // Only reachable if the account became unverified between resolution and
    // session creation (a racing email change). Fail closed.
    throw new AuthError("Google sign-in failed", "GOOGLE_SIGN_IN_FAILED", 409);
  }
  return { ...result, created };
}

async function resolveGoogleUser(
  profile: GoogleProfile,
): Promise<{ userId: string; created: boolean }> {
  try {
    return await linkOrCreate(profile);
  } catch (error) {
    // Two concurrent first sign-ins can race on either unique key. The loser
    // simply retries once; by then the winner's rows are visible.
    if (isUniqueViolation(error)) return linkOrCreate(profile);
    throw error;
  }
}

async function linkOrCreate(
  profile: GoogleProfile,
): Promise<{ userId: string; created: boolean }> {
  // Hash outside the transaction: bcrypt is deliberately slow.
  const unusablePasswordHash = await hashPassword(randomSecret());

  return db.transaction().execute(async (trx) => {
    const linked = await trx
      .selectFrom("user_identities")
      .where("provider", "=", GOOGLE_PROVIDER)
      .where("subject", "=", profile.subject)
      .select("user_id")
      .executeTakeFirst();
    if (linked) {
      await trx
        .updateTable("user_identities")
        .set({ last_used_at: new Date(), email: profile.email })
        .where("provider", "=", GOOGLE_PROVIDER)
        .where("subject", "=", profile.subject)
        .execute();
      return { userId: linked.user_id, created: false };
    }

    const existing = await trx
      .selectFrom("users")
      .where("email", "=", profile.email)
      .select(["id", "email_verified_at"])
      .forUpdate()
      .executeTakeFirst();

    if (existing) {
      const otherGoogle = await trx
        .selectFrom("user_identities")
        .where("user_id", "=", existing.id)
        .where("provider", "=", GOOGLE_PROVIDER)
        .select("id")
        .executeTakeFirst();
      if (otherGoogle) {
        // The address belongs to a user already bound to a different Google
        // account. Refuse rather than silently re-binding the account.
        throw new AuthError(
          "This email is linked to a different Google account",
          "GOOGLE_ACCOUNT_MISMATCH",
          409,
        );
      }
      await trx
        .insertInto("user_identities")
        .values({
          user_id: existing.id,
          provider: GOOGLE_PROVIDER,
          subject: profile.subject,
          email: profile.email,
        })
        .execute();
      if (!existing.email_verified_at) {
        // Nobody ever proved control of this address, so whoever chose the
        // password may not be the owner (pre-registration takeover: an
        // attacker signs up with the victim's email and waits). Google has now
        // proven ownership, so the unproven password and anything issued on
        // its strength are discarded before the account is marked verified.
        await trx
          .updateTable("users")
          .set({
            email_verified_at: new Date(),
            password_hash: unusablePasswordHash,
            updated_at: new Date(),
          })
          .where("id", "=", existing.id)
          .execute();
        await trx
          .deleteFrom("auth_tokens")
          .where("user_id", "=", existing.id)
          .execute();
        await trx
          .deleteFrom("user_sessions")
          .where("user_id", "=", existing.id)
          .execute();
      }
      return { userId: existing.id, created: false };
    }

    const user = await trx
      .insertInto("users")
      .values({
        email: profile.email,
        name: profile.name,
        password_hash: unusablePasswordHash,
        email_verified_at: new Date(),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("user_identities")
      .values({
        user_id: user.id,
        provider: GOOGLE_PROVIDER,
        subject: profile.subject,
        email: profile.email,
      })
      .execute();
    return { userId: user.id, created: true };
  });
}
