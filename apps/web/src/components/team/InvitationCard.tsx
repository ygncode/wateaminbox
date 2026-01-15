import { Clock, Mail, RefreshCw, X } from "lucide-react";
import { dayjs, nowMs } from "@whatsapp-web/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InvitationCardProps } from "./types";

/**
 * Individual invitation card
 */
export function InvitationCard({
  invitation,
  onCancel,
  onResend,
  isCancelling,
  isResending,
}: InvitationCardProps) {
  const expiresAt = dayjs(invitation.expiresAt);
  const isExpiringSoon = expiresAt.valueOf() - nowMs() < 24 * 60 * 60 * 1000;

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-dark-border bg-white dark:bg-dark-elevated p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-dark-tertiary">
          <Mail className="h-5 w-5 text-gray-500 dark:text-dark-text-secondary" />
        </div>
        <div>
          <p className="font-medium text-gray-900 dark:text-dark-text-primary">
            {invitation.email}
          </p>
          <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-dark-text-secondary">
            <Clock className="h-3 w-3" />
            <span
              className={
                isExpiringSoon ? "text-orange-500 dark:text-orange-400" : ""
              }
            >
              Expires {expiresAt.format("MMM D, YYYY")}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onResend}
          disabled={isResending}
          className="gap-1"
        >
          <RefreshCw className={cn("h-4 w-4", isResending && "animate-spin")} />
          Resend
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isCancelling}
          className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-700 dark:hover:text-red-300"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
