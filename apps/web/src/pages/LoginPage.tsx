import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowRight,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { AuthPageShell } from "../components/auth/AuthPageShell";
import { Button } from "../components/ui/button";
import { FormField } from "../components/ui/form-field";
import { useAuth } from "../contexts/auth-context";
import { useWorkspace } from "../contexts/workspace-context";
import {
  buildAuthUrl,
  getAuthRedirectFromState,
  getSafeAuthRedirect,
} from "../lib/auth-redirect";
import { type LoginFormData, loginSchema } from "../lib/schemas";
import { workspacePath } from "../lib/workspace-routes";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo =
    getSafeAuthRedirect(searchParams.get("redirect")) ??
    getAuthRedirectFromState(location.state);
  const suggestedEmail = searchParams.get("email") ?? "";
  const { login, isLoading, error, clearError, isAuthenticated } = useAuth();
  const {
    activeWorkspaceId,
    isLoading: isWorkspaceLoading,
    needsWorkspaceSetup,
    needsWorkspaceChoice,
  } = useWorkspace();

  const {
    register,
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
    try {
      await login(data.email, data.password);
      // Navigation is handled by useEffect based on auth state
    } catch {
      // Error is handled by auth context
    }
  };

  return (
    <AuthPageShell variant="login">
      <div className="mx-auto w-full max-w-[30rem]">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0a7c43] dark:text-[#52df83]">
          Welcome back
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 text-balance sm:text-4xl dark:text-dark-text-primary">
          Sign in to your team inbox
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-dark-text-secondary">
          Continue managing conversations, assignments, and customer context
          with your team.
        </p>

        <form
          onSubmit={handleSubmit(onSubmit)}
          onChange={error ? clearError : undefined}
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
              <span>{error}</span>
            </div>
          )}

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

          <div>
            <FormField
              label="Password"
              id="password"
              type="password"
              placeholder="Enter your password"
              registration={register("password")}
              error={errors.password}
              autoComplete="current-password"
              showPasswordToggle
            />
            <div className="mt-2 flex justify-end">
              <Link
                to={buildAuthUrl(
                  "/forgot-password",
                  redirectTo,
                  currentEmail,
                )}
                className="rounded-sm text-sm font-semibold text-[#0a7c43] underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-offset-2 dark:text-[#52df83] dark:focus-visible:ring-offset-dark-elevated"
              >
                Forgot password?
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
                Signing in…
              </>
            ) : (
              <>
                Sign in
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
            Your sign-in is protected, and workspace access stays private to
            approved team members.
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-slate-600 dark:text-dark-text-secondary">
          New to WATeamInbox?{" "}
          <Link
            to={buildAuthUrl("/register", redirectTo, currentEmail)}
            className="rounded-sm font-semibold text-[#0a7c43] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#075e54] focus-visible:ring-offset-2 dark:text-[#52df83] dark:focus-visible:ring-offset-dark-elevated"
          >
            Create an account
          </Link>
        </p>
      </div>
    </AuthPageShell>
  );
}
