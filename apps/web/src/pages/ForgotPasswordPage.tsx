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
import { Link } from "react-router-dom";
import { AuthPageShell } from "../components/auth/AuthPageShell";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useForgotPassword } from "../hooks/useAuthMutations";
import {
  type ForgotPasswordFormData,
  forgotPasswordSchema,
} from "../lib/schemas/auth";

export function ForgotPasswordPage() {
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
      email: "",
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
              className="absolute inset-0 scale-150 rounded-full bg-[#25d366]/10"
              aria-hidden="true"
            />
            <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-[#e2f8e9] text-[#075e54] dark:bg-[#25d366]/15 dark:text-[#52df83]">
              <MailCheck aria-hidden="true" className="h-8 w-8" />
            </span>
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
            Request received
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
            Check your inbox
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
            If an account exists for{" "}
            <strong className="break-all font-semibold text-slate-900 dark:text-dark-text-primary">
              {submittedEmail}
            </strong>
            , we&apos;ve sent a secure password reset link.
          </p>

          <div className="mt-7 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left dark:border-dark-border dark:bg-dark-tertiary/60">
            <p className="text-sm font-semibold text-slate-800 dark:text-dark-text-primary">
              Nothing yet?
            </p>
            <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-dark-text-secondary">
              Allow a few minutes, then check your spam folder or{" "}
              <button
                type="button"
                onClick={() => setIsSubmitted(false)}
                className="rounded-sm font-semibold text-[#0a7c43] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] dark:text-[#52df83]"
              >
                try another email
              </button>
              .
            </p>
          </div>

          <Button
            asChild
            size="lg"
            className="mt-7 h-12 w-full rounded-xl bg-[#075e54] text-white shadow-lg shadow-[#075e54]/15 hover:bg-[#064b43]"
          >
            <Link to="/login">
              Return to sign in
              <ArrowRight aria-hidden="true" />
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
          to="/login"
          className="mb-8 inline-flex items-center gap-2 rounded-sm text-sm font-semibold text-slate-500 transition-colors hover:text-[#075e54] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-offset-2 dark:text-dark-text-secondary dark:hover:text-[#52df83] dark:focus-visible:ring-offset-dark-elevated"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to sign in
        </Link>

        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
          Account recovery
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
          Forgot your password?
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
          Enter the email you use for WATeamInbox. We&apos;ll send instructions
          to help you choose a new password.
        </p>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-8 space-y-5 [&_input]:h-11 [&_input]:rounded-xl [&_input]:border-slate-300 [&_input]:bg-white [&_input]:px-3.5 dark:[&_input]:border-dark-border dark:[&_input]:bg-dark-tertiary"
          aria-busy={forgotPasswordMutation.isPending}
        >
          <FormField
            label="Work email"
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
            className="h-12 w-full rounded-xl bg-[#075e54] text-white shadow-lg shadow-[#075e54]/15 hover:bg-[#064b43] dark:bg-whatsapp-green-a11y-button dark:hover:bg-whatsapp-green-a11y-button/90"
            disabled={forgotPasswordMutation.isPending}
          >
            {forgotPasswordMutation.isPending ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                Sending secure link…
              </>
            ) : (
              <>
                Send reset link
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
            For your privacy, we&apos;ll show the same confirmation whether or
            not an account is registered with that email.
          </p>
        </div>
      </div>
    </AuthPageShell>
  );
}
