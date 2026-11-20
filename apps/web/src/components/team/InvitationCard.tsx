import { dayjs, nowMs } from "@wateaminbox/shared";
import { Clock, Mail, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { InvitationCardProps } from "./types";
import { useTranslation } from "react-i18next";

export function InvitationCard({
  invitation,
  onCancel,
  onResend,
  isCancelling,
  isResending,
}: InvitationCardProps) {
  const { t } = useTranslation();

  const expiresAt = dayjs(invitation.expiresAt);
  const isExpiringSoon = expiresAt.valueOf() - nowMs() < 24 * 60 * 60 * 1000;
  const hasCustomAccess = Boolean(
    invitation.permissions && Object.keys(invitation.permissions).length,
  );

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Mail className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p dir="ltr" className="truncate font-medium">
              {invitation.email}
            </p>
            <Badge variant="secondary" className="capitalize">
              {invitation.role}
            </Badge>
            {hasCustomAccess && (
              <Badge variant="default">
                {t("team.customAccess", "Custom access")}
              </Badge>
            )}
            <Badge variant="outline" className="text-accent">
              {invitation.deliveryState || "delivered"}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span className={isExpiringSoon ? "text-warning" : ""}>
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
          {t("team.resend")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isCancelling}
          className="text-danger hover:bg-danger-soft hover:text-danger"
          aria-label={t("team.cancelInvitationFor", {
            email: invitation.email,
          })}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}
