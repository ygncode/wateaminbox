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
): Promise<ResendVerificationResponse> {
  return fetchWithAuth<ResendVerificationResponse>(
    "/auth/resend-verification",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
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

export async function verifyEmail(token: string): Promise<void> {
  await fetchWithAuth("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
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
