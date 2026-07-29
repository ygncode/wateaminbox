import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  MailCheck,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthPageShell } from "../components/auth/AuthPageShell";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useAuth } from "../contexts/auth-context";
import { buildAuthUrl, getSafeAuthRedirect } from "../lib/auth-redirect";
import { type RegisterFormData, registerSchema } from "../lib/schemas";

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = getSafeAuthRedirect(searchParams.get("redirect"));
  const suggestedEmail = searchParams.get("email") ?? "";
  const {
    register: registerUser,
    isLoading,
    error,
    clearError,
    isAuthenticated,
  } = useAuth();
  const [registrationSuccess, setRegistrationSuccess] = React.useState(false);
  const [registeredEmail, setRegisteredEmail] = React.useState("");

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
      await registerUser({
        name: data.name,
        email: data.email,
        password: data.password,
      });
      setRegisteredEmail(data.email);
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
            <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-[#e2f8e9] text-[#075e54] dark:bg-[#25d366]/15 dark:text-[#52df83]">
              <MailCheck aria-hidden="true" className="h-8 w-8" />
            </span>
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
            Account created
          </p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
            Verify your email to continue
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
            We sent a verification link to{" "}
            <strong className="break-all font-semibold text-slate-900 dark:text-dark-text-primary">
              {registeredEmail}
            </strong>
            . Open it to activate your WATeamInbox account.
          </p>

          <div className="mt-7 flex w-full items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-left dark:border-[#25d366]/20 dark:bg-[#25d366]/[0.07]">
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-[#0a7c43] dark:text-[#52df83]"
            />
            <p className="text-sm leading-5 text-emerald-950/75 dark:text-emerald-50/70">
              The link may take a minute to arrive. Check your spam folder if
              you don&apos;t see it.
            </p>
          </div>

          <Button
            asChild
            size="lg"
            className="mt-7 h-12 w-full rounded-xl bg-[#075e54] text-white shadow-lg shadow-[#075e54]/15 hover:bg-[#064b43]"
          >
            <Link to={buildAuthUrl("/login", redirectTo, registeredEmail)}>
              Continue to sign in
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
          Create your workspace
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
          Bring your team into one inbox
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
          Set up your account and start turning customer conversations into
          coordinated teamwork.
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
              label="Full name"
              id="name"
              type="text"
              placeholder="Your name"
              registration={register("name")}
              error={errors.name}
              autoComplete="name"
              autoFocus
            />

            <FormField
              label="Work email"
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
              label="Password"
              id="password"
              type="password"
              placeholder="At least 8 characters"
              registration={register("password")}
              error={errors.password}
              autoComplete="new-password"
              hint="Use 8 or more characters."
              showPasswordToggle
            />

            <FormField
              label="Confirm password"
              id="confirmPassword"
              type="password"
              placeholder="Repeat your password"
              registration={register("confirmPassword")}
              error={errors.confirmPassword}
              autoComplete="new-password"
              showPasswordToggle
            />
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
                Creating your account…
              </>
            ) : (
              <>
                Create account
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600 dark:text-dark-text-secondary">
          Already have an account?{" "}
          <Link
            to={buildAuthUrl("/login", redirectTo, suggestedEmail)}
            className="rounded-sm font-semibold text-[#0a7c43] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-offset-2 dark:text-[#52df83] dark:focus-visible:ring-offset-dark-elevated"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthPageShell>
  );
}
