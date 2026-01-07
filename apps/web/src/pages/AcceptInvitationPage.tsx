import {
  Building2,
  CheckCircle,
  Clock,
  Mail,
  User,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { dayjs, now } from "@whatsapp-web/shared";
import { Button, Skeleton } from "../components/ui";
import { useAuth } from "../contexts/auth-context";
import { useAcceptInvitation, useInvitationByToken } from "../hooks/useTeam";

/**
 * Accept Invitation page
 * Allows users to view and accept team invitations
 */
export function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, refreshSession } = useAuth();
  const [accepted, setAccepted] = useState(false);
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

  // Format date for display
  const formatDate = (dateString: string) => {
    return dayjs(dateString).format("MMMM D, YYYY");
  };

  const handleAccept = async () => {
    if (!token) return;

    try {
      setError(null);
      await acceptInvitation.mutateAsync(token);
      setAccepted(true);
      // Refresh the session to update companies list
      await refreshSession();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to accept invitation",
      );
    }
  };

  // Redirect to chat after successful acceptance
  useEffect(() => {
    if (accepted) {
      const timer = setTimeout(() => {
        navigate("/chat");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [accepted, navigate]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
        <div className="w-full max-w-md rounded-lg bg-white dark:bg-dark-elevated p-8 shadow-lg">
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
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
        <div className="w-full max-w-md rounded-lg bg-white dark:bg-dark-elevated p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary mb-2">
            Invalid Invitation
          </h1>
          <p className="text-gray-600 dark:text-dark-text-secondary mb-6">
            This invitation link is invalid or has already been used.
          </p>
          <Link to="/login">
            <Button className="w-full bg-whatsapp-teal-green hover:bg-whatsapp-dark-green">
              Go to Login
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Show success state after accepting
  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
        <div className="w-full max-w-md rounded-lg bg-white dark:bg-dark-elevated p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary mb-2">
            Welcome to {invitation.companyName}!
          </h1>
          <p className="text-gray-600 dark:text-dark-text-secondary mb-4">
            You have successfully joined the team. Redirecting you to the
            chat...
          </p>
          <div className="animate-pulse text-sm text-gray-500 dark:text-dark-text-tertiary">
            Redirecting in a moment...
          </div>
        </div>
      </div>
    );
  }

  // Main invitation view
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-dark-primary">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-dark-elevated p-8 shadow-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-whatsapp-light-green">
            <Mail className="h-8 w-8 text-whatsapp-dark-green" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-dark-text-primary">
            Team Invitation
          </h1>
          <p className="text-gray-600 dark:text-dark-text-secondary mt-1">
            You have been invited to join a team
          </p>
        </div>

        {/* Invitation details */}
        <div className="space-y-4 mb-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-dark-tertiary">
            <Building2 className="h-5 w-5 text-gray-500 dark:text-dark-text-tertiary flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                Company
              </p>
              <p className="font-medium text-gray-900 dark:text-dark-text-primary">
                {invitation.companyName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-dark-tertiary">
            <Mail className="h-5 w-5 text-gray-500 dark:text-dark-text-tertiary flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                Invited Email
              </p>
              <p className="font-medium text-gray-900 dark:text-dark-text-primary">
                {invitation.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-dark-tertiary">
            <User className="h-5 w-5 text-gray-500 dark:text-dark-text-tertiary flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                Invited By
              </p>
              <p className="font-medium text-gray-900 dark:text-dark-text-primary">
                {invitation.invitedBy}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-dark-tertiary">
            <Clock className="h-5 w-5 text-gray-500 dark:text-dark-text-tertiary flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-dark-text-tertiary">
                Expires
              </p>
              <p
                className={`font-medium ${
                  isExpired
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-900 dark:text-dark-text-primary"
                }`}
              >
                {formatDate(invitation.expiresAt)}
                {isExpired && " (Expired)"}
              </p>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Action buttons */}
        {isExpired ? (
          <div className="text-center">
            <p className="text-red-600 dark:text-red-400 mb-4">
              This invitation has expired. Please request a new one.
            </p>
            <Link to="/login">
              <Button variant="outline" className="w-full">
                Go to Login
              </Button>
            </Link>
          </div>
        ) : !isAuthenticated ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-dark-text-secondary text-center mb-4">
              Please log in or create an account to accept this invitation.
            </p>
            <Link to={`/login?redirect=/invite/${token}`}>
              <Button className="w-full bg-whatsapp-teal-green hover:bg-whatsapp-dark-green">
                Log In
              </Button>
            </Link>
            <Link
              to={`/register?redirect=/invite/${token}&email=${encodeURIComponent(invitation.email)}`}
            >
              <Button variant="outline" className="w-full">
                Create Account
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              onClick={handleAccept}
              disabled={acceptInvitation.isPending}
              className="w-full bg-whatsapp-teal-green hover:bg-whatsapp-dark-green"
            >
              {acceptInvitation.isPending
                ? "Accepting..."
                : "Accept Invitation"}
            </Button>
            <Link to="/chat">
              <Button variant="outline" className="w-full">
                Cancel
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
