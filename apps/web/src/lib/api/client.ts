/**
 * API Client
 * Base HTTP client with authentication, token refresh, and error handling
 */

import type { RefreshResponse } from './types.js'

// API Configuration
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// Token storage
let accessToken: string | null = null
let refreshToken: string | null = null
let companyId: string | null = null

const TOKEN_STORAGE_KEY = 'auth_token'
const REFRESH_TOKEN_STORAGE_KEY = 'refresh_token'
const COMPANY_ID_STORAGE_KEY = 'company_id'

// Custom error class
export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

// Initialize tokens from storage
export function initializeAuth(): void {
  try {
    accessToken = localStorage.getItem(TOKEN_STORAGE_KEY)
    refreshToken = localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)
    companyId = localStorage.getItem(COMPANY_ID_STORAGE_KEY)
  } catch {
    // localStorage not available
  }
}

export function setAuthTokens(access: string, refresh: string): void {
  accessToken = access
  refreshToken = refresh
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, access)
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refresh)
  } catch {
    // localStorage not available
  }
}

export function setCompanyId(id: string): void {
  companyId = id
  try {
    localStorage.setItem(COMPANY_ID_STORAGE_KEY, id)
  } catch {
    // localStorage not available
  }
}

export function getCompanyId(): string | null {
  return companyId
}

export function clearCompanyId(): void {
  companyId = null
  try {
    localStorage.removeItem(COMPANY_ID_STORAGE_KEY)
  } catch {
    // localStorage not available
  }
}

export function clearAuthTokens(): void {
  accessToken = null
  refreshToken = null
  companyId = null
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
    localStorage.removeItem(COMPANY_ID_STORAGE_KEY)
  } catch {
    // localStorage not available
  }
}

export function getAccessToken(): string | null {
  return accessToken
}

export function getRefreshToken(): string | null {
  return refreshToken
}

// Response handler
export async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: {
      code: string
      message: string
      details?: Record<string, unknown>
    }
    try {
      const jsonResponse = await response.json()
      // Handle both { error: "..." } and { message: "..." } formats from backend
      errorData = {
        code: jsonResponse.code || jsonResponse.error || 'UNKNOWN_ERROR',
        message:
          jsonResponse.message ||
          jsonResponse.error ||
          response.statusText ||
          'An unknown error occurred',
        details: jsonResponse.details || jsonResponse.existingContact,
      }
    } catch {
      errorData = {
        code: 'UNKNOWN_ERROR',
        message: response.statusText || 'An unknown error occurred',
      }
    }
    throw new ApiRequestError(response.status, errorData.code, errorData.message, errorData.details)
  }

  // Handle empty responses
  if (response.status === 204) {
    return undefined as T
  }

  const json = await response.json()
  // Unwrap the data field if the response has the standard { success, data } format
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    return json.data as T
  }
  return json as T
}

// Token refresh attempt
async function attemptTokenRefresh(): Promise<boolean> {
  if (!refreshToken) return false

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    })

    if (response.ok) {
      const data = (await response.json()) as RefreshResponse
      setAuthTokens(data.tokens.accessToken, data.tokens.refreshToken)
      return true
    }
  } catch (error) {
    console.error('[API] Token refresh failed:', error)
  }

  // Clear tokens on refresh failure
  clearAuthTokens()
  return false
}

// Fetch wrapper with authentication
export async function fetchWithAuth<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (accessToken) {
    ;(headers as Record<string, string>).Authorization = `Bearer ${accessToken}`
  }

  // Add company ID header for multi-tenant support
  if (companyId) {
    ;(headers as Record<string, string>)['X-Company-ID'] = companyId
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  // Handle 401 - attempt token refresh
  if (response.status === 401 && refreshToken) {
    const refreshed = await attemptTokenRefresh()
    if (refreshed) {
      // Retry the request with new token
      ;(headers as Record<string, string>).Authorization = `Bearer ${accessToken}`
      const retryResponse = await fetch(url, {
        ...options,
        headers,
      })
      return handleResponse<T>(retryResponse)
    }
  }

  return handleResponse<T>(response)
}

// Fetch wrapper for FormData requests (file uploads)
// Does not set Content-Type header - browser will set it with boundary
export async function fetchFormDataWithAuth<T>(
  endpoint: string,
  formData: FormData,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST'
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`

  const headers: Record<string, string> = {}

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  if (companyId) {
    headers['X-Company-ID'] = companyId
  }

  const response = await fetch(url, {
    method,
    headers,
    body: formData,
  })

  // Handle 401 - attempt token refresh
  if (response.status === 401 && refreshToken) {
    const refreshed = await attemptTokenRefresh()
    if (refreshed) {
      headers.Authorization = `Bearer ${accessToken}`
      const retryResponse = await fetch(url, {
        method,
        headers,
        body: formData,
      })
      return handleResponse<T>(retryResponse)
    }
  }

  return handleResponse<T>(response)
}

// Build query string from params
export function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value))
    }
  }
  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

// Basic API object for simple HTTP operations
export async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  return fetchWithAuth<T>(endpoint, options)
}

export const api = {
  get: <T>(endpoint: string) => fetchApi<T>(endpoint),

  post: <T>(endpoint: string, data?: unknown) =>
    fetchApi<T>(endpoint, {
      method: 'POST',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data: unknown) =>
    fetchApi<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  patch: <T>(endpoint: string, data: unknown) =>
    fetchApi<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: <T>(endpoint: string) =>
    fetchApi<T>(endpoint, {
      method: 'DELETE',
    }),
}

// Initialize auth on module load
initializeAuth()
