import { dayjs, nowMs } from "@wateaminbox/shared";
import { Clock, Mail, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InvitationCardProps } from "./types";

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
    <article className="flex flex-col gap-4 rounded-xl border border-[#dce3de] bg-white p-4 dark:border-dark-border dark:bg-dark-elevated sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-[#075c41]">
          <Mail className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{invitation.email}</p>
            <Badge variant="secondary" className="capitalize">
              {invitation.role}
            </Badge>
            <Badge
              variant="outline"
              className="text-emerald-700 dark:text-emerald-300"
            >
              {invitation.deliveryState || "delivered"}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#65736d] dark:text-dark-text-secondary">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span
                className={
                  isExpiringSoon ? "text-orange-600 dark:text-orange-400" : ""
                }
              >
                Expires {expiresAt.format("MMM D, YYYY")}
              </span>
            </span>
            <span>
              Invited by{" "}
              {invitation.inviterName ||
                invitation.inviterEmail ||
                "a team member"}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onResend}
          disabled={isResending}
          className="gap-1"
        >
          <RefreshCw className={cn("h-4 w-4", isResending && "animate-spin")} />{" "}
          Resend
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isCancelling}
          className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
          aria-label={`Cancel invitation for ${invitation.email}`}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}
