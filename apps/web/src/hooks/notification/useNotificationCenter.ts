import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toISOString } from "@wateaminbox/shared";
import {
  deleteNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/lib/api/notifications";
import type {
  InAppNotification,
  NotificationListParams,
} from "@/lib/api/types";
import { useWebSocketContext } from "@/contexts";
import type { NotificationPayload } from "@/lib/websocket";
import { queryKeys } from "../query-keys";

// Stable empty params object to prevent query key instability
const EMPTY_PARAMS: NotificationListParams = {};

/**
 * Hook for managing in-app notification center
 */
export function useNotificationCenter(params?: NotificationListParams) {
  // Use stable empty params when none provided
  const effectiveParams = params ?? EMPTY_PARAMS;
  const queryClient = useQueryClient();
  const { subscribe, isConnected } = useWebSocketContext();

  // Fetch notifications list
  const {
    data: notificationsData,
    isLoading: isLoadingNotifications,
    error: notificationsError,
    refetch: refetchNotifications,
  } = useQuery({
    queryKey: queryKeys.notifications.list(effectiveParams),
    queryFn: () => getNotifications(effectiveParams),
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 60 * 1000, // Refetch every minute
  });

  // Fetch unread count separately for the badge
  const {
    data: unreadCount = 0,
    isLoading: isLoadingCount,
    refetch: refetchCount,
  } = useQuery({
    queryKey: queryKeys.notifications.count(),
    queryFn: getUnreadNotificationCount,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Refetch count more frequently
  });

  // Mark single notification as read
  const markAsReadMutation = useMutation({
    mutationFn: markNotificationAsRead,
    onSuccess: (updatedNotification) => {
      // Update the notifications list
      queryClient.setQueryData(
        queryKeys.notifications.list(effectiveParams),
        (old: { data: InAppNotification[]; meta: unknown } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((n) =>
              n.id === updatedNotification.id ? updatedNotification : n,
            ),
          };
        },
      );
      // Decrement the unread count
      queryClient.setQueryData(
        queryKeys.notifications.count(),
        (old: number | undefined) => (old ? Math.max(0, old - 1) : 0),
      );
    },
  });

  // Mark all notifications as read
  const markAllAsReadMutation = useMutation({
    mutationFn: markAllNotificationsAsRead,
    onSuccess: () => {
      // Update the notifications list - mark all as read
      queryClient.setQueryData(
        queryKeys.notifications.list(effectiveParams),
        (old: { data: InAppNotification[]; meta: unknown } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((n) => ({
              ...n,
              isRead: true,
              readAt: toISOString(),
            })),
          };
        },
      );
      // Reset unread count to 0
      queryClient.setQueryData(queryKeys.notifications.count(), 0);
    },
  });

  // Delete notification
  const deleteMutation = useMutation({
    mutationFn: deleteNotification,
    onSuccess: (_, notificationId) => {
      // Remove from the notifications list
      queryClient.setQueryData(
        queryKeys.notifications.list(effectiveParams),
        (
          old:
            | {
                data: InAppNotification[];
                meta: { total: number; unreadCount: number };
              }
            | undefined,
        ) => {
          if (!old) return old;
          const notification = old.data.find((n) => n.id === notificationId);
          return {
            ...old,
            data: old.data.filter((n) => n.id !== notificationId),
            meta: {
              ...old.meta,
              total: old.meta.total - 1,
              unreadCount:
                notification && !notification.isRead
                  ? old.meta.unreadCount - 1
                  : old.meta.unreadCount,
            },
          };
        },
      );
      // Potentially update unread count
      refetchCount();
    },
  });

  const notifications = notificationsData?.data || [];
  const meta = notificationsData?.meta || {
    total: 0,
    unreadCount: 0,
    limit: 20,
    offset: 0,
  };

  // Listen for new notifications via WebSocket
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribe<NotificationPayload>(
      "notification:new",
      () => {
        // Refetch notifications and count when a new notification arrives
        void refetchNotifications();
        void refetchCount();
      },
    );

    return unsubscribe;
  }, [isConnected, subscribe, refetchNotifications, refetchCount]);

  return {
    // Data
    notifications,
    unreadCount,
    total: meta.total,
    hasMore: meta.offset + meta.limit < meta.total,

    // Loading states
    isLoading: isLoadingNotifications || isLoadingCount,
    isLoadingNotifications,
    isLoadingCount,

    // Errors
    error: notificationsError,

    // Actions
    markAsRead: (notificationId: string) =>
      markAsReadMutation.mutate(notificationId),
    markAllAsRead: () => markAllAsReadMutation.mutate(),
    deleteNotification: (notificationId: string) =>
      deleteMutation.mutate(notificationId),
    refresh: () => {
      refetchNotifications();
      refetchCount();
    },

    // Mutation states
    isMarkingAsRead: markAsReadMutation.isPending,
    isMarkingAllAsRead: markAllAsReadMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

export default useNotificationCenter;
