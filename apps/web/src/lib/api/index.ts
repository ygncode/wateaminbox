/**
 * API Module Index
 * Re-exports all API functions and types for backward compatibility
 *
 * Usage: import { ... } from "@/lib/api"
 */

// Re-export types
export * from "./types.js"

// Re-export client utilities
export {
  API_BASE_URL,
  ApiRequestError,
  initializeAuth,
  setAuthTokens,
  setCompanyId,
  getCompanyId,
  clearAuthTokens,
  getAccessToken,
  getRefreshToken,
  handleResponse,
  fetchWithAuth,
  buildQueryString,
  fetchApi,
  api,
} from "./client.js"

// Re-export auth functions
export {
  login,
  register,
  logout,
  forgotPassword,
  getCurrentUser,
  healthCheck,
} from "./auth.js"

// Re-export contacts functions
export {
  getContacts,
  getContact,
  updateContact,
  previewContactImport,
  importContacts,
  downloadImportTemplate,
} from "./contacts.js"

// Re-export conversations functions
export {
  getConversations,
  getConversation,
  updateConversation,
  markConversationAsRead,
} from "./conversations.js"

// Re-export messages functions
export {
  getMessages,
  sendMessage,
  deleteMessage,
  uploadMedia,
} from "./messages.js"

// Re-export analytics functions
export {
  getResponseTimeStats,
  getResponseTimeTrend,
  getTeamResponseTimeStats,
  getSlaBreaches,
} from "./analytics.js"

// Re-export companies functions
export { getUserCompanies } from "./companies.js"

// Re-export whatsapp functions
export {
  connectWhatsApp,
  disconnectWhatsApp,
  getWhatsAppStatus,
  listWhatsAppConnections,
  getWhatsAppConnection,
  createWhatsAppConnection,
  reconnectWhatsAppConnection,
  disconnectWhatsAppConnection,
  deleteWhatsAppConnection,
  updateWhatsAppConnection,
  sendWhatsAppMessage,
} from "./whatsapp.js"

// Re-export notifications functions
export {
  getNotificationPreferences,
  updateNotificationPreferences,
  muteContactApi,
  unmuteContactApi,
  getNotifications,
  getNotificationById,
  getUnreadNotificationCount,
  createNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
} from "./notifications.js"

// Re-export quick-replies functions
export {
  getQuickReplies,
  getQuickReplyById,
  getQuickReplyByShortcut,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} from "./quick-replies.js"

// Re-export labels functions
export {
  getWhatsAppLabels,
  getLabelSyncStatus,
  getWhatsAppLabel,
  triggerLabelSync,
  linkTagToLabel,
  unlinkTagFromLabel,
  autoCreateTagsFromLabels,
  getTagsWithLabelStatus,
  applyLabelToContact,
  removeLabelFromContact,
} from "./labels.js"

// Re-export catalogs functions
export {
  getWhatsAppCatalogs,
  getCatalogSyncStatus,
  getWhatsAppCatalog,
  getCatalogProducts,
  triggerCatalogSync,
  triggerCatalogProductsSync,
  archiveCatalog,
  restoreCatalog,
  updateProductVisibility,
} from "./catalogs.js"
