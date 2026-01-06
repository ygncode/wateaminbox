import type { CreateMessageInput, Message } from '@whatsapp-web/shared'

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

// Types
export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface ApiResponse<T> {
  data: T
  meta?: {
    page?: number
    limit?: number
    total?: number
    hasMore?: boolean
  }
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  message: string
  user: {
    id: string
    email: string
    name?: string
    emailVerified: boolean
  }
  tokens: {
    accessToken: string
    refreshToken: string
  }
  session: {
    id: string
    expiresAt: string
  }
}

export interface RegisterRequest {
  email: string
  password: string
  name: string
  companyName?: string
}

export interface RegisterResponse {
  message: string
  user: {
    id: string
    email: string
    emailVerified: boolean
    createdAt: string
  }
}

export interface RefreshResponse {
  message: string
  tokens: {
    accessToken: string
    refreshToken: string
  }
}

export interface Contact {
  id: string
  phoneNumber: string
  jid?: string
  name?: string
  customName?: string
  avatarUrl?: string
  isBlocked: boolean
  isGroup?: boolean
  isOnline?: boolean
  lastSeen?: Date
  createdAt: Date
  updatedAt: Date
}

export interface Conversation {
  id: string
  contactId: string
  contact: Contact
  lastMessage?: Message
  unreadCount: number
  isPinned: boolean
  isMuted: boolean
  assignedUserId?: string
  createdAt: Date
  updatedAt: Date
}

export interface PaginationParams {
  page?: number
  limit?: number
  cursor?: string
}

export interface MessageQueryParams extends PaginationParams {
  before?: string // Message ID to fetch messages before
  after?: string // Message ID to fetch messages after
}

// Token storage
let accessToken: string | null = null
let refreshToken: string | null = null
let companyId: string | null = null

const TOKEN_STORAGE_KEY = 'auth_token'
const REFRESH_TOKEN_STORAGE_KEY = 'refresh_token'
const COMPANY_ID_STORAGE_KEY = 'company_id'

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

// Fetch wrapper with authentication
async function fetchWithAuth<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: ApiError
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

// Build query string from params
function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value))
    }
  }
  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

// =====================
// Basic API object (preserved for backwards compatibility)
// =====================

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

// =====================
// Auth API
// =====================

export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  const response = await fetchWithAuth<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
  setAuthTokens(response.tokens.accessToken, response.tokens.refreshToken)
  return response
}

export async function register(data: RegisterRequest): Promise<RegisterResponse> {
  const response = await fetchWithAuth<RegisterResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  // Registration doesn't return tokens - user must verify email and then login
  return response
}

export async function logout(): Promise<void> {
  try {
    await fetchWithAuth('/auth/logout', {
      method: 'POST',
    })
  } finally {
    clearAuthTokens()
  }
}

export interface ForgotPasswordResponse {
  message: string
}

