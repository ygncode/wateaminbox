/**
 * API Client
 * Base HTTP client with authentication, token refresh, and error handling
 */

import { getWorkspaceBillingUrl } from "../billing-url.js";
import type { RefreshResponse } from "./types.js";

// API Configuration
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:4445/api";

// Token storage
let accessToken: string | null = null;
let companyId: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let paymentRedirectStarted = false;

const COMPANY_ID_STORAGE_KEY = "company_id";

function redirectToBillingOnPaymentRequired(status: number): void {
  if (
    status !== 402 ||
    paymentRedirectStarted ||
    !companyId ||
    typeof window === "undefined"
  ) {
    return;
  }

  const billingUrl = getWorkspaceBillingUrl(companyId, { onboarding: true });
  if (!billingUrl) return;

  paymentRedirectStarted = true;
  window.location.replace(billingUrl);
}

export function redirectToBillingForCurrentWorkspace(): void {
  redirectToBillingOnPaymentRequired(402);
}

// Custom error class
export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

// Access tokens intentionally remain in memory. The refresh token is held in
// an HttpOnly cookie and therefore cannot be read by injected JavaScript.
export function initializeAuth(): void {
  try {
    companyId = localStorage.getItem(COMPANY_ID_STORAGE_KEY);
  } catch {
    // localStorage not available
  }
}

export function setAuthToken(access: string): void {
  accessToken = access;
}

export function setCompanyId(id: string): void {
  if (companyId !== id) paymentRedirectStarted = false;
  companyId = id;
  try {
    // Workspace preferences are persisted per user by WorkspaceContext. Remove
    // the former global value after it has been consumed as a migration hint.
    localStorage.removeItem(COMPANY_ID_STORAGE_KEY);
  } catch {
    // localStorage not available
  }
}

export function getCompanyId(): string | null {
  return companyId;
}

export function clearCompanyId(): void {
  companyId = null;
  try {
    localStorage.removeItem(COMPANY_ID_STORAGE_KEY);
  } catch {
    // localStorage not available
  }
}

export function clearAuthTokens(): void {
  accessToken = null;
  companyId = null;
  paymentRedirectStarted = false;
  try {
    localStorage.removeItem(COMPANY_ID_STORAGE_KEY);
  } catch {
    // localStorage not available
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

// Response handler
export async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // A private deployment may require billing before workspace APIs become
    // available. Keep the OSS client commercial-logic-free: HTTP 402 plus the
    // generic configured billing URL is the complete redirect contract.
    redirectToBillingOnPaymentRequired(response.status);
    let errorData: {
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };
    try {
      const jsonResponse = await response.json();
      // Handle both { error: "..." } and { message: "..." } formats from backend
      errorData = {
        code: jsonResponse.code || jsonResponse.error || "UNKNOWN_ERROR",
        message:
          jsonResponse.message ||
          jsonResponse.error ||
          response.statusText ||
          "An unknown error occurred",
        details: jsonResponse.details || jsonResponse.existingContact,
      };
    } catch {
      errorData = {
        code: "UNKNOWN_ERROR",
        message: response.statusText || "An unknown error occurred",
      };
    }
    throw new ApiRequestError(
      response.status,
      errorData.code,
      errorData.message,
      errorData.details,
    );
  }

  // Handle empty responses
  if (response.status === 204) {
    return undefined as T;
  }

  const json = await response.json();
  // Unwrap the data field in these cases:
  // 1. Pure wrapper: { data } - only field is data
  // 2. Legacy format: { success, data } or { success, data, ... } - has success flag
  // Don't unwrap: { data, pagination } - no success flag, multiple fields
  if (json && typeof json === "object" && "data" in json) {
    const keys = Object.keys(json);
    const hasSuccessFlag = "success" in json;
    const isOnlyDataField = keys.length === 1 && keys[0] === "data";

    if (isOnlyDataField || hasSuccessFlag) {
      return json.data as T;
    }
  }
  return json as T;
}

async function performTokenRefresh(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      const data = (await response.json()) as RefreshResponse;
      setAuthToken(data.tokens.accessToken);
      return true;
    }
  } catch (error) {
    console.error("[API] Token refresh failed:", error);
  }

  clearAuthTokens();
  return false;
}

// Coalesce simultaneous 401 responses so a single-use refresh cookie is only
// rotated once.
export function attemptTokenRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// Fetch wrapper with authentication
export async function fetchWithAuth<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (accessToken) {
    (headers as Record<string, string>).Authorization = `Bearer ${accessToken}`;
  }

  // Add company ID header for multi-tenant support
  if (companyId) {
    (headers as Record<string, string>)["X-Company-ID"] = companyId;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  // Handle 401 - attempt token refresh via the HttpOnly cookie.
  if (response.status === 401 && endpoint !== "/auth/refresh") {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      // Retry the request with new token
      (headers as Record<string, string>).Authorization =
        `Bearer ${accessToken}`;
      const retryResponse = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
      });
      return handleResponse<T>(retryResponse);
    }
  }

  return handleResponse<T>(response);
}

/** Fetch an authenticated binary response, including token-refresh retry. */
export async function fetchBlobWithAuth(
  endpoint: string,
  options: RequestInit = {},
): Promise<Blob> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (companyId) headers["X-Company-ID"] = companyId;

  let response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
  if (response.status === 401) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      response = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
      });
    }
  }
  if (!response.ok) await handleResponse<never>(response);
  return response.blob();
}

// Fetch wrapper for FormData requests (file uploads)
// Does not set Content-Type header - browser will set it with boundary
export async function fetchFormDataWithAuth<T>(
  endpoint: string,
  formData: FormData,
  method: "POST" | "PUT" | "PATCH" = "POST",
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {};

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (companyId) {
    headers["X-Company-ID"] = companyId;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: formData,
    credentials: "include",
  });

  // Handle 401 - attempt token refresh via the HttpOnly cookie.
  if (response.status === 401) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      headers.Authorization = `Bearer ${accessToken}`;
      const retryResponse = await fetch(url, {
        method,
        headers,
        body: formData,
        credentials: "include",
      });
      return handleResponse<T>(retryResponse);
    }
  }

  return handleResponse<T>(response);
}

// Build query string from params
export function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

// Basic API object for simple HTTP operations
export async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  return fetchWithAuth<T>(endpoint, options);
}

export const api = {
  get: <T>(endpoint: string) => fetchApi<T>(endpoint),

  post: <T>(endpoint: string, data?: unknown) =>
    fetchApi<T>(endpoint, {
      method: "POST",
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data: unknown) =>
    fetchApi<T>(endpoint, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  patch: <T>(endpoint: string, data: unknown) =>
    fetchApi<T>(endpoint, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: <T>(endpoint: string) =>
    fetchApi<T>(endpoint, {
      method: "DELETE",
    }),
};

// Initialize auth on module load
initializeAuth();
