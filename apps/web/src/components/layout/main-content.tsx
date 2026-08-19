import type * as React from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export interface MainContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function MainContent({
  className,
  children,
  ...props
}: MainContentProps) {
  return (
    <main
      className={cn(
        "flex flex-1 flex-col bg-gray-50 dark:bg-dark-primary",
        className,
      )}
      {...props}
    >
      {children}
    </main>
  );
}

export interface MainContentHeaderProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function MainContentHeader({
  className,
  children,
  ...props
}: MainContentHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between border-b border-gray-200 dark:border-dark-border bg-gray-100 dark:bg-dark-secondary px-4",
        // Responsive height with safe area support
        "h-14 min-h-[56px] md:h-[60px] md:min-h-[60px]",
        // Safe area inset for notch
        "safe-area-top",
        className,
      )}
      {...props}
    >
      {children}
    </header>
  );
}

export interface MessageAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function MessageArea({
  className,
  children,
  ...props
}: MessageAreaProps) {
  return (
    <div
      className={cn("flex-1 overflow-y-auto bg-[#e5ddd5] p-4", className)}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c5c5c5' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export interface MessageInputAreaProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function MessageInputArea({
  className,
  children,
  ...props
}: MessageInputAreaProps) {
  return (
    <footer
      className={cn(
        "flex items-center gap-2 border-t border-gray-200 dark:border-dark-border bg-gray-100 dark:bg-dark-secondary",
        // Responsive padding
        "px-2 py-2 md:px-4 md:py-3",
        // Safe area inset for home indicator
        "safe-area-bottom",
        className,
      )}
      {...props}
    >
      {children}
    </footer>
  );
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
}

export function EmptyState({
  className,
  title,
  description,
  ...props
}: EmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center justify-center bg-gray-100 dark:bg-dark-primary text-center",
        className,
      )}
      {...props}
    >
      <div className="max-w-md space-y-4 px-4">
        <div className="mx-auto h-24 w-24 rounded-full bg-whatsapp-green/10 flex items-center justify-center">
          <svg
            className="h-12 w-12 text-whatsapp-green"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
            />
          </svg>
        </div>
        <h2 className="text-2xl font-light text-gray-800 dark:text-dark-text-primary">
          {title ?? t("chat.selectChat", "Select a chat")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-dark-text-secondary">
          {description ??
            t(
              "chat.selectChatDescription",
              "Choose a conversation from the sidebar to start messaging",
            )}
        </p>
      </div>
    </div>
  );
}