export async function forgotPassword(email: string): Promise<ForgotPasswordResponse> {
  return fetchWithAuth<ForgotPasswordResponse>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

interface GetMeResponse {
  user: {
    id: string
    email: string
    emailVerified: boolean
  }
}

export async function getCurrentUser(): Promise<GetMeResponse['user']> {
  const response = await fetchWithAuth<GetMeResponse>('/auth/me')
  return response.user
}

// =====================
// Contacts API
// =====================

export async function getContacts(params?: PaginationParams): Promise<ApiResponse<Contact[]>> {
  const query = params ? buildQueryString(params as Record<string, unknown>) : ''
  return fetchWithAuth<ApiResponse<Contact[]>>(`/contacts${query}`)
}

export async function getContact(contactId: string): Promise<Contact> {
  return fetchWithAuth<Contact>(`/contacts/${contactId}`)
}

export async function updateContact(
  contactId: string,
  data: Partial<Pick<Contact, 'customName' | 'isBlocked'>>
): Promise<Contact> {
  return fetchWithAuth<Contact>(`/contacts/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// =====================
// Conversations API
// =====================

export async function getConversations(
  params?: PaginationParams
): Promise<ApiResponse<Conversation[]>> {
  const query = params ? buildQueryString(params as Record<string, unknown>) : ''
  return fetchWithAuth<ApiResponse<Conversation[]>>(`/conversations${query}`)
}

export async function getConversation(conversationId: string): Promise<Conversation> {
  return fetchWithAuth<Conversation>(`/conversations/${conversationId}`)
}

export async function updateConversation(
  conversationId: string,
  data: Partial<Pick<Conversation, 'isPinned' | 'isMuted' | 'assignedUserId'>>
): Promise<Conversation> {
  return fetchWithAuth<Conversation>(`/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function markConversationAsRead(conversationId: string): Promise<void> {
  await fetchWithAuth(`/conversations/${conversationId}/read`, {
    method: 'POST',
  })
}

// =====================
// Messages API
// =====================

export async function getMessages(
  conversationId: string,
  params?: MessageQueryParams
): Promise<ApiResponse<Message[]>> {
  const query = params ? buildQueryString(params as Record<string, unknown>) : ''
  return fetchWithAuth<ApiResponse<Message[]>>(`/conversations/${conversationId}/messages${query}`)
}

export async function sendMessage(
  conversationId: string,
  data: Omit<CreateMessageInput, 'conversationId'>
): Promise<Message> {
  return fetchWithAuth<Message>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<void> {
  await fetchWithAuth(`/conversations/${conversationId}/messages/${messageId}`, {
    method: 'DELETE',
  })
}

// =====================
// Media API
// =====================

export interface UploadMediaResponse {
  success: boolean
  mediaUrl: string
  fileName: string
  fileSize: number
  mimeType: string
}

export async function uploadMedia(file: File): Promise<UploadMediaResponse> {
  const formData = new FormData()
  formData.append('file', file)

  // Get company ID from local storage
  const companyId = getCompanyId()

  const headers: Record<string, string> = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  if (companyId) {
    headers['X-Company-ID'] = companyId
  }

  const response = await fetch(`${API_BASE_URL}/media/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })

  return handleResponse<UploadMediaResponse>(response)
}

// =====================
// Companies API
// =====================

export interface Company {
  id: string
  name: string
  status: 'active' | 'suspended'
  createdAt: string
  updatedAt: string
}

export interface CompanyWithRole extends Company {
  role: 'owner' | 'admin' | 'member'
}

export async function getUserCompanies(): Promise<CompanyWithRole[]> {
  // fetchWithAuth automatically unwraps the { success, data } response
  return fetchWithAuth<CompanyWithRole[]>('/companies')
}

// =====================
// Health Check
// =====================

export async function healthCheck(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE_URL}/health`)
  return handleResponse<{ status: string }>(response)
}

// =====================
// WhatsApp Connection API
// =====================

export interface WhatsAppConnectionStatus {
  status: 'disconnected' | 'pending' | 'connected'
  phoneNumber?: string
  jid?: string
  connectedAt?: string
  lastSync?: string
}

export interface WhatsAppConnectResponse {
  message: string
  websocketUrl: string
}

export async function connectWhatsApp(): Promise<WhatsAppConnectResponse> {
  return fetchWithAuth<WhatsAppConnectResponse>('/whatsapp/connect', {
    method: 'POST',
  })
}

export async function disconnectWhatsApp(): Promise<{ message: string }> {
  return fetchWithAuth<{ message: string }>('/whatsapp/disconnect', {
    method: 'POST',
  })
}

export async function getWhatsAppStatus(): Promise<WhatsAppConnectionStatus> {
  return fetchWithAuth<WhatsAppConnectionStatus>('/whatsapp/status')
}

// =====================
// WhatsApp Multi-Connection API
// =====================

export type WhatsAppConnectionStatusType =
  | 'disconnected'
  | 'pending'
  | 'connected'
  | 'banned'
  | 'error'

export interface WhatsAppConnection {
  id: string
  name: string
  status: WhatsAppConnectionStatusType
  phoneNumber?: string
  jid?: string
  connectedAt?: string
  lastSync?: string
  createdAt: string
  updatedAt: string
}

export interface WhatsAppConnectionsListResponse {
  data: WhatsAppConnection[]
  meta: {
    total: number
  }
}

export interface CreateWhatsAppConnectionResponse {
  data: WhatsAppConnection
  message: string
  websocketUrl: string
}

export interface WhatsAppConnectionDetailResponse {
  data: WhatsAppConnection
}

/**
 * List all WhatsApp connections for the current company
 */
export async function listWhatsAppConnections(): Promise<WhatsAppConnection[]> {
  // Note: fetchWithAuth already unwraps { success, data } format
  // So response is already the array of connections
  return fetchWithAuth<WhatsAppConnection[]>('/whatsapp/connections')
}

/**
 * Get a specific WhatsApp connection by ID
 */
export async function getWhatsAppConnection(connectionId: string): Promise<WhatsAppConnection> {
  // Note: fetchWithAuth already unwraps { success, data } format
  return fetchWithAuth<WhatsAppConnection>(`/whatsapp/connections/${connectionId}`)
}

/**
 * Create a new WhatsApp connection and initiate the pairing process
 */
export async function createWhatsAppConnection(name?: string): Promise<WhatsAppConnection> {
  // Note: fetchWithAuth already unwraps { success, data } format
  return fetchWithAuth<WhatsAppConnection>('/whatsapp/connections', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

/**
 * Reconnect an existing disconnected WhatsApp connection
 */
export async function reconnectWhatsAppConnection(
  connectionId: string
): Promise<{ message: string; websocketUrl: string }> {
  return fetchWithAuth<{ message: string; websocketUrl: string }>(
    `/whatsapp/connections/${connectionId}/reconnect`,
    {
      method: 'POST',
    }
  )
}

/**
 * Disconnect a specific WhatsApp connection
 */
export async function disconnectWhatsAppConnection(
  connectionId: string
): Promise<{ message: string }> {
  return fetchWithAuth<{ message: string }>(`/whatsapp/connections/${connectionId}/disconnect`, {
    method: 'POST',
  })
}

/**
 * Delete a WhatsApp connection permanently
 */
export async function deleteWhatsAppConnection(connectionId: string): Promise<{ message: string }> {
  return fetchWithAuth<{ message: string }>(`/whatsapp/connections/${connectionId}`, {
    method: 'DELETE',
  })
}

/**
 * Update a WhatsApp connection (e.g., rename)
 */
export async function updateWhatsAppConnection(
  connectionId: string,
  data: { name?: string }
): Promise<WhatsAppConnection> {
  // Note: fetchWithAuth already unwraps { success, data } format
  return fetchWithAuth<WhatsAppConnection>(`/whatsapp/connections/${connectionId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function sendWhatsAppMessage(
  jid: string,
  content: string,
  messageType: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text',
  mediaUrl?: string
): Promise<{ message: string; messageId: string }> {
  return fetchWithAuth<{ message: string; messageId: string }>('/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({ jid, content, messageType, mediaUrl }),
  })
}

// =====================
// Contact Import API
// =====================

export interface ContactImportPreview {
  row: number
  phoneNumber: string
  name: string | null
  notes: string | null
  tags: string | null
  exists: boolean
  existingName: string | null
}

export interface ContactImportPreviewResponse {
  total: number
  existingCount: number
  newCount: number
  preview: ContactImportPreview[]
}

export interface ContactImportResult {
  row: number
  phoneNumber: string
  status: 'created' | 'updated' | 'skipped' | 'error'
  error?: string
  contactId?: string
}

export interface ContactImportResponse {
  success: boolean
  summary: {
    total: number
    created: number
    updated: number
    skipped: number
    errors: number
  }
  results: ContactImportResult[]
}

export async function previewContactImport(file: File): Promise<ContactImportPreviewResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const headers: HeadersInit = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  if (companyId) {
    headers['X-Company-ID'] = companyId
  }

  const response = await fetch(`${API_BASE_URL}/contacts/import/preview`, {
    method: 'POST',
    headers,
    body: formData,
  })

  return handleResponse<ContactImportPreviewResponse>(response)
}

export async function importContacts(
  file: File,
  options: { updateExisting?: boolean; createTags?: boolean } = {}
): Promise<ContactImportResponse> {
  const formData = new FormData()
  formData.append('file', file)
  if (options.updateExisting !== undefined) {
    formData.append('updateExisting', String(options.updateExisting))
  }
  if (options.createTags !== undefined) {
    formData.append('createTags', String(options.createTags))
  }

  const headers: HeadersInit = {}
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  if (companyId) {
    headers['X-Company-ID'] = companyId
  }

  const response = await fetch(`${API_BASE_URL}/contacts/import`, {
    method: 'POST',
    headers,
    body: formData,
  })

  return handleResponse<ContactImportResponse>(response)
}

export function downloadImportTemplate(): void {
  const url = `${API_BASE_URL}/contacts/import/template`
  window.open(url, '_blank')
}

// =====================
// Response Time Analytics API
// =====================

export interface ResponseTimeStats {
  averageResponseTimeMinutes: number
  medianResponseTimeMinutes: number
  maxResponseTimeMinutes: number
  minResponseTimeMinutes: number
  totalConversations: number
  withinSlaCount: number
  slaComplianceRate: number
}

export interface ResponseTimeByDate {
  date: string
  averageResponseTimeMinutes: number
  conversationCount: number
  slaComplianceRate: number
}

export interface TeamResponseTimeStats {
  userId: string
  email: string
  averageResponseTimeMinutes: number
  totalResponses: number
  slaComplianceRate: number
}

export interface SlaBreach {
  contactId: string
  contactName: string | null
  inboundMessageTime: string
  responseTime: string | null
  responseMinutes: number
  respondedBy: string | null
}

export async function getResponseTimeStats(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number
): Promise<{
  data: ResponseTimeStats
  meta: { startDate: string; endDate: string; slaThresholdMinutes: number }
}> {
  const params = new URLSearchParams()
  if (startDate) params.append('startDate', startDate.toISOString())
  if (endDate) params.append('endDate', endDate.toISOString())
  if (slaThreshold) params.append('slaThreshold', String(slaThreshold))

  const query = params.toString() ? `?${params.toString()}` : ''
  return fetchWithAuth(`/analytics/response-time${query}`)
}

export async function getResponseTimeTrend(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number
): Promise<{
  data: ResponseTimeByDate[]
  meta: { startDate: string; endDate: string; slaThresholdMinutes: number }
}> {
  const params = new URLSearchParams()
  if (startDate) params.append('startDate', startDate.toISOString())
  if (endDate) params.append('endDate', endDate.toISOString())
  if (slaThreshold) params.append('slaThreshold', String(slaThreshold))

  const query = params.toString() ? `?${params.toString()}` : ''
  return fetchWithAuth(`/analytics/response-time/trend${query}`)
}

export async function getTeamResponseTimeStats(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number
): Promise<{
  data: TeamResponseTimeStats[]
  meta: { startDate: string; endDate: string; slaThresholdMinutes: number }
}> {
  const params = new URLSearchParams()
  if (startDate) params.append('startDate', startDate.toISOString())
  if (endDate) params.append('endDate', endDate.toISOString())
  if (slaThreshold) params.append('slaThreshold', String(slaThreshold))

  const query = params.toString() ? `?${params.toString()}` : ''
  return fetchWithAuth(`/analytics/response-time/team${query}`)
}

export async function getSlaBreaches(
  startDate?: Date,
  endDate?: Date,
  slaThreshold?: number,
  limit?: number
): Promise<{
  data: SlaBreach[]
  meta: { startDate: string; endDate: string; slaThresholdMinutes: number }
}> {
  const params = new URLSearchParams()
  if (startDate) params.append('startDate', startDate.toISOString())
  if (endDate) params.append('endDate', endDate.toISOString())
  if (slaThreshold) params.append('slaThreshold', String(slaThreshold))
  if (limit) params.append('limit', String(limit))

  const query = params.toString() ? `?${params.toString()}` : ''
  return fetchWithAuth(`/analytics/sla-breaches${query}`)
}

// =====================
// Notification Preferences API
// =====================

export type SoundChoice = 'default' | 'chime' | 'bell' | 'pop' | 'none'

export interface NotificationPreferencesResponse {
  id: string
  userId: string
  soundEnabled: boolean
  soundChoice: SoundChoice
  quietHoursStart: string | null
  quietHoursEnd: string | null
  mutedContacts: string[]
  createdAt: string
  updatedAt: string
}

export interface UpdateNotificationPreferencesInput {
  soundEnabled?: boolean
  soundChoice?: SoundChoice
  quietHoursStart?: string | null
  quietHoursEnd?: string | null
  mutedContacts?: string[]
}

export async function getNotificationPreferences(): Promise<NotificationPreferencesResponse> {
  const response = await fetchWithAuth<{
    data: NotificationPreferencesResponse
  }>('/notifications/preferences')
  return response.data
}

export async function updateNotificationPreferences(
  input: UpdateNotificationPreferencesInput
): Promise<NotificationPreferencesResponse> {
  const response = await fetchWithAuth<{
    data: NotificationPreferencesResponse
  }>('/notifications/preferences', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return response.data
}

export async function muteContactApi(contactJid: string): Promise<{ mutedContacts: string[] }> {
  const response = await fetchWithAuth<{ data: { mutedContacts: string[] } }>(
    '/notifications/mute',
    {
      method: 'POST',
      body: JSON.stringify({ contactJid }),
    }
  )
  return response.data
}

export async function unmuteContactApi(contactJid: string): Promise<{ mutedContacts: string[] }> {
  const response = await fetchWithAuth<{ data: { mutedContacts: string[] } }>(
    '/notifications/unmute',
    {
      method: 'POST',
      body: JSON.stringify({ contactJid }),
    }
  )
  return response.data
}

// =====================
// Notification History API (In-App Notification Center)
// =====================

export type NotificationType = 'message' | 'mention' | 'assignment' | 'team' | 'system'

export interface InAppNotification {
  id: string
  userId: string
  notificationType: NotificationType
  title: string
  message: string | null
  actionUrl: string | null
  metadata: Record<string, unknown> | null
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export interface NotificationListParams {
  limit?: number
  offset?: number
  unreadOnly?: boolean
}

export interface NotificationListResponse {
  data: InAppNotification[]
  meta: {
    total: number
    unreadCount: number
    limit: number
    offset: number
  }
}

export interface CreateNotificationInput {
  notificationType: NotificationType
  title: string
  message?: string
  actionUrl?: string
  metadata?: Record<string, unknown>
}

export async function getNotifications(
  params: NotificationListParams = {}
): Promise<NotificationListResponse> {
  const query = buildQueryString(params as Record<string, unknown>)
  return fetchWithAuth<NotificationListResponse>(`/notifications${query}`)
}

export async function getNotificationById(notificationId: string): Promise<InAppNotification> {
  const response = await fetchWithAuth<{ data: InAppNotification }>(
    `/notifications/${notificationId}`
  )
  return response.data
}

export async function getUnreadNotificationCount(): Promise<number> {
  const response = await fetchWithAuth<{ data: { unreadCount: number } }>('/notifications/count')
  return response.data.unreadCount
}

export async function createNotification(
  input: CreateNotificationInput
): Promise<InAppNotification> {
  const response = await fetchWithAuth<{ data: InAppNotification }>('/notifications', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.data
}

export async function markNotificationAsRead(notificationId: string): Promise<InAppNotification> {
  const response = await fetchWithAuth<{ data: InAppNotification }>(
    `/notifications/${notificationId}/read`,
    {
      method: 'PATCH',
    }
  )
  return response.data
}

export async function markAllNotificationsAsRead(): Promise<number> {
  const response = await fetchWithAuth<{ data: { markedAsRead: number } }>(
    '/notifications/read-all',
    {
      method: 'POST',
    }
  )
  return response.data.markedAsRead
}

export async function deleteNotification(notificationId: string): Promise<boolean> {
  const response = await fetchWithAuth<{ data: { deleted: boolean } }>(
    `/notifications/${notificationId}`,
    {
      method: 'DELETE',
    }
  )
  return response.data.deleted
}

// =====================
// Quick Replies API
// =====================

export interface QuickReply {
  id: string
  shortcut: string
  title: string
  content: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface QuickReplyListParams {
  search?: string
  limit?: number
  offset?: number
}

export interface CreateQuickReplyInput {
  shortcut: string
  title: string
  content: string
}

export interface UpdateQuickReplyInput {
  shortcut?: string
  title?: string
  content?: string
}

export interface QuickReplyListResponse {
  data: QuickReply[]
  meta: {
    total: number
    limit: number
    offset: number
  }
}

export async function getQuickReplies(
  params?: QuickReplyListParams
): Promise<QuickReplyListResponse> {
  const query = params ? buildQueryString(params as Record<string, unknown>) : ''
  return fetchWithAuth<QuickReplyListResponse>(`/quick-replies${query}`)
}

export async function getQuickReplyById(quickReplyId: string): Promise<QuickReply> {
  const response = await fetchWithAuth<{ data: QuickReply }>(`/quick-replies/${quickReplyId}`)
  return response.data
}

export async function getQuickReplyByShortcut(shortcut: string): Promise<QuickReply | null> {
  try {
    const response = await fetchWithAuth<{ data: QuickReply }>(
      `/quick-replies/search/${encodeURIComponent(shortcut)}`
    )
    return response.data
  } catch (error) {
    if (error instanceof ApiRequestError && error.statusCode === 404) {
      return null
    }
    throw error
  }
}

export async function createQuickReply(input: CreateQuickReplyInput): Promise<QuickReply> {
  const response = await fetchWithAuth<{ data: QuickReply }>('/quick-replies', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.data
}

export async function updateQuickReply(
  quickReplyId: string,
  input: UpdateQuickReplyInput
): Promise<QuickReply> {
  const response = await fetchWithAuth<{ data: QuickReply }>(`/quick-replies/${quickReplyId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return response.data
}

export async function deleteQuickReply(quickReplyId: string): Promise<boolean> {
  const response = await fetchWithAuth<{ data: { deleted: boolean } }>(
    `/quick-replies/${quickReplyId}`,
    {
      method: 'DELETE',
    }
  )
  return response.data.deleted
}

// =====================
// WhatsApp Labels API
// =====================

export interface WhatsAppLabel {
  id: string
  labelId: string
  name: string
  color: string | null
  predefinedId: number | null
  syncedTagId: string | null
  lastSyncedAt: string
  createdAt: string
  updatedAt: string
}

export interface LabelSyncStatus {
  totalLabels: number
  linkedLabels: number
  unlinkedLabels: number
  totalTags: number
  linkedTags: number
  lastSyncAt: string | null
}

export interface TagWithLabelStatus {
  id: string
  name: string
  color: string | null
  createdBy: string | null
  createdAt: string
  whatsappLabelId: string | null
  syncedAt: string | null
  linkedLabel: {
    labelId: string
    name: string
    color: string | null
  } | null
}

export interface LabelListResponse {
  data: WhatsAppLabel[]
}

export interface TagsWithStatusResponse {
  data: TagWithLabelStatus[]
}

export interface SyncLabelsResponse {
  message: string
  status: string
}

export interface LinkTagResponse {
  success: boolean
  message: string
}

export interface AutoCreateTagsResponse {
  success: boolean
  message: string
  created: number
  linked: number
}

/**
 * Get all WhatsApp labels
 */
export async function getWhatsAppLabels(): Promise<WhatsAppLabel[]> {
  const response = await fetchWithAuth<LabelListResponse>('/labels')
  return response.data
}

/**
 * Get label sync status summary
 */
export async function getLabelSyncStatus(): Promise<LabelSyncStatus> {
  return fetchWithAuth<LabelSyncStatus>('/labels/status')
}

/**
 * Get a specific WhatsApp label
 */
export async function getWhatsAppLabel(labelId: string): Promise<WhatsAppLabel> {
  return fetchWithAuth<WhatsAppLabel>(`/labels/${labelId}`)
}

/**
 * Trigger a sync of labels from WhatsApp
 */
export async function triggerLabelSync(): Promise<SyncLabelsResponse> {
  return fetchWithAuth<SyncLabelsResponse>('/labels/sync', {
    method: 'POST',
  })
}

/**
 * Link a tag to a WhatsApp label
 */
export async function linkTagToLabel(labelId: string, tagId: string): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(`/labels/${labelId}/link`, {
    method: 'POST',
    body: JSON.stringify({ tagId }),
  })
}

/**
 * Unlink a tag from a WhatsApp label
 */
export async function unlinkTagFromLabel(labelId: string): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(`/labels/${labelId}/link`, {
    method: 'DELETE',
  })
}

/**
 * Auto-create tags from unlinked WhatsApp labels
 */
export async function autoCreateTagsFromLabels(): Promise<AutoCreateTagsResponse> {
  return fetchWithAuth<AutoCreateTagsResponse>('/labels/auto-create', {
    method: 'POST',
  })
}

/**
 * Get all tags with their WhatsApp label sync status
 */
export async function getTagsWithLabelStatus(): Promise<TagWithLabelStatus[]> {
  const response = await fetchWithAuth<TagsWithStatusResponse>('/labels/tags/with-status')
  return response.data
}

/**
 * Apply a WhatsApp label to a contact
 */
export async function applyLabelToContact(
  labelId: string,
  contactId: string
): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(`/labels/${labelId}/apply/${contactId}`, {
    method: 'POST',
  })
}

/**
 * Remove a WhatsApp label from a contact
 */
export async function removeLabelFromContact(
  labelId: string,
  contactId: string
): Promise<LinkTagResponse> {
  return fetchWithAuth<LinkTagResponse>(`/labels/${labelId}/apply/${contactId}`, {
    method: 'DELETE',
  })
}

// =====================
// WhatsApp Catalogs API
// =====================

export type CatalogStatus = 'active' | 'inactive' | 'archived'
export type ProductVisibility = 'visible' | 'hidden'

export interface WhatsAppCatalog {
  id: string
  catalogId: string
  name: string
  description: string | null
  currency: string
  status: CatalogStatus
  businessJid: string | null
  headerImageUrl: string | null
  productCount: number
  lastSyncedAt: string
  createdAt: string
  updatedAt: string
}

export interface CatalogProduct {
  id: string
  productId: string
  catalogId: string
  name: string
  description: string | null
  price: number | null
  currency: string
  imageUrls: string[] | null
  sku: string | null
  category: string | null
  availability: string
  visibility: ProductVisibility
  url: string | null
  retailerId: string | null
  createdAt: string
  updatedAt: string
}

export interface CatalogSyncStatus {
  totalCatalogs: number
  activeCatalogs: number
  totalProducts: number
  lastSyncAt: string | null
}

export interface CatalogListResponse {
  data: WhatsAppCatalog[]
}

export interface CatalogProductsResponse {
  data: CatalogProduct[]
  meta: {
    catalogId: string
    catalogName: string
    totalProducts: number
  }
}

export interface SyncCatalogsResponse {
  message: string
  status: string
  catalogId?: string
}

export interface CatalogActionResponse {
  success: boolean
  message: string
}

/**
 * Get all WhatsApp Business catalogs
 */
export async function getWhatsAppCatalogs(): Promise<WhatsAppCatalog[]> {
  const response = await fetchWithAuth<CatalogListResponse>('/catalogs')
  return response.data
}

/**
 * Get catalog sync status summary
 */
export async function getCatalogSyncStatus(): Promise<CatalogSyncStatus> {
  return fetchWithAuth<CatalogSyncStatus>('/catalogs/status')
}

/**
 * Get a specific catalog by ID
 */
export async function getWhatsAppCatalog(catalogId: string): Promise<WhatsAppCatalog> {
  return fetchWithAuth<WhatsAppCatalog>(`/catalogs/${catalogId}`)
}

/**
 * Get products for a specific catalog
 */
export async function getCatalogProducts(catalogId: string): Promise<CatalogProductsResponse> {
  return fetchWithAuth<CatalogProductsResponse>(`/catalogs/${catalogId}/products`)
}

/**
 * Trigger a sync of catalogs from WhatsApp Business
 */
export async function triggerCatalogSync(): Promise<SyncCatalogsResponse> {
  return fetchWithAuth<SyncCatalogsResponse>('/catalogs/sync', {
    method: 'POST',
  })
}

/**
 * Trigger a sync of products for a specific catalog
 */
export async function triggerCatalogProductsSync(catalogId: string): Promise<SyncCatalogsResponse> {
  return fetchWithAuth<SyncCatalogsResponse>(`/catalogs/${catalogId}/sync-products`, {
    method: 'POST',
  })
}

/**
 * Archive a catalog
 */
export async function archiveCatalog(catalogId: string): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(`/catalogs/${catalogId}/archive`, {
    method: 'POST',
  })
}

/**
 * Restore an archived catalog
 */
export async function restoreCatalog(catalogId: string): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(`/catalogs/${catalogId}/restore`, {
    method: 'POST',
  })
}

/**
 * Update product visibility
 */
export async function updateProductVisibility(
  catalogId: string,
  productId: string,
  visibility: ProductVisibility
): Promise<CatalogActionResponse> {
  return fetchWithAuth<CatalogActionResponse>(
    `/catalogs/${catalogId}/products/${productId}/visibility`,
    {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    }
  )
}

// Initialize auth on module load
initializeAuth()
