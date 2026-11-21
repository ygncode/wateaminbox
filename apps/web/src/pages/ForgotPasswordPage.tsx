import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router";
import { AuthPageShell } from "../components/auth/AuthPageShell";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useForgotPassword } from "../hooks/useAuthMutations";
import { buildAuthUrl, getSafeAuthRedirect } from "../lib/auth-redirect";
import {
  type ForgotPasswordFormData,
  forgotPasswordSchema,
} from "../lib/schemas/auth";
import { Trans, useTranslation } from "react-i18next";

export function ForgotPasswordPage() {
  const { t } = useTranslation();

  const [searchParams] = useSearchParams();
  const redirectTo = getSafeAuthRedirect(searchParams.get("redirect"));
  const suggestedEmail = searchParams.get("email") ?? "";
  const [isSubmitted, setIsSubmitted] = React.useState(false);
  const [submittedEmail, setSubmittedEmail] = React.useState("");
  const forgotPasswordMutation = useForgotPassword();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: suggestedEmail,
    },
  });

  const onSubmit = (data: ForgotPasswordFormData) => {
    forgotPasswordMutation.mutate(
      { email: data.email },
      {
        onSuccess: () => {
          setSubmittedEmail(data.email);
          setIsSubmitted(true);
        },
        onError: () => {
          // Backend always returns success to prevent email enumeration
          // but we show success anyway for the same reason
          setSubmittedEmail(data.email);
          setIsSubmitted(true);
        },
      },
    );
  };

  if (isSubmitted) {
    return (
      <AuthPageShell variant="recovery">
        <div
          className="flex flex-col items-center text-center"
          aria-live="polite"
        >
          <div className="relative mb-7">
            <div
              className="absolute inset-0 scale-150 rounded-full bg-accent/10"
              aria-hidden="true"
            />
            <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-accent-soft text-accent">
              <MailCheck aria-hidden="true" className="h-8 w-8" />
            </span>
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-accent">
            {t("auth.requestReceived", "Request received")}
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-fg text-balance sm:text-4xl">
            {t("auth.checkInbox", "Check your inbox")}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-fg-muted">
            <Trans
              i18nKey="auth.resetLinkSent"
              values={{ email: submittedEmail }}
              defaults="If an account exists for <strong>{{email}}</strong>, we've sent a secure password reset link."
              components={{
                strong: <strong className="break-all font-semibold text-fg" />,
              }}
            />
          </p>

          <div className="mt-7 w-full rounded-2xl border border-line bg-muted/60 p-4 text-start">
            <p className="text-sm font-semibold text-fg">
              {t("auth.nothingYet", "Nothing yet?")}
            </p>
            <p className="mt-1 text-sm leading-5 text-fg-muted">
              <Trans
                i18nKey="auth.nothingYetHint"
                defaults="Allow a few minutes, then check your spam folder or <retry>try another email</retry>."
                components={{
                  retry: (
                    <button
                      type="button"
                      onClick={() => setIsSubmitted(false)}
                      className="rounded-sm font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  ),
                }}
              />
            </p>
          </div>

          <Button
            asChild
            size="lg"
            className="mt-7 h-12 w-full rounded-xl bg-primary text-on-primary shadow-lg hover:bg-primary-hover"
          >
            <Link to={buildAuthUrl("/login", redirectTo, submittedEmail)}>
              {t("auth.returnToSignIn", "Return to sign in")}
              <ArrowRight aria-hidden="true" className="rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell variant="recovery">
      <div>
        <Link
          to={buildAuthUrl("/login", redirectTo, suggestedEmail)}
          className="mb-8 inline-flex items-center gap-2 rounded-sm text-sm font-semibold text-fg-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4 rtl:-scale-x-100" />
          {t("auth.backToSignIn", "Back to sign in")}
        </Link>

        <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">
          {t("auth.accountRecovery", "Account recovery")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-fg text-balance sm:text-4xl">
          {t("auth.forgotPasswordTitle", "Forgot your password?")}
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-fg-muted">
          {t(
            "auth.forgotPasswordSubtitle",
            "Enter the email you use for WATeamInbox. We'll send instructions to help you choose a new password.",
          )}
        </p>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-8 space-y-5 [&_input]:h-11 [&_input]:rounded-xl [&_input]:border-line-strong [&_input]:bg-raised [&_input]:px-3.5"
          aria-busy={forgotPasswordMutation.isPending}
          noValidate
        >
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

          <Button
            type="submit"
            size="lg"
            className="h-12 w-full rounded-xl bg-primary text-on-primary shadow-lg hover:bg-accent-soft"
            disabled={forgotPasswordMutation.isPending}
          >
            {forgotPasswordMutation.isPending ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                {t("auth.sendingSecureLink", "Sending secure link…")}
              </>
            ) : (
              <>
                {t("auth.sendResetLink", "Send reset link")}
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
              "auth.forgotPasswordPrivacyNote",
              "For your privacy, we'll show the same confirmation whether or not an account is registered with that email.",
            )}
          </p>
        </div>
      </div>
    </AuthPageShell>
  );
}
