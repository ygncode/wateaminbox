import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NewMessagePayload,
  NotificationPayload,
} from "@wateaminbox/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { queryKeys } from "../hooks/query-keys";
import {
  getNotificationPreferences,
  getPushStatus,
  getUnreadNotificationCount,
  muteContactApi,
  subscribeToPush,
  type NotificationPreferencesResponse,
  type UpdateNotificationPreferencesInput,
  unmuteContactApi,
  unsubscribeFromPush,
  updateNotificationPreferences,
} from "../lib/api";
import {
  getDesktopSenderName,
  getMessagePreview,
  shouldShowDesktopNotification,
} from "../lib/desktop-notifications";
import { getSafeNotificationPath } from "../lib/notification-navigation";
import { invalidateNotificationQueries } from "../lib/notification-realtime";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getNotificationPermission,
  getNotificationSettings,
  isNotificationSupported,
  type NotificationSettings,
  requestNotificationPermission,
  saveNotificationSettings,
  setNotificationSettingsScope,
  sendTestNotification,
  showMessageNotification,
} from "../lib/notifications";
import { useAuth } from "./auth-context";
import { useRealtimeContext } from "./RealtimeProvider";

export interface NotificationContextValue {
  settings: NotificationSettings;
  permission: NotificationPermission;
  isSupported: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  unreadCount: number;
  isLoadingUnreadCount: boolean;
  hasActivePushSubscription: boolean;
  updateSettings: (updates: Partial<NotificationSettings>) => void;
  requestPermission: () => Promise<NotificationPermission>;
  testNotification: () => Promise<boolean>;
  muteContact: (jid: string) => void;
  unmuteContact: (jid: string) => void;
  isContactMuted: (jid: string) => boolean;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

function mapApiToLocal(
  preferences: NotificationPreferencesResponse,
): Partial<NotificationSettings> {
  return {
    enabled: preferences.notificationsEnabled,
    soundEnabled: preferences.soundEnabled,
    soundChoice: preferences.soundChoice,
    quietHoursEnabled: Boolean(
      preferences.quietHoursStart && preferences.quietHoursEnd,
    ),
    quietHoursStart: preferences.quietHoursStart || "22:00",
    quietHoursEnd: preferences.quietHoursEnd || "07:00",
    mutedContacts: preferences.mutedContacts,
  };
}

function mapLocalToApi(
  updates: Partial<NotificationSettings>,
): UpdateNotificationPreferencesInput {
  const input: UpdateNotificationPreferencesInput = {};
  if (updates.enabled !== undefined)
    input.notificationsEnabled = updates.enabled;
  if (updates.soundEnabled !== undefined)
    input.soundEnabled = updates.soundEnabled;
  if (updates.soundChoice !== undefined) {
    input.soundChoice =
      updates.soundChoice as UpdateNotificationPreferencesInput["soundChoice"];
  }
  if (updates.quietHoursEnabled !== undefined) {
    input.quietHoursStart = updates.quietHoursEnabled
      ? updates.quietHoursStart || "22:00"
      : null;
    input.quietHoursEnd = updates.quietHoursEnabled
      ? updates.quietHoursEnd || "07:00"
      : null;
  }
  if (updates.quietHoursStart !== undefined)
    input.quietHoursStart = updates.quietHoursStart;
  if (updates.quietHoursEnd !== undefined)
    input.quietHoursEnd = updates.quietHoursEnd;
  if (updates.mutedContacts !== undefined)
    input.mutedContacts = updates.mutedContacts;
  return input;
}

function applicationServerKey(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  return bytes.buffer;
}

function serializeSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return null;
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, currentCompanyId, user } = useAuth();
  const { subscribe, subscribeUser, isConnected } = useRealtimeContext();
  setNotificationSettingsScope(currentCompanyId, user?.id ?? null);
  const [settings, setSettings] = useState(getNotificationSettings);
  const [permission, setPermission] = useState(getNotificationPermission);
  const [hasActivePushSubscription, setHasActivePushSubscription] =
    useState(false);
  const enabled = isAuthenticated && Boolean(currentCompanyId && user);

  useEffect(() => {
    setSettings(
      enabled
        ? getNotificationSettings()
        : { ...DEFAULT_NOTIFICATION_SETTINGS },
    );
    setHasActivePushSubscription(false);
  }, [currentCompanyId, enabled, user?.id]);

  const preferencesQuery = useQuery({
    queryKey: queryKeys.notificationPreferences.all,
    queryFn: getNotificationPreferences,
    enabled,
    staleTime: 60_000,
    gcTime: 300_000,
  });
  const unreadQuery = useQuery({
    queryKey: queryKeys.notifications.count(),
    queryFn: getUnreadNotificationCount,
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
  });

  const updateMutation = useMutation({
    mutationFn: updateNotificationPreferences,
    onSuccess: (preferences) => {
      queryClient.setQueryData(
        queryKeys.notificationPreferences.all,
        preferences,
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notificationPreferences.all,
      });
      toast.error("Notification settings were not saved");
    },
  });

  useEffect(() => {
    const preferences = preferencesQuery.data;
    if (!preferences) return;
    const updated = saveNotificationSettings(mapApiToLocal(preferences));
    setSettings(updated);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone && preferences.timezone !== timezone) {
      updateMutation.mutate({ timezone });
    }
  }, [preferencesQuery.data]);

  const muteMutation = useMutation({ mutationFn: muteContactApi });
  const unmuteMutation = useMutation({ mutationFn: unmuteContactApi });

  const updateSettings = useCallback(
    (updates: Partial<NotificationSettings>) => {
      const previous = getNotificationSettings();
      const updated = saveNotificationSettings(updates);
      setSettings(updated);
      if (!enabled) return;
      updateMutation.mutate(mapLocalToApi(updates), {
        onError: () => {
          saveNotificationSettings(previous);
          setSettings(previous);
        },
      });
    },
    [enabled, updateMutation],
  );

  const requestPermission = useCallback(async () => {
    const nextPermission = await requestNotificationPermission();
    setPermission(nextPermission);
    return nextPermission;
  }, []);

  const mutateContact = useCallback(
    (jid: string, muted: boolean) => {
      const previous = getNotificationSettings();
      const mutedContacts = muted
        ? [...new Set([...previous.mutedContacts, jid])]
        : previous.mutedContacts.filter((contactJid) => contactJid !== jid);
      const optimistic = saveNotificationSettings({ mutedContacts });
      setSettings(optimistic);
      if (!enabled) return;
      const mutation = muted ? muteMutation : unmuteMutation;
      mutation.mutate(jid, {
        onSuccess: (response) => {
          const saved = saveNotificationSettings({
            mutedContacts: response.mutedContacts,
          });
          setSettings(saved);
          toast.success(muted ? "Contact muted" : "Contact unmuted");
        },
        onError: () => {
          saveNotificationSettings(previous);
          setSettings(previous);
          toast.error(
            muted ? "Could not mute contact" : "Could not unmute contact",
          );
        },
      });
    },
    [enabled, muteMutation, unmuteMutation],
  );

  useEffect(() => {
    if (!enabled || !isConnected) return;
    return subscribeUser<NotificationPayload>("notification:new", () => {
      void invalidateNotificationQueries(queryClient);
    });
  }, [enabled, isConnected, queryClient, subscribeUser]);

  useEffect(() => {
    if (!enabled || !isConnected) return;
    return subscribe<NewMessagePayload>(
      "message:new",
      ({ message, conversationId }) => {
        if (
          !shouldShowDesktopNotification({
            settings,
            permission,
            senderType: message.senderType,
            senderJid: message.senderJid,
            documentVisible: document.visibilityState === "visible",
            documentFocused: document.hasFocus(),
            hasActivePushSubscription,
          })
        )
          return;
        const actionPath = getSafeNotificationPath(`/chat/${conversationId}`);
        void showMessageNotification(
          getDesktopSenderName(message),
          getMessagePreview(message),
          message.senderJid || message.senderId,
          conversationId,
          {
            avatarUrl: message.senderAvatarUrl || undefined,
            messageId: message.id,
            onClick: () => {
              if (actionPath) navigate(actionPath);
            },
          },
        );
      },
    );
  }, [
    enabled,
    hasActivePushSubscription,
    isConnected,
    navigate,
    permission,
    settings,
    subscribe,
  ]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setHasActivePushSubscription(false);
      return;
    }
    let cancelled = false;
    const synchronize = async () => {
      const registration = await navigator.serviceWorker.register(
        "/notification-sw.js",
      );
      let subscription = await registration.pushManager.getSubscription();
      if (!enabled || !settings.enabled || permission !== "granted") {
        if (subscription) {
          if (enabled)
            await unsubscribeFromPush(subscription.endpoint).catch(
              () => undefined,
            );
          await subscription.unsubscribe();
        }
        if (!cancelled) setHasActivePushSubscription(false);
        return;
      }
      const status = await getPushStatus();
      const publicKey =
        status.publicKey || import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!status.configured || !publicKey) {
        if (!cancelled) setHasActivePushSubscription(false);
        return;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
      const serialized = serializeSubscription(subscription);
      if (!serialized)
        throw new Error("Browser returned an invalid push subscription");
      await subscribeToPush(serialized);
      if (!cancelled) setHasActivePushSubscription(true);
    };
    synchronize().catch(() => {
      if (!cancelled) setHasActivePushSubscription(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentCompanyId, enabled, permission, settings.enabled, user?.id]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      settings,
      permission,
      isSupported: isNotificationSupported(),
      isLoading: preferencesQuery.isLoading,
      isSyncing:
        updateMutation.isPending ||
        muteMutation.isPending ||
        unmuteMutation.isPending,
      unreadCount: unreadQuery.data ?? 0,
      isLoadingUnreadCount: unreadQuery.isLoading,
      hasActivePushSubscription,
      updateSettings,
      requestPermission,
      testNotification: sendTestNotification,
      muteContact: (jid) => mutateContact(jid, true),
      unmuteContact: (jid) => mutateContact(jid, false),
      isContactMuted: (jid) => settings.mutedContacts.includes(jid),
    }),
    [
      settings,
      permission,
      preferencesQuery.isLoading,
      updateMutation.isPending,
      muteMutation.isPending,
      unmuteMutation.isPending,
      unreadQuery.data,
      unreadQuery.isLoading,
      hasActivePushSubscription,
      updateSettings,
      requestPermission,
      mutateContact,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationContext(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context)
    throw new Error(
      "useNotifications must be used within NotificationProvider",
    );
  return context;
}
