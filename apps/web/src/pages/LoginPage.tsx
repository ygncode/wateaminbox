import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CircleAlert,
  LoaderCircle,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { AuthPageShell } from "../components/auth/AuthPageShell";
import { GoogleSignInButton } from "../components/auth/GoogleSignInButton";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import { resendVerification } from "../lib/api";
import {
  buildAuthUrl,
  getAuthRedirectFromState,
  getInvitationTokenFromRedirect,
  getSafeAuthRedirect,
} from "../lib/auth-redirect";
import { isEmailVerificationRequiredError } from "../lib/email-verification";
import { productAnalytics } from "../lib/product-analytics";
import { type LoginFormData, loginSchema } from "../lib/schemas";
import { workspacePath } from "../lib/workspace-routes";

export function LoginPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo =
    getSafeAuthRedirect(searchParams.get("redirect")) ??
    getAuthRedirectFromState(location.state);
  const invitationToken = getInvitationTokenFromRedirect(redirectTo);
  const suggestedEmail = searchParams.get("email") ?? "";
  const googleResult = searchParams.get("google");
  const googleError = searchParams.get("googleError");
  const { login, isLoading, error, clearError, isAuthenticated } = useAuth();
  const {
    activeWorkspaceId,
    isLoading: isWorkspaceLoading,
    needsWorkspaceSetup,
    needsWorkspaceChoice,
  } = useWorkspace();

  const [verificationRequired, setVerificationRequired] = React.useState(false);
  const [isResending, setIsResending] = React.useState(false);
  const [resendMessage, setResendMessage] = React.useState<string | null>(null);
  const [resendError, setResendError] = React.useState<string | null>(null);

  const {
    register,
    getValues,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: suggestedEmail,
      password: "",
    },
  });
  const currentEmail = watch("email");

  // Returning from Google is a full page load: the API already set the refresh
  // cookie, and AuthProvider restores the session from it on boot exactly as on
  // any reload. The effect above then routes the user onward. Only record the
  // analytics event here, once the session has actually been restored.
  const googleTracked = React.useRef(false);
  React.useEffect(() => {
    if (!googleResult || googleTracked.current || !isAuthenticated) return;
    googleTracked.current = true;
    productAnalytics.track(googleResult === "signup" ? "sign_up" : "login", {
      method: "google",
    });
  }, [googleResult, isAuthenticated]);

  const googleErrorMessage = googleError
    ? googleError === "cancelled"
      ? t("auth.googleCancelled", "Google sign-in was cancelled.")
      : googleError === "unverified"
        ? t(
            "auth.googleUnverified",
            "Your Google account email is not verified. Verify it with Google or sign in with email.",
          )
        : googleError === "mismatch"
          ? t(
              "auth.googleMismatch",
              "This email is already linked to a different Google account.",
            )
          : t(
              "auth.googleFailed",
              "Google sign-in did not complete. Please try again.",
            )
    : null;

  // Return users to the invitation (or other protected destination) after
  // login. An invitation can be accepted before the user has any company.
  React.useEffect(() => {
    if (!isAuthenticated || isWorkspaceLoading) return;
    if (redirectTo) {
      navigate(redirectTo, { replace: true });
    } else if (needsWorkspaceSetup) {
      navigate("/company-setup", { replace: true });
    } else if (needsWorkspaceChoice || !activeWorkspaceId) {
      navigate("/workspaces", { replace: true });
    } else {
      navigate(workspacePath(activeWorkspaceId), { replace: true });
    }
  }, [
    activeWorkspaceId,
    isAuthenticated,
    isWorkspaceLoading,
    navigate,
    needsWorkspaceChoice,
    needsWorkspaceSetup,
    redirectTo,
  ]);

  const onSubmit = async (data: LoginFormData) => {
    clearError();
    setVerificationRequired(false);
    setResendMessage(null);
    setResendError(null);
    try {
      await login(data.email, data.password);
      productAnalytics.track("login", { method: "email" });
      // Navigation is handled by useEffect based on auth state
    } catch (loginError) {
      if (isEmailVerificationRequiredError(loginError)) {
        setVerificationRequired(true);
      }
    }
  };

  const resendVerificationEmail = async () => {
    const { email, password } = getValues();
    setIsResending(true);
    setResendMessage(null);
    setResendError(null);
    try {
      const response = await resendVerification(
        email,
        password,
        invitationToken,
      );
      setResendMessage(response.message);
    } catch (resendFailure) {
      setResendError(
        resendFailure instanceof Error
          ? resendFailure.message
          : t(
              "auth.resendVerificationFailed",
              "Could not resend the verification email",
            ),
      );
    } finally {
      setIsResending(false);
    }
  };

  const clearLoginFeedback = () => {
    if (error) clearError();
    if (verificationRequired) setVerificationRequired(false);
    setResendMessage(null);
    setResendError(null);
  };

  return (
    <AuthPageShell variant="login">
      <div className="mx-auto w-full max-w-[30rem]">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">
          {t("auth.welcomeBack", "Welcome back")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg text-balance sm:text-4xl">
          {t("auth.loginTitle", "Sign in to your team inbox")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-fg-muted">
          {t(
            "auth.loginSubtitle",
            "Continue managing conversations, assignments, and customer context with your team.",
          )}
        </p>

        {googleErrorMessage && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm leading-5 text-danger"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <p>{googleErrorMessage}</p>
          </div>
        )}

        <GoogleSignInButton redirect={redirectTo} />

        <form
          onSubmit={handleSubmit(onSubmit)}
          onChange={clearLoginFeedback}
          className="mt-6 space-y-5 [&_input]:h-11 [&_input]:rounded-xl [&_input]:border-line-strong [&_input]:bg-raised [&_input]:px-3.5"
          aria-busy={isLoading}
          noValidate
        >
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm leading-5 text-danger"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p>{error}</p>
                {verificationRequired && (
                  <button
                    type="button"
                    onClick={resendVerificationEmail}
                    disabled={isResending || Boolean(resendMessage)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResending ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin"
                      />
                    ) : (
                      <MailCheck aria-hidden="true" className="h-4 w-4" />
                    )}
                    {isResending
                      ? t("auth.sending", "Sending…")
                      : t(
                          "auth.resendVerification",
                          "Resend verification email",
                        )}
                  </button>
                )}
                {resendMessage && (
                  <p className="mt-2 font-medium text-accent">
                    {resendMessage}
                  </p>
                )}
                {resendError && <p className="mt-2">{resendError}</p>}
              </div>
            </div>
          )}

          <FormField
            label={t("auth.workEmail", "Work email")}
            id="email"
            type="email"
            placeholder="you@company.com"
            registration={register("email")}
            error={errors.email}
            autoComplete="email"
            autoFocus
          />

          <div>
            <FormField
              label={t("auth.password", "Password")}
              id="password"
              type="password"
              placeholder={t("auth.passwordPlaceholder", "Enter your password")}
              registration={register("password")}
              error={errors.password}
              autoComplete="current-password"
              showPasswordToggle
            />
            <div className="mt-2 flex justify-end">
              <Link
                to={buildAuthUrl("/forgot-password", redirectTo, currentEmail)}
                className="rounded-sm text-sm font-semibold text-accent underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {t("auth.forgotPasswordLink", "Forgot password?")}
              </Link>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="h-12 w-full rounded-xl bg-primary text-on-primary shadow-lg hover:bg-accent-soft"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                {t("auth.signingIn", "Signing in…")}
              </>
            ) : (
              <>
                {t("auth.signInAction", "Sign in")}
                <ArrowRight aria-hidden="true" className="rtl:-scale-x-100" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-line bg-subtle/80 p-4">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-accent"
          />
          <p className="text-xs leading-5 text-fg-muted">
            {t(
              "auth.loginPrivacyNote",
              "Your sign-in is protected, and workspace access stays private to approved team members.",
            )}
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-fg-muted">
          {t("auth.newToApp", "New to WATeamInbox?")}{" "}
          <Link
            to={buildAuthUrl("/register", redirectTo, currentEmail)}
            className="rounded-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t("auth.createAccountLink", "Create an account")}
          </Link>
        </p>
      </div>
    </AuthPageShell>
  );
}
