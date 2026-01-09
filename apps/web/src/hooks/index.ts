/**
 * Hooks barrel export
 *
 * This file re-exports all hooks from their feature directories.
 * For new code, prefer importing from specific feature directories:
 *   - import { useDebounce } from '@/hooks/ui'
 *   - import { useNotifications } from '@/hooks/notification'
 *   - import { useDashboardStats } from '@/hooks/analytics'
 */

// Feature directories (preferred imports)
export * from "./ui";
export * from "./notification";
export * from "./analytics";
export * from "./chat";

// Query utilities
export * from "./query";
export * from "./query-keys";

// Async data utility
export * from "./useAsyncData";

// Feature-specific hooks
export * from "./useAudit";
export * from "./useChats";
export * from "./useContact";
export * from "./useExport";
export * from "./useGroups";
export * from "./useInfiniteMessages";
export * from "./useMessages";
export * from "./useTeam";
export * from "./useWebSocket";
