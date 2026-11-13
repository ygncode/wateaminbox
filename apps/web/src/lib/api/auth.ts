/**
 * Auth API
 * Authentication related API functions
 */

import {
  API_BASE_URL,
  clearAuthTokens,
  fetchWithAuth,
  handleResponse,
  setAuthToken,
} from "./client.js";
import type {
  ChangePasswordRequest,
  CurrentUserResponse,
  ForgotPasswordResponse,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
  VerifyEmailResponse,
} from "./types.js";

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  const response = await fetchWithAuth<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
  setAuthToken(response.tokens.accessToken);
  return response;
}

export async function register(
  data: RegisterRequest,
): Promise<RegisterResponse> {
  const response = await fetchWithAuth<RegisterResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
  // Registration doesn't return tokens - user must verify email and then login
  return response;
}

export async function resendVerification(
  email: string,
  password: string,
  invitationToken?: string,
): Promise<ResendVerificationResponse> {
  return fetchWithAuth<ResendVerificationResponse>(
    "/auth/resend-verification",
    {
      method: "POST",
      body: JSON.stringify({ email, password, invitationToken }),
    },
  );
}

export async function logout(): Promise<void> {
  try {
    await fetchWithAuth("/auth/logout", {
      method: "POST",
    });
  } finally {
    clearAuthTokens();
  }
}

export async function forgotPassword(
  email: string,
): Promise<ForgotPasswordResponse> {
  return fetchWithAuth<ForgotPasswordResponse>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verifyEmail(
  token: string,
  invitationToken?: string,
): Promise<VerifyEmailResponse> {
  return fetchWithAuth<VerifyEmailResponse>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token, invitationToken }),
  });
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  await fetchWithAuth("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

interface GetMeResponse {
  user: CurrentUserResponse;
}

export async function getCurrentUser(): Promise<GetMeResponse["user"]> {
  const response = await fetchWithAuth<GetMeResponse>("/auth/me");
  return response.user;
}

export async function updateCurrentUserProfile(
  input: UpdateProfileRequest,
): Promise<UpdateProfileResponse> {
  return fetchWithAuth<UpdateProfileResponse>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function changeCurrentUserPassword(
  input: ChangePasswordRequest,
): Promise<void> {
  await fetchWithAuth("/auth/change-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function healthCheck(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return handleResponse<{ status: string }>(response);
}

/** Whether this deployment has "Sign in with Google" configured. */
export async function getGoogleSignInStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/google/status`, {
      credentials: "include",
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { enabled?: unknown };
    return body.enabled === true;
  } catch {
    return false;
  }
}

/**
 * URL for a full-page navigation that starts the Google flow. Must be a
 * navigation, not fetch: the API redirects the browser to Google.
 */
export function googleSignInUrl(redirect: string | null): string {
  const base = API_BASE_URL.startsWith("http")
    ? API_BASE_URL
    : new URL(API_BASE_URL, window.location.origin).toString();
  const url = new URL(`${base.replace(/\/$/, "")}/auth/google/start`);
  if (redirect) url.searchParams.set("redirect", redirect);
  return url.toString();
}
