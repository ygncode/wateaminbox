import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../hooks/query-keys";

export function invalidateNotificationQueries(
  queryClient: Pick<QueryClient, "invalidateQueries">,
): Promise<void> {
  return queryClient
    .invalidateQueries({ queryKey: queryKeys.notifications.all })
    .then(() => undefined);
}
