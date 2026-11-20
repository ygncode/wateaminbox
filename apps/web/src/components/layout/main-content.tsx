import type * as React from "react";
import { cn } from "@/lib/utils";
import { MAIN_CONTENT_ROOT_CLASS } from "./main-content-layout";
import { useTranslation } from "react-i18next";

export { MAIN_CONTENT_ROOT_CLASS };

export interface MainContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function MainContent({
  className,
  children,
  ...props
}: MainContentProps) {
  return (
    <main className={cn(MAIN_CONTENT_ROOT_CLASS, className)} {...props}>
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
        "flex items-center justify-between border-b border-line bg-surface px-4",
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
      className={cn("relative flex-1 overflow-y-auto bg-chat p-4", className)}
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
        "flex items-center gap-2 border-t border-line bg-surface",
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
        "flex flex-1 flex-col items-center justify-center bg-page text-center",
        className,
      )}
      {...props}
    >
      <div className="max-w-md space-y-4 px-4">
        <div className="mx-auto h-24 w-24 rounded-full bg-accent/10 flex items-center justify-center">
          <svg
            className="h-12 w-12 text-accent"
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
        <h2 className="text-2xl font-light text-fg">
          {title ?? t("chat.selectChat", "Select a chat")}
        </h2>
        <p className="text-sm text-fg-muted">
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
