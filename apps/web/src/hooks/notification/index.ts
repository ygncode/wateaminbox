/**
 * Notification-related hooks
 *
 * Hooks for managing browser notifications and in-app notification center.
 */

// Browser notification management
export {
  useNotifications,
  type UseNotificationsReturn,
} from "./useNotifications";

// In-app notification center
export { useNotificationCenter } from "./useNotificationCenter";
