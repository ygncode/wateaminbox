/**
 * Scheduled message hooks
 *
 * Query and mutations for messages scheduled for future delivery.
 * Toast feedback stays in the calling components, per convention.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelScheduledMessage,
  createScheduledMessage,
  getScheduledMessages,
  type ScheduleMessageInput,
} from "../../lib/api";
import { queryKeys } from "../query-keys";

export function useScheduledMessages(contactId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.scheduledMessages.list({ contactId }),
    queryFn: () => getScheduledMessages(contactId as string),
    enabled: Boolean(contactId),
    staleTime: 30_000,
  });
}

export function useScheduleMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleMessageInput) => createScheduledMessage(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.scheduledMessages.all,
      });
    },
  });
}

export function useCancelScheduledMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelScheduledMessage(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.scheduledMessages.all,
      });
    },
  });
}
