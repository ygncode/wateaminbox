import { dayjs, now } from "@wateaminbox/shared";
import {
  Building2,
  CheckCircle,
  Clock,
  Mail,
  Settings2,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Skeleton } from "../components/ui";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { useAcceptInvitation, useInvitationByToken } from "../hooks/useTeam";
import { buildAuthUrl } from "../lib/auth-redirect";
import { workspacePath } from "../lib/workspace-routes";
import { permissionOptions } from "../components/team/permission-options";
import { useTranslation } from "react-i18next";

/**
 * Accept Invitation page
 * Allows users to view and accept team invitations
 */
export function AcceptInvitationPage() {
  const { t } = useTranslation();

  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { refreshWorkspaces, switchWorkspace } = useWorkspace();
  const [acceptedWorkspaceId, setAcceptedWorkspaceId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Fetch invitation details
  const {
    data: invitation,
    isLoading,
    error: fetchError,
  } = useInvitationByToken(token || null);

  // Accept invitation mutation
  const acceptInvitation = useAcceptInvitation();

  // Check if invitation is expired
  const isExpired = invitation
    ? dayjs(invitation.expiresAt).isBefore(now())
    : false;
  const hasCustomAccess = Boolean(
    invitation?.permissions && Object.keys(invitation.permissions).length,
  );
  const enabledCapabilityCount = invitation
    ? permissionOptions.filter(
        (option) => invitation.effectivePermissions[option.key],
      ).length
    : 0;

  // Format date for display
  const formatDate = (dateString: string) => {
    return dayjs(dateString).format("MMMM D, YYYY");
  };

  const handleAccept = async () => {
    if (!token) return;

    try {
      setError(null);
      const result = await acceptInvitation.mutateAsync(token);
      await refreshWorkspaces();
      await switchWorkspace(result.company.id);
      setAcceptedWorkspaceId(result.company.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("invitation.acceptFailed", "Failed to accept invitation"),
      );
    }
  };

  // Redirect to chat after successful acceptance
  useEffect(() => {
    if (acceptedWorkspaceId) {
      const timer = setTimeout(() => {
        navigate(workspacePath(acceptedWorkspaceId));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [acceptedWorkspaceId, navigate]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted">
        <div className="w-full max-w-md rounded-lg bg-surface p-8 shadow-lg">
          <div className="space-y-4">
            <Skeleton className="h-8 w-48 mx-auto" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-10 w-full mt-4" />
          </div>
        </div>
      </div>
    );
  }

  // Show error state for invalid/not found invitation
  if (fetchError || !invitation) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted">
        <div className="w-full max-w-md rounded-lg bg-surface p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-danger-soft">
            <XCircle className="h-8 w-8 text-danger" />
          </div>
          <h1 className="text-xl font-semibold text-fg mb-2">
            {t("invitation.invalidTitle", "Invalid Invitation")}
          </h1>
          <p className="text-fg-muted mb-6">
            {t(
              "invitation.invalidBody",
              "This invitation link is invalid or has already been used.",
            )}
          </p>
          <Link to="/login">
            <Button className="w-full bg-primary hover:bg-primary-hover">
              {t("invitation.goToLogin", "Go to Login")}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Show success state after accepting
  if (acceptedWorkspaceId) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted">
        <div className="w-full max-w-md rounded-lg bg-surface p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
            <CheckCircle className="h-8 w-8 text-accent" />
          </div>
          <h1 className="text-xl font-semibold text-fg mb-2">
            {t("invitation.welcomeTo", { name: invitation.companyName })}
          </h1>
          <p className="text-fg-muted mb-4">
            {t(
              "invitation.successBody",
              "You have successfully joined the team. Redirecting you to the chat...",
            )}
          </p>
          <div className="animate-pulse text-sm text-fg-muted">
            {t("invitation.redirecting", "Redirecting in a moment...")}
          </div>
        </div>
      </div>
    );
  }

  // Main invitation view
  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted">
      <div className="w-full max-w-md rounded-lg bg-surface p-8 shadow-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary">
            <Mail className="h-8 w-8 text-accent-hover" />
          </div>
          <h1 className="text-xl font-semibold text-fg">
            {t("invitation.title", "Team Invitation")}
          </h1>
          <p className="text-fg-muted mt-1">
            {t("invitation.subtitle", "You have been invited to join a team")}
          </p>
        </div>

        {/* Invitation details */}
        <div className="space-y-4 mb-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-subtle">
            <Building2 className="h-5 w-5 text-fg-muted flex-shrink-0" />
            <div>
              <p className="text-xs text-fg-muted">
                {t("invitation.workspace")}
              </p>
              <p className="font-medium text-fg">{invitation.companyName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-subtle">
            <Mail className="h-5 w-5 text-fg-muted flex-shrink-0" />
            <div>
              <p className="text-xs text-fg-muted">
                {t("invitation.invitedEmail", "Invited Email")}
              </p>
              <p className="font-medium text-fg">{invitation.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-subtle">
            <User className="h-5 w-5 text-fg-muted flex-shrink-0" />
            <div>
              <p className="text-xs text-fg-muted">
                {t("invitation.invitedBy", "Invited By")}
              </p>
              <p className="font-medium text-fg">{invitation.invitedBy}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-subtle">
            <ShieldCheck className="h-5 w-5 text-fg-muted flex-shrink-0" />
            <div>
              <p className="text-xs text-fg-muted">
                {t("invitation.role", "Role")}
              </p>
              <p className="font-medium capitalize text-fg">
                {invitation.role}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-subtle">
            <Settings2 className="h-5 w-5 text-fg-muted flex-shrink-0" />
            <div>
              <p className="text-xs text-fg-muted">
                {t("invitation.startingAccess", "Starting access")}
              </p>
              <p className="font-medium text-fg">
                {t("invitation.accessSummary", {
                  defaultValue: "{{mode}} · {{count}} capabilities enabled",
                  mode: hasCustomAccess
                    ? t("team.customAccess", "Custom access")
                    : t("team.roleDefaults", "Role defaults"),
                  count: enabledCapabilityCount,
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-subtle">
            <Clock className="h-5 w-5 text-fg-muted flex-shrink-0" />
            <div>
              <p className="text-xs text-fg-muted">
                {t("invitation.expires", "Expires")}
              </p>
              <p
                className={`font-medium ${
                  isExpired ? "text-danger" : "text-fg"
                }`}
              >
                {formatDate(invitation.expiresAt)}
                {isExpired && ` ${t("invitation.expiredSuffix", "(Expired)")}`}
              </p>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-danger-soft text-danger text-sm">
            {error}
          </div>
        )}

        {/* Action buttons */}
        {isExpired ? (
          <div className="text-center">
            <p className="text-danger mb-4">
              {t(
                "invitation.expiredBody",
                "This invitation has expired. Please request a new one.",
              )}
            </p>
            <Link to="/login">
              <Button variant="outline" className="w-full">
                {t("invitation.goToLogin", "Go to Login")}
              </Button>
            </Link>
          </div>
        ) : !isAuthenticated ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted text-center mb-4">
              {t(
                "invitation.loginPrompt",
                "Please log in or create an account to accept this invitation.",
              )}
            </p>
            <Link
              to={buildAuthUrl("/login", `/invite/${token}`, invitation.email)}
            >
              <Button className="w-full bg-primary hover:bg-primary-hover">
                {t("invitation.logIn", "Log In")}
              </Button>
            </Link>
            <Link
              to={buildAuthUrl(
                "/register",
                `/invite/${token}`,
                invitation.email,
              )}
            >
              <Button variant="outline" className="w-full">
                {t("invitation.createAccount", "Create Account")}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              onClick={handleAccept}
              disabled={acceptInvitation.isPending}
              className="w-full bg-primary hover:bg-primary-hover"
            >
              {acceptInvitation.isPending
                ? t("invitation.accepting", "Accepting…")
                : t("invitation.accept", "Accept Invitation")}
            </Button>
            <Link to="/chat">
              <Button variant="outline" className="w-full">
                {t("common.cancel", "Cancel")}
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
