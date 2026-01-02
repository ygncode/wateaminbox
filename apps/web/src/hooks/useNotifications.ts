import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  getNotificationSettings,
  saveNotificationSettings,
  requestNotificationPermission,
  getNotificationPermission,
  isNotificationSupported,
  showMessageNotification,
  sendTestNotification,
  muteContact,
  unmuteContact,
  isContactMuted,
  type NotificationSettings,
} from "../lib/notifications";
import { useWebSocketContext } from "../contexts/WebSocketProvider";
import type { NewMessagePayload } from "../lib/websocket";

export interface UseNotificationsReturn {
  // State
  settings: NotificationSettings;
  permission: NotificationPermission;
  isSupported: boolean;

  // Actions
  updateSettings: (updates: Partial<NotificationSettings>) => void;
  requestPermission: () => Promise<NotificationPermission>;
  testNotification: () => Promise<boolean>;
  muteContact: (jid: string) => void;
  unmuteContact: (jid: string) => void;
  isContactMuted: (jid: string) => boolean;
}

export function useNotifications(): UseNotificationsReturn {
  const navigate = useNavigate();
  const { subscribe, isConnected } = useWebSocketContext();

  const [settings, setSettings] = useState<NotificationSettings>(
    getNotificationSettings(),
  );
  const [permission, setPermission] = useState<NotificationPermission>(
    getNotificationPermission(),
  );

  // Update settings
  const updateSettings = useCallback(
    (updates: Partial<NotificationSettings>) => {
      const updated = saveNotificationSettings(updates);
      setSettings(updated);
    },
    [],
  );

  // Request permission
  const requestPermission = useCallback(async () => {
    const newPermission = await requestNotificationPermission();
    setPermission(newPermission);
    return newPermission;
  }, []);

  // Test notification
  const testNotification = useCallback(async () => {
    return sendTestNotification();
  }, []);

  // Mute/unmute handlers
  const handleMuteContact = useCallback((jid: string) => {
    muteContact(jid);
    setSettings(getNotificationSettings());
  }, []);

  const handleUnmuteContact = useCallback((jid: string) => {
    unmuteContact(jid);
    setSettings(getNotificationSettings());
  }, []);

  const handleIsContactMuted = useCallback((jid: string) => {
    return isContactMuted(jid);
  }, []);

  // Subscribe to incoming messages for notifications
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribe<NewMessagePayload>(
      "message:new",
      (payload) => {
        const { message, conversationId } = payload;

        // Don't show notification for own messages (sent by user)
        if (message.senderType === "user") {
          return;
        }

        // Don't show notification if the page is focused and visible
        if (document.visibilityState === "visible" && document.hasFocus()) {
          return;
        }

        // Show notification
        showMessageNotification(
          message.senderId || "Unknown",
          getMessagePreview(message),
          message.senderId || "",
          conversationId,
          {
            onClick: () => {
              navigate(`/chat/${conversationId}`);
            },
          },
        );
      },
    );

    return unsubscribe;
  }, [isConnected, subscribe, navigate]);

  return {
    settings,
    permission,
    isSupported: isNotificationSupported(),
    updateSettings,
    requestPermission,
    testNotification,
    muteContact: handleMuteContact,
    unmuteContact: handleUnmuteContact,
    isContactMuted: handleIsContactMuted,
  };
}

/**
 * Get a preview of the message content
 */
function getMessagePreview(message: {
  messageType?: string;
  content?: string;
}): string {
  switch (message.messageType) {
    case "image":
      return "Sent an image";
    case "video":
      return "Sent a video";
    case "audio":
      return "Sent an audio message";
    case "document":
      return "Sent a document";
    case "location":
      return "Shared a location";
    case "template":
      return "Template message";
    default:
      return message.content?.slice(0, 100) || "New message";
  }
}

export default useNotifications;
