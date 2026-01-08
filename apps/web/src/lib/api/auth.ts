/**
 * Auth API
 * Authentication related API functions
 */

import {
  fetchWithAuth,
  setAuthTokens,
  clearAuthTokens,
  API_BASE_URL,
  handleResponse,
} from "./client.js";
import type {
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  ForgotPasswordResponse,
} from "./types.js";

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  const response = await fetchWithAuth<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
  setAuthTokens(response.tokens.accessToken, response.tokens.refreshToken);
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

interface GetMeResponse {
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
  };
}

export async function getCurrentUser(): Promise<GetMeResponse["user"]> {
  const response = await fetchWithAuth<GetMeResponse>("/auth/me");
  return response.user;
}

export async function healthCheck(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return handleResponse<{ status: string }>(response);
}
