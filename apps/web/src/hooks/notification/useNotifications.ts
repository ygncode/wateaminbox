import {
  useNotificationContext,
  type NotificationContextValue,
} from "../../contexts/NotificationProvider";

export type UseNotificationsReturn = NotificationContextValue;

/** Global notification runtime consumer. */
export function useNotifications(): UseNotificationsReturn {
  return useNotificationContext();
}

export default useNotifications;
