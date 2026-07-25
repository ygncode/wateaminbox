import { formatStatusTime } from "@wateaminbox/shared";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useNotificationCenter } from "@/hooks/notification";
import { navigateToNotificationTarget } from "@/lib/notification-navigation";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

export function NotificationsPage() {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const controller = useNotificationCenter({
    limit: PAGE_SIZE,
    offset,
    unreadOnly,
  });

  return (
    <main className="min-h-dvh bg-gray-50 px-4 py-8 dark:bg-dark-primary sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-whatsapp-dark-green">
              Activity inbox
            </p>
            <h1 className="text-2xl font-semibold text-gray-950 dark:text-dark-text-primary">
              Notifications
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-dark-text-secondary">
              {controller.unreadCount} unread across your current company
            </p>
          </div>
          {controller.unreadCount > 0 && (
            <Button variant="outline" onClick={controller.markAllAsRead}>
              <CheckCheck className="mr-2 size-4" /> Mark all as read
            </Button>
          )}
        </header>

        <div className="mb-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-dark-border dark:bg-dark-elevated">
          <Checkbox
            id="unread-notifications"
            checked={unreadOnly}
            onCheckedChange={(checked) => {
              setUnreadOnly(Boolean(checked));
              setOffset(0);
            }}
          />
          <label
            htmlFor="unread-notifications"
            className="text-sm font-medium text-gray-700 dark:text-dark-text-primary"
          >
            Show unread only
          </label>
        </div>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-dark-border dark:bg-dark-elevated">
          {controller.isLoadingNotifications ? (
            <div className="p-12 text-center text-sm text-gray-500">
              Loading notifications…
            </div>
          ) : controller.error ? (
            <div className="p-12 text-center">
              <p className="text-sm text-red-600">
                Notifications could not be loaded.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={controller.refresh}
              >
                Try again
              </Button>
            </div>
          ) : controller.notifications.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-whatsapp-green/10 text-whatsapp-dark-green">
                <Bell className="size-6" />
              </div>
              <h2 className="font-semibold text-gray-900 dark:text-dark-text-primary">
                You’re all caught up
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                No notifications match this view.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-dark-border">
              {controller.notifications.map((notification) => (
                <li key={notification.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "group flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-dark-tertiary",
                      !notification.isRead && "bg-whatsapp-green/[0.04]",
                    )}
                    onClick={() => {
                      if (!notification.isRead)
                        controller.markAsRead(notification.id);
                      navigateToNotificationTarget(
                        notification.actionUrl,
                        navigate,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      if (!notification.isRead)
                        controller.markAsRead(notification.id);
                      navigateToNotificationTarget(
                        notification.actionUrl,
                        navigate,
                      );
                    }}
                  >
                    <span
                      className={cn(
                        "mt-1 size-2 shrink-0 rounded-full",
                        notification.isRead
                          ? "bg-gray-200 dark:bg-dark-border"
                          : "bg-whatsapp-green",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-900 dark:text-dark-text-primary">
                        {notification.title}
                      </span>
                      {notification.message && (
                        <span className="mt-1 block text-sm text-gray-600 dark:text-dark-text-secondary">
                          {notification.message}
                        </span>
                      )}
                      <span className="mt-2 block text-xs text-gray-400">
                        {formatStatusTime(notification.createdAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                      {!notification.isRead && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Mark as read"
                          onClick={(event) => {
                            event.stopPropagation();
                            controller.markAsRead(notification.id);
                          }}
                        >
                          <Check className="size-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Delete notification"
                        onClick={(event) => {
                          event.stopPropagation();
                          controller.deleteNotification(notification.id);
                        }}
                      >
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <nav
          className="mt-4 flex items-center justify-between"
          aria-label="Notification pages"
        >
          <Button
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="mr-1 size-4" /> Previous
          </Button>
          <span className="text-xs font-medium text-gray-500">
            {controller.total === 0 ? 0 : offset + 1}–
            {Math.min(offset + PAGE_SIZE, controller.total)} of{" "}
            {controller.total}
          </span>
          <Button
            variant="outline"
            disabled={!controller.hasMore}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next <ChevronRight className="ml-1 size-4" />
          </Button>
        </nav>
      </div>
    </main>
  );
}
