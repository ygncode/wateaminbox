import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toISOString } from "@wateaminbox/shared";
import { useNotificationContext } from "@/contexts/NotificationProvider";
import {
  deleteNotification,
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/lib/api/notifications";
import type {
  NotificationListParams,
  NotificationListResponse,
} from "@/lib/api/types";
import {
  deleteNotificationFromResponse,
  markNotificationReadInResponse,
} from "@/lib/notification-cache";
import { queryKeys } from "../query-keys";

const EMPTY_PARAMS: NotificationListParams = {};

export function useNotificationCenter(
  params?: NotificationListParams,
  options?: { listEnabled?: boolean },
) {
  const effectiveParams = params ?? EMPTY_PARAMS;
  const queryClient = useQueryClient();
  const { unreadCount, isLoadingUnreadCount } = useNotificationContext();
  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications.list(effectiveParams),
    queryFn: () => getNotifications(effectiveParams),
    enabled: options?.listEnabled ?? true,
    staleTime: 30_000,
    gcTime: 300_000,
    refetchInterval: options?.listEnabled === false ? false : 60_000,
  });

  const updateAllLists = useCallbackForLists(queryClient);
  const markAsReadMutation = useMutation({
    mutationFn: markNotificationAsRead,
    onSuccess: (updated) => {
      let wasUnread = false;
      updateAllLists((old) => {
        const result = markNotificationReadInResponse(old, updated);
        wasUnread ||= result.changedUnread;
        return result.response;
      });
      if (wasUnread) {
        queryClient.setQueryData<number>(
          queryKeys.notifications.count(),
          (old = 0) => Math.max(0, old - 1),
        );
      }
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: markAllNotificationsAsRead,
    onSuccess: () => {
      updateAllLists((old) => ({
        ...old,
        data: old.data.map((item) => ({
          ...item,
          isRead: true,
          readAt: item.readAt ?? toISOString(),
        })),
        meta: { ...old.meta, unreadCount: 0 },
      }));
      queryClient.setQueryData(queryKeys.notifications.count(), 0);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNotification,
    onSuccess: (_, notificationId) => {
      let deletedUnread = false;
      updateAllLists((old) => {
        const result = deleteNotificationFromResponse(old, notificationId);
        deletedUnread ||= result.deletedUnread;
        return result.response;
      });
      if (deletedUnread) {
        queryClient.setQueryData<number>(
          queryKeys.notifications.count(),
          (old = 0) => Math.max(0, old - 1),
        );
      }
    },
  });

  const meta = notificationsQuery.data?.meta ?? {
    total: 0,
    unreadCount: 0,
    limit: effectiveParams.limit ?? 20,
    offset: effectiveParams.offset ?? 0,
  };
  return {
    notifications: notificationsQuery.data?.data ?? [],
    unreadCount,
    total: meta.total,
    hasMore: meta.offset + meta.limit < meta.total,
    isLoading: notificationsQuery.isLoading || isLoadingUnreadCount,
    isLoadingNotifications: notificationsQuery.isLoading,
    isLoadingCount: isLoadingUnreadCount,
    /** True while any fetch is in flight, including background refetches. */
    isFetching: notificationsQuery.isFetching,
    error: notificationsQuery.error,
    markAsRead: (id: string) => markAsReadMutation.mutate(id),
    markAllAsRead: () => markAllAsReadMutation.mutate(),
    deleteNotification: (id: string) => deleteMutation.mutate(id),
    refresh: () => {
      void notificationsQuery.refetch();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.count(),
      });
    },
    isMarkingAsRead: markAsReadMutation.isPending,
    isMarkingAllAsRead: markAllAsReadMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}

function useCallbackForLists(queryClient: ReturnType<typeof useQueryClient>) {
  return (
    updater: (old: NotificationListResponse) => NotificationListResponse,
  ) => {
    queryClient.setQueriesData<NotificationListResponse>(
      { queryKey: queryKeys.notifications.lists() },
      (old) => (old ? updater(old) : old),
    );
  };
}

export default useNotificationCenter;
