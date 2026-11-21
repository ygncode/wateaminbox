import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ChannelMessageNewPayload,
  NewMessagePayload,
  NotificationPayload,
  WhatsAppConnectedPayload,
  WorkerConnectionStatusPayload,
} from "@wateaminbox/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { queryKeys } from "../hooks/query-keys";
import {
  getNotificationPreferences,
  getPushStatus,
  getUnreadNotificationCount,
  muteContactApi,
  type NotificationPreferencesResponse,
  subscribeToPush,
  type UpdateNotificationPreferencesInput,
  unmuteContactApi,
  unsubscribeFromPush,
  updateNotificationPreferences,
} from "../lib/api";
import {
  createAlertDeduper,
  decideIncomingAlert,
  getDesktopSenderName,
  getMessagePreview,
} from "../lib/desktop-notifications";
import {
  chatNotificationPath,
  getSafeNotificationPath,
} from "../lib/notification-navigation";
import { invalidateNotificationQueries } from "../lib/notification-realtime";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getNotificationPermission,
  getNotificationSettings,
  isNotificationSupported,
  type NotificationSettings,
  playNotificationSound,
  requestNotificationPermission,
  saveNotificationSettings,
  sendTestNotification,
  setNotificationSettingsScope,
  showMessageNotification,
} from "../lib/notifications";
import { useChatStore } from "../stores/chat-store";
import { useAuth } from "./auth-context";
import { useRealtimeContext } from "./RealtimeProvider";
import { useWorkspace } from "./workspace-context";

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
  const { t } = useTranslation();

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuth();
  const { activeWorkspaceId: currentCompanyId } = useWorkspace();
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
      toast.error(
        t("notifications.saveFailed", "Notification settings were not saved"),
      );
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
          toast.success(
            muted
              ? t("contacts.muted", "Contact muted")
              : t("contacts.unmuted", "Contact unmuted"),
          );
        },
        onError: () => {
          saveNotificationSettings(previous);
          setSettings(previous);
          toast.error(
            muted
              ? t("contacts.muteFailed", "Could not mute contact")
              : t("contacts.unmuteFailed", "Could not unmute contact"),
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
    const refreshNotifications = () => {
      void invalidateNotificationQueries(queryClient);
    };
    const unsubscribeConnected = subscribe<WhatsAppConnectedPayload>(
      "connected",
      refreshNotifications,
    );
    const unsubscribeWorkerStatus = subscribe<WorkerConnectionStatusPayload>(
      "connection:status",
      (payload) => {
        if (payload.status === "connected") refreshNotifications();
      },
    );
    return () => {
      unsubscribeConnected();
      unsubscribeWorkerStatus();
    };
  }, [enabled, isConnected, queryClient, subscribe]);

  // One alert decision for every channel, so WhatsApp (`message:new`) and
  // Telegram (`channel_message:new`) obey the same settings, focus rules,
  // quiet hours and mutes, and a message replayed by a reconnect or
  // re-announced once its media arrives alerts only once.
  const shouldAlertOnce = useMemo(() => createAlertDeduper(), []);

  useEffect(() => {
    if (!enabled || !isConnected) return;
    const alert = (input: {
      messageId: string;
      senderType: string;
      senderJid?: string | null;
      /** Every chat id this message belongs to (thread and inbox row). */
      chatIds: string[];
      /** The chat's own WhatsApp JID, which group mutes are stored under. */
      chatJid?: string | null;
      title: string;
      body: string;
      avatarUrl?: string;
      /** Inbox row to open, and the thread inside it when it differs. */
      chatId: string;
      thread?: string;
    }) => {
      const openChatId = useChatStore.getState().selectedConversationId;
      const decision = decideIncomingAlert({
        settings,
        permission,
        senderType: input.senderType,
        senderJid: input.senderJid,
        chatKeys: [input.chatJid, ...input.chatIds],
        documentVisible: document.visibilityState === "visible",
        documentFocused: document.hasFocus(),
        hasActivePushSubscription,
        isOpenConversation: Boolean(
          openChatId && input.chatIds.includes(openChatId),
        ),
      });
      if (decision === "none" || !shouldAlertOnce(input.messageId)) return;
      if (decision === "sound") {
        void playNotificationSound();
        return;
      }
      const actionPath = getSafeNotificationPath(
        chatNotificationPath(currentCompanyId, input.chatId, input.thread),
      );
      void showMessageNotification(
        input.title,
        input.body,
        input.senderJid ?? "",
        input.chatIds[0] ?? "",
        {
          avatarUrl: input.avatarUrl,
          messageId: input.messageId,
          onClick: () => {
            if (actionPath) navigate(actionPath);
          },
        },
      );
    };

    // User channel: the server already restricted both events to members
    // allowed to read the conversation, so an alert cannot surface a chat the
    // recipient is not authorized to open.
    const unsubscribeLegacy = subscribeUser<NewMessagePayload>(
      "message:new",
      ({ message, conversationId, contactJid }) => {
        const threadId = (message as { channelConversationId?: string | null })
          .channelConversationId;
        alert({
          messageId: message.id,
          senderType: message.senderType,
          senderJid: message.senderJid,
          chatIds: threadId ? [conversationId, threadId] : [conversationId],
          chatJid: contactJid,
          title: getDesktopSenderName(message),
          body: getMessagePreview(message),
          avatarUrl: message.senderAvatarUrl || undefined,
          chatId: conversationId,
        });
      },
    );
    const unsubscribeChannel = subscribeUser<ChannelMessageNewPayload>(
      "channel_message:new",
      ({ message, conversation }) => {
        if (message.direction !== "inbound") return;
        const threadId = message.conversationId || conversation.id;
        const rowId = conversation.legacyContactId ?? null;
        alert({
          messageId: message.id,
          senderType: "contact",
          chatIds: rowId ? [threadId, rowId] : [threadId],
          title:
            message.senderName?.trim() ||
            conversation.subject?.trim() ||
            conversation.accountName?.trim() ||
            "New message",
          body: getMessagePreview({
            messageType: message.messageType ?? undefined,
            content: message.textContent ?? undefined,
          }),
          // A bridged thread lives under its customer's inbox row.
          chatId: rowId ?? threadId,
          thread: rowId && rowId !== threadId ? threadId : undefined,
        });
      },
    );
    return () => {
      unsubscribeLegacy();
      unsubscribeChannel();
    };
  }, [
    currentCompanyId,
    enabled,
    hasActivePushSubscription,
    isConnected,
    navigate,
    permission,
    settings,
    shouldAlertOnce,
    subscribeUser,
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
