import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MailCheck,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Trans, useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuthPageShell } from "../components/auth/AuthPageShell";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useAuth } from "../contexts/auth-context";
import {
  buildAuthUrl,
  getInvitationTokenFromRedirect,
  getSafeAuthRedirect,
} from "../lib/auth-redirect";
import { API_BASE_URL } from "../lib/api/client";
import { productAnalytics } from "../lib/product-analytics";
import { type RegisterFormData, registerSchema } from "../lib/schemas";

export function RegisterPage() {
  const { t } = useTranslation();

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = getSafeAuthRedirect(searchParams.get("redirect"));
  const invitationToken = getInvitationTokenFromRedirect(redirectTo);
  const isInvitationRegistration = Boolean(invitationToken);
  const suggestedEmail = searchParams.get("email") ?? "";
  const {
    register: registerUser,
    isLoading,
    error,
    clearError,
    isAuthenticated,
  } = useAuth();
  const [discoverySources, setDiscoverySources] = React.useState<
    Array<{ value: string; label: string }>
  >([]);
  const [discoverySource, setDiscoverySource] = React.useState("");
  const [discoveryOther, setDiscoveryOther] = React.useState("");
  React.useEffect(() => {
    if (isInvitationRegistration) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    // Optional host capability: self-hosted servers need not provide this route.
    void fetch(`${API_BASE_URL}/auth/registration-options`, {
      signal: controller.signal,
    })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (
          controller.signal.aborted ||
          !payload ||
          typeof payload !== "object"
        )
          return;
        const options = (payload as { discoverySources?: unknown })
          .discoverySources;
        if (
          Array.isArray(options) &&
          options.length <= 20 &&
          options.every(
            (option) =>
              option &&
              typeof option.value === "string" &&
              typeof option.label === "string" &&
              option.value.length <= 50 &&
              option.label.length <= 100,
          )
        )
          setDiscoverySources(options);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [isInvitationRegistration]);
  const [registrationSuccess, setRegistrationSuccess] = React.useState(false);
  const [registeredEmail, setRegisteredEmail] = React.useState("");
  const [verificationEmailSent, setVerificationEmailSent] =
    React.useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: suggestedEmail,
      password: "",
      confirmPassword: "",
    },
  });

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectTo ?? "/chat", { replace: true });
    }
  }, [isAuthenticated, navigate, redirectTo]);

  const onSubmit = async (data: RegisterFormData) => {
    clearError();
    try {
      const response = await registerUser({
        name: data.name,
        email: data.email,
        password: data.password,
        invitationToken,
        discoverySource:
          !isInvitationRegistration &&
          discoverySources.some((option) => option.value === discoverySource)
            ? {
                source: discoverySource,
                ...(discoverySource === "other" && discoveryOther.trim()
                  ? { other: discoveryOther.trim() }
                  : {}),
              }
            : undefined,
      });
      productAnalytics.track("sign_up", { method: "email" });
      setRegisteredEmail(data.email);
      setVerificationEmailSent(response.verificationEmailSent);
      setRegistrationSuccess(true);
    } catch {
      // Error is handled by auth context
    }
  };

  if (registrationSuccess) {
    return (
      <AuthPageShell variant="register">
        <div
          className="flex flex-col items-center text-center"
          aria-live="polite"
        >
          <div className="relative mb-7">
            <div
              className="absolute inset-0 scale-150 rounded-full bg-[#25d366]/10"
              aria-hidden="true"
            />
            <span
              className={`relative grid h-16 w-16 place-items-center rounded-2xl ${
                verificationEmailSent
                  ? "bg-[#e2f8e9] text-[#075e54] dark:bg-[#25d366]/15 dark:text-[#52df83]"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
              }`}
            >
              {verificationEmailSent ? (
                <MailCheck aria-hidden="true" className="h-8 w-8" />
              ) : (
                <CircleAlert aria-hidden="true" className="h-8 w-8" />
              )}
            </span>
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
            {t("auth.accountCreated", "Account created")}
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
            {verificationEmailSent
              ? t("auth.verifyEmailTitle", "Verify your email to continue")
              : t(
                  "auth.emailDeliveryFailedTitle",
                  "Account created, but email delivery failed",
                )}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
            {verificationEmailSent ? (
              <Trans
                i18nKey="auth.verificationSentTo"
                values={{ email: registeredEmail }}
                defaults="We sent a verification link to <strong>{{email}}</strong>. Open it to activate your WATeamInbox account."
                components={{
                  strong: (
                    <strong className="break-all font-semibold text-slate-900 dark:text-dark-text-primary" />
                  ),
                }}
              />
            ) : (
              <Trans
                i18nKey="auth.verificationFailedTo"
                values={{ email: registeredEmail }}
                defaults="We could not send the verification link to <strong>{{email}}</strong>. Sign in with your new credentials to retry delivery."
                components={{
                  strong: (
                    <strong className="break-all font-semibold text-slate-900 dark:text-dark-text-primary" />
                  ),
                }}
              />
            )}
          </p>

          <div
            className={`mt-7 flex w-full items-start gap-3 rounded-2xl border p-4 text-left ${
              verificationEmailSent
                ? "border-emerald-100 bg-emerald-50/70 dark:border-[#25d366]/20 dark:bg-[#25d366]/[0.07]"
                : "border-amber-200 bg-amber-50 dark:border-amber-400/25 dark:bg-amber-400/[0.08]"
            }`}
          >
            {verificationEmailSent ? (
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-[#0a7c43] dark:text-[#52df83]"
              />
            ) : (
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300"
              />
            )}
            <p
              className={`text-sm leading-5 ${
                verificationEmailSent
                  ? "text-emerald-950/75 dark:text-emerald-50/70"
                  : "text-amber-950/80 dark:text-amber-100/80"
              }`}
            >
              {verificationEmailSent
                ? t(
                    "auth.verificationHint",
                    "The link may take a minute to arrive. Check your spam folder if you don't see it.",
                  )
                : t(
                    "auth.deliveryFailedHint",
                    "Your account was kept safely. The sign-in page can send a fresh link after checking your password.",
                  )}
            </p>
          </div>

          <Button
            asChild
            size="lg"
            className="mt-7 h-12 w-full rounded-xl bg-[#075e54] text-white shadow-lg shadow-[#075e54]/15 hover:bg-[#064b43]"
          >
            <Link to={buildAuthUrl("/login", redirectTo, registeredEmail)}>
              {verificationEmailSent
                ? t("auth.continueToSignIn", "Continue to sign in")
                : t("auth.goToSignInRetry", "Go to sign in and retry")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell variant="register">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
          {isInvitationRegistration
            ? t("auth.joinWorkspaceEyebrow", "Join your team")
            : t("auth.createWorkspaceEyebrow", "Create your workspace")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
          {isInvitationRegistration
            ? t("auth.invitationRegisterTitle", "Create your account to join")
            : t("auth.registerTitle", "Bring your team into one inbox")}
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
          {isInvitationRegistration
            ? t(
                "auth.invitationRegisterSubtitle",
                "Verify the invited email and we'll add you to the workspace automatically.",
              )
            : t(
                "auth.registerSubtitle",
                "Set up your account and start turning customer conversations into coordinated teamwork.",
              )}
        </p>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-8 space-y-5 [&_input]:h-11 [&_input]:rounded-xl [&_input]:border-slate-300 [&_input]:bg-white [&_input]:px-3.5 dark:[&_input]:border-dark-border dark:[&_input]:bg-dark-tertiary"
          aria-busy={isLoading}
          noValidate
        >
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              label={t("auth.fullName", "Full name")}
              id="name"
              type="text"
              placeholder={t("auth.fullNamePlaceholder", "Your name")}
              registration={register("name")}
              error={errors.name}
              autoComplete="name"
              autoFocus
            />

            <FormField
              label={t("auth.workEmail", "Work email")}
              id="email"
              type="email"
              placeholder="you@company.com"
              registration={register("email")}
              error={errors.email}
              autoComplete="email"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              label={t("auth.password", "Password")}
              id="password"
              type="password"
              placeholder={t(
                "auth.passwordMinPlaceholder",
                "At least 8 characters",
              )}
              registration={register("password")}
              error={errors.password}
              autoComplete="new-password"
              hint={t("auth.passwordHint", "Use 8 or more characters.")}
              showPasswordToggle
            />

            <FormField
              label={t("auth.confirmPasswordLabel", "Confirm password")}
              id="confirmPassword"
              type="password"
              placeholder={t(
                "auth.confirmPasswordPlaceholder",
                "Repeat your password",
              )}
              registration={register("confirmPassword")}
              error={errors.confirmPassword}
              autoComplete="new-password"
              showPasswordToggle
            />
          </div>

          {!isInvitationRegistration && discoverySources.length > 0 && (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="discovery-source"
                  className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-dark-text-secondary"
                >
                  {t("auth.discoverySource", "How did you hear about us?")}{" "}
                  <span className="font-normal text-slate-500 dark:text-dark-text-secondary">
                    {t("auth.optional", "(optional)")}
                  </span>
                </label>
                <select
                  id="discovery-source"
                  value={discoverySource}
                  onChange={(event) => {
                    setDiscoverySource(event.target.value);
                    setDiscoveryOther("");
                  }}
                  disabled={isLoading}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] disabled:opacity-50 dark:border-dark-border dark:bg-dark-tertiary dark:text-dark-text-primary"
                >
                  <option value="">
                    {t("auth.discoverySourcePlaceholder", "Select an option")}
                  </option>
                  {discoverySources.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {discoverySource === "other" && (
                <div>
                  <label
                    htmlFor="discovery-other"
                    className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-dark-text-secondary"
                  >
                    {t(
                      "auth.discoveryOther",
                      "Where did you hear about us? (optional)",
                    )}
                  </label>
                  <input
                    id="discovery-other"
                    type="text"
                    value={discoveryOther}
                    onChange={(event) => setDiscoveryOther(event.target.value)}
                    maxLength={200}
                    disabled={isLoading}
                    autoComplete="off"
                    className="w-full border text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] dark:text-dark-text-primary"
                  />
                </div>
              )}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="h-12 w-full rounded-xl bg-[#075e54] text-white shadow-lg shadow-[#075e54]/15 hover:bg-[#064b43] dark:bg-whatsapp-green-a11y-button dark:hover:bg-whatsapp-green-a11y-button/90"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                {t("auth.creatingAccount", "Creating your account…")}
              </>
            ) : (
              <>
                {t("auth.createAccountAction", "Create account")}
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600 dark:text-dark-text-secondary">
          {t("auth.alreadyHaveAccount", "Already have an account?")}{" "}
          <Link
            to={buildAuthUrl("/login", redirectTo, suggestedEmail)}
            className="rounded-sm font-semibold text-[#0a7c43] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-offset-2 dark:text-[#52df83] dark:focus-visible:ring-offset-dark-elevated"
          >
            {t("auth.signInAction", "Sign in")}
          </Link>
        </p>
      </div>
    </AuthPageShell>
  );
}
