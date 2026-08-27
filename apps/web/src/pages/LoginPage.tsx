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
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
          {t("auth.welcomeBack", "Welcome back")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
          {t("auth.loginTitle", "Sign in to your team inbox")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
          {t(
            "auth.loginSubtitle",
            "Continue managing conversations, assignments, and customer context with your team.",
          )}
        </p>

        <form
          onSubmit={handleSubmit(onSubmit)}
          onChange={clearLoginFeedback}
          className="mt-8 space-y-5 [&_input]:h-11 [&_input]:rounded-xl [&_input]:border-slate-300 [&_input]:bg-white [&_input]:px-3.5 dark:[&_input]:border-dark-border dark:[&_input]:bg-dark-tertiary"
          aria-busy={isLoading}
          noValidate
        >
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
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
                    className="mt-2 inline-flex items-center gap-1.5 rounded-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-60"
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
                  <p className="mt-2 font-medium text-emerald-700 dark:text-emerald-300">
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
                className="rounded-sm text-sm font-semibold text-[#0a7c43] underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-offset-2 dark:text-[#52df83] dark:focus-visible:ring-offset-dark-elevated"
              >
                {t("auth.forgotPasswordLink", "Forgot password?")}
              </Link>
            </div>
          </div>

          <Button
            type="submit"
            size="lg"
            className="h-12 w-full rounded-xl bg-[#075e54] text-white shadow-lg shadow-[#075e54]/15 hover:bg-[#064b43] dark:bg-whatsapp-green-a11y-button dark:hover:bg-whatsapp-green-a11y-button/90"
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
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-dark-border dark:bg-dark-tertiary/50">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-[#0a7c43] dark:text-[#52df83]"
          />
          <p className="text-xs leading-5 text-slate-500 dark:text-dark-text-secondary">
            {t(
              "auth.loginPrivacyNote",
              "Your sign-in is protected, and workspace access stays private to approved team members.",
            )}
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-slate-600 dark:text-dark-text-secondary">
          {t("auth.newToApp", "New to WATeamInbox?")}{" "}
          <Link
            to={buildAuthUrl("/register", redirectTo, currentEmail)}
            className="rounded-sm font-semibold text-[#0a7c43] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-offset-2 dark:text-[#52df83] dark:focus-visible:ring-offset-dark-elevated"
          >
            {t("auth.createAccountLink", "Create an account")}
          </Link>
        </p>
      </div>
    </AuthPageShell>
  );
}
