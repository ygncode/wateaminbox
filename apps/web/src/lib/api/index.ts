/**
 * API Module Index
 * Re-exports all API functions and types for backward compatibility
 *
 * Usage: import { ... } from "@/lib/api"
 */

// Re-export analytics functions
export {
  getResponseTimeStats,
  getResponseTimeTrend,
  getSlaBreaches,
  getTeamResponseTimeStats,
} from "./analytics.js";
// Re-export auth functions
export {
  forgotPassword,
  getCurrentUser,
  healthCheck,
  login,
  logout,
  register,
  resetPassword,
  verifyEmail,
} from "./auth.js";
// Re-export catalogs functions
export {
  archiveCatalog,
  getCatalogProducts,
  getCatalogSyncStatus,
  getWhatsAppCatalog,
  getWhatsAppCatalogs,
  restoreCatalog,
  triggerCatalogProductsSync,
  triggerCatalogSync,
  updateProductVisibility,
} from "./catalogs.js";
// Re-export client utilities
export {
  API_BASE_URL,
  ApiRequestError,
  api,
  attemptTokenRefresh,
  buildQueryString,
  clearAuthTokens,
  clearCompanyId,
  fetchApi,
  fetchWithAuth,
  getAccessToken,
  getCompanyId,
  handleResponse,
  initializeAuth,
  setAuthToken,
  setCompanyId,
} from "./client.js";
// Re-export companies functions
export { getUserCompanies } from "./companies.js";
// Re-export contacts functions
export {
  downloadImportTemplate,
  getContact,
  getContacts,
  importContacts,
  previewContactImport,
  updateContact,
} from "./contacts.js";
// Re-export conversations functions
export {
  getConversation,
  getConversations,
  markConversationAsRead,
  updateConversation,
} from "./conversations.js";
// Re-export labels functions
export {
  applyLabelToContact,
  autoCreateTagsFromLabels,
  getLabelSyncStatus,
  getTagsWithLabelStatus,
  getWhatsAppLabel,
  getWhatsAppLabels,
  linkTagToLabel,
  removeLabelFromContact,
  triggerLabelSync,
  unlinkTagFromLabel,
} from "./labels.js";
// Re-export messages functions
export {
  deleteMessage,
  getMessages,
  sendMessage,
  uploadMedia,
} from "./messages.js";

// Re-export notifications functions
export {
  createNotification,
  deleteNotification,
  getNotificationById,
  getNotificationPreferences,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  muteContactApi,
  unmuteContactApi,
  updateNotificationPreferences,
} from "./notifications.js";

// Re-export quick-replies functions
export {
  createQuickReply,
  deleteQuickReply,
  getQuickReplies,
  getQuickReplyById,
  getQuickReplyByShortcut,
  updateQuickReply,
} from "./quick-replies.js";
// Re-export types
export * from "./types.js";
// Re-export whatsapp functions
export {
  connectWhatsApp,
  createWhatsAppConnection,
  deleteWhatsAppConnection,
  disconnectWhatsApp,
  disconnectWhatsAppConnection,
  getWhatsAppConnection,
  getWhatsAppStatus,
  listWhatsAppConnections,
  reconnectWhatsAppConnection,
  updateWhatsAppConnection,
} from "./whatsapp.js";
