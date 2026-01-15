import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWebSocketContext } from "../../contexts/WebSocketProvider";
import {
  getAccessToken,
  getNotificationPreferences,
  muteContactApi,
  type NotificationPreferencesResponse,
  type UpdateNotificationPreferencesInput,
  unmuteContactApi,
  updateNotificationPreferences,
} from "../../lib/api";
import {
  getNotificationPermission,
  getNotificationSettings,
  isNotificationSupported,
  type NotificationSettings,
  requestNotificationPermission,
  saveNotificationSettings,
  sendTestNotification,
  showMessageNotification,
} from "../../lib/notifications";
import type { NewMessagePayload } from "../../lib/websocket";
import { queryKeys } from "../query-keys";

export interface UseNotificationsReturn {
  // State
  settings: NotificationSettings;
  permission: NotificationPermission;
  isSupported: boolean;
  isLoading: boolean;
  isSyncing: boolean;

  // Actions
  updateSettings: (updates: Partial<NotificationSettings>) => void;
  requestPermission: () => Promise<NotificationPermission>;
  testNotification: () => Promise<boolean>;
  muteContact: (jid: string) => void;
  unmuteContact: (jid: string) => void;
  isContactMuted: (jid: string) => boolean;
}

/**
 * Maps API response to local NotificationSettings format
 */
function mapApiToLocal(
  prefs: NotificationPreferencesResponse,
): Partial<NotificationSettings> {
  return {
    soundEnabled: prefs.soundEnabled,
    soundChoice: prefs.soundChoice,
    quietHoursEnabled: !!(prefs.quietHoursStart && prefs.quietHoursEnd),
    quietHoursStart: prefs.quietHoursStart || "22:00",
    quietHoursEnd: prefs.quietHoursEnd || "07:00",
    mutedContacts: prefs.mutedContacts,
  };
}

/**
 * Maps local settings to API update input format
 */
function mapLocalToApi(
  updates: Partial<NotificationSettings>,
): UpdateNotificationPreferencesInput {
  const apiInput: UpdateNotificationPreferencesInput = {};

  if (updates.soundEnabled !== undefined) {
    apiInput.soundEnabled = updates.soundEnabled;
  }
  if (updates.soundChoice !== undefined) {
    apiInput.soundChoice = updates.soundChoice as
      | "default"
      | "chime"
      | "bell"
      | "pop"
      | "none";
  }
  if (updates.quietHoursEnabled !== undefined) {
    if (updates.quietHoursEnabled) {
      // Set quiet hours if enabled
      apiInput.quietHoursStart = updates.quietHoursStart || "22:00";
      apiInput.quietHoursEnd = updates.quietHoursEnd || "07:00";
    } else {
      // Clear quiet hours if disabled
      apiInput.quietHoursStart = null;
      apiInput.quietHoursEnd = null;
    }
  }
  if (updates.quietHoursStart !== undefined) {
    apiInput.quietHoursStart = updates.quietHoursStart;
  }
  if (updates.quietHoursEnd !== undefined) {
    apiInput.quietHoursEnd = updates.quietHoursEnd;
  }
  if (updates.mutedContacts !== undefined) {
    apiInput.mutedContacts = updates.mutedContacts;
  }

  return apiInput;
}

export function useNotifications(): UseNotificationsReturn {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { subscribe, isConnected } = useWebSocketContext();

  const [settings, setSettings] = useState<NotificationSettings>(
    getNotificationSettings(),
  );
  const [permission, setPermission] = useState<NotificationPermission>(
    getNotificationPermission(),
  );

  const isAuthenticated = !!getAccessToken();

  // Fetch preferences from API (only when authenticated)
  const { data: apiPreferences, isLoading } = useQuery({
    queryKey: queryKeys.notificationPreferences.all,
    queryFn: getNotificationPreferences,
    enabled: isAuthenticated,
    staleTime: 60_000, // 1 minute
    gcTime: 300_000, // 5 minutes
    retry: 1,
  });

  // Sync API preferences to local state when fetched
  useEffect(() => {
    if (apiPreferences) {
      const apiSettings = mapApiToLocal(apiPreferences);
      const merged = saveNotificationSettings(apiSettings);
      setSettings(merged);
    }
  }, [apiPreferences]);

  // Mutation for updating preferences on server
  const updateMutation = useMutation({
    mutationFn: (input: UpdateNotificationPreferencesInput) =>
      updateNotificationPreferences(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  // Mutation for muting a contact
  const muteMutation = useMutation({
    mutationFn: muteContactApi,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  // Mutation for unmuting a contact
  const unmuteMutation = useMutation({
    mutationFn: unmuteContactApi,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
    },
  });

  // Update settings - saves locally and syncs to API
  const updateSettings = useCallback(
    (updates: Partial<NotificationSettings>) => {
      // Update local storage immediately for responsiveness
      const updated = saveNotificationSettings(updates);
      setSettings(updated);

      // Sync to API if authenticated
      if (isAuthenticated) {
        const apiInput = mapLocalToApi(updates);
        if (Object.keys(apiInput).length > 0) {
          updateMutation.mutate(apiInput);
        }
      }
    },
    [isAuthenticated, updateMutation],
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

  // Mute contact - updates locally and syncs to API
  const handleMuteContact = useCallback(
    (jid: string) => {
      // Update local immediately
      const current = getNotificationSettings();
      if (!current.mutedContacts.includes(jid)) {
        const updated = saveNotificationSettings({
          mutedContacts: [...current.mutedContacts, jid],
        });
        setSettings(updated);
      }

      // Sync to API if authenticated
      if (isAuthenticated) {
        muteMutation.mutate(jid);
      }
    },
    [isAuthenticated, muteMutation],
  );

  // Unmute contact - updates locally and syncs to API
  const handleUnmuteContact = useCallback(
    (jid: string) => {
      // Update local immediately
      const current = getNotificationSettings();
      if (current.mutedContacts.includes(jid)) {
        const updated = saveNotificationSettings({
          mutedContacts: current.mutedContacts.filter((id) => id !== jid),
        });
        setSettings(updated);
      }

      // Sync to API if authenticated
      if (isAuthenticated) {
        unmuteMutation.mutate(jid);
      }
    },
    [isAuthenticated, unmuteMutation],
  );

  const handleIsContactMuted = useCallback(
    (jid: string) => {
      return settings.mutedContacts.includes(jid);
    },
    [settings.mutedContacts],
  );

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
    isLoading,
    isSyncing:
      updateMutation.isPending ||
      muteMutation.isPending ||
      unmuteMutation.isPending,
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
