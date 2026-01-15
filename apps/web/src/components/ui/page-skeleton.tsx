import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

export type PageSkeletonVariant =
  | "default"
  | "chat"
  | "settings"
  | "dashboard"
  | "auth"
  | "team";

export interface PageSkeletonProps {
  variant?: PageSkeletonVariant;
  className?: string;
}

/**
 * Page loading skeleton component for Suspense fallbacks
 * Provides visual placeholders that match the structure of each page type
 */
export function PageSkeleton({
  variant = "default",
  className,
}: PageSkeletonProps) {
  switch (variant) {
    case "chat":
      return <ChatPageSkeleton className={className} />;
    case "settings":
      return <SettingsPageSkeleton className={className} />;
    case "dashboard":
      return <DashboardPageSkeleton className={className} />;
    case "auth":
      return <AuthPageSkeleton className={className} />;
    case "team":
      return <TeamPageSkeleton className={className} />;
    default:
      return <DefaultPageSkeleton className={className} />;
  }
}

/**
 * Chat page skeleton - sidebar with chat list + main content area
 */
function ChatPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-dvh w-screen overflow-hidden bg-gray-200 dark:bg-dark-primary",
        className,
      )}
    >
      <div className="mx-auto flex h-full w-full max-w-[1600px] shadow-xl">
        {/* Sidebar skeleton */}
        <div className="flex h-full w-full flex-col border-r border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary md:w-[320px] lg:w-[400px]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-dark-border bg-gray-100 dark:bg-dark-secondary px-4 h-14 md:h-[60px]">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex gap-4">
              <Skeleton className="h-6 w-6" />
              <Skeleton className="h-6 w-6" />
              <Skeleton className="h-6 w-6" />
            </div>
          </div>
          {/* Search */}
          <div className="border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary p-2">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
          {/* Chat list items */}
          <div className="flex-1 p-2 space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="h-12 w-12 rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                  <Skeleton className="h-3 w-full max-w-[200px]" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main content area - empty state skeleton */}
        <div className="hidden md:flex flex-1 items-center justify-center bg-gray-50 dark:bg-dark-secondary">
          <div className="text-center">
            <Skeleton className="w-20 h-20 rounded-full mx-auto mb-4" />
            <Skeleton className="h-6 w-40 mx-auto mb-2" />
            <Skeleton className="h-4 w-56 mx-auto" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings page skeleton - navigation + content area
 */
function SettingsPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("min-h-dvh bg-gray-100 dark:bg-dark-primary", className)}
    >
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-sm p-6 space-y-6">
          {/* Profile section */}
          <div className="flex items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
          {/* Settings items */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-4 border-t border-gray-200 dark:border-dark-border"
            >
              <div className="space-y-1">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-9 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Dashboard page skeleton - stats cards + charts
 */
function DashboardPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("min-h-dvh bg-gray-100 dark:bg-dark-primary", className)}
    >
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-40" />
        </div>
      </div>
      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-dark-elevated rounded-lg shadow-sm p-6"
            >
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-sm p-6">
            <Skeleton className="h-6 w-40 mb-4" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-sm p-6">
            <Skeleton className="h-6 w-40 mb-4" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Auth page skeleton - centered form card
 */
function AuthPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-dark-primary",
        className,
      )}
    >
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-lg p-8">
          {/* Logo + title */}
          <div className="text-center mb-8">
            <Skeleton className="w-16 h-16 rounded-full mx-auto mb-4" />
            <Skeleton className="h-7 w-40 mx-auto mb-2" />
            <Skeleton className="h-4 w-48 mx-auto" />
          </div>
          {/* Form fields */}
          <div className="space-y-4">
            <div>
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div>
              <Skeleton className="h-4 w-20 mb-2" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Skeleton className="h-10 w-full mt-6" />
          </div>
          {/* Footer link */}
          <div className="mt-6 text-center">
            <Skeleton className="h-4 w-48 mx-auto" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Team page skeleton - header + member list
 */
function TeamPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("min-h-dvh bg-gray-100 dark:bg-dark-primary", className)}
    >
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-dark-border bg-white dark:bg-dark-secondary">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
      {/* Tabs */}
      <div className="max-w-4xl mx-auto px-4 py-4">
        <div className="flex gap-4 mb-6">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
        {/* Member list */}
        <div className="bg-white dark:bg-dark-elevated rounded-lg shadow-sm divide-y divide-gray-200 dark:divide-dark-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Default page skeleton - simple centered loading
 */
function DefaultPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "min-h-dvh flex items-center justify-center bg-gray-100 dark:bg-dark-primary",
        className,
      )}
    >
      <div className="text-center">
        <Skeleton className="w-16 h-16 rounded-full mx-auto mb-4" />
        <Skeleton className="h-4 w-32 mx-auto" />
      </div>
    </div>
  );
}
